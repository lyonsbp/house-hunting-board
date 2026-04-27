import * as cheerio from "cheerio";

import {
  ListingFetchError,
  type ListingPreview,
  type ListingPreviewImage,
  type ListingPreviewProperty,
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
  let blob: unknown = null;
  $("script").each((_, el) => {
    if (blob) return;
    const text = $(el).html();
    if (!text) return;
    if (!text.includes("__reactServerState")) return;
    const start = text.indexOf("{");
    if (start < 0) return;
    const candidate = sliceBalancedJson(text, start);
    if (!candidate) return;
    try {
      blob = JSON.parse(candidate);
    } catch {
      // ignore — we'll fall through to JSON-LD
    }
  });
  if (!blob) return null;

  // Redfin nests further JSON-as-strings inside; collect every JSON-parseable
  // string and every nested object so we can pick whichever has photos +
  // address fields.
  const nodes = collectObjectsAndParseableStrings(blob);

  let imageUrls: string[] = [];
  let propertyNode: Record<string, unknown> | null = null;

  for (const node of nodes) {
    if (imageUrls.length === 0) {
      imageUrls = readRedfinImages(node);
    }
    if (!propertyNode && hasRedfinPropertyShape(node)) {
      propertyNode = node;
    }
    if (imageUrls.length > 0 && propertyNode) break;
  }

  if (imageUrls.length === 0) return null;

  const property = buildPropertyFromRedfinNode(
    propertyNode ?? {},
    sourceUrl,
    blob,
  );
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

/** Walk an arbitrary value, returning every object encountered (incl. those reached by JSON.parsing string leaves). */
function collectObjectsAndParseableStrings(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || cur === undefined) continue;
    if (typeof cur === "string") {
      // Only attempt JSON.parse when it looks like a JSON object/array — this
      // is much faster than try/catch on every leaf string.
      const t = cur.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          stack.push(JSON.parse(cur));
        } catch {
          // ignore
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

const REDFIN_PHOTO_KEYS = new Set([
  "photoUrls",
  "photos",
  "photoSet",
  "fullPhotoUrl",
]);

function readRedfinImages(node: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (!REDFIN_PHOTO_KEYS.has(k) && k !== "mediaBrowserInfoBySourceId") continue;
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      urls.push(v);
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && /^https?:\/\//.test(item)) {
          urls.push(item);
        } else if (item && typeof item === "object") {
          const u =
            (item as Record<string, unknown>).fullPhotoUrl ??
            (item as Record<string, unknown>).url ??
            (item as Record<string, unknown>).src ??
            (item as Record<string, unknown>).large ??
            (item as Record<string, unknown>).bigPhoto;
          if (typeof u === "string") urls.push(u);
        }
      }
    }
  }
  return urls;
}

function hasRedfinPropertyShape(node: Record<string, unknown>): boolean {
  return (
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
  const address = typeof node.streetAddress === "object" && node.streetAddress
    ? (node.streetAddress as Record<string, unknown>)
    : null;

  const street =
    asString(node.streetLine) ??
    asString(address?.streetLine) ??
    asString(node.streetAddress as unknown);

  return {
    source: SOURCE,
    sourceUrl,
    sourceId: asString(node.propertyId) ?? asString(node.listingId),
    address: street,
    city: asString(node.city) ?? asString(address?.city),
    state: asString(node.state) ?? asString(address?.state),
    zip: asString(node.zip) ?? asString(address?.zip),
    listPrice:
      asNumber(priceInfo?.amount) ??
      asNumber(node.price) ??
      asNumber(node.listPrice),
    soldPrice: asNumber(node.soldPrice),
    bedrooms: asInt(node.beds) ?? asInt(node.numBedrooms),
    bathrooms: asNumber(node.baths) ?? asNumber(node.numBathrooms),
    sqft: asInt(node.sqFt) ?? asInt(node.sqft) ?? asInt(node.livingArea),
    lotSqft: asInt(node.lotSize) ?? asInt(node.lotSqft),
    yearBuilt: asInt(node.yearBuilt),
    status: asString(node.status) ?? asString(node.mlsStatus),
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
