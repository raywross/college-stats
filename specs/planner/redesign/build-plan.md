# Planner Redesign: Build Plan

> Written 2026-10-10 for the build of the [planner redesign](README.md) (group `planner` on the roadmap: plan-standing,
> plan-page, plan-list, plan-rounds, plan-scores, plan-calendar). Method: the `build-roadmap-section` skill. Every
> unit agent reads this file first. Integration branch `feature/plan-redesign`; unit branches
> `feature/plan-redesign-<unit>`.

## Review notes (decisions this plan makes where the specs are silent)
1. **Header deadline dot vs static public pages.** The header renders on every page, and public pages must stay
   static (`tests/nav-latency.test.mts`). The dot is fetched in the browser after hydration from a tiny
   `GET /api/plan/next` (no-store; `{ dueSoon: boolean }`), never computed in the layout.
2. **Before the migration is applied.** Preview deployments use the dev database, which won't have the new columns
   until the owner runs the SQL. `readPlan` retries without `category_source`/`round_source` on a missing-column error
   and treats every row as `student` source (never overwrites), so the plan renders read-only-safe either way.
3. **Picked test dates** ("I'll take it") are stored in the student profile JSON as `tests.plannedDates: string[]`
   (cycle-entry keys). The cycle generator emits register + test-day tasks only for those keys. No new table.
4. **Per-viewer calendar feed** needs a token that isn't tied to one list. New table `plan_viewer_calendar_tokens`
   (hash only) and a security-definer function that returns the events of every list the token's owner can read.
   Own migration file, own unit (opus), because it crosses lists outside a session.
5. **The design preview** (`/plan/preview`) stays during review so the owner can compare; the cleanup unit deletes it
   only after the owner approves (listed as a follow-up in the PR, not done in this build).
6. **`decide_rounds`** (the "Decide your application rounds" task) has nothing to point at once the proposal is gone:
   the rounds generator stops emitting it (existing rows become orphans and hide), and emits `cost_check` instead.
7. Spec open-question recommendations are adopted as written (practice score marked once in the header card;
   concordance used as is; parents with edit access see the numbers form; no GPA-only colleges in the retake card;
   color-by-child default for Everyone; six-week work window until "Working on it").
8. **Share image** is marked "later" in calendar.md and is not in this build.

## Shared contracts (decided up front; units implement against these names)

### Database (U1: `supabase/migrations/20261010120000_plan_redesign.sql`)
```sql
alter table public.list_items add column category_source text not null default 'auto' check (category_source in ('auto','student'));
alter table public.list_items add column round_source    text not null default 'auto' check (round_source in ('auto','student'));
-- backfill: a chosen category (not 'unsorted') is the student's; a stored round is the student's
update public.list_items set category_source = 'student' where category <> 'unsorted';
update public.list_items set round_source = 'student' where round is not null;
```
No policy changes (row policies already cover every column). U8 adds `20261010130000_plan_viewer_feed.sql`.

### Types (`lib/planner/types.ts`, additive)
- `PlanItemColumns` gains `category_source: "auto" | "student"; round_source: "auto" | "student"`.
- `PlanSchool` gains `gpaAverage: number | null` (unweighted, ≤ 4, from `reported.admission_profile.gpa`, as the
  preview page computes it) and `standing: StandingSchool` (built by `planSchoolFor`).
- `TaskKind` gains `"cost_check" | "test_register" | "test_day"`.

### Student profile (`lib/student-profile.ts`)
`StudentProfileTests` gains `focus: "sat" | "act" | "none" | null`, `practice: boolean`, `plannedDates: string[]`
(sanitized: known keys only, max 6). New pure helper `planTest(profile): { kind: "sat" | "act"; score: number } |
null` (focus decides; with focus null and exactly one score on file, that one; "none" → null) and
`planStudent(profile): StandingStudent` (GPA through `unweightedGpa4`).

### The view model (`lib/planner/plan-view.ts`, pure, U1)
Generalizes `components/plan-preview/derive.ts` over real rows. Every tab reads this; nothing recomputes it.
```ts
export interface PlanRowView {
  item: PlanItem; school: PlanSchool | null; dream: boolean;
  standing: StandingResult | null; group: ListCategory; groupAuto: boolean;
  round: ListRound; roundAuto: boolean; roundWhy: string; pickable: ListRound[];
  deadline: { iso: string; field: string; edition: string | null; lastCycle: boolean } | null;
  decision: { iso: string; field: string } | null;
  moveUp: MoveUp | null; seasonStatus: "not_started" | "working" | "submitted" | "decision" | null;
}
export interface PlanView {
  student: StandingStudent; rows: PlanRowView[];       // ordered: Dream, Reach, Target, Likely, unsorted; then position
  balance: Record<Fit, number>; balanceLine: string | null;
  problems: string[]; edTwo: { itemId: string; name: string; due: string | null } | null;
  retake: RetakeSuggestion | null; next: PlanRowView | null; inSeason: boolean;
  notices: ("problems" | "edTwo" | "balance" | "retake")[];   // at most three, in list.md's order
}
export function planView(input: { items: PlanItem[]; schools: Record<string, PlanSchool>; profile: StudentProfileData | null; today: string }): PlanView;
/** Rows whose stored auto category/round differs from the model: what regenerate writes. */
export function autoWrites(view: PlanView): { id: string; category?: ListCategory; round?: ListRound }[];
```

