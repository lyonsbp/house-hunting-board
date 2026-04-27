import { fetchListingHtml } from "../http";
import { parseRedfin } from "../parsers/redfin";
import type { ListingFetcher, ListingPreview } from "../types";

export class RedfinFetcher implements ListingFetcher {
  readonly source = "redfin" as const;

  matches(url: URL): boolean {
    return /(^|\.)redfin\.com$/i.test(url.hostname);
  }

  async fetchAndParse(url: string): Promise<ListingPreview> {
    const { html, finalUrl } = await fetchListingHtml(url);
    return parseRedfin(html, finalUrl);
  }
}
