-- The essay page's and the header's reads in one call each (specs/serving-architecture.md "Measured after the deploy
-- and the migration (2026-11-08)": /advisor/essays/[id] made 12 reads in 7 waves and then the browser fetched
-- /api/essays/review; /api/me ran the viewer bundle for the household's children). Apply after
-- 20261108120000_fast_policies.sql (SQL Editor, dev first, then prod). Tested against real Postgres (PGlite + the auth
-- stub) in tests/essay-me-bundles.test.mts: each function returns what the per-table reads it replaces return, for
-- every caller.
--
-- Both are security invoker: row-level security decides every read (the read policies are set-based since
-- 20261108120000_fast_policies.sql), and the function only shapes, as plan_bundle() and org_student_bundle() do.
-- Every `order by` ends on a unique key, so the order never depends on the plan.

/* ------------------------------------------------------------------ */
/* essay_bundle(p_essay)                                               */
/* ------------------------------------------------------------------ */

-- One draft as lib/essays/load.ts readEssay(), the review route's readReviews(), and planColleges() read it: the
-- essay (ESSAY_COLUMNS), its versions (newest first, at most 100), links, comments (by created) and suggestions not
-- withdrawn (newest first), each comment and suggestion with its author's display name as lib/lists.ts namesFor()
-- reads it (profiles by id, under row-level security), the draft it was copied from, how many drafts were copied from
-- it, its reviews (newest first, at most 10) with their notes (by position), and the unit ids on the student's
-- default list (else their first list by created), by position. Null when the caller can't read the essay or it
-- isn't there.
create or replace function public.essay_bundle(p_essay uuid) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_essay public.essays;
  v_list uuid;
begin
  select * into v_essay from public.essays e where e.id = p_essay;
  if not found then
    return null;
  end if;
  -- planColleges(): lists by is_default desc, then created; the default, else the first.
  select l.id into v_list
  from public.lists l
  where l.student_id = v_essay.student_id
  order by l.is_default desc, l.created, l.id
  limit 1;
  return jsonb_build_object(
    'essay', jsonb_build_object(
      'id', v_essay.id, 'student_id', v_essay.student_id, 'prompt_ref', v_essay.prompt_ref, 'title', v_essay.title,
      'count_kind', v_essay.count_kind, 'count', v_essay.count, 'limit_max', v_essay.limit_max,
      'limit_min', v_essay.limit_min, 'status', v_essay.status, 'kind', v_essay.kind, 'base_id', v_essay.base_id,
      'created', v_essay.created, 'updated', v_essay.updated, 'body', v_essay.body
    ),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'essay_id', v.essay_id, 'count', v.count, 'source', v.source,
        'label', v.label, 'created', v.created) order by v.created desc, v.id)
      from (
        select x.id, x.essay_id, x.count, x.source, x.label, x.created
        from public.essay_versions x where x.essay_id = p_essay
        order by x.created desc, x.id
        limit 100
      ) v
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('essay_id', k.essay_id, 'prompt_ref', k.prompt_ref, 'created', k.created)
        order by k.created, k.prompt_ref)
      from public.essay_links k where k.essay_id = p_essay
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'essay_id', c.essay_id, 'version_id', c.version_id,
        'author_id', c.author_id, 'author_role', c.author_role, 'anchor', c.anchor, 'body', c.body,
        'created', c.created, 'resolved_at', c.resolved_at,
        'author_name', (select p.display_name from public.profiles p where p.id = c.author_id))
        order by c.created, c.id)
      from public.essay_comments c where c.essay_id = p_essay
    ), '[]'::jsonb),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'essay_id', s.essay_id, 'base_version_id', s.base_version_id,
        'base_body', s.base_body, 'author_id', s.author_id, 'author_role', s.author_role,
        'proposed_body', s.proposed_body, 'note', s.note, 'status', s.status, 'decisions', s.decisions,
        'created', s.created, 'updated', s.updated, 'decided_at', s.decided_at,
        'author_name', (select p.display_name from public.profiles p where p.id = s.author_id))
        order by s.created desc, s.id)
      from public.essay_suggestions s where s.essay_id = p_essay and s.status <> 'withdrawn'
    ), '[]'::jsonb),
    'base', (
      select jsonb_build_object('id', b.id, 'title', b.title, 'updated', b.updated)
      from public.essays b where b.id = v_essay.base_id
    ),
    'variants', (select count(*) from public.essays d where d.base_id = p_essay),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'version_id', r.version_id, 'created', r.created,
        'outcome', r.outcome, 'method', r.method,
        'notes', coalesce((
          select jsonb_agg(jsonb_build_object('id', n.id, 'review_id', n.review_id, 'position', n.position,
            'category', n.category, 'span', n.span, 'observation', n.observation, 'why', n.why, 'source', n.source,
            'ask', n.ask, 'fix', n.fix, 'state', n.state) order by n.position, n.id)
          from public.essay_notes n where n.review_id = r.id
        ), '[]'::jsonb))
        order by r.created desc, r.id)
      from (
        select x.id, x.version_id, x.created, x.outcome, x.method
        from public.essay_reviews x where x.essay_id = p_essay
        order by x.created desc, x.id
        limit 10
      ) r
    ), '[]'::jsonb),
    'list_unit_ids', coalesce((
      select jsonb_agg(i.unit_id order by i.position, i.id)
      from public.list_items i where i.list_id = v_list
    ), '[]'::jsonb)
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* me_bundle()                                                         */
/* ------------------------------------------------------------------ */

