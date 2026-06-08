import { RedfinFetcher } from "./fetchers/redfin";
import { ZillowFetcher } from "./fetchers/zillow";
import { UnsupportedListingError, type ListingFetcher } from "./types";

const FETCHERS: ListingFetcher[] = [new RedfinFetcher(), new ZillowFetcher()];

export function getFetcher(rawUrl: string): ListingFetcher {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsupportedListingError(rawUrl);
  }
  for (const f of FETCHERS) {
    if (f.matches(parsed)) return f;
  }
  throw new UnsupportedListingError(parsed.hostname);
}

export const SUPPORTED_HOST_HINTS = [
  "redfin.com",
  "redf.in",
  "zillow.com",
] as const;
