/**
 * Daily-quota helpers for listing scrapes. Configurable via env so we can
 * dial up if Scrapfly costs stay flat, or down if abuse surfaces:
 *
 *   LISTING_SCRAPE_DAILY_LIMIT  — integer, default 10
 *   SUPERADMIN_EMAILS           — comma-separated list of emails that are
 *                                 not subject to the limit
 */
const DEFAULT_DAILY_LIMIT = 10;

export function getDailyScrapeLimit(): number {
  const raw = process.env.LISTING_SCRAPE_DAILY_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
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
