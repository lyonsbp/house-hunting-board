-- Storage bucket for image artifacts. Private bucket — access via signed
-- URLs only. Path convention: boards/<board_id>/<filename> so RLS can be
-- gated on the board_id parsed out of the object path.
--
-- `storage.foldername(name)` is a Supabase helper that returns the path
-- segments minus the filename, e.g. for "boards/abc/file.png" it returns
-- {boards, abc}. We require segment 1 to be "boards" and treat segment 2
-- as the board UUID.

insert into storage.buckets (id, name, public)
  values ('artifacts', 'artifacts', false)
  on conflict (id) do nothing;

drop policy if exists "artifacts: members read storage"   on storage.objects;
drop policy if exists "artifacts: editors upload storage" on storage.objects;
drop policy if exists "artifacts: editors delete storage" on storage.objects;

create policy "artifacts: members read storage" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'boards'
    and public.is_board_member(((storage.foldername(name))[2])::uuid)
  );

create policy "artifacts: editors upload storage" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'boards'
    and public.has_board_role(((storage.foldername(name))[2])::uuid, 'editor')
  );

create policy "artifacts: editors delete storage" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'boards'
    and public.has_board_role(((storage.foldername(name))[2])::uuid, 'editor')
  );
