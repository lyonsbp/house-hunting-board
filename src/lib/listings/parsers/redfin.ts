import * as cheerio from "cheerio";

import {
  ListingFetchError,
  type ListingPreview,
  type ListingPreviewImage,
  type ListingPreviewProperty,
  type PropertyPriceEvent,
} from "../types";
import {
  asInt,
  asNumber,
  asString,
  buildOgFallback,
  dedupeImages,
  pickResidentialNode,
  readImagesFromJsonLd,
  readJsonLd,
} from "./util";

const SOURCE = "redfin" as const;

/**
 * Three-layer parser: embedded `__reactServerState` payload first, JSON-LD
 * residential schema second, OG tags last. Each fallback widens the net but
 * loses fidelity (OG yields exactly one image).
 */
export function parseRedfin(html: string, sourceUrl: string): ListingPreview {
  const $ = cheerio.load(html);

  const fromEmbedded = parseEmbeddedReactState($, sourceUrl);
  if (fromEmbedded) return fromEmbedded;

  const fromJsonLd = parseFromJsonLd($, sourceUrl);
  if (fromJsonLd) return fromJsonLd;

  const fromOg = buildOgFallback($, SOURCE, sourceUrl);
  if (fromOg) return fromOg;

  throw new ListingFetchError(
    "parse",
    "Could not extract a Redfin listing from this page",
  );
}

// ---------------------------------------------------------------------------
// Pathway 1: Redfin's embedded React state.
//
// Redfin ships the listing payload in a `<script>` block that begins with
// `root.__reactServerState.InitialContext = ` and ends with a JSON-stringified
// blob assigned to that property. We slice from the `{` to the matching
// closing `}` and JSON.parse it. Helpfully, Redfin also wraps each individual
// payload in a string that itself JSON-parses to the actual structure — we
// recurse into nested string/JSON until we find usable fields.
// ---------------------------------------------------------------------------

