-- Sign-in activity on the console's person page (owner, 2026-10-13: "add those logs to the people page"): one account's
-- sign-ins, sessions, and account-security events, newest first. Additive; apply after
-- 20261013150000_selectivity_history.sql (dev first, then prod).
--
-- Sources, all in Supabase's auth schema (read here with the definer's rights; the API never exposes that schema):
-- * auth.audit_log_entries: Supabase Auth's own log (sign-in, sign-out, password changed, reset requested, sign-up,
--   authenticator changes). Written only when the project's "audit logs in the database" setting is on (the dashboard
--   setting; the API can't change it). Token refreshes are left out: they happen every hour a session is open.
-- * auth.sessions: each session's start, last activity, assurance level, and browser (user agent).
-- * auth.users and auth.mfa_factors: the account's own timestamps (created, confirmation and reset links sent,
--   confirmed, last sign-in) and when an authenticator was added, so there is history before the audit log is on.
-- * public.admin_log: what Quad support did to the account (reset links, email changes, sign-outs, pauses).
-- IP addresses are never returned (support doesn't need them; specs/product/admin-console-ui.md "Sign-in activity").

create function public.admin_user_auth_activity(p_user uuid, p_limit integer default 100)
returns table (at timestamptz, kind text, detail text, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select e.at, e.kind, e.detail, e.source
  from (
    select a.created_at as at, a.payload ->> 'action' as kind,
           nullif(concat_ws(' ', a.payload ->> 'log_type', a.payload -> 'traits' ->> 'provider'), '') as detail, 'audit'::text as source
    from auth.audit_log_entries a
    where (a.payload ->> 'actor_id' = p_user::text or a.payload -> 'traits' ->> 'user_id' = p_user::text)
      and a.payload ->> 'action' is distinct from 'token_refreshed'
    union all
    select s.created_at, 'session_started', concat_ws(' · ', s.aal::text, s.user_agent), 'session'
    from auth.sessions s where s.user_id = p_user
    union all
    select coalesce(s.refreshed_at::timestamptz, s.updated_at), 'session_active', concat_ws(' · ', s.aal::text, s.user_agent), 'session'
    from auth.sessions s
    where s.user_id = p_user and coalesce(s.refreshed_at::timestamptz, s.updated_at) is not null
      and coalesce(s.refreshed_at::timestamptz, s.updated_at) > s.created_at + interval '1 minute'
    union all
    select v.at, v.kind, null, 'account'
    from auth.users u
    cross join lateral (values
      (u.created_at, 'account_created'),
      (u.confirmation_sent_at, 'confirmation_sent'),
      (u.email_confirmed_at, 'email_confirmed'),
      (u.recovery_sent_at, 'recovery_sent'),
      (u.email_change_sent_at, 'email_change_sent'),
      (u.last_sign_in_at, 'last_sign_in')
    ) v (at, kind)
    where u.id = p_user and v.at is not null
    union all
    select f.created_at, 'factor_added', f.factor_type::text || ' · ' || f.status::text, 'account'
    from auth.mfa_factors f where f.user_id = p_user
    union all
    select l.at, l.action, null, 'support'
    from public.admin_log l
    where l.target_kind = 'user' and l.target_id = p_user::text and (l.action like 'auth.%' or l.action like 'account.%')
  ) e
  order by e.at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.admin_user_auth_activity(uuid, integer) from public, anon;
grant execute on function public.admin_user_auth_activity(uuid, integer) to authenticated;
