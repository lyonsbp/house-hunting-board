import { fetchListingHtml } from "../http";
import { parseZillow } from "../parsers/zillow";
import type { ListingFetcher, ListingPreview } from "../types";

export class ZillowFetcher implements ListingFetcher {
  readonly source = "zillow" as const;

  matches(url: URL): boolean {
    return /(^|\.)zillow\.com$/i.test(url.hostname);
  }

  async fetchAndParse(url: string): Promise<ListingPreview> {
    const { html, finalUrl } = await fetchListingHtml(url);
    return parseZillow(html, finalUrl);
  }
}
