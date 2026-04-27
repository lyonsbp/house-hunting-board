import * as cheerio from "cheerio";

import type {
  ListingPreview,
  ListingPreviewImage,
  ListingPreviewProperty,
  ListingSource,
} from "../types";

/**
 * Parse all `<script type="application/ld+json">` blocks. JSON-LD is used as a
 * stable fallback when the per-site embedded React/Next state shape shifts.
 */
export function readJsonLd($: cheerio.CheerioAPI): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // ignore malformed blocks
    }
  });
  return out;
}

const RESIDENTIAL_TYPES = new Set([
  "RealEstateListing",
  "SingleFamilyResidence",
  "Residence",
  "House",
  "Apartment",
  "Product", // Some sites mis-tag listings as Product; we'll still grab images.
]);

export function pickResidentialNode(nodes: unknown[]): Record<string, unknown> | null {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const t = (node as Record<string, unknown>)["@type"];
    if (typeof t === "string" && RESIDENTIAL_TYPES.has(t)) {
      return node as Record<string, unknown>;
    }
    if (Array.isArray(t) && t.some((v) => typeof v === "string" && RESIDENTIAL_TYPES.has(v))) {
      return node as Record<string, unknown>;
    }
  }
  return null;
}

export function readImagesFromJsonLd(node: Record<string, unknown>): string[] {
  const raw = node.image;
  if (!raw) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => {
      if (typeof v === "string") return [v];
      if (v && typeof v === "object") {
        const url = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl;
        return typeof url === "string" ? [url] : [];
      }
      return [];
    });
  }
  if (typeof raw === "object") {
    const url = (raw as Record<string, unknown>).url ?? (raw as Record<string, unknown>).contentUrl;
    return typeof url === "string" ? [url] : [];
  }
  return [];
}

export function buildOgFallback(
  $: cheerio.CheerioAPI,
  source: ListingSource,
  sourceUrl: string,
): ListingPreview | null {
  const meta = (selector: string) =>
    $(selector).attr("content")?.trim() || undefined;
  const ogImage =
    meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  const ogTitle =
    meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]') ??
    ($("title").first().text().trim() || undefined);

  if (!ogImage) return null;

  const property: ListingPreviewProperty = {
    source,
    sourceUrl,
    address: ogTitle,
    raw: { ogTitle, ogImage },
  };
  const images: ListingPreviewImage[] = [{ url: ogImage }];
  return {
    property,
    images,
    pathway: "og-tags",
    partial: true,
    scrapedAt: new Date().toISOString(),
  };
}

export function dedupeImages(urls: string[]): ListingPreviewImage[] {
  const seen = new Set<string>();
  const out: ListingPreviewImage[] = [];
  for (const u of urls) {
    if (!u) continue;
    const trimmed = u.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push({ url: trimmed });
  }
  return out;
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.\-]/g, "");
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
}

export function asInt(v: unknown): number | undefined {
  const n = asNumber(v);
  return n === undefined ? undefined : Math.trunc(n);
}