function parseEmbeddedReactState(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): ListingPreview | null {
  // Redfin pages contain at least three top-level assignments inside the
  // same `<script>`:
  //   root.__reactServerState || (root.__reactServerState = {});
  //   root.__reactServerState.InitialContext = { … listing payload … };
  //   root.__reactServerState.Config       = { … };
  //
  // The `||` line nests an empty `{}` that we don't want to land on. Anchor
  // the slice to a known assignment site, with `InitialContext` first since
  // that's where the photo array lives.
  const ANCHORS = [
    "InitialContext = ",
    "InitialContext=",
    "ClassicProvider = ",
    "Config = ",
  ];
  let blob: unknown = null;
  $("script").each((_, el) => {
    if (blob) return;
    const text = $(el).html();
    if (!text) return;
    if (!text.includes("__reactServerState")) return;
    for (const anchor of ANCHORS) {
      const at = text.indexOf(anchor);
      if (at < 0) continue;
      const start = text.indexOf("{", at + anchor.length);
      if (start < 0) continue;
      const candidate = sliceBalancedJson(text, start);
      if (!candidate) continue;
      try {
        blob = JSON.parse(candidate);
        if (blob) break;
      } catch {
        // try the next anchor
      }
    }
  });
  if (!blob) return null;

  // Redfin nests further JSON-as-strings inside; collect every JSON-parseable
  // string and every nested object. We may pull photos from one node and
  // address fields from a different one; both are merged into the preview.
  const nodes = collectObjectsAndParseableStrings(blob);

  // Aggregate photo URLs from every `mediaBrowserInfo.photos` array we see.
  // Multiple arrays exist on a listing page (the listing itself plus nearby
  // POIs sourced from Foursquare etc.) — filter to Redfin's CDN so we don't
  // import a coffee shop's photos.
  const allUrls: string[] = [];
  for (const node of nodes) {
    for (const u of readRedfinImages(node)) allUrls.push(u);
  }
  const imageUrls = allUrls.filter((u) =>
    /^https?:\/\/[a-z0-9-]*\.?cdn-redfin\.com\//i.test(u),
  );

  // Property node selection — prefer a node that has the `addressSectionInfo`
  // sub-object (the canonical shape on modern Redfin pages); fall back to a
  // node that itself looks like a property record.
  let propertyNode: Record<string, unknown> | null = null;
  for (const node of nodes) {
    if (
      typeof node.addressSectionInfo === "object" &&
      node.addressSectionInfo
    ) {
      propertyNode = node.addressSectionInfo as Record<string, unknown>;
      break;
    }
  }
  if (!propertyNode) {
    for (const node of nodes) {
      if (hasRedfinPropertyShape(node)) {
        propertyNode = node;
        break;
      }
    }
  }

  if (imageUrls.length === 0) return null;

  // Pull listing-history events out of `propertyHistoryInfo.events` —
  // typically lives on a sibling node alongside addressSectionInfo.
  let priceHistory: PropertyPriceEvent[] = [];
  for (const node of nodes) {
    const phi = node.propertyHistoryInfo;
    if (phi && typeof phi === "object" && Array.isArray((phi as Record<string, unknown>).events)) {
      priceHistory = parseRedfinHistoryEvents(
        (phi as { events: unknown[] }).events,
      );
      if (priceHistory.length > 0) break;
    }
  }

  const property = buildPropertyFromRedfinNode(
    propertyNode ?? {},
    sourceUrl,
    blob,
  );
  property.priceHistory = priceHistory;
  const images: ListingPreviewImage[] = dedupeImages(imageUrls);

  return {
    property,
    images,
    pathway: "embedded-json",
    partial: false,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Slice from the first `{` at `start` to its matching closing `}`. Tracks
 * string state so braces inside JSON strings don't fool the counter.
 */
function sliceBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Walk an arbitrary value, returning every object encountered (incl. those
 * reached by JSON.parsing string leaves). Handles Redfin's API anti-hijacking
 * prefix `{}&&{...}` (and the simpler `&&{...}`) by stripping it before
 * attempting `JSON.parse`.
 */
function collectObjectsAndParseableStrings(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || cur === undefined) continue;
    if (typeof cur === "string") {
      const candidate = stripRedfinPrefix(cur.trim());
      if (candidate.startsWith("{") || candidate.startsWith("[")) {
        try {
          stack.push(JSON.parse(candidate));
        } catch {
          // ignore — not all string leaves are JSON
        }
      }
      continue;
    }
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (typeof cur === "object") {
      if (seen.has(cur as object)) continue;
      seen.add(cur as object);
      out.push(cur as Record<string, unknown>);
      for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v);
    }
  }
  return out;
}

/**
 * Redfin's stingray API responses are wrapped to defeat naive JSON hijacking:
 * the body looks like `{}&&{"data":...}` or `&&{"data":...}`. Strip whichever
 * prefix is present before parsing.
 */
function stripRedfinPrefix(s: string): string {
  if (s.startsWith("{}&&")) return s.slice(4);
  if (s.startsWith("&&")) return s.slice(2);
  return s;
}

/**
 * Pick the best URL out of a Redfin `photoUrls` object. Carousel entries on
 * a listing page are shaped like:
 *   { fullScreenPhotoUrl, nonFullScreenPhotoUrl, nonFullScreenPhotoUrlCompressed,
 *     lightboxListUrl, thumbnailUrl }
 * Prefer the full-screen url so the imported asset is high-resolution.
 */
