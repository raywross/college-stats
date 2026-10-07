# Planner Model: Stages, Tasks, Visits, Offers, and the Plan Tab

> Status: **planned** 2026-10-07. The foundation unit of the [planner](README.md): the shared tables, the stage
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
plan_trials  (student_id, grad_year, started_at)   -- the free Plan-tab trial, once per student per cycle
```

Rules:
- `dream` is cleared on the old college when set on another (a trigger), so there is always at most one.
- `applied_on` and status move together: setting `applied_on` sets `status = 'applied'`; setting status back clears it.
  `committed_on` requires `enrolling`; `enrolling` on one item clears it on the others in the same list (as today).
- Tasks for an item cascade with it. A task's `item_id` is null for student-wide tasks (FAFSA, test registration).
- A guardian's own list ([household-hub.md](../product/household-hub.md#one-list-per-person)) gets `college` and
  `stage` tasks and visits, no student-wide `cycle` tasks, no offers, no trial: the planner is the student's.
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
`lib/entitlements.ts` ([commercialization.md](../product/commercialization.md#feature-map)) gains one feature key per
stage capability from the [tiers table](README.md#tiers-proposal-see-the-open-questions): `planner.tab`,
`planner.rounds`, `planner.actions.visits`, `planner.calendar`, `planner.reminders`, `planner.parents.nudge`,
`planner.offers.upload`. Until commercialization is built, every key returns allowed (today's rule for lists), and
the trial table is written but not enforced. The Plan tab's read-only state after the trial shows the same page with
ticks disabled and one "Plus" chip at the top, nothing blurred: the plan is the family's data and stays readable.

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
`plan_task_ticked {kind, source, assignee}`, `plan_stage_done {stage}`, `plan_nudge_sent`, `plan_trial_started`,
`plan_trial_ended`. Never a title, a date, a college's count, or a note.

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