### Tabs and routing (`lib/planner/plan-tabs.ts`, pure, U1)
```ts
export type PlanTab = "colleges" | "scores" | "calendar" | "offers";
export function parseTab(v: unknown): PlanTab | null;
export function defaultTab(viewer: "student" | "guardian", everyone: boolean): PlanTab;   // student colleges, guardian calendar
export function tabsFor(opts: { everyone: boolean; hasDecision: boolean }): PlanTab[];       // Everyone → ["calendar"]
export function tabForStage(stage: number): PlanTab;   // 1,2,3,5 → colleges; 4 → calendar; 6 → offers
export function planHref(opts: { person?: string | null; tab?: PlanTab | null }): string;   // "/plan?for=…&tab=…"
```

### Tab component props (stubs created by U1, replaced by their owners)
```ts
// components/planner/tabs/types.ts
export interface PlanTabProps { ctx: PlanContext; view: PlanView }
export interface CalendarChild { studentId: string; name: string; colorSlot: 0 | 1 | 2; ring: boolean; gradYear: number | null;
  ctx: PlanContext; view: PlanView }
export interface CalendarTabProps { children: CalendarChild[]; viewer: "student" | "guardian"; everyone: boolean }
```
Stub files (U1 writes each as a minimal placeholder exporting the default component with these props):
`components/planner/PlanList.tsx` (U3), `components/planner/ScoresTab.tsx` (U4),
`components/planner/FamilyCalendar.tsx` (U5), `components/planner/NumbersForm.tsx` and
`components/planner/FirstTimeSetup.tsx` (U3; props `{ ctx: PlanContext; view: PlanView; onClose?: () => void }`),
`components/planner/SignedOutPlan.tsx` (U7; no props). Units replace stubs; nobody else edits them.

### Server actions (`lib/planner/store-plan.ts`, `"use server"`, U1; async exports only)
`setGroup(itemId, group: "reach"|"target"|"likely"|null)` (null = Use the suggestion → `auto`),
`setPlanRound(itemId, round: ListRound | null)` (null = Use the starting round),
`setPlanDream(itemId, dream)` (wraps the built `setDream`, then re-syncs auto rounds),
`setNumbers(studentId, { gpa, gpaScale, focus, score, practice })`,
`setPlannedDate(studentId, entryKey, on: boolean)`.
Each: `ready("planner.tab")`, caller's session, then `syncAuto(listId)` (writes `autoWrites`) and `regenerate`.
`syncAuto` also runs on every plan open for editors (where tasks are regenerated today).

### Colors (U1)
Round, test, money, and child colors move from the preview's `--pv-*` into `app/globals.css` as `--round-ed`,
`--round-ed2`, `--round-ea`, `--round-rea`, `--round-rd`, `--round-rolling`, `--plan-test`, `--plan-money`,
`--kid-1..3` (light and dark, values from calendar.md "Colors"), and `lib/planner/colors.ts` exports `ROUND_VAR`,
`TEST_VAR`, `MONEY_VAR`, `KID_VARS`, `GROUP_CLASS` (Reach violet, Target sky, Likely emerald tints).

### Telemetry (`lib/analytics.ts`, U1 adds every event so units don't collide)
`plan_opened {tab, viewer, everyone}` (replaces `{stage}`), `plan_tab {tab}`, `plan_switch_child`,
`plan_signed_out_started`, `plan_signed_out_saved`, `plan_numbers_set {test, practice}`, `plan_group_changed
{from_auto}`, `plan_dream_set`, `plan_round_changed {from_auto, round}`, `plan_drawer_opened`, `plan_ed2_offer_used`,
`plan_round_problem_shown {kind}`, `plan_scores_opened {suggestion}`, `plan_test_date_picked {test}`,
`plan_calendar_opened {everyone, color_by}`, `plan_calendar_feed_added`, `plan_calendar_printed`.

