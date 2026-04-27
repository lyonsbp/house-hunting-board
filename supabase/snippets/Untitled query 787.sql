  -- Show what's actually live for boards (so we know whether 0002/0003 applied)
  select policyname, cmd, roles, qual, with_check
  from pg_policies
  where tablename = 'boards';

  select tgname, tgenabled
  from pg_trigger
  where tgrelid = 'public.boards'::regclass
    and not tgisinternal;

  select column_name, column_default, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='boards';