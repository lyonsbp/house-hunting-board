  create policy "members: insert self" on public.board_members
    for insert
    to authenticated
    with check (auth.uid() = user_id);