# Planner Model: Stages, Tasks, Visits, Offers, and the Plan Tab

> Status: **built** 2026-10-08 on `feature/planner` ([below](#built-2026-10-08-unit-u1-on-featureplanner-model)); planned 2026-10-07. The foundation unit of the [planner](README.md): the shared tables, the stage
> machine, the Plan tab's frame on the person's page, the cycle year, and the entitlement hooks every stage reads.
> Builds on [household-hub.md](../product/household-hub.md) and [saved-lists.md](../product/saved-lists.md). Part of
> the planner.

## Goal
Give the six stages one model to write to, so a tick anywhere is a fact everywhere, a data publish can move a date
without losing anyone's work, a parent's view is the same query with a different session, and the iPhone app can
render the plan from the same `lib/` code ([iphone-app/api.md](../iphone-app/api.md)). Nothing here is visible on its
own except the Plan tab's empty frame and the stage strip.

## Principles
- **The list is the spine.** `list_items` already holds category, status, outcome, round, deadline override,
  enrolling, updates, visited, and follows-social. The planner adds columns to it and tables that hang off it. There
  is no second "plan" copy of the colleges.
- **Stage is computed, never stored.** A student's stage follows from their list's facts (below), so nobody has to
  "advance" anything and nothing gets out of step.
- **Tasks are generated with keys.** Every generated task has a `key` (`{item_id}:{kind}:{round}`, or
  `{student}:{kind}` for student-wide ones) so generation is idempotent: a re-run after a data publish updates dates
  and text, never duplicates, and never touches `done_at`.
- **Dates carry lineage.** A generated task stores the field path and edition its date came from, so the ⓘ on the
  plan is the same citation popover as on the profile ([data-lineage.md](../data-lineage.md)).
- **Access is the list's access.** Whoever can read a list reads its plan; whoever can edit it edits the plan
  (`can_read_list` / `can_edit_list` from the hub migration); `done_by` and `created_by` record who.

## The cycle year
Everything dated is relative to the student's **application cycle**: the academic year in which they apply, named
by the fall they'd enroll (`grad_year` on the student record, built). A class of 2028 student applies in the 2027–28
cycle. The cycle file ([timeline.md](timeline.md#the-cycle-file)) is keyed by that year. A student with no `grad_year`
is asked for it when the Plan tab opens (one field, saved to the student record). The student's **grade** follows
from it (today's date against the cycle), and decides which stages are in season
([timeline.md](timeline.md#the-plan-by-grade)).

## Stages
| Stage | A student is in it when | Leaves it when |
|---|---|---|
| 1 List | the list has fewer than 3 colleges, or any college is `unsorted` | 3+ colleges, all categorized |
| 2 Rounds | some college that offers an early round has no `round`, or the plan has an unresolved conflict | every college has a round and no conflict is open |
| 3 Actions | always available; "in season" from the spring of junior year to the first deadline | never (it's a side stage) |
| 4 Timeline | the first task's window has opened | never; it's the backbone |
| 5 Applications | any college is `applying` | every college is `applied` or `decided` |
| 6 Offers | any college is `decided` | `enrolling` is set on one college and its commit tasks are done |

`stageOf(list, items, tasks, today)` in `lib/planner/stage.ts` (pure, tested) returns the **current** stage (the
earliest one with open work) and a flag per stage (`done`, `open`, `not yet`). The strip shows all six; the current
one is open by default.

## Tables
New migration `…_planner.sql`, additive, policies mirroring `list_items`
([database-architecture.md](../database-architecture.md#rules-for-user-data-tables)).

```
list_items  + dream boolean not null default false        -- one per list (partial unique index where dream)
            + priority int null                            -- the student's own rank, 1 = would go first (stage 2)
            + followed_networks text[] not null default '{}' -- which of the six networks they follow (stage 3)
            + info_requested_on date null                   -- stage 3
            + application_platform text null               -- 'common_app' | 'coalition' | 'own' | 'uc' | 'apply_texas' | 'other' (stage 5)
            + applied_on date null, complete_on date null   -- stage 5 (applied_on sets status 'applied')
            + portal_url text null                          -- stage 5; a URL only, never credentials
            + committed_on date null, withdrawn_on date null -- stage 6

plan_tasks   (id, list_id, item_id null, key text, kind text, title text, detail text null,
              due_on date null, window_start date null, window_end date null,
              assignee: 'student' | 'guardian' | 'either',
              source: 'college' | 'cycle' | 'stage' | 'own', source_field text null, source_edition text null,
              done_at timestamptz null, done_by uuid null, snoozed_until date null, dismissed boolean default false,
              position int, created_by uuid null, created_at)
              unique (list_id, key) where key is not null

plan_visits  (id, item_id, kind: 'campus_tour' | 'info_session' | 'open_house' | 'virtual' | 'interview' | 'fair'
              | 'overnight' | 'other', on_date date, at_time time null, registered boolean default false,
              registration_url text null, who text[] default '{}', rating smallint null check (1..5),
              notes jsonb not null default '{}', created_by, created_at, updated_at)

plan_offers  (the offers table of offers.md: id, item_id, award_year, letter_date, source: 'form' | 'upload',
              coa jsonb, gift jsonb, work_study int null, loans jsonb, quotes jsonb null, confirmed_at, created_by)
plan_letters (id, item_id, kind: 'admission' | 'aid' | 'other', storage_path, uploaded_by, extracted jsonb null,
              confirmed_at null, created_at)   -- private Storage bucket; deleted with the account

plan_nudges  (id, task_id, from_user, to_student, note text null, sent_at, channel: 'email' | 'sms')
plan_calendar_tokens (id, list_id, token_hash, created_by, created_at, revoked_at null)
sms_consents (id, user_id null, student_id null, phone, consented_by uuid, consented_at, revoked_at null,
              provider_opt_out_at null)   -- one active row per person; a guardian consents for a student under 18
```

Rules:
- `dream` is cleared on the old college when set on another (a trigger), so there is always at most one.
- `applied_on` and status move together: setting `applied_on` sets `status = 'applied'`; setting status back clears it.
  `committed_on` requires `enrolling`; `enrolling` on one item clears it on the others in the same list (as today).
- Tasks for an item cascade with it. A task's `item_id` is null for student-wide tasks (FAFSA, test registration).
- A guardian's own list ([household-hub.md](../product/household-hub.md#one-list-per-person)) gets `college` and
  `stage` tasks and visits, no student-wide `cycle` tasks, no offers: the planner is the student's.
- `sms_consents` is written only by the consent flow ([timeline.md](timeline.md#texts)); a provider STOP reply
  sets `provider_opt_out_at` through the webhook, and no text goes to a row with either timestamp set.
- Private notes stay in `list_notes` with the existing `private` flag; `plan_visits.notes` is never private (a visit
  is a family event); a student who wants private visit thoughts writes a private list note.
- Policy tests (`tests/planner-policies.test.mts`, PGlite): owner read/write; view-only guardian reads, can't tick;
  outsider sees nothing; a letter's storage path is readable only through the owning rows; the dream trigger; the
  one-enrolling rule; calendar tokens never readable by anyone but their creator.

## Where it lives
- **The Plan tab**: `/household/[person]/plan`, a third segmented link (List | **Plan** | Numbers) on a student's
  page, built into the hub's one-frame layout ([household-hub.md](../product/household-hub.md#redesign-2026-10-06)).
  Guardians' pages have no Plan tab (their list rows get visit and action controls in "More" instead).
- **Frame** (`components/planner/PlanPage.tsx`): a **stage strip** across the top (six pills with a count each:
  "Rounds · 2 to decide", "Apply · 3 of 8 in"), then the current stage's panel, then **This week** (tasks due in the
  next seven days, overdue first), then the timeline's month view ([timeline.md](timeline.md#display)). Opening a
  pill swaps the panel; the strip and the week stay. Phones: the strip is a sideways row that snaps pill by pill
  (the people strip's pattern, [mobile.md](../mobile.md)); panels are one column.
- **On the list** each row's facts line gains the next task and date ("Apply by Jan 5 · ED II"), replacing the plain
  deadline, and "More" gains the row's stage controls (Dream, priority, round, actions, applied, decision) so a family
  that lives on the List tab never has to open Plan.
- **On the hub** the people strip's caption for a student in season becomes the stage ("Applying · 3 of 8 in") and
  the household page shows the summary line per student ([parents.md](parents.md#the-summary-line)).
- **`/me/plan`** redirects to the viewer's own Plan tab, like `/me/list`.

## Entitlements
The commercial model is decided after the planner is built ([README.md](README.md#owner-decisions-2026-10-07)), so
nothing in these specs is gated and no tier is named. What the model provides is one hook so gating can be added
later without touching the stages: every Server Action in `lib/planner/store.ts` calls `allowed(user, capability)`
from `lib/entitlements.ts` with a capability name (`planner.tab`, `planner.rounds`, `planner.actions.visits`,
`planner.calendar`, `planner.reminders`, `planner.texts`, `planner.parents.nudge`, `planner.offers`), and that
function returns true for everything today, as it does for lists. When [commercialization.md](../product/commercialization.md)
is built it fills in the map; the capability names are the planner's contribution to it.

## Shared code (contracts for the stage units)
| Module | Exports |
|---|---|
| `lib/planner/stage.ts` (pure) | `Stage`, `stageOf()`, `stageCounts()` |
| `lib/planner/tasks.ts` (pure) | `TaskKind`, `PlanTask`, `generateTasks(school, item, student, cycle, today) → PlanTask[]` composed from per-stage generators each stage unit registers (`registerGenerator(kind, fn)`), `mergeTasks(existing, generated)` (keeps `done_at`, `snoozed_until`, `dismissed`; updates due dates and text; removes generated tasks whose source is gone), `nextTask(items, tasks)`, `groupByMonth()`, `groupByCollege()` |
| `lib/planner/cycle.ts` (pure) | `cycleFor(gradYear)`, `loadCycle(year)` over `data/application-cycle.json`, `gradeOf(gradYear, today)` |
| `lib/planner/store.ts` (`"use server"`) | `planFor(listId)` (items, tasks, visits, offers in one read), `tick(taskId)`, `untick`, `snooze`, `addOwnTask`, `setDream`, `setPriority`, `setRound`, `logVisit`, `recordFollow`, `markApplied`, `recordDecision`, `choose(itemId)`; each checks the entitlement key, then RLS does the rest |
| `components/planner/*` | `PlanPage`, `StageStrip`, `ThisWeek`, `TaskRow` (tick, date with ⓘ, assignee chip, snooze, nudge for a guardian), `CollegeChip` (crest + name, reused by every stage) |
| `tests/planner-*.test.mts` | stage machine over fixture lists; generation idempotence (run twice, equal; move a date, tick survives); cycle lookup; grade from grad year at several dates |

## Telemetry
Events (registered per [telemetry.md](../product/telemetry.md#event-registry)): `plan_opened {stage}`,
`plan_task_ticked {kind, source, assignee}`, `plan_stage_done {stage}`, `plan_nudge_sent {channel}`,
`plan_text_consented`, `plan_text_opted_out`. Never a title, a date, a phone number, a college's count, or a note.

## Files (planned)
Migration `supabase/migrations/…_planner.sql`; `lib/planner/{stage,tasks,cycle,store}.ts`;
`app/household/[person]/plan/page.tsx`; `app/me/plan/route.ts` (redirect); `components/planner/`;
`tests/planner-policies.test.mts`, `tests/planner-stage.test.mts`, `tests/planner-tasks.test.mts`; glossary entries
`plan`, `stage`, `dream-school`, `task-assignee`.

## Open questions
1. A student in two households (divorced parents each with an account) has one student record and one default list,
   so one plan; both sides see it under the existing grants. Is a per-guardian private task list needed ("Dad's
   part")? Recommendation: not in v1; the assignee is "guardian", and either can tick.
2. Should a counselor ([counselor-portal.md](../product/counselor-portal.md)) be able to add tasks to a student's
   plan? The model allows it (`source: 'own'`, `created_by` the counselor); the grant is the portal's question.

## Built (2026-10-08, unit U1 on `feature/planner-model`)
The foundation the stage units fill. What exists:
- **Migration** `supabase/migrations/20261008120000_planner.sql`: the columns on `lists` (`sort`,
  `rounds_plan_accepted_at`) and `list_items` (the table above plus `recommendations_count`, `supplements_count`,
  `transcript_shared`); `plan_tasks` (plus `date_note`, `orphaned`), `plan_visits`, `plan_offers` (plus `pros`,
  `cons`), `plan_letters`, `plan_nudges` (plus `reply`, `replied_at`, channel `app`), `plan_calendar_tokens`,
  `sms_consents`. Policies through `can_read_list`/`can_edit_list`, and `can_read_item`/`can_edit_item` for tables
  hanging off an item. One trigger on `list_items` keeps the Dream, applied_on ↔ status, committed_on ↔ enrolling, and
  one-enrolling rules (each backed by a partial unique index or check); `plan_tasks_rules` keeps a task's item on its
  list, refuses `cycle` tasks on a guardian's own list, freezes `list_id`, and sets `done_by`/`created_by` from the
  session. `send_nudge(task, note, channel)` (security definer) enforces one nudge per task per three days and three
  per week per student from one guardian (`nudge_limit`), only from a guardian of a student with an account.
  `plan_for_calendar_token(hash)` (anon-callable) returns the list id for a live token. Nothing references the
  storage schema; the letters bucket is `supabase/storage/planner-letters.sql` (U7, owner-run).
- **Pure modules**: `lib/planner/types.ts` (every row type, PlanContext, PlanSchool, plus `GeneratorInput` and
  `Generator`), `stage.ts` (`STAGES`, `stageCounts`, `stageOf`, `stageCaption`, `redConflicts`, `parseStage`,
  `addDays`), `cycle.ts` (`cycleFor`, `currentCycle`, `cycleStartFromEntering`, `loadCycle`, `gradeOf`, `inSeason`,
  `APPLIES`, `applies`, `validateCycleFile`), `tasks.ts` (`taskKey`, `generateTasks`, `mergeTasks`, `applyMerge`,
  `nextTask`, `nextTaskByItem`, `thisWeek`, `groupByMonth`, `groupByCollege`, labels), `generators/index.ts` and six
  stub generators, `lib/ics.ts`, `lib/entitlements.ts`.
- **Server**: `lib/planner/context.ts` (server-only: `readPlan`, `planSchoolFor`/`planSchools` with citations
  resolved only for fields the college has, `generatorInputFor`, `planContextFrom`, `writeMerge`, `todayIso`),
  `lib/planner/store.ts` (Server Actions: `planFor`, `regenerate`, `tick`, `untick`, `snooze`, `dismiss`,
  `addOwnTask`, `setDream`, `setPriority`, `setRound`, `setGradYear`), `lib/planner/hub.ts` (`stageCaptions`).
- **UI**: the Plan tab (List | Plan | Numbers, students only) at `/household/[person]/plan` with the stage strip,
  the open stage's panel, This week, and the timeline below; every panel is a "Coming in this build" stub
  (`components/planner/stages/*`) until its unit fills it. `RowControls` renders the five `row/*` stubs in each list
  row's More (the hub's List tab), whose facts line now ends with the next plan step and its date. The people strip
  shows a student's stage in season ("Applying · 3 of 8 in"). The class-year prompt asks once when it's missing.
  `/me/plan` redirects to the viewer's own Plan tab (a guardian's own page).
- **Data**: `data/application-cycle.json` with the 2026–27 and 2027–28 cycles' fixed dates (Common App opens, FAFSA
  and CSS Profile open, the reply date), checked by `npm run check:cycle` in `verify`.
- **Glossary** `plan`, `stage`, `dream-school`, `task-assignee`; **telemetry** every planner event.
- **Tests**: `tests/planner-policies.test.mts` (every rule above, with guards that break the Dream rule, the task
  write policy, one-enrolling, token privacy, the nudge limits, and the letters policy), `planner-stage`,
  `planner-tasks` (merge idempotence, a moved date keeps its tick, orphans, ics), `planner-cycle` (lookup, grade at
  the turning points, `applies`, the file check rejecting an unknown `applies`).

Deviations and decisions:
- `mergeTasks(existing, generated)` returns upserts without `list_id` (the writer adds it); `applyMerge` shows the
  stored result for tests. `registerGenerator` became the fixed list in `generators/index.ts`.
- `nextTask(tasks, today, itemId?)` and `nextTaskByItem(items, tasks, today)` instead of `nextTask(items, tasks)`.
- The current stage prefers List, Rounds, Apply, Offers; the Timeline leads only when none of those is open, and
  Actions only when nothing else is. Rounds counts every live college without a round as "to decide" (the
  early-offering filter waits for U3's `conflicts`/`roundsOffered`, which can pass `conflicts` in).
- The one-enrolling rule wasn't in the database before; the migration adds it (a trigger plus a partial unique index,
  after clearing extra enrolling rows, keeping the one highest on the list).
- `plan_text_consented` carries `by_guardian` and `plan_text_opted_out` carries `via` (the registry needs at least one
  property per event); both are server events.
- A nudge's three-day limit is per task from anyone (the student hears about a task once), the weekly limit per
  guardian.
- ListPage's regular-round deadline now resolves against the cycle the entering class applies in ("Fall 2027" →
  November 2026), which it had a year late.
- The list's new columns are on `ListItem` as optional fields (`PlanItem` makes them required), so rows built before
  the planner still type-check. Every list read now selects them: apply the migration before deploying.
- The account export got the planner tables in U8 (`lib/account-export.ts`).
