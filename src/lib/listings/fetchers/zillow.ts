import { fetchListingHtml } from "../http";
import { parseZillow } from "../parsers/zillow";
import { fetchViaScrapfly, scrapflyAvailable } from "../scrapfly";
import { type ListingFetcher, type ListingPreview } from "../types";

/**
 * Zillow is fronted by PerimeterX/HUMAN, which reliably blocks Cloudflare
 * Workers' datacenter IPs. When SCRAPFLY_API_KEY is set we route the page
 * fetch through Scrapfly (asp=true, render_js=true) which uses residential
 * IPs and can bypass the JS challenge. With no key we attempt a direct
 * fetch — useful for local dev and as a no-cost fallback when Scrapfly
 * itself is down.
 *
 * Image downloads from `photos.zillowstatic.com` always go direct: their
 * CDN is open and doesn't need the proxy, and routing thumbnails through
 * Scrapfly would multiply the per-import cost by ~30×.
 */
export class ZillowFetcher implements ListingFetcher {
  readonly source = "zillow" as const;

  matches(url: URL): boolean {
    return /(^|\.)zillow\.com$/i.test(url.hostname);
  }

  async fetchAndParse(url: string): Promise<ListingPreview> {
    if (scrapflyAvailable()) {
      const { html, finalUrl } = await fetchViaScrapfly(url, {
        renderJs: true,
        autoScroll: true,
      });
      return parseZillow(html, finalUrl);
    }
    const { html, finalUrl } = await fetchListingHtml(url);
    return parseZillow(html, finalUrl);
  }
}
