/**
 * Per-user AI invocation quota. PRD §5.3: 10 invocations per rolling 7-day
 * window. An Edit counts as 1; a Remix of N variants counts as N (each row
 * in `ai_edits` is one tick of the counter).
 *
 * Configurable via env so we can dial up/down without a code change:
 *
 *   AI_INVOCATION_LIMIT             — int, default 10
 *   AI_INVOCATION_WINDOW_DAYS       — int, default 7
 *   SUPERADMIN_EMAILS               — shared with the listing-scrape gate;
 *                                      these users bypass the limit entirely
 */
const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_DAYS = 7;

export function getAiInvocationLimit(): number {
  const raw = process.env.AI_INVOCATION_LIMIT;
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

export function getAiWindowDays(): number {
  const raw = process.env.AI_INVOCATION_WINDOW_DAYS;
  if (!raw) return DEFAULT_WINDOW_DAYS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW_DAYS;
}

/** ISO timestamp marking the start of the current rolling window. */
export function startOfAiWindow(): string {
  const days = getAiWindowDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

export function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
