-- Application snapshots (specs/chances/calibration.md "Collecting outcomes" 1; specs/chances/method/outcomes.md): the
-- student's estimate inputs as of the day a college is marked applied, binned, with the estimate the site gave and
-- whether the student changed the group. Outcomes are measured against these, never against inputs changed later.
-- Additive. Apply after 20261010140000_college_data_failures.sql (SQL Editor, dev first, then prod). Tested in
-- tests/chances-snapshot-policies.test.mts (PGlite + the auth stub) and tests/chances-snapshot.test.mts (the text).
--
-- Rules:
-- 1. One row per list item (the latest time it was marked applied), written only through
--    record_application_snapshot(): the caller must be able to edit the list, the item must be applied, and the list
--    must be a student's (a guardian's own list has no planner outcomes). The function sets who, which college, when,
--    the season, and the consent; the request supplies only the binned inputs and the estimate.
-- 2. No name, no high school id, no free text: every column is a number, a boolean, a code from a fixed set, or an
--    array of codes. The high school appears only as a band of what it offers.
-- 3. Private to the student: read by whoever can read the list (the student and the guardians who see it, as
--    list_items), deleted by the student's own account (or an editing guardian of a student without one, the
--    outcome-share consent's rule). Nobody updates a row through the API. Export: lib/account-export.ts.
-- 4. consented mirrors the list's outcome-share consent (lists.outcome_share_consented_at, 20261008141000), kept in
--    step by triggers; a later consent covers the snapshots already taken, and revoking it removes them from every
--    future use (the measurements and the "students like you" counts read consented rows only).
-- 5. Season = the fall the student would enter: applied July or later counts toward the next year's fall. A season
--    is finished on September 1 of that year (decisions, wait lists, and summer melt are over).
--    delete_unconsented_snapshots() removes unconsented rows of finished seasons (weekly cron, or by hand).
-- 6. Rows go with the item, the list, or the student (cascade), so account purges and list deletions take them.

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

create table public.application_snapshots (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null unique references public.list_items (id) on delete cascade,
  list_id           uuid not null references public.lists (id) on delete cascade,
  student_id        uuid not null references public.students (id) on delete cascade,
  unit_id           text not null check (unit_id ~ '^[0-9]{1,10}$'),
  season            integer not null check (season between 2020 and 2100),
  applied_on        date not null,
  round             text check (round in ('ed', 'ed2', 'ea', 'rea', 'rd', 'rolling')),

  -- The student's inputs, binned (calibration.md: GPA to 0.05, scores to 10 SAT / 1 ACT, grades to 0.1).
  gpa               numeric(3, 2) check (gpa between 0 and 4 and gpa * 20 = round(gpa * 20)),
  gpa_low           numeric(3, 2) check (gpa_low between 0 and 4 and gpa_low * 20 = round(gpa_low * 20)),
  gpa_high          numeric(3, 2) check (gpa_high between 0 and 4 and gpa_high * 20 = round(gpa_high * 20)),
  gpa_scale         text check (gpa_scale in ('4.0', '5.0', '100')),
  test_kind         text check (test_kind in ('sat', 'act')),
  test_score        smallint,
  sat_math          smallint check (sat_math between 200 and 800 and sat_math % 10 = 0),
  act_math          smallint check (act_math between 1 and 36),
  class_rank_pct    smallint check (class_rank_pct between 0 and 100),
  state             text check (state ~ '^[A-Z]{2}$' or state = 'OUTSIDE_US'),
  majors            text[] not null default '{}' check (cardinality(majors) <= 3 and array_to_string(majors, ',') ~ '^([0-9]{2}(,[0-9]{2})*)?$'),
  practice          boolean not null default false,
  advanced_courses  smallint not null default 0 check (advanced_courses between 0 and 40),
  advanced_planned  smallint not null default 0 check (advanced_planned between 0 and advanced_courses),
  honors_courses    smallint not null default 0 check (honors_courses between 0 and 40),
  advanced_gpa      numeric(2, 1) check (advanced_gpa between 0 and 4),
  math_gpa          numeric(2, 1) check (math_gpa between 0 and 4),
  science_gpa       numeric(2, 1) check (science_gpa between 0 and 4),
  -- What the high school offers, as a band (never which school).
  hs_ap_band        text check (hs_ap_band in ('none', '1-5', '6-10', '11-15', '16+')),
  hs_ib             boolean,
  hs_dual           boolean,
  -- The college's overall admit rate as the site showed it that day, to the hundredth.
  admit_rate        numeric(3, 2) check (admit_rate between 0 and 1),

  -- The estimate, as the student saw it.
  estimate_group    text check (estimate_group in ('reach', 'target', 'likely')),
  estimate_label    text check (estimate_label in ('reach-for-everyone', 'guaranteed')),
  inputs_used       text[] not null default '{}'
    check (inputs_used <@ array['gpa', 'test', 'sections', 'class_rank', 'courses', 'subject_grades', 'state', 'major', 'round', 'high_school']::text[]),
  -- Note catalog keys (lib/chances/notes.ts), never their filled-in text.
  note_keys         text[] not null default '{}' check (cardinality(note_keys) <= 40 and array_to_string(note_keys, ',') ~ '^([a-z0-9_.]+(,[a-z0-9_.]+)*)?$'),
  model_version     text check (model_version ~ '^[A-Za-z0-9._:-]{1,40}$'),
  -- What the season measurements read beside the group (method/outcomes.md): never shown.
  position          text check (position in ('below', 'in', 'above')),
  base_rate_kind    text check (base_rate_kind in ('guaranteed', 'major', 'residency', 'overall')),
  base_rate         numeric(3, 2) check (base_rate between 0 and 1),
  crowded           boolean,
  rigor_reading     text check (rigor_reading in ('most', 'much', 'some', 'few_offered', 'cant_place')),
  -- The group with one input switched off, for "what each input bought".
  without_residency text check (without_residency in ('reach', 'target', 'likely')),
  without_crowding  text check (without_crowding in ('reach', 'target', 'likely')),
  without_rigor     text check (without_rigor in ('reach', 'target', 'likely')),
  without_rank      text check (without_rank in ('reach', 'target', 'likely')),

  -- The group the student picked on their list, when they picked one, and whether it differs from the estimate.
  student_group     text check (student_group in ('reach', 'target', 'likely')),
  group_changed     boolean not null default false,

  consented         boolean not null default false,
  created_at        timestamptz not null default now(),

  constraint application_snapshots_test_shape check (
    (test_kind is null and test_score is null)
    or (test_kind = 'sat' and test_score between 400 and 1600 and test_score % 10 = 0)
    or (test_kind = 'act' and test_score between 1 and 36)
  ),
  constraint application_snapshots_gpa_range check (gpa_low is null or gpa_high is null or gpa_low <= gpa_high)
);