-- The header's account state (app/api/me/route.ts) in one call: the caller's profile (name, role hint, pause), whether
-- they belong to a counselor organization, whether they are an admin (before the second factor), and the household's
-- children as lib/households.ts householdChildren() resolves them. A child is a student the caller reaches as a
-- guardian (lib/accounts.ts resolveStudentAccess: a readable student record that isn't the caller's own, and that the
-- caller manages, or reaches through a household where they are an active guardian, or that no live counselor grant of
-- theirs covers) and who is on the roster of a household the caller is in; `joined` is the date on the roster of the
-- first such household (by the household's created), and the children are ordered by it, then id. The reads are the
-- viewer bundle's (students through visible_student_ids(); household_members, households, and the grants under
-- row-level security; the rosters through household_roster()), so the answer is the one the TypeScript computes.
create or replace function public.me_bundle() returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  return jsonb_build_object(
    'profile', (
      select jsonb_build_object('display_name', p.display_name, 'role_hint', p.role_hint, 'suspended_at', p.suspended_at)
      from public.profiles p where p.id = v_uid
    ),
    'org', public.my_organization() is not null,
    'admin', public.is_admin_any_aal(),
    'children', coalesce((
      with rosters as (
        select h.id as household_id, h.created as household_created, r.ordinality, r.role, r.student_id, r.joined,
               bool_or(r.is_me) over (partition by h.id) as mine
        from public.households h
        cross join lateral public.household_roster(h.id) with ordinality r
        where h.deleted_at is null
      ),
      rostered as (
        -- The students on the rosters of the households the caller is in, each with the date of their first:
        -- households by created, then the roster's own order (lib/households.ts householdChildren's `joined`).
        select distinct on (x.student_id) x.student_id, x.joined
        from rosters x
        where x.mine and x.role = 'student' and x.student_id is not null
        order by x.student_id, x.household_created, x.household_id, x.ordinality
      ),
      family as (
        -- Reached through a household where the caller is an active guardian (resolveStudentAccess's viaHousehold).
        select m.student_id
        from public.household_members g
        join public.household_members m on m.household_id = g.household_id and m.role = 'student'
          and m.status = 'active' and m.student_id is not null
        where g.user_id = v_uid and g.role = 'guardian' and g.status = 'active'
      ),
      granted as (
        -- The caller's live grants as a member of a counselor organization (viewer_bundle()'s `grants`).
        select g.student_id
        from public.org_students g
        join public.org_members om on om.org_id = g.org_id and om.user_id = v_uid
        join public.organizations o on o.id = g.org_id and o.deleted_at is null
        where g.ended_at is null
      )
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name, 'joined', ro.joined) order by ro.joined, s.id)
      from public.students s
      join rostered ro on ro.student_id = s.id
      where s.deleted_at is null
        and s.id in (select public.visible_student_ids())
        and s.user_id is distinct from v_uid
        and (
          s.managed_by = v_uid
          or s.id in (select f.student_id from family f)
          or s.id not in (select gr.student_id from granted gr)
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.essay_bundle(uuid) from public, anon;
revoke execute on function public.me_bundle() from public, anon;
grant execute on function public.essay_bundle(uuid) to authenticated;
grant execute on function public.me_bundle() to authenticated;
