  -- Simulate what PostgREST sets up for an authenticated request
  begin;
  set local role authenticated;
  set local request.jwt.claims =
  '{"sub":"8da52b47-2499-4958-a42f-9db16faf5dce","role":"authenticated","aud":"authenticated"}';

  -- Also list every trigger (including internal/FK) on boards while we're here
  select tgname, tgisinternal, tgenabled
  from pg_trigger
  where tgrelid = 'public.boards'::regclass;

  -- And every policy on boards
  select policyname, permissive, cmd, roles::text, with_check
  from pg_policies
  where tablename = 'boards';

  -- The actual test
  insert into public.boards (name) values ('manual test from studio');

  rollback;