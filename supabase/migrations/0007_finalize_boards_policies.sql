-- Lock in the final state of `boards` RLS policies and clean up the
-- diagnostic function from 0005. This migration was added after a long
-- debug session that uncovered a subtle Postgres behavior:
--
-- INSERT ... RETURNING evaluates the table's SELECT USING policy on the
-- new row to verify visibility. Our SELECT policy is `is_board_member(id)`,
-- and even though the AFTER INSERT trigger `add_creator_as_owner` inserts
-- the membership row in the same statement, the RETURNING-time RLS check
-- doesn't see it (snapshot/timing inside a single statement), so the check
-- fails and Postgres raises a misleading "new row violates row-level
-- security policy for table boards" error.
--
-- Application-side workaround (in `src/app/actions.ts`): generate the id
-- with `crypto.randomUUID()` and skip `.select()` so the INSERT does not
-- emit a RETURNING clause. The boards page reads the row back in a
-- separate SELECT after the trigger has committed.
--
-- Policies below stay simple: WITH CHECK (true) gated on the
-- `authenticated` role. The BEFORE INSERT trigger from 0003
-- (`set_creator`) populates `created_by` from auth.uid(), and the
-- AFTER INSERT trigger from 0001 (`add_creator_as_owner`) writes the
-- creator into `board_members`.

-- Drop every variant of the boards policies that may have accumulated
-- across migrations / manual fixes during debugging.
drop policy if exists "boards: members read"          on public.boards;
drop policy if exists "boards: any user inserts"      on public.boards;
drop policy if exists "boards: authenticated inserts" on public.boards;
drop policy if exists "boards: any inserts"           on public.boards;
drop policy if exists "boards: editor updates"        on public.boards;
drop policy if exists "boards: owner deletes"         on public.boards;
drop policy if exists boards_select                   on public.boards;
drop policy if exists boards_insert                   on public.boards;
drop policy if exists boards_update                   on public.boards;
drop policy if exists boards_delete                   on public.boards;

create policy "boards: members read" on public.boards
  for select to public using (public.is_board_member(id));

create policy "boards: authenticated inserts" on public.boards
  for insert to authenticated with check (true);

create policy "boards: editor updates" on public.boards
  for update to public using (public.has_board_role(id, 'editor'));

create policy "boards: owner deletes" on public.boards
  for delete to public using (public.has_board_role(id, 'owner'));

-- Drop the diagnostic function from 0005; it was only needed to
-- introspect the role/uid PostgREST sees per request.
drop function if exists public.debug_auth_context();