function pickRedfinPhotoUrl(photoUrls: Record<string, unknown>): string | null {
  const order = [
    "fullScreenPhotoUrl",
    "nonFullScreenPhotoUrl",
    "lightboxListUrl",
    "nonFullScreenPhotoUrlCompressed",
    "thumbnailUrl",
    "fullPhotoUrl",
    "url",
    "src",
  ];
  for (const k of order) {
    const v = photoUrls[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

function readRedfinImages(node: Record<string, unknown>): string[] {
  const urls: string[] = [];
  // Modern Redfin: mediaBrowserInfo.photos[] — preferred path.
  const mbi = node.mediaBrowserInfo;
  if (mbi && typeof mbi === "object") {
    const photos = (mbi as Record<string, unknown>).photos;
    if (Array.isArray(photos)) {
      for (const photo of photos) {
        if (!photo || typeof photo !== "object") continue;
        const photoUrls = (photo as Record<string, unknown>).photoUrls;
        if (photoUrls && typeof photoUrls === "object") {
          const u = pickRedfinPhotoUrl(photoUrls as Record<string, unknown>);
          if (u) urls.push(u);
        }
      }
    }
  }
  if (urls.length > 0) return urls;

  // Legacy / alternate shapes: top-level photo arrays.
  const LEGACY_KEYS = new Set([
    "photoUrls",
    "photos",
    "photoSet",
    "fullPhotoUrl",
    "mediaBrowserInfoBySourceId",
  ]);
  for (const [k, v] of Object.entries(node)) {
    if (!LEGACY_KEYS.has(k)) continue;
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      urls.push(v);
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && /^https?:\/\//.test(item)) {
          urls.push(item);
        } else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const inner = obj.photoUrls;
          if (inner && typeof inner === "object") {
            const u = pickRedfinPhotoUrl(inner as Record<string, unknown>);
            if (u) {
              urls.push(u);
              continue;
            }
          }
          const u =
            (typeof obj.fullPhotoUrl === "string" && obj.fullPhotoUrl) ||
            (typeof obj.url === "string" && obj.url) ||
            (typeof obj.src === "string" && obj.src) ||
            (typeof obj.large === "string" && obj.large) ||
            (typeof obj.bigPhoto === "string" && obj.bigPhoto) ||
            null;
          if (u) urls.push(u);
        }
      }
    }
  }
  return urls;
}

function hasRedfinPropertyShape(node: Record<string, unknown>): boolean {
  return (
    "addressSectionInfo" in node ||
    "streetAddress" in node ||
    "streetLine" in node ||
    ("priceInfo" in node && typeof node.priceInfo === "object") ||
    ("price" in node && "beds" in node)
  );
}