create index application_snapshots_list_idx on public.application_snapshots (list_id);
create index application_snapshots_student_idx on public.application_snapshots (student_id);
create index application_snapshots_cell_idx on public.application_snapshots (unit_id, season) where consented;
create index application_snapshots_cleanup_idx on public.application_snapshots (season) where not consented;

/* ------------------------------------------------------------------ */
/* Seasons                                                             */
/* ------------------------------------------------------------------ */

-- The fall a student applying on this date would enter (rule 5). lib/chances/snapshot.ts snapshotSeason() matches.
create function public.application_season(p_applied date) returns integer
language sql
immutable
set search_path = ''
as $$
  select extract(year from p_applied)::integer + case when extract(month from p_applied) >= 7 then 1 else 0 end
$$;

-- The latest season whose outcomes are all in (rule 5). lib/chances/snapshot.ts lastFinishedSeason() matches.
create function public.last_finished_season() returns integer
language sql
stable
set search_path = ''
as $$
  select extract(year from now() at time zone 'utc')::integer
    - case when extract(month from now() at time zone 'utc') >= 9 then 0 else 1 end
$$;

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.application_snapshots enable row level security;

create policy "Snapshots: read" on public.application_snapshots for select to authenticated
  using (public.can_read_list(list_id));
create policy "Snapshots: delete" on public.application_snapshots for delete to authenticated
  using (public.can_consent_outcome_share(student_id));

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that. No insert or
-- update for users: writes go through record_application_snapshot().
revoke all on public.application_snapshots from public, anon, authenticated;
grant select, delete on public.application_snapshots to authenticated;
grant all on public.application_snapshots to service_role;

/* ------------------------------------------------------------------ */
/* The write (rule 1)                                                  */
/* ------------------------------------------------------------------ */