### Multi-child loading (`lib/planner/load.ts`, `server-only`, U1)
`loadPlanFor(studentId, viewer)` → `{ ctx, view } | { empty | setup-missing }` (moves the body of today's
`PlanPage` read/regenerate/context code here, plus `syncAuto`), and `myPlanChildren()` → the students the signed-in
user can see as a guardian (from `myHouseholds()`), with color slots in the order they were added.

## Units

| Unit | Spec | Model | Wave | Branch |
|---|---|---|---|---|
| U1 Foundation | standing.md, contracts above | opus | 0 | `feature/plan-redesign-foundation` |
| U2 Page frame & nav | page.md | sonnet | 1 | `feature/plan-redesign-page` |
| U3 List & rounds UI | list.md, rounds.md (UI) | sonnet | 1 | `feature/plan-redesign-list` |
| U4 Scores | scores.md | sonnet | 1 | `feature/plan-redesign-scores` |
| U5 Calendar | calendar.md (view, Coming up) | sonnet | 1 | `feature/plan-redesign-calendar` |
| U6 Generators | rounds.md "Money", scores.md "Test dates" | sonnet | 1 | `feature/plan-redesign-generators` |
| U7 Signed-out Plan | page.md "Signed out" | sonnet | 2 | `feature/plan-redesign-signedout` |
| U8 Feed & print | calendar.md "Feed, print, share" | opus | 2 | `feature/plan-redesign-feed` |
| U9 Cleanup | "What's removed" in every part | haiku | 3 | `feature/plan-redesign-cleanup` |
| QA | browser QA script, desktop + 390px | sonnet | after merge | (no branch; scratchpad) |

### U1 Foundation (opus, wave 0)
Owns: the migration, `lib/planner/{types,context,plan-view,plan-tabs,colors,load,store-plan}.ts`,
`lib/student-profile.ts` (the three fields + helpers), `lib/analytics.ts`, `app/globals.css` (tokens), the three
tab stubs and `components/planner/tabs/types.ts`.
Steps:
1. Migration file as above; a test in `tests/planner-redesign-migration.test.mts` that reads the SQL and checks both
   columns, their checks, and the backfill statements.
2. Types: `PlanItemColumns`, `PlanSchool.gpaAverage`/`standing`, new `TaskKind`s.
3. `context.ts`: add the two columns to `PLAN_ITEM_COLUMNS`; missing-column fallback in `readPlan` (review note 2);
   fill `gpaAverage` and `standing` in `planSchoolFor`. Test the fallback with a fake client.
4. Student profile: fields, sanitize, `emptyProfile`, `planTest`, `planStudent`; tests (both scores + focus, one
   score + null focus, "none", practice flag round-trip, bad plannedDates dropped).
5. `plan-view.ts` + `autoWrites`; tests: ordering, auto vs student group/round, notices capped at three in order,
   balance lines, `next`, status mapping, a student row is never in `autoWrites`, a locked (applied/decided) row's
   round never rewritten. Port the seven standing.md table examples through `planView` end to end.
