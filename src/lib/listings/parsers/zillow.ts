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

const SOURCE = "zillow" as const;

/**
 * Three-layer parser: `__NEXT_DATA__` first (the modern Next.js shape),
 * JSON-LD residential schema second, OG tags last.
 *
 * Zillow's modern path embeds the listing under
 * `props.pageProps.componentProps.gdpClientCache` keyed by the GraphQL
 * query name (e.g. `ForSaleShopperPlatformFullRenderQuery({...})`). The
 * value is a JSON string. We grep for any `property` field with an array
 * of photos rather than relying on the exact key, since the query name
 * has been known to vary.
 */
export function parseZillow(html: string, sourceUrl: string): ListingPreview {
  const $ = cheerio.load(html);

  const fromNext = parseFromNextData($, sourceUrl);
  if (fromNext) return fromNext;

  const fromJsonLd = parseFromJsonLd($, sourceUrl);
  if (fromJsonLd) return fromJsonLd;

  const fromOg = buildOgFallback($, SOURCE, sourceUrl);
  if (fromOg) return fromOg;

  throw new ListingFetchError(
    "parse",
    "Could not extract a Zillow listing from this page",
  );
}

// ---------------------------------------------------------------------------
// Pathway 1: __NEXT_DATA__
// ---------------------------------------------------------------------------

function parseFromNextData(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): ListingPreview | null {
  const text = $("script#__NEXT_DATA__").text();
  if (!text) return null;
  let blob: unknown;
  try {
    blob = JSON.parse(text);
  } catch {
    return null;
  }

  const nodes = collectObjectsAndParseableStrings(blob);

  let propertyNode: Record<string, unknown> | null = null;
  for (const node of nodes) {
    if (hasZillowPropertyShape(node)) {
      propertyNode = node;
      break;
    }
  }
  if (!propertyNode) return null;

  const images = readZillowImages(propertyNode);
  if (images.length === 0) return null;

  const property = buildPropertyFromZillowNode(
    propertyNode,
    sourceUrl,
    propertyNode,
  );

  return {
    property,
    images: dedupeImages(images),
    pathway: "embedded-json",
    partial: false,
    scrapedAt: new Date().toISOString(),
  };
}

function collectObjectsAndParseableStrings(
  root: unknown,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || cur === undefined) continue;
    if (typeof cur === "string") {
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

function hasZillowPropertyShape(node: Record<string, unknown>): boolean {
  // Modern Zillow: `homeStatus` + `address` (object) + `responsivePhotos`
  // or `originalPhotos` + `bedrooms`/`bathrooms`. Match conservatively.
  if (!("homeStatus" in node) && !("hdpUrl" in node)) return false;
  if (!("address" in node) && !("streetAddress" in node)) return false;
  return (
    "responsivePhotos" in node ||
    "originalPhotos" in node ||
    "photos" in node ||
    "bigPhotos" in node ||
    "miniCardPhotos" in node
  );
}

function readZillowImages(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const candidates = [
    "responsivePhotos",
    "originalPhotos",
    "photos",
    "bigPhotos",
  ];
  for (const key of candidates) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    for (const photo of arr) {
      const u = highestResolutionPhotoUrl(photo);
      if (u) out.push(u);
    }
    if (out.length > 0) return out;
  }
  return out;
}

function highestResolutionPhotoUrl(photo: unknown): string | null {
  if (!photo || typeof photo !== "object") return null;
  const p = photo as Record<string, unknown>;

  // Modern shape: { mixedSources: { jpeg: [{url, width}], webp: [{...}] } }
  const mixed = p.mixedSources;
  if (mixed && typeof mixed === "object") {
    const jpeg = (mixed as Record<string, unknown>).jpeg;
    if (Array.isArray(jpeg) && jpeg.length > 0) {
      const widthOf = (v: unknown) =>
        asInt((v as Record<string, unknown> | null)?.width) ?? 0;
      const sorted = [...jpeg].sort((a, b) => widthOf(b) - widthOf(a));
      const top = (sorted[0] ?? jpeg[jpeg.length - 1]) as Record<string, unknown>;
      const url = asString(top?.url);
      if (url) return url;
    }
  }

  // Legacy shape: { url } or {url_3x, url_2x, url}
  const url =
    asString(p.url_3x) ??
    asString(p.url_2x) ??
    asString(p.url) ??
    asString(p.src);
  return url ?? null;
}

function buildPropertyFromZillowNode(
  node: Record<string, unknown>,
  sourceUrl: string,
  raw: unknown,
): ListingPreviewProperty {
  const address =
    node.address && typeof node.address === "object"
      ? (node.address as Record<string, unknown>)
      : null;

  return {
    source: SOURCE,
    sourceUrl,
    sourceId: asString(node.zpid) ?? asString(node.mlsid),
    address: asString(address?.streetAddress) ?? asString(node.streetAddress),
    city: asString(address?.city) ?? asString(node.city),
    state: asString(address?.state) ?? asString(node.state),
    zip: asString(address?.zipcode) ?? asString(node.zipcode),
    listPrice: asNumber(node.price) ?? asNumber(node.listPrice),
    bedrooms: asInt(node.bedrooms),
    bathrooms: asNumber(node.bathrooms),
    sqft: asInt(node.livingArea) ?? asInt(node.livingAreaValue),
    lotSqft: asInt(node.lotSize) ?? asInt(node.lotAreaValue),
    yearBuilt: asInt(node.yearBuilt),
    status: asString(node.homeStatus),
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

  const address =
    node.address && typeof node.address === "object" && !Array.isArray(node.address)
      ? (node.address as Record<string, unknown>)
      : null;

  const property: ListingPreviewProperty = {
    source: SOURCE,
    sourceUrl,
    address:
      asString(node.streetAddress) ??
      asString(address?.streetAddress) ??
      asString(node.name),
    city: asString(address?.addressLocality),
    state: asString(address?.addressRegion),
    zip: asString(address?.postalCode),
    bedrooms: asInt(node.numberOfBedrooms ?? node.numberOfRooms),
    bathrooms: asNumber(node.numberOfBathroomsTotal ?? node.numberOfBathrooms),
    yearBuilt: asInt(node.yearBuilt),
    raw: node,
  };

  const out: ListingPreviewImage[] = dedupeImages(images);
  return {
    property,
    images: out,
    pathway: "json-ld",
    partial: false,
    scrapedAt: new Date().toISOString(),
  };
}
