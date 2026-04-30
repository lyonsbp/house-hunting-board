/**
 * Constants safe to import from both client and server code. Anything
 * here MUST NOT pull in server-only deps like `next/headers`. The main
 * `@/lib/board-data` module imports server-side Supabase clients, which
 * are unsafe in client components — this file exists so client code can
 * reference the sentinel without dragging that in.
 */
export const UNCATEGORIZED_ID = "uncategorized" as const;