function buildPropertyFromRedfinNode(
  node: Record<string, unknown>,
  sourceUrl: string,
  raw: unknown,
): ListingPreviewProperty {
  const priceInfo =
    typeof node.priceInfo === "object" && node.priceInfo
      ? (node.priceInfo as Record<string, unknown>)
      : null;
  const latestPriceInfo =
    typeof node.latestPriceInfo === "object" && node.latestPriceInfo
      ? (node.latestPriceInfo as Record<string, unknown>)
      : null;
  const address =
    typeof node.streetAddress === "object" && node.streetAddress
      ? (node.streetAddress as Record<string, unknown>)
      : null;
  const sqFtField =
    typeof node.sqFt === "object" && node.sqFt
      ? (node.sqFt as Record<string, unknown>)
      : null;
  const status =
    typeof node.status === "object" && node.status
      ? (node.status as Record<string, unknown>)
      : null;

  const street =
    asString(node.streetLine) ??
    asString(address?.assembledAddress) ??
    asString(address?.streetLine) ??
    (typeof node.streetAddress === "string"
      ? asString(node.streetAddress as unknown)
      : undefined);

  // Some addressSectionInfo payloads only carry sold price (under priceInfo).
  // Use status to decide whether the headline number is list vs sold.
  const headlineAmount =
    asNumber(priceInfo?.amount) ?? asNumber(latestPriceInfo?.amount);
  const statusToken =
    asString(status?.longerDefinitionToken) ??
    asString(status?.displayValue) ??
    asString(node.status);
  const isSold = statusToken
    ? /sold|closed/i.test(statusToken)
    : asString(priceInfo?.label)?.toLowerCase().includes("sold");

  return {
    source: SOURCE,
    sourceUrl,
    sourceId: asString(node.propertyId) ?? asString(node.listingId),
    address: street,
    city: asString(node.city) ?? asString(address?.city),
    state: asString(node.state) ?? asString(address?.state),
    zip: asString(node.zip) ?? asString(address?.zip),
    listPrice: isSold
      ? undefined
      : headlineAmount ?? asNumber(node.price) ?? asNumber(node.listPrice),
    soldPrice: isSold ? headlineAmount : asNumber(node.soldPrice),
    bedrooms: asInt(node.beds) ?? asInt(node.numBedrooms),
    bathrooms: asNumber(node.baths) ?? asNumber(node.numBathrooms),
    sqft:
      asInt(sqFtField?.value) ??
      asInt(node.sqFt) ??
      asInt(node.sqft) ??
      asInt(node.livingArea),
    lotSqft: asInt(node.lotSize) ?? asInt(node.lotSqft),
    yearBuilt: asInt(node.yearBuilt),
    status: statusToken,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Pathway 2: JSON-LD residential schema.
// ---------------------------------------------------------------------------

function parseFromJsonLd(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): ListingPreview | null {
  const nodes = readJsonLd($);
  const node = pickResidentialNode(nodes);
  if (!node) return null;

  const images = readImagesFromJsonLd(node);
  if (images.length === 0) return null;

  const offers = pickOffers(node);
  const address = pickAddress(node);

  const property: ListingPreviewProperty = {
    source: SOURCE,
    sourceUrl,
    address: asString(node.streetAddress) ?? asString(address?.streetAddress) ?? asString(node.name),
    city: asString(address?.addressLocality),
    state: asString(address?.addressRegion),
    zip: asString(address?.postalCode),
    listPrice: asNumber(offers?.price),
    bedrooms: asInt(node.numberOfBedrooms ?? node.numberOfRooms),
    bathrooms: asNumber(node.numberOfBathroomsTotal ?? node.numberOfBathrooms),
    sqft: asInt(extractFloorSize(node)),
    yearBuilt: asInt(node.yearBuilt),
    raw: node,
  };

  return {
    property,
    images: dedupeImages(images),
    pathway: "json-ld",
    partial: false,
    scrapedAt: new Date().toISOString(),
  };
}

function pickAddress(node: Record<string, unknown>): Record<string, unknown> | null {
  const a = node.address;
  if (a && typeof a === "object" && !Array.isArray(a)) {
    return a as Record<string, unknown>;
  }
  return null;
}

function pickOffers(node: Record<string, unknown>): Record<string, unknown> | null {
  const o = node.offers;
  if (o && typeof o === "object" && !Array.isArray(o)) {
    return o as Record<string, unknown>;
  }
  if (Array.isArray(o) && o.length > 0 && typeof o[0] === "object") {
    return o[0] as Record<string, unknown>;
  }
  return null;
}

function extractFloorSize(node: Record<string, unknown>): unknown {
  const fs = node.floorSize;
  if (!fs) return undefined;
  if (typeof fs === "object" && fs && "value" in fs) {
    return (fs as Record<string, unknown>).value;
  }
  return fs;
}

/**
 * Map Redfin's `propertyHistoryInfo.events` into our unified shape.
 * Redfin events look like:
 *   { eventDescription: "Sold (MLS)", price: 2700000,
 *     eventDate: 1623308400000 /* unix ms *\/ , historyEventType: 2, ... }
 *
 * The price is sold vs list depending on the description — "Sold" / "Closed"
 * → soldPrice; everything else (Listed / Price Changed / Pending / etc) is
 * a list price. Skip events with no usable date.
 */
function parseRedfinHistoryEvents(raw: unknown[]): PropertyPriceEvent[] {
  const out: PropertyPriceEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const dateMs = asNumber(obj.eventDate);
    if (dateMs === undefined) continue;
    const description = asString(obj.eventDescription) ?? "";
    const price = asNumber(obj.price);
    const isSold = /sold|closed/i.test(description);
    const date = new Date(dateMs).toISOString();
    out.push({
      date,
      event: description || asString(obj.mlsDescription) || "Event",
      listPrice: !isSold && price && price > 0 ? price : undefined,
      soldPrice: isSold && price && price > 0 ? price : undefined,
      status: description || asString(obj.mlsDescription),
    });
  }
  // Newest first — matches the order the Redfin UI displays history in
  // and what page.tsx expects when picking a "prior" snapshot.
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
