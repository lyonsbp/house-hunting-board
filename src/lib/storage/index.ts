/**
 * Public entry-point for the image storage abstraction.
 *
 * Read path: this module is NOT involved. Each artifact row carries its
 * own `storage_backend` column and the URL resolver in `board-data.ts`
 * branches on that — old rows keep working from Supabase, new rows
 * resolve to R2 public URLs.
 *
 * Write path: callers gate the new variant pipeline behind
 * `r2WritesEnabled()`. When off, they fall back to the legacy single-file
 * Supabase Storage upload (today's behavior). When on, they encode
 * variants and call `storage.putBundle()`. This split avoids writing a
 * second backend that doesn't speak variants and keeps the legacy code
 * path untouched until the rollout completes.
 */

import { r2Storage } from "./r2";

export type { ImageStorage, Variant, ImageExt, ArtifactBundle, BundleInput, StoredObjectRef } from "./types";
export { VARIANTS, buildKey } from "./types";

/** The active storage backend for writes. Only R2 today. */
export const storage = r2Storage;

/**
 * Single env-var flag that gates new R2 writes. Reads off
 * `STORAGE_BACKEND` so the same setting can live in `.env.local` (dev),
 * `.dev.vars` (preview), and `wrangler secret put` (prod).
 */
export function r2WritesEnabled(): boolean {
  const raw = process.env.STORAGE_BACKEND;
  if (!raw) return false;
  return raw.trim().toLowerCase() === "r2";
}
