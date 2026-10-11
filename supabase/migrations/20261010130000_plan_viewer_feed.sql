-- The per-viewer calendar feed (specs/planner/redesign/calendar.md "Feed, print, share"; build-plan.md review note 4,
-- unit U8). Additive; apply after 20261010120000_plan_redesign.sql (SQL Editor, dev first, then prod). Tested in
-- tests/planner-viewer-feed-policies.test.mts (PGlite, every assertion as a signed-in user or a signed-out caller).
--
-- The built per-list feed (plan_calendar_tokens, 20261008120000_planner.sql) is tied to one list. A parent wants one
-- subscription that carries every child they can see, so this token belongs to a person, not a list:
-- 1. plan_viewer_calendar_tokens: the sha256 hex of the token only (the clear token is shown once, never stored).
--    The owner reads, creates, and revokes their own rows; nobody else sees them. A revoked token stays revoked.
-- 2. plan_viewer_feed(token_hash): the feed's one read, callable without a session (the token is the only secret, as
--    with plan_for_calendar_token). It resolves the token's owner and returns, for every student whose list that
--    owner can read under the household grants, the open dated tasks and the visits on that student's plan list:
--    titles and dates only, never a detail, a note, or a number from the profile. College names aren't in the
--    database (unit_id is); the route resolves them from the dataset.
--
-- Read access is evaluated for the token's owner, not auth.uid() (a calendar has no session). The rule is
-- can_read_student (20261005120000_accounts.sql), which is what can_read_list_owner uses for a student's list
-- (20261006150000_household_hub.sql): a live (not deleted) student record that is the owner's own, a managed record
-- the owner created, or one where the owner is an active guardian in a live household where the student is an
-- active member. It is restated here with the owner's id in place of auth.uid(); the policy test checks it gives the
-- same answer as can_read_list for every person and list. Guardians' own lists (lists.user_id) aren't plans and are
-- never included. Each student contributes one list, the plan's: the default list, else the first created (as
-- lib/planner/load.ts picks it).

/* ------------------------------------------------------------------ */
/* 1. Tokens                                                           */
/* ------------------------------------------------------------------ */

create table public.plan_viewer_calendar_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index plan_viewer_calendar_tokens_user_idx on public.plan_viewer_calendar_tokens (user_id) where revoked_at is null;

-- Once revoked, always revoked: a revoked link never comes back by clearing revoked_at (make a new one instead).
create function public.plan_viewer_calendar_tokens_keep_revoked() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null then
    new.revoked_at := old.revoked_at;
  end if;
  return new;
end;
$$;

create trigger plan_viewer_calendar_tokens_keep_revoked
before update on public.plan_viewer_calendar_tokens
for each row execute function public.plan_viewer_calendar_tokens_keep_revoked();

alter table public.plan_viewer_calendar_tokens enable row level security;

create policy "Viewer calendar tokens: owner reads" on public.plan_viewer_calendar_tokens for select to authenticated
  using (user_id = auth.uid());
create policy "Viewer calendar tokens: owner creates" on public.plan_viewer_calendar_tokens for insert to authenticated
  with check (user_id = auth.uid() and revoked_at is null);
create policy "Viewer calendar tokens: owner revokes" on public.plan_viewer_calendar_tokens for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that. Signed-out
-- callers get nothing on the table; the feed reads it only through plan_viewer_feed().
revoke all on public.plan_viewer_calendar_tokens from public, anon, authenticated;
grant select on public.plan_viewer_calendar_tokens to authenticated;
grant insert (user_id, token_hash) on public.plan_viewer_calendar_tokens to authenticated;
grant update (revoked_at) on public.plan_viewer_calendar_tokens to authenticated;
grant all on public.plan_viewer_calendar_tokens to service_role;

/* ------------------------------------------------------------------ */
/* 2. The feed's read                                                  */
/* ------------------------------------------------------------------ */

-- One row per event: `kind` 'task' (title, due_on or window_start/window_end) or 'visit' (visit_kind, on the due_on
-- column, at_time). Done, dismissed, and orphaned tasks and undated ones are left out. Nothing for an unknown or
-- revoked token.
create function public.plan_viewer_feed(p_token_hash text)
returns table (
  student_id   uuid,
  student_name text,
  kind         text,
  id           uuid,
  item_id      uuid,
  unit_id      text,
  round        text,
  title        text,
  due_on       date,
  window_start date,
  window_end   date,
  visit_kind   text,
  at_time      time
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select t.user_id
    from public.plan_viewer_calendar_tokens t
    where p_token_hash ~ '^[0-9a-f]{64}$' and t.token_hash = p_token_hash and t.revoked_at is null
    limit 1
  ),
  -- can_read_student, for the token's owner (see the header).
  readable as (
    select s.id as student_id,
           nullif(split_part(btrim(coalesce(nullif(btrim(s.display_name), ''), p.display_name, '')), ' ', 1), '') as student_name
    from viewer v
    join public.students s on s.deleted_at is null
    left join public.profiles p on p.id = s.user_id
    where s.user_id = v.user_id
       or s.managed_by = v.user_id
       or exists (
         select 1
         from public.household_members g
         join public.household_members m on m.household_id = g.household_id
         join public.households h on h.id = g.household_id
         where g.user_id = v.user_id
           and g.role = 'guardian' and g.status = 'active'
           and m.student_id = s.id and m.role = 'student' and m.status = 'active'
           and h.deleted_at is null
       )
  ),
  plan_lists as (
    select distinct on (l.student_id) l.id as list_id, l.student_id
    from public.lists l
    join readable r on r.student_id = l.student_id
    order by l.student_id, l.is_default desc, l.created, l.id
  )
  select r.student_id, r.student_name, 'task'::text, t.id, t.item_id, li.unit_id, li.round, t.title,
         t.due_on, t.window_start, t.window_end, null::text, null::time
  from plan_lists pl
  join readable r on r.student_id = pl.student_id
  join public.plan_tasks t on t.list_id = pl.list_id
  left join public.list_items li on li.id = t.item_id
  where t.done_at is null and not t.dismissed and not t.orphaned
    and (t.due_on is not null or t.window_start is not null)
  union all
  select r.student_id, r.student_name, 'visit'::text, v.id, v.item_id, li.unit_id, li.round, null::text,
         v.on_date, null::date, null::date, v.kind, v.at_time
  from plan_lists pl
  join readable r on r.student_id = pl.student_id
  join public.list_items li on li.list_id = pl.list_id
  join public.plan_visits v on v.item_id = li.id
$$;

-- The token is the only secret, so the feed is callable without a session, like plan_for_calendar_token. This is the
-- only thing a signed-out caller can reach here.
revoke execute on function public.plan_viewer_feed(text) from public;
grant execute on function public.plan_viewer_feed(text) to anon, authenticated, service_role;

-- Internal: the trigger only.
revoke execute on function public.plan_viewer_calendar_tokens_keep_revoked() from public, anon, authenticated;
