-- Public boards (read-only sharing).
-- Owners can flip `is_public` on. Anyone — including anonymous visitors —
-- gets read access to the board's artifacts/categories/tags/comments via
-- new SELECT-only policies that fall through to `can_read_board()`.
--
-- Writes (insert/update/delete) keep their existing editor-only policies
-- untouched — RLS combines policies with OR for SELECT and AND for the
-- write checks, so the existing rules stay authoritative for mutations.

alter table public.boards
  add column is_public boolean not null default false;

create or replace function public.can_read_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.boards b where b.id = p_board_id and b.is_public)
    or public.is_board_member(p_board_id);
$$;

-- New SELECT-only policies that broaden read access to public boards.
-- These are additive — the existing member-based policies still apply, so
-- the effective SELECT permission is the OR of (member) ∪ (public).

create policy "boards: public read"
  on public.boards for select
  using (is_public);

create policy "categories: public read"
  on public.categories for select
  using (
    exists (select 1 from public.boards b where b.id = board_id and b.is_public)
  );

create policy "artifacts: public read"
  on public.artifacts for select
  using (
    exists (select 1 from public.boards b where b.id = board_id and b.is_public)
  );

create policy "artifact_categories: public read"
  on public.artifact_categories for select
  using (
    exists (
      select 1
      from public.artifacts a
      join public.boards b on b.id = a.board_id
      where a.id = artifact_id and b.is_public
    )
  );

create policy "tags: public read"
  on public.tags for select
  using (
    exists (select 1 from public.boards b where b.id = board_id and b.is_public)
  );

create policy "artifact_tags: public read"
  on public.artifact_tags for select
  using (
    exists (
      select 1
      from public.artifacts a
      join public.boards b on b.id = a.board_id
      where a.id = artifact_id and b.is_public
    )
  );

create policy "comments: public read"
  on public.comments for select
  using (
    exists (
      select 1
      from public.artifacts a
      join public.boards b on b.id = a.board_id
      where a.id = artifact_id and b.is_public
    )
  );
