  alter table public.boards enable row level security;

  drop policy if exists "boards: any user inserts"     on public.boards;
  drop policy if exists "boards: authenticated inserts" on public.boards;

  create policy "boards: authenticated inserts" on public.boards
    as permissive
    for insert
    to authenticated
    with check (true);