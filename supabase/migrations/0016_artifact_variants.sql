-- 0016_artifact_variants.sql
--
-- Image-storage cutover prep: move artifact bytes from Supabase Storage to
-- Cloudflare R2 (zero egress, served via CF cache as immutable URLs). Adds
-- two columns that let rows mark which backend they live on, so the read
-- path can tolerate a mixed-state world during the rolling backfill.
--
-- 1. `content_hash` — sha256 hex of the original bytes. The R2 key derives
--    from this (`v1/<hashPrefix2>/<sha256>/<variant>.<ext>`), so identical
--    images uploaded twice dedupe to one R2 object set even when two
--    artifact rows point at it. Nullable until backfill catches up. Indexed
--    partial: the `where` clause keeps the index tight while column is
--    backfilling.
--
-- 2. `storage_backend` — 'supabase' for legacy rows, 'r2' for rows whose
--    bytes have been uploaded (or backfilled) to R2. The read path branches
--    on this column to pick URL-resolution strategy. Defaults to 'supabase'
--    so existing rows stay valid without a backfill UPDATE.
--
-- Variant records (per-variant key + ext) live in `artifacts.metadata` as
-- `metadata.variants: { thumb: {key, ext}, display: {key, ext}, original: {key, ext} }`.
-- jsonb rather than a sidecar table — same trade-off as the existing
-- `metadata.lqip` / `metadata.ai_edit_of` fields: per-row, write-once,
-- never queried with set semantics.
--
-- The legacy `storage_path` column stays populated through cutover so the
-- read path can fall back. A follow-up migration drops it after the
-- `--purge-supabase` backfill pass.

alter table public.artifacts
  add column content_hash text,
  add column storage_backend text not null default 'supabase'
    check (storage_backend in ('supabase', 'r2'));

create index if not exists artifacts_content_hash_idx
  on public.artifacts (content_hash)
  where content_hash is not null;