-- Records (or replaces) the snapshot for an applied item. p_snapshot carries the binned inputs and the estimate as
-- lib/chances/snapshot.ts builds them; any identity, date, season, or consent key in it is ignored. Returns the
-- row's id. Raises 'not_allowed' (42501) when the caller can't edit the list or the list isn't a student's, and
-- 'not_applied' (22023) when the item isn't applied.
create function public.record_application_snapshot(p_item uuid, p_snapshot jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.list_items;
  v_list public.lists;
  r public.application_snapshots;
  v_id uuid;
begin
  select * into v_item from public.list_items where id = p_item;
  if v_item.id is null or not public.can_edit_list(v_item.list_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_list from public.lists where id = v_item.list_id;
  if v_list.student_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_item.applied_on is null or v_item.status not in ('applied', 'decided') then
    raise exception 'not_applied' using errcode = '22023';
  end if;
  r := jsonb_populate_record(null::public.application_snapshots, coalesce(p_snapshot, '{}'::jsonb));

  insert into public.application_snapshots as s (
    item_id, list_id, student_id, unit_id, season, applied_on, round,
    gpa, gpa_low, gpa_high, gpa_scale, test_kind, test_score, sat_math, act_math, class_rank_pct, state, majors, practice,
    advanced_courses, advanced_planned, honors_courses, advanced_gpa, math_gpa, science_gpa, hs_ap_band, hs_ib, hs_dual,
    admit_rate, estimate_group, estimate_label, inputs_used, note_keys, model_version,
    position, base_rate_kind, base_rate, crowded, rigor_reading,
    without_residency, without_crowding, without_rigor, without_rank,
    student_group, group_changed, consented, created_at
  ) values (
    v_item.id, v_item.list_id, v_list.student_id, v_item.unit_id, public.application_season(v_item.applied_on), v_item.applied_on,
    coalesce(r.round, v_item.round),
    r.gpa, r.gpa_low, r.gpa_high, r.gpa_scale, r.test_kind, r.test_score, r.sat_math, r.act_math, r.class_rank_pct, r.state,
    coalesce(r.majors, '{}'), coalesce(r.practice, false),
    coalesce(r.advanced_courses, 0), coalesce(r.advanced_planned, 0), coalesce(r.honors_courses, 0), r.advanced_gpa, r.math_gpa,
    r.science_gpa, r.hs_ap_band, r.hs_ib, r.hs_dual,
    r.admit_rate, r.estimate_group, r.estimate_label, coalesce(r.inputs_used, '{}'), coalesce(r.note_keys, '{}'), r.model_version,
    r.position, r.base_rate_kind, r.base_rate, r.crowded, r.rigor_reading,
    r.without_residency, r.without_crowding, r.without_rigor, r.without_rank,
    r.student_group, coalesce(r.group_changed, false), v_list.outcome_share_consented_at is not null, now()
  )
  on conflict (item_id) do update set
    list_id = excluded.list_id, student_id = excluded.student_id, unit_id = excluded.unit_id, season = excluded.season,
    applied_on = excluded.applied_on, round = excluded.round,
    gpa = excluded.gpa, gpa_low = excluded.gpa_low, gpa_high = excluded.gpa_high, gpa_scale = excluded.gpa_scale,
    test_kind = excluded.test_kind, test_score = excluded.test_score, sat_math = excluded.sat_math, act_math = excluded.act_math,
    class_rank_pct = excluded.class_rank_pct, state = excluded.state, majors = excluded.majors, practice = excluded.practice,
    advanced_courses = excluded.advanced_courses, advanced_planned = excluded.advanced_planned,
    honors_courses = excluded.honors_courses, advanced_gpa = excluded.advanced_gpa, math_gpa = excluded.math_gpa,
    science_gpa = excluded.science_gpa, hs_ap_band = excluded.hs_ap_band, hs_ib = excluded.hs_ib, hs_dual = excluded.hs_dual,
    admit_rate = excluded.admit_rate, estimate_group = excluded.estimate_group, estimate_label = excluded.estimate_label,
    inputs_used = excluded.inputs_used, note_keys = excluded.note_keys, model_version = excluded.model_version,
    position = excluded.position, base_rate_kind = excluded.base_rate_kind, base_rate = excluded.base_rate,
    crowded = excluded.crowded, rigor_reading = excluded.rigor_reading,
    without_residency = excluded.without_residency, without_crowding = excluded.without_crowding,
    without_rigor = excluded.without_rigor, without_rank = excluded.without_rank,
    student_group = excluded.student_group, group_changed = excluded.group_changed, consented = excluded.consented,
    created_at = excluded.created_at
  returning s.id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_application_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.record_application_snapshot(uuid, jsonb) to authenticated, service_role;

/* ------------------------------------------------------------------ */
/* Consent and ownership stay in step (rule 4)                         */
/* ------------------------------------------------------------------ */

-- A list's consent or student changing (a consent given or revoked; a managed record merged into the student's own
-- account) is copied to its snapshots. Security definer: users hold no update grant on the table.
create function public.lists_sync_snapshots() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_id is null then
    delete from public.application_snapshots where list_id = new.id;
  else
    update public.application_snapshots
      set consented = new.outcome_share_consented_at is not null, student_id = new.student_id
      where list_id = new.id
        and (consented is distinct from (new.outcome_share_consented_at is not null) or student_id is distinct from new.student_id);
  end if;
  return null;
end;
$$;

create trigger lists_sync_snapshots
after update of outcome_share_consented_at, student_id on public.lists
for each row execute function public.lists_sync_snapshots();

-- An item moved to another list takes its snapshot along, with that list's student and consent.
create function public.list_items_sync_snapshot() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.lists;
begin
  select * into v_list from public.lists where id = new.list_id;
  if v_list.student_id is null then
    delete from public.application_snapshots where item_id = new.id;
  else
    update public.application_snapshots
      set list_id = new.list_id, student_id = v_list.student_id, consented = v_list.outcome_share_consented_at is not null
      where item_id = new.id;
  end if;
  return null;
end;
$$;

create trigger list_items_sync_snapshot
after update of list_id on public.list_items
for each row when (new.list_id is distinct from old.list_id)
execute function public.list_items_sync_snapshot();

revoke execute on function public.lists_sync_snapshots() from public, anon, authenticated;
revoke execute on function public.list_items_sync_snapshot() from public, anon, authenticated;

/* ------------------------------------------------------------------ */
/* Season-end cleanup (rule 5)                                         */
/* ------------------------------------------------------------------ */

-- Deletes the unconsented snapshots of every finished season up to p_season (default: the latest finished one) and
-- returns how many went. Refuses a season that isn't finished. Service role only (the weekly cron, or by hand:
-- select public.delete_unconsented_snapshots();).
create function public.delete_unconsented_snapshots(p_season integer default null) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last integer := public.last_finished_season();
  v_count integer;
