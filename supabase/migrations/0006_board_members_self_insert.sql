-- Allow a user to insert a board_members row where they are the user being
-- added. This unblocks the `add_creator_as_owner` AFTER INSERT trigger on
-- `boards`, which writes (board_id, auth.uid(), 'owner', auth.uid()) when a
-- new board is created — at that moment no owner exists yet, so the
-- existing `for all using/with check (has_board_role(_, 'owner'))` policy
-- can never pass and the bootstrap row is rejected.
--
-- Owner-driven invites (adding OTHER users) still flow through the existing
-- "members: owner mutates" policy. The two policies are PERMISSIVE so their
-- WITH CHECKs are OR'd together for inserts.

create policy "members: insert self" on public.board_members
  for insert
  to authenticated
  with check (auth.uid() = user_id);
