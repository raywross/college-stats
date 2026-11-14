-- Quad Advisor's billing (specs/product/commercialization.md "Billing"; specs/product/advisor.md "2. The trial"):
-- the subscriptions Stripe's webhooks write, the customer ids behind them, the events already handled, the one
-- read the entitlement hook makes, and the setting that turns the price on.
--
-- * `subscriptions`: one row per Stripe subscription. Written only by the server with the secret key (the webhook,
--   the checkout's return, the nightly reconcile); a person reads their own rows, an admin every row. `allowed()`
--   reads this table, never Stripe, at request time.
-- * `billing_customers`: the Stripe customer each account has, made on the first checkout.
-- * `stripe_events`: every webhook event id handled once (Stripe retries; a replay must do nothing).
-- * `advisor_access(students[])`: for each student the caller may read, the accounts behind them (for the early-account
--   rule), whether a trial has ever covered them, and the subscriptions that cover them: a student plan naming them,
--   or a family plan held by a guardian in one of their households (or the guardian managing their record).
-- * `admin_set_setting()` learns `advisor.price_live_at`: an ISO timestamp, or null while the Advisor is free for all.

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  product                text not null check (product in ('student', 'family')),
  status                 text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
  stripe_customer_id     text not null,
  stripe_subscription_id text not null unique,
  price_id               text,
  price_variant          text not null default 'list',
  trial_end              timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  covers_student_id      uuid references public.students (id) on delete set null,
  covered_student_ids    uuid[] not null default '{}',
  reminder_sent_at       timestamptz,
  created                timestamptz not null default now(),
  updated                timestamptz not null default now()
);

create index subscriptions_user_idx on public.subscriptions (user_id);
create index subscriptions_covers_idx on public.subscriptions (covers_student_id) where covers_student_id is not null;
create index subscriptions_covered_idx on public.subscriptions using gin (covered_student_ids);
create index subscriptions_status_idx on public.subscriptions (status);

alter table public.subscriptions enable row level security;

create policy subscriptions_read_own on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

create table public.billing_customers (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created            timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
create policy billing_customers_read_own on public.billing_customers for select to authenticated using (user_id = (select auth.uid()));
grant select on public.billing_customers to authenticated;
grant all on public.billing_customers to service_role;

create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
grant all on public.stripe_events to service_role;

-- The subscriptions covering one student: a student plan naming them, or a family plan held by a guardian who shares
-- an active household with them or manages their record.
create function public.subscriptions_covering(p_student uuid) returns setof public.subscriptions
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.subscriptions s
  where (s.product = 'student' and s.covers_student_id = p_student)
     or (s.product = 'family' and (
          exists (
            select 1
            from public.household_members g
            join public.household_members k on k.household_id = g.household_id
            where g.user_id = s.user_id and g.role = 'guardian' and g.status = 'active'
              and k.student_id = p_student and k.role = 'student' and k.status = 'active'
          )
          or exists (select 1 from public.students st where st.id = p_student and st.managed_by = s.user_id and st.deleted_at is null)
        ));
$$;

revoke execute on function public.subscriptions_covering(uuid) from public, anon, authenticated;
grant execute on function public.subscriptions_covering(uuid) to service_role;

-- One read for the entitlement hook and the caseload chip: per student the caller may read (every student for the
-- service role), the accounts behind them, whether any trial has covered them, and the covering subscriptions.
create function public.advisor_access(p_students uuid[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_student uuid;
  v_created jsonb;
  v_rows jsonb;
  v_used boolean;
begin
  foreach v_student in array coalesce(p_students, '{}'::uuid[]) loop
    if auth.role() <> 'service_role' and not public.can_read_student(v_student) then
      continue;
    end if;
    select coalesce(jsonb_agg(p.created), '[]'::jsonb) into v_created
    from public.students st
    join public.profiles p on p.id = st.user_id or p.id = st.managed_by
    where st.id = v_student;
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows from public.subscriptions_covering(v_student) s;
    select exists (select 1 from public.subscriptions s where v_student = any (s.covered_student_ids)) into v_used;
    v_out := v_out || jsonb_build_object('student_id', v_student, 'created', v_created, 'trial_used', v_used, 'subscriptions', v_rows);
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.advisor_access(uuid[]) from public, anon;
grant execute on function public.advisor_access(uuid[]) to authenticated, service_role;

-- The price goes live when the owner sets `advisor.price_live_at` (specs/product/open-doors.md "Early accounts"):
-- an ISO timestamp as a string, or null. Accounts created before it are early accounts.
create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_day text;
  v_when timestamptz;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_key not in ('planner.all_moves', 'planner.today', 'advisor.price_live_at') then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;
  if p_key = 'planner.all_moves' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if p_key = 'planner.today' and jsonb_typeof(p_value) <> 'null' then
    if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid_value' using errcode = '22023'; end if;
    v_day := p_value #>> '{}';
    if v_day !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_value' using errcode = '22023'; end if;
    begin
      if to_char(v_day::date, 'YYYY-MM-DD') <> v_day then raise exception 'invalid_value' using errcode = '22023'; end if;
    exception when others then
      raise exception 'invalid_value' using errcode = '22023';
    end;
  end if;
  if p_key = 'advisor.price_live_at' and jsonb_typeof(p_value) <> 'null' then
    if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid_value' using errcode = '22023'; end if;
    begin
      v_when := (p_value #>> '{}')::timestamptz;
    exception when others then
      raise exception 'invalid_value' using errcode = '22023';
    end;
  end if;
  select s.value into v_old from public.app_settings s where s.key = p_key;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.admin_log_write('setting.set', null, p_key, jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;