6. `plan-tabs.ts` with tests (stage redirects, Everyone → calendar only, Offers only after a decision).
7. `colors.ts` + CSS tokens (copy values from the preview's palette block; keep the preview working).
8. `analytics.ts` events; update `PlanOpened` to the new shape (keep it compiling).
9. `load.ts` (`loadPlanFor`, `myPlanChildren`) extracted from `components/planner/PlanPage.tsx`; `PlanPage` keeps
   working by calling it.
10. `store-plan.ts` actions + `syncAuto`; unit-test the pure parts (argument validation, write sets).
11. Tab stubs. `npm run verify` and `npx next build` green.

### U2 Page frame & navigation (sonnet, wave 1)
Owns: `app/plan/page.tsx`, `app/plan/loading.tsx`, `components/planner/{PlanFrame,PlanHeaderCard,NextUp,PlanTabs,
ChildSwitcher}.tsx`, `app/api/plan/next/route.ts`, `components/layout/{Header,BottomNav}.tsx`, redirects in
`app/household/[person]/plan/page.tsx` and `app/me/plan/route.ts`, `tests/planner-page.test.mts`.
Steps:
1. `/plan` server page: `connection()`, auth; signed out renders `<SignedOutPlan />` (import from
   `components/planner/SignedOutPlan.tsx`; the U1 stub, owned by U7). Signed in: student →
   `loadPlanFor(self)`; guardian → `myPlanChildren()`, `?for=` picks one, else Everyone (or the only child).
2. `PlanHeaderCard`: initial in household color, "Your plan"/"Maya's plan", class year, season words, numbers line
   (practice marked) that opens `NumbersForm` in place (import from `components/planner/NumbersForm.tsx`, owned by
   U3; U1 ships a stub). No completeness meter.
3. `NextUp`: `view.next` with round diamond and days; pre-season "Applications open Aug 1, YYYY"; after deadlines the
   next decision date.
4. `PlanTabs`: links via `planHref`, Scores dot when `view.retake`, Offers tab from `tabsFor`; renders `PlanList`,
   `ScoresTab`, `FamilyCalendar`, or the built `OffersStage`.
5. First time (no numbers or no Dream decided): render `FirstTimeSetup` (U3) in place of the tabs.
6. `ChildSwitcher`: pills with color, name, class year, shortened summary line; Everyone pill (skipped for one
   child); remembers last choice in `localStorage` (try/catch); `plan_switch_child`.
7. Nav: Header adds Plan second; BottomNav Explore, Search, Plan (`ListChecks`), Compare, More (Home removed; logo is
   home). Dot: client fetch of `/api/plan/next` after mount, signed-in only.
8. Redirects: `/household/[p]/plan` → `/plan?for=p` (keep `?stage=` mapped by `tabForStage`); `/me/plan` → `/plan`;
   `/household/[p]/plan/print` → `/plan/print?for=p`.
9. Telemetry `plan_opened`, `plan_tab`. Tests: route choice per viewer, Everyone tab fallback, stage redirects,
   nav order, public pages still static.

### U3 List & rounds UI (sonnet, wave 1)
Owns: `components/planner/{PlanList,PlanRow,GroupChip,RoundChip,RowDrawer,ListNotices,NumbersForm,FirstTimeSetup}.tsx`,
`tests/planner-list-view.test.mts`.
Steps:
1. `PlanRow`: heart, crest + name link, `GroupChip` (✦ while auto; tap cycles → `setGroup`, optimistic), `RoundChip`
   (menu of `pickable` with "EA · Nov 1"; ✦ while auto → `setPlanRound`), deadline with ⓘ citation (struck when
   past; "no date on record"), status chip in season, (i). Phone: two lines, 44px hit areas.
2. `RowDrawer` inline: group reasons or "You picked this group" + Use the suggestion; round why or "You picked this
   round" + Use the starting round + expected decision; score line from `moveUp`/send advice; Show interest (reuse
   `components/planner/row/actions.tsx` controls; collapsed unless the college considers interest); Requirements in
   season (reuse `row/apply.tsx`); Notes. "How early rounds work at X" link to the profile.
3. `PlanList`: header counts line + ✦ legend; Sort control (keep distance/cost/deadline sorts, drop ranking);
   `ListNotices` renders `view.notices` (amber problems box, ED II line with Use ED II there, balance line, retake card
   linking `?tab=scores`); "Mark a Dream" hint when none; add-a-college search at the bottom.
4. `NumbersForm`: GPA (+ scale behind "Different scale?"), SAT · ACT · Not testing, slider + number box, practice
   checkbox, hint text; live re-sort through a client callback that recomputes `planView` with draft numbers; save via
   `setNumbers`; `plan_numbers_set`. Parents with edit access can use it.
5. `FirstTimeSetup`: two steps (numbers, Dream hearts), Show my plan.
6. Telemetry per list.md. Tests: notice cap and order rendered, chip labels, deadline strike-through logic.

### U4 Scores (sonnet, wave 1)
Owns: `lib/planner/scores.ts`, `components/planner/{ScoresTab,ScoreRow}.tsx`, glossary entries `concordance`,
`test-optional` in `lib/glossary.ts` (additive), `tests/planner-scores.test.mts`.
Steps:
1. `scores.ts` (pure): `SCORE_LAG = 14`; `datesFor(test, cycle, grade, today, rows)` (senior: ≤3 dates whose scores
   reach a deadline; junior: next 4); `inTimeText(date, rows)` with the three sentences from scores.md; tests.
2. `ScoresTab`: big score + test + practice; encouraging line; suggestion card (`bg-pop`) or the plain card with
   "Show upcoming SAT dates"; date rows with register-by, official link, **I'll take it** (`setPlannedDate`).
3. `ScoreRow`: middle-50 bar on one axis, the dot, group chip, send advice, ⓘ, "1420 → Target", "via concordance".
4. Third person for parents; never a probability or admit rate; telemetry.

