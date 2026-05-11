-- 0014_ai_edits_metadata_and_ref_uploads.sql
--
-- M8: Style references for AI edits & remix.
--
-- 1. Adds `metadata jsonb` to `ai_edits` so we can record reference-image
--    inputs (and any future per-row provenance) on the same row that
--    already tracks prompt/model/cost. Shape, persisted by the AI edit
--    server actions:
--
--      { "refs": [ { source: 'artifact'|'upload', id_or_path: string, role?: string }, ... ] }
--
--    JSONB rather than a sidecar table because the data is per-row,
--    write-once, and never queried with set semantics — same trade-off
--    we already make for `artifacts.metadata`.
--
-- 2. Storage RLS for the ephemeral `ref_uploads/` prefix in the existing
--    `artifacts` bucket. Path convention:
--
--      ref_uploads/<user_id>/<uuid>.<ext>
--
--    The user owns their own prefix (read/write/delete). The Cloudflare
--    cron worker that GCs files older than 24h uses the service-role key
--    so it bypasses these policies.

alter table public.ai_edits
  add column metadata jsonb not null default '{}'::jsonb;

drop policy if exists "ref_uploads: owner read"   on storage.objects;
drop policy if exists "ref_uploads: owner write"  on storage.objects;
drop policy if exists "ref_uploads: owner delete" on storage.objects;

create policy "ref_uploads: owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'ref_uploads'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

create policy "ref_uploads: owner write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'ref_uploads'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

create policy "ref_uploads: owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'ref_uploads'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );
