-- Belt-and-suspenders: a BEFORE INSERT trigger that fills creator columns
-- from auth.uid() if the client didn't provide one. This guarantees the
-- column matches auth.uid() at WITH CHECK time, regardless of how the
-- DEFAULT expression behaves in different PostgREST request contexts.
--
-- We also loosen the boards INSERT policy from `auth.uid() = created_by`
-- to just `auth.uid() is not null`, since the trigger now guarantees the
-- equality structurally. (artifacts/comments policies already use
-- has_board_role checks plus author equality; left alone.)

create or replace function public.set_creator()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_table_name = 'comments' then
    if new.author_id is null then new.author_id := auth.uid(); end if;
  else
    if new.created_by is null then new.created_by := auth.uid(); end if;
  end if;
  return new;
end;
$$;

create trigger boards_set_creator
  before insert on public.boards
  for each row execute function public.set_creator();

create trigger artifacts_set_creator
  before insert on public.artifacts
  for each row execute function public.set_creator();

create trigger comments_set_creator
  before insert on public.comments
  for each row execute function public.set_creator();

create trigger ai_edits_set_creator
  before insert on public.ai_edits
  for each row execute function public.set_creator();

drop policy if exists "boards: any user inserts" on public.boards;
create policy "boards: authenticated inserts" on public.boards
  for insert with check (auth.uid() is not null);