begin
  if p_season is not null and p_season > v_last then
    raise exception 'season_not_finished' using errcode = '22023';
  end if;
  delete from public.application_snapshots where not consented and season <= coalesce(p_season, v_last);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.delete_unconsented_snapshots(integer) from public, anon, authenticated;
grant execute on function public.delete_unconsented_snapshots(integer) to service_role;

/* ------------------------------------------------------------------ */
/* Reads that leave no row-level data behind                           */
/* ------------------------------------------------------------------ */

-- The season measurements' input (scripts/chances-calibration.mts): consented snapshots of live students with the
-- item's outcome, without any id (no item, list, or student). Service role only.
create function public.chances_outcome_rows(p_from_season integer default 2020, p_to_season integer default 2100) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(s) - 'id' - 'item_id' - 'list_id' - 'student_id' - 'created_at') || jsonb_build_object('outcome', li.outcome)
  from public.application_snapshots s
  join public.list_items li on li.id = s.item_id
  join public.students st on st.id = s.student_id
  where s.consented and st.deleted_at is null and s.season between p_from_season and p_to_season
$$;

revoke execute on function public.chances_outcome_rows(integer, integer) from public, anon, authenticated;
grant execute on function public.chances_outcome_rows(integer, integer) to service_role;

-- "Students like you" (calibration.md): of the consented snapshots at this college with this academic position and
-- base-rate kind (and state, when given) in these seasons, how many had a final decision and how many were admitted.
-- No row at all unless the cell has at least 50 decisions and at least 10 each admitted and not admitted, so a small
-- cell can't be read through the API. lib/chances/like-you.ts applies the same rule.
create function public.chances_like_you(p_unit text, p_position text, p_base_rate_kind text, p_state text, p_from_season integer, p_to_season integer)
returns table (n integer, admitted integer)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, (count(*) filter (where li.outcome = 'admitted'))::integer
  from public.application_snapshots s
  join public.list_items li on li.id = s.item_id
  join public.students st on st.id = s.student_id
  where s.consented and st.deleted_at is null
    and s.unit_id = p_unit and s.position = p_position and s.base_rate_kind = p_base_rate_kind
    and (p_state is null or s.state = p_state)
    and s.season between p_from_season and p_to_season
    and li.outcome in ('admitted', 'denied', 'waitlisted')
  having count(*) >= 50
    and count(*) filter (where li.outcome = 'admitted') >= 10
    and count(*) filter (where li.outcome <> 'admitted') >= 10
$$;

revoke execute on function public.chances_like_you(text, text, text, text, integer, integer) from public;
grant execute on function public.chances_like_you(text, text, text, text, integer, integer) to anon, authenticated, service_role;
