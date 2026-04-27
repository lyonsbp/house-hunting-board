-- Default `created_by` to the calling user on board-scoped writes so the
-- client never has to send its own UUID (and never desync from it).
-- The existing RLS WITH CHECK policies still enforce `auth.uid() = created_by`,
-- which is now trivially true for inserts that omit the field.
--
-- `auth.uid()` is null for unauthenticated requests; the NOT NULL constraint
-- on these columns turns that into a clean error rather than a silent
-- mis-attribution.

alter table public.boards    alter column created_by set default auth.uid();
alter table public.artifacts alter column created_by set default auth.uid();
alter table public.comments  alter column author_id  set default auth.uid();
alter table public.ai_edits  alter column created_by set default auth.uid();
