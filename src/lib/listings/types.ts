/**
 * Listing-import abstraction. Mirrors the AI editor pattern in `src/lib/ai/`:
 * a single `ListingFetcher` interface with per-source implementations,
 * dispatched by URL host through `registry.getFetcher`.
 *
 * Add a new source by:
 *   1. extending `ListingSource`,
 *   2. writing a parser under `parsers/` and a fetcher under `fetchers/`,
 *   3. registering the fetcher in `registry.ts`.
 */

export type ListingSource = "redfin" | "zillow";

export type ParsePathway = "embedded-json" | "json-ld" | "og-tags";

export interface ListingPreviewProperty {
  source: ListingSource;
  sourceUrl: string;
  sourceId?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  listPrice?: number;
  soldPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSqft?: number;
  yearBuilt?: number;
  status?: string;
  /** The chunk we parsed; persisted into `properties.raw` for provenance. */
  raw: unknown;
}

export interface ListingPreviewImage {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface ListingPreview {
  property: ListingPreviewProperty;
  images: ListingPreviewImage[];
  pathway: ParsePathway;
  /** True when only OG tags resolved — single image, partial metadata. */
  partial: boolean;
  scrapedAt: string;
}

export interface ListingFetcher {
  readonly source: ListingSource;
  matches(url: URL): boolean;
  fetchAndParse(url: string): Promise<ListingPreview>;
}

export type ListingFetchErrorCode =
  | "timeout"
  | "blocked"
  | "not-html"
  | "http"
  | "parse";

export class ListingFetchError extends Error {
  readonly code: ListingFetchErrorCode;
  readonly status?: number;

  constructor(
    code: ListingFetchErrorCode,
    message: string,
    opts?: { status?: number; cause?: unknown },
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = "ListingFetchError";
    this.code = code;
    this.status = opts?.status;
  }
}

export class UnsupportedListingError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`Unsupported listing host: ${host}`);
    this.name = "UnsupportedListingError";
    this.host = host;
  }
}
