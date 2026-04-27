-- Simplest possible boards INSERT policy: any authenticated request passes.
-- PostgREST only assigns the `authenticated` role to requests carrying a
-- valid JWT, so this is a structural auth gate, not a value comparison.
-- The 0003 BEFORE INSERT trigger fills `created_by` from auth.uid() and
-- the existing AFTER INSERT trigger (`add_creator_as_owner`) populates
-- `board_members`, so correctness is preserved without any WITH CHECK
-- comparison that can drift.

drop policy if exists "boards: any user inserts"     on public.boards;
drop policy if exists "boards: authenticated inserts" on public.boards;

create policy "boards: authenticated inserts" on public.boards
  as permissive
  for insert
  to authenticated
  with check (true);
