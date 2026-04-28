/**
 * Daily-quota helpers for listing scrapes. Configurable via env so we can
 * dial up if Scrapfly costs stay flat, or down if abuse surfaces:
 *
 *   LISTING_SCRAPE_DAILY_LIMIT   — integer, default 10 (preview/import path)
 *   LISTING_REFRESH_DAILY_LIMIT  — integer, default 20 (refresh path)
 *   SUPERADMIN_EMAILS            — comma-separated list of emails that are
 *                                  not subject to the limit
 *
 * Refreshes get a separate quota because they're bounded by the user's
 * already-imported listings (you can't refresh a property you don't have)
 * and the marginal cost is the same Scrapfly call. Splitting also means
 * spamming refreshes can't blow the import quota for the day.
 */
const DEFAULT_DAILY_LIMIT = 10;
const DEFAULT_REFRESH_LIMIT = 20;

export function getDailyScrapeLimit(): number {
  const raw = process.env.LISTING_SCRAPE_DAILY_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

export function getDailyRefreshLimit(): number {
  const raw = process.env.LISTING_REFRESH_DAILY_LIMIT;
  if (!raw) return DEFAULT_REFRESH_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFRESH_LIMIT;
}

export function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Start of the current UTC day, ISO string for >= comparisons. */
export function startOfTodayUtc(): string {
  const now = new Date();
  const utcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return utcMidnight.toISOString();
}
