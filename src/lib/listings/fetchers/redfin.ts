import { fetchListingHtml } from "../http";
import { parseRedfin } from "../parsers/redfin";
import type { ListingFetcher, ListingPreview } from "../types";

export class RedfinFetcher implements ListingFetcher {
  readonly source = "redfin" as const;

  matches(url: URL): boolean {
    // `redf.in` is Redfin's own URL shortener (e.g. share/SMS links); it
    // 30x-redirects to the canonical `redfin.com` page, which `fetchListingHtml`
    // follows so the parser still sees full listing HTML.
    return /(^|\.)(redfin\.com|redf\.in)$/i.test(url.hostname);
  }

  async fetchAndParse(url: string): Promise<ListingPreview> {
    const { html, finalUrl } = await fetchListingHtml(url);
    return parseRedfin(html, finalUrl);
  }
}
