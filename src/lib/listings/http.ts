import { ListingFetchError } from "./types";

/**
 * Realistic browser UA. Listing sites (especially Zillow) gate their richer
 * static-HTML payloads on a real-looking client. This is the same posture as
 * `fetchOgMetadata` in `boards/[id]/actions.ts` but tuned more aggressively.
 */
const LISTING_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const LISTING_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
  "image/webp,*/*;q=0.8";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function fetchListingHtml(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": LISTING_UA,
        accept: LISTING_ACCEPT,
        "accept-language": "en-US,en;q=0.9",
      },
    });
  } catch (cause) {
    clearTimeout(timer);
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new ListingFetchError("timeout", "Listing fetch timed out", {
        cause,
      });
    }
    throw new ListingFetchError("http", "Listing fetch failed", { cause });
  }
  clearTimeout(timer);

  if (res.status === 403 || res.status === 429) {
    throw new ListingFetchError(
      "blocked",
      `Source blocked the request (${res.status}). The listing site may be filtering datacenter traffic — try again later.`,
      { status: res.status },
    );
  }
  if (!res.ok) {
    throw new ListingFetchError(
      "http",
      `Listing fetch returned ${res.status}`,
      { status: res.status },
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) {
    throw new ListingFetchError(
      "not-html",
      `Expected text/html, got "${ct || "unknown"}"`,
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const html = await res.text();
    if (html.length > MAX_HTML_BYTES) {
      throw new ListingFetchError(
        "http",
        "Listing HTML exceeded the 2MB cap",
      );
    }
    return { html, finalUrl: res.url || url };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  // Stream so a misbehaving 200MB page can't exhaust memory.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // best-effort
      }
      throw new ListingFetchError(
        "http",
        "Listing HTML exceeded the 2MB cap",
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const html = new TextDecoder("utf-8").decode(merged);
  return { html, finalUrl: res.url || url };
}
