-- TEMPORARY diagnostic. Returns the role/uid PostgREST is running as for
-- the current request. Used once to debug why an authenticated insert is
-- being rejected by an RLS policy that says `to authenticated with check (true)`.
-- DELETE this migration (and the function) once the bug is found.

create or replace function public.debug_auth_context()
returns json
language sql
stable
as $$
  select json_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'auth_uid',     auth.uid(),
    'auth_role',    auth.role(),
    'jwt_claims',   current_setting('request.jwt.claims', true)
  );
$$;

grant execute on function public.debug_auth_context() to anon, authenticated;
