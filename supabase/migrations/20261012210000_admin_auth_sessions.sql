-- admin-auth's session ending (specs/product/admin.md, "What deactivate means" and "The admin-auth Edge Function").
--
-- "Sign out everywhere" and "Deactivate" delete a person's rows from auth.sessions, which ends every refresh (their
-- refresh tokens cascade with the session), so a still-valid access token dies within its hour. Supabase Auth's admin
-- API has no call for this (its sign-out needs the person's own token), and the auth schema is not exposed through
-- the API, so the admin-auth Edge Function calls this function with the service role. Nobody else can: execute is
-- revoked from every API role but service_role. Not named admin_*: it does no is_admin() check of its own, because
-- the function's caller already did (the Edge Function verifies the admin's token and is_admin() first).
--
-- Additive; apply after 20261012200000_admin.sql (dev first, then prod). plpgsql, so the body is only resolved when
-- called (the PGlite tests' auth stub has no auth.sessions unless a test creates it).

create function public.auth_end_sessions(p_user uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.auth_end_sessions(uuid) from public, anon, authenticated;
grant execute on function public.auth_end_sessions(uuid) to service_role;