### U5 Calendar (sonnet, wave 1)
Owns: `lib/planner/calendar.ts`, `components/planner/{FamilyCalendar,CalendarLane,ComingUp}.tsx`,
`tests/planner-calendar.test.mts`. Reference: `components/plan-preview/CalendarView.tsx`.
Steps:
1. `calendar.ts` (pure): school-year range (Aug 1–Jul 31) and stepping; lanes per child (tests only while testing or
   retake live, essays & recs windows packed so labels don't collide, money markers incl. `cost_check` tasks, one
   lane per college with a six-week work bar (from "Working on it" date when set), ◆ deadline, ○ decision; the quiet
   applications line; no-date line); `comingUp(children, today, 12)`. Tests for each lane rule and packing.
2. `FamilyCalendar`: Everyone stacks children with header rows; Color by child / by round toggle (child default);
   today line; arrows; marks are buttons with tooltip + aria-label; ⓘ source in tooltip.
3. `ComingUp` list (first on phones); timeline in a horizontally scrolling card opened at today; no page scroll.
4. "Add to my calendar" and "Print" buttons point at U8's routes (`/plan/print`, the existing feed until U8 lands).

### U6 Generators (sonnet, wave 1)
Owns: `lib/planner/generators/{rounds,cycle}.ts`, `tests/planner-generators-redesign.test.mts`.
Steps:
1. Rounds generator: drop `decide_rounds`; emit `cost_check` per row in `ed`/`ed2`, key `{list}:cost_check:{item}:{round}`,
   due 21 days before that round's deadline, `assignee: "guardian"`, detail links `links.price_calculator`; carries the
   deadline's lineage.
2. Cycle generator: entries with `applies: "plans_tests"` emit only for keys in `profile.tests.plannedDates`, as
   `test_register` (due register_by) and `test_day` (due date); other tests generate nothing.
3. Tests: moving a round moves/removes the task (via `mergeTasks` orphaning); untapped dates produce nothing.

### U7 Signed-out Plan (sonnet, wave 2)
Owns: `components/planner/SignedOutPlan.tsx`, `lib/planner/local-plan.ts`, tests. Pitch sentence + a looping
recording placeholder (a CSS animation of rows re-sorting is acceptable; no video asset required), `NumbersForm` in
local mode, add colleges from search (kept in `localStorage`, read with try/catch), rows from `planView` with
`/api/schools` data, "Save your plan" to sign up; import on sign-up alongside `ImportLocalProfile`. Telemetry
`plan_signed_out_started/saved`.

### U8 Feed & print (opus, wave 2)
Owns: `supabase/migrations/20261010130000_plan_viewer_feed.sql`, `app/api/plan/feed/[token]/route.ts`,
`lib/planner/store-timeline.ts` (additive: viewer token create/revoke), `app/plan/print/page.tsx`, tests incl. a
policy test that a token never yields a list its owner can't read. Child name first in titles; titles only. Print:
Coming-up grouped by month, per child or all, grayscale-legible.

### U9 Cleanup (haiku, wave 3, after U1–U8 merged)
Delete what nothing imports any more: `StageStrip`, `StagePanel`, `stages/*` except `OffersStage`,
`PriorityList`, `RoundsTable`, `MonthView`, `CollegeView`, `TimelineViews`, `WindowBar`, `ThisWeek`; remove
`proposeRounds`/`bindingChecklist`/`acceptRoundsPlan`/`setPriorityOrder` exports and their tests;
`suggestCategory` from `suggest.ts`. Use `grep` to prove each is unreferenced first. `npm run verify` + `npx next build`.

## Rules for every unit agent
- Read this file, your spec, `CLAUDE.md`, `AGENTS.md`. Run `npm ci` first. Rename your branch, then
  `git merge feature/plan-redesign`. Copy `.env.local` from the integration worktree.
- Own only your files; registries (`lib/glossary.ts`, `lib/analytics.ts`) only additively. Never touch
  `lib/roadmap.ts`, release notes, or other units' files. If you need a contract changed, say so in your report.
- Every term gets `<Term>`/`<InfoTip>`; every date and range cites its edition; no admit rates or probabilities on
  the plan's first screen; phone width 390 px with no horizontal page scroll; `"use server"` files export only async
  functions.
- Tests for your unit; prove a new guard fails when broken. `npm run verify` and `npx next build` must pass before
  your final commit. Commit on your branch; don't push or open PRs.
- One git command per shell call. Stop every background process you start.
- Report: branch, commits, files, decisions not covered here, anything left undone.

## Integration
Merge waves in order (U1; then U6, U3, U4, U5, U2; then U8, U7; then U9) with `--no-ff`, `npm run verify` after
each, `npx next build` after each wave. Then browser QA (sample accounts on dev once the migration is applied, else
the read-only fallback), mark specs built, remove the roadmap entries and the emptied group, one release note, push,
and open the PR for the owner's review on the Vercel preview. Not merged into `main` until the owner approves.
