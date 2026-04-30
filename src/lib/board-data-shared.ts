/**
 * Constants and types safe to import from both client and server code.
 * Anything here MUST NOT pull in server-only deps like `next/headers`.
 * The main `@/lib/board-data` module imports server-side Supabase
 * clients, which are unsafe in client components — this file exists so
 * client code can reference shared values without dragging that in.
 */
export const UNCATEGORIZED_ID = "uncategorized" as const;

/** Canvas-mode card geometry. Used by both the seeder (server) and the
 * canvas renderer (client) — keep them in sync by sourcing from here. */
export const CANVAS_CARD_W = 280;
export const CANVAS_CARD_H = 360;
export const CANVAS_GAP = 24;

export type CanvasPosition = { x: number; y: number };
