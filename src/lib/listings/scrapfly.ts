import { ListingFetchError } from "./types";

/**
 * Scrapfly client. Used as a fallback for sources that bounce direct
 * Cloudflare-Workers fetches with PerimeterX/HUMAN (Zillow being the main
 * one). When SCRAPFLY_API_KEY isn't set, callers fall back to direct fetch
 * — Redfin works fine without a proxy and we don't want to burn API
 * credits on it by default.
 *
 * Scrapfly billing scales with the option flags: `asp=true` (anti-scraping
 * protection) is what unlocks PerimeterX bypass and is the headline cost.
 * Image downloads from the listing's CDN do NOT route through Scrapfly —
 * those go direct from `commitListingImport`.
 */
const SCRAPFLY_ENDPOINT = "https://api.scrapfly.io/scrape";
const DEFAULT_TIMEOUT_MS = 60_000;

export function scrapflyAvailable(): boolean {
  return !!process.env.SCRAPFLY_API_KEY;
}

export async function fetchViaScrapfly(
  targetUrl: string,
  opts: { timeoutMs?: number; renderJs?: boolean; country?: string } = {},
): Promise<{ html: string; finalUrl: string }> {
  const key = process.env.SCRAPFLY_API_KEY;
  if (!key) {
    throw new ListingFetchError(
      "http",
      "Scrapfly is not configured (SCRAPFLY_API_KEY missing)",
    );
  }
  const params = new URLSearchParams({
    key,
    url: targetUrl,
    asp: "true",
    render_js: String(opts.renderJs ?? true),
    country: opts.country ?? "us",
    // Don't bill us for assets we don't use. We only need the HTML.
    cache: "false",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(`${SCRAPFLY_ENDPOINT}?${params.toString()}`, {
      signal: ctrl.signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new ListingFetchError("timeout", "Scrapfly request timed out", {
        cause,
      });
    }
    throw new ListingFetchError("http", "Scrapfly request failed", { cause });
  }
  clearTimeout(timer);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ListingFetchError(
      "http",
      `Scrapfly returned ${res.status}${detail ? `: ${truncate(detail, 200)}` : ""}`,
      { status: res.status },
    );
  }

  const payload = (await res.json().catch(() => null)) as ScrapflyEnvelope | null;
  if (!payload?.result) {
    throw new ListingFetchError("http", "Scrapfly response had no result");
  }

  const upstreamStatus = payload.result.status_code;
  if (upstreamStatus === 403 || upstreamStatus === 429) {
    throw new ListingFetchError(
      "blocked",
      `Source blocked the request via Scrapfly (${upstreamStatus}).`,
      { status: upstreamStatus },
    );
  }
  if (upstreamStatus && upstreamStatus >= 400) {
    throw new ListingFetchError(
      "http",
      `Source returned ${upstreamStatus} via Scrapfly`,
      { status: upstreamStatus },
    );
  }

  const html = payload.result.content;
  if (typeof html !== "string" || html.length === 0) {
    throw new ListingFetchError("http", "Scrapfly returned empty HTML");
  }

  return { html, finalUrl: payload.result.url ?? targetUrl };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

type ScrapflyEnvelope = {
  result?: {
    status_code?: number;
    content?: string;
    url?: string;
  };
};
