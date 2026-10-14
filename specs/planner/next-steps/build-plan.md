# Next Steps: Build Plan

> Written 2026-10-14 for the build of [next steps](README.md) (roadmap group `next-steps`: next-steps-seasons,
> ed-opportunities, interest-and-visits, list-shape, applying-moves, next-steps-notifications, your-story). Method:
> the `build-roadmap-section` skill. Every unit agent reads this file first, then its own spec. Integration branch
> `feature/next-steps` (worktree `.claude/worktrees/next-steps`); unit branches `feature/next-steps-<unit>`.

## Review notes (decisions this plan makes where the specs are silent or the code disagrees)
1. **A move is any `plan_tasks` row.** The playbook's own entries are generated rows (`source: 'season'`, kind
   `playbook`); the moves other parts describe over built tasks (submit, record a decision, cost check, the essay
   window, Common App opens) are the built rows themselves, given a card. Nothing is generated twice: a playbook row
   whose source is "the cycle file" is **not** emitted by the season generator; the cycle task is the move.
2. **A task's season** is `task.season` when set (the season generator sets it), else the season its date falls in
   (`seasonOfDate(taskDate, gradYear)` in `lib/planner/moves.ts`), else the current season (undated built tasks).
   Only the season generator writes the column; the other generators are untouched.
3. **The generators get the estimates.** The ED, interest, and shape rules need each college's level, closeness, and
   ED verdict. `GeneratorInput` gains `estimates: Record<string, EstimateResult>` (plus `gradYear`, `season`), and every
   caller of `generateTasks` passes them (`lib/planner/load.ts`, `lib/planner/store.ts regenerate`,
   `lib/planner/store-plan.ts`). `regenerate()` computes them with `planEstimates` (it didn't before).
3. **One migration** for the whole section (U1): `supabase/migrations/20261014120000_next_steps.sql`. Columns
   `plan_tasks.season`, `plan_tasks.action`; the kind check widened to every new kind of every part; `source` check
   gains `'season'`; `list_items.ed_dismissed_at`, `list_items.ed_checks`; `notification_prefs.season_brief`; table
   `plan_opens`; and `plan_bundle()` redefined to select the new columns (a plpgsql function listing columns drops new
   ones: chances-build lesson). The lead applies it to dev right after U1 merges; the reads fall back without the new
   columns meanwhile (review note 5).
4. **No new cycle-file entries.** Playbook moves the spec sources to a cycle key that doesn't exist (`psat`,
   `fsa_id`, `test_register`) are playbook rows with their own window computed from the season (PSAT: Oct 1–31 of the
   season's year; FSA IDs: the junior-winter window), `source: 'season'`, detail "Advisors place this …".
5. **Before the migration is applied** (a preview on a database without it): `readPlan`/`readTasks` retry without
   `season, action` and read them as null; `writeMerge` retries an upsert without those two fields on a
   missing-column error; `readItems` retries without `ed_dismissed_at, ed_checks` (null / `{}`). Same pattern as the
   sibling column.
6. **The kind check and TaskKind stay in step** (tests/planner-task-kinds.test.mts): U1 adds every kind below to
   `TaskKind` and to the migration at once, so no later unit needs SQL.
7. **"Not now" is `dismiss`** (built: `dismissed = true`, kept through regeneration) and **Done is `tick`**. A skipped
   move never resurfaces; the brief and the week read `isOpen`. "Not for me" on an ED pill is `ed_dismissed_at`.
8. **Cards by kind.** `components/planner/moves/registry.tsx` maps a task kind to its card; `MoveCard` is the default
   (title, why, date, assignee chip, one button from `action`, Not now). Rule units add their own card file and one
   registry line.
9. **Open-question recommendations adopted** as owner assumptions: Coming up shows dates for next season's dated moves;
   both guardians get the parent moves, one tick closes it for both; no ED pill for a Dream at Likely; last-cycle ED
   counts show the pill with the note; an ED-candidate visit move persists for its season after a dismissed pill; the
   junior long list gets a soft "20 is plenty" line and no move; a High-reach Dream counts toward the maximum ("including
   your Dream"); the row's status word returns from senior fall, muted and read-only; "Tell us where you landed" also
   asks a student with no recorded decision (free college pick); the brief goes on the first Sunday of the season; the
   story prompts are offered to seniors inside the essay move.
10. **Owner decisions (2026-10-14) in force:** "Good ED opportunity" wording with a "Start it in ED" button; the Next
    steps tab is the default on login; senior list 12–15 (0–2 / 2–3 / 5–8 / 2–3 / 2–3); only the three story prompts.

## Shared contracts (decided up front; units implement against these names)

### Seasons (`lib/planner/seasons.ts`, pure, U1)
```ts
export type Season = "freshman" | "sophomore" | "junior_fall" | "junior_winter" | "junior_spring" | "summer_before_senior"
  | "senior_fall" | "senior_winter" | "senior_spring" | "summer_after" | "graduated" | "unknown";
export const SEASONS: readonly Season[];                       // in order, unknown last
export const SEASON_LABELS: Record<Season, string>;            // "Junior spring", "Summer before senior year", …
export function seasonOf(gradYear: number | null, today: string): Season;   // boundaries per seasons.md (Aug 1 turns)
export function seasonOfDate(iso: string, gradYear: number): Season;        // the season a date falls in
export function seasonBounds(season: Season, gradYear: number): { start: string; end: string } | null;  // ISO, inclusive
export function nextSeason(season: Season): Season | null;
export function seasonRank(season: Season): number;
export function gradeOf(gradYear, today): Grade;   // the shim: Grade from Season; cycle.ts re-exports it (one boundary)
```
`cycle.ts`'s `gradeOf` becomes `export { gradeOf } from "./seasons.ts"`-equivalent (its month table moves; `earlier`
← freshman/sophomore, `junior_fall` ← junior_fall + junior_winter, the rest 1:1). Every existing caller keeps compiling.

### Moves (`lib/planner/types.ts`, additive, U1)
```ts
export type TaskSource = "college" | "cycle" | "stage" | "own" | "season";
export type TaskKind = /* existing */ | "playbook"                                   // U1: the playbook's own entries
  | "ed_decide" | "ed2_decide"                                                       // U2
  | "visit_ed" | "show_interest"                                                     // U3
  | "shape_gap" | "shape_cost"                                                       // U4
  | "confirm_complete" | "compare_offers" | "decide_by" | "outcome_share"            // U5
  | "story";                                                                         // U7
export type MoveAction =
  | { kind: "href"; href: string }                                   // open a page (official site, calculator, Numbers)
  | { kind: "open_intake"; step: number }                            // the intake guide on a step
  | { kind: "open_tab"; tab: PlanTab }                               // Offers, Colleges
  | { kind: "open_row"; itemId: string; panel?: "ed" | "capture" }  // the row's details (ED sheet / capture panel on top)
  | { kind: "mark_applied"; itemId: string } | { kind: "record_decision"; itemId: string }
  | { kind: "set_round"; itemId: string; round: "ed" | "ed2" } | { kind: "choose"; itemId: string }
  | { kind: "show_rail"; level: StandingLevel; gap: ShapeGapKind } | { kind: "story" } | { kind: "tick" };
export interface PlanTask { /* existing */ season: Season | null; action: MoveAction | null }
// GeneratedTask gains season and action (both nullable); GENERATED_FIELDS gains "season", "action".
export type GeneratorInput = Pick<PlanContext, …existing…> & { gradYear: number | null; season: Season; estimates: Record<string, EstimateResult> };
```
`PlanContext` gains `season: Season` and `estimates` the same way (planContextFrom passes them through).

### The playbook (`lib/planner/moves-catalog.ts`, pure, U1)
```ts
export interface PlaybookEntry {
  key: string;                       // "psat_practice", "long_list", "money_talk", … (the task key suffix)
  season: Season; title: string; why: string; who: Assignee; carries: boolean;
  applies: MoveApplies;              // see below; "always" when none
  action: (ctx: PlaybookActionInput) => MoveAction | null;
  window?: (bounds) => { start: string; end: string } | { due: string } | null;   // dated entries only
  source: "advisors" | "profile" | "list" | "depth" | "story" | "shape" | "ed" | "interest";
}
export const PLAYBOOK: readonly PlaybookEntry[];                 // every row of seasons.md's tables that isn't a built task
export const SEASON_EXPLAINER: Record<Season, { lead: string; paragraph: string; next?: string }>;
export const MOVE_TEXT: Record<string, { title: string; why: string }>;   // text for the rule units' kinds (ed_decide, shape_gap, …) lives here too, keyed by kind[:variant]
```
A test (`tests/planner-moves-catalog.test.mts`) fails on a percentage, "×", "odds", "chance", or a bare number in any
title or why (dates like "Nov 1" and counts like "12–15 colleges" are allowed by an explicit allowlist).

### Applies vocabulary (`lib/planner/generators/season.ts`, U1)
```ts
export type MoveApplies = "always" | "has_dream" | "no_dream" | "list_empty" | "list_nonempty" | `profile_missing:${ProfileSection}`
  | "story_missing" | "no_visit_logged" | "tests_focus_null" | "ed_candidate" | "interest_candidate" | "shape_gap" | "cost_limit_unset";
export function moveApplies(a: MoveApplies, facts: MoveFacts): boolean;
export interface MoveFacts { items; schools; profile; visits; estimates; edCandidates: EdCandidate[]; shapeGaps: ShapeGap[]; interest: InterestMove[] }
```
The season generator builds `MoveFacts` once by calling the three rule modules below (U1 ships them as stubs
returning `[]`; their units replace them) and emits: this season's and next season's playbook entries that apply, plus
earlier seasons' entries with `carries: true` that still apply; then the rule modules' own moves (each returns
`GeneratedTask[]`, key `{list}:{kind}:{item or suffix}`). Keys: `{list}:playbook:{entry.key}`.
Nothing dated before `today − 30 days` is emitted (the built staleness rule).

### Rule modules (contracts; U1 writes stubs, owners replace)
```ts
// lib/planner/ed-opportunities.ts (U2)
export interface EdCandidate { itemId: string; unitId: string; round: "ed" | "ed2" | "ed_alt"; rank: number; level: StandingLevel; dream: boolean; dismissed: boolean }
export function edOpportunities(rows: EdRow[], estimates, schools, opts: { season: Season; today: string }): EdCandidate[];   // ranked, ≤ 3, [] before junior_spring
export function edMoves(input: GeneratorInput, candidates: EdCandidate[]): GeneratedTask[];   // ed_decide / ed2_decide (+ cost_check per candidate is the rounds generator's: U2 extends it)
export function edSheetFacts(row, school, estimate): EdSheetFacts;
// lib/planner/interest.ts (U3)
export interface InterestMove { itemId: string; rule: "visit_ed" | "important" | "considered"; kind: "visit_ed" | "show_interest" }
export function interestMoves(rows, estimates, schools, hooks, edCandidates, opts: { season; today }): InterestMove[];   // ≤ 3 open
export function interestTasks(input: GeneratorInput, moves: InterestMove[]): GeneratedTask[];
// lib/planner/list-shape.ts (U4)
export type ShapeGapKind = "likely_min" | "affordable" | "target_min" | "reach_min" | "over_max" | "total_off";
export interface ShapeGap { kind: ShapeGapKind; level: StandingLevel | null; who: Assignee; line: string }
export const LIST_SHAPE; export function shapeFor(season: Season): Shape | null;
export function shapeGaps(counts: Record<StandingLevel, number>, unsorted: number, season: Season, affordability: "ok" | "none" | "unknown"): ShapeGap[];
export function countLine(counts): string;   // "Your list has 3 Reaches, 2 Targets, and no Likely yet."
export function shapeTasks(input: GeneratorInput, gaps: ShapeGap[]): GeneratedTask[];   // the first gap only
```

### The Next steps view (`lib/planner/moves.ts`, pure, U1)
```ts
export interface MoveGroups { now: PlanTask[]; more: PlanTask[]; comingUp: { title: string; date: string | null }[]; done: PlanTask[]; season: Season }
export function nowMoves(tasks: PlanTask[], opts: { season: Season; gradYear: number | null; today: string; viewer: "student" | "guardian"; max?: number }): MoveGroups;
export function yourPartMoves(tasks, today): PlanTask[];     // assignee guardian | either, open
export function taskSeason(t: PlanTask, gradYear: number | null, current: Season): Season;
export function topMove(groups: MoveGroups): PlanTask | null;  // the people line's "Next:"
```
Now order: overdue dated, dated within 14 days, `ed_decide`/`ed2_decide` in window, then playbook order (the catalog's
position), capped at 6. Done = this season's done moves.

### Tabs (`lib/planner/plan-tabs.ts`, U1)
`PlanTab` gains `"next"` (label **Next steps**, icon `Footprints`, first in the strip); `defaultTab()` returns `"next"`
for students and guardians; `tabsFor` lists it first; `PLAN_TABS` includes it. `planHref({ tab: "next", move?: taskId })`
adds `&move=<id>` so the people line's Next: opens the tab scrolled to the card.

### Cards (`components/planner/moves/`, U1 stubs; owners replace)
```ts
// types.ts
export interface MoveCardProps { task: PlanTask; ctx: PlanContext; view: PlanView; onDone: (t) => void; onSkip: (t) => void; pending: boolean }
// registry.tsx:  export const MOVE_CARDS: Partial<Record<TaskKind, ComponentType<MoveCardProps>>>  — rule units add their kind
// MoveCard.tsx: the default card (U1b)
```
`components/planner/NextSteps.tsx` (U1 stub → U1b): renders `nowMoves`, folds, header, explainer, a guardian's Your
part; `?move=` scrolls to the card. `PlanTabs.tsx` renders it for `tab === "next"` (U1).

### Profile (`lib/student-profile.ts`, U1 adds the type; U7 the rest)
```ts
export interface StudentStory { about: string; thread: string; majorWhy: string; updatedAt: string | null }
// StudentProfileData gains `story: StudentStory | null`; emptyProfile → null; sanitizeStory (500 chars each, plain text).
```
`profilesICanSee()` strips the text for a guardian (`about`/`thread`/`majorWhy` → `""`, `updatedAt` kept) (U7).

### Telemetry (`lib/analytics.ts`, U1 adds every event)
`plan_move_shown {kind, season}`, `plan_move_done {kind, season, by}`, `plan_move_skipped {kind, season}`,
`plan_season_explainer_opened {season}`, `plan_ed_pill_shown {round, level, rank}`, `plan_ed_sheet_opened {round}`,
`plan_ed_started {round}`, `plan_ed_dismissed {round}`, `plan_interest_move_shown {rule, level}`, `plan_interest_act {act}`,
`plan_shape_gap_shown {gap, season}`, `plan_rail_opened {level}`, `plan_rail_added {level}`, `plan_applied {round}`,
`plan_decision_recorded {outcome}`, `plan_outcome_shared {yes}`, `story_filled {count}`; server: `brief_sent {season, role}`.
`plan_opened.tab` and `plan_tab.tab` gain `"next"`.

### Database (U1: `supabase/migrations/20261014120000_next_steps.sql`)
```sql
alter table public.plan_tasks add column season text check (season in ('freshman','sophomore','junior_fall','junior_winter','junior_spring','summer_before_senior','senior_fall','senior_winter','senior_spring','summer_after','graduated','unknown'));
alter table public.plan_tasks add column action jsonb check (action is null or jsonb_typeof(action) = 'object');
-- drop + re-add plan_tasks_kind_check with every TaskKind; drop + re-add the source check with 'season'
alter table public.list_items add column ed_dismissed_at timestamptz;
alter table public.list_items add column ed_checks jsonb not null default '{}' check (jsonb_typeof(ed_checks) = 'object');
alter table public.notification_prefs add column season_brief boolean;      -- null: the default (on where email is on)
create table public.plan_opens (user_id uuid references auth.users on delete cascade, student_id uuid references public.students on delete cascade, last_at timestamptz not null default now(), primary key (user_id, student_id));
-- RLS: a user reads/writes only their own rows; service_role all.
create or replace function public.plan_bundle(...)  -- same body, items select + ed_dismissed_at, ed_checks; tasks select + season, action
```
`PLAN_ITEM_COLUMNS` and `PLAN_TASK_COLUMNS` gain the columns; `tests/bundles.test.mts` gains the same guard for the
tasks select that it has for items; `tests/planner-next-steps-migration.test.mts` reads the SQL.

### What's removed (U2) and replaced (U4)
U2 deletes `edHelpsMostSuggestion`, `edTwoSuggestion` and the `edHelps`/`edTwo` notices (`PlanNotice` type,
`NOTICE_ORDER`, `ListNotices.tsx`, `PlanNotice.tsx`, their tests); the Dream's ED guard in `auto-rounds.ts` stays.
U4 replaces `BALANCE_LINES`, `LIST_SIZE`, `MIN_LIKELY`, and `balanceLineFor` with `shapeGaps` (the notice shows the
first gap's `line`); `balanceLineFor(groups, season, affordability)` keeps its name. Both edit `lib/planner/plan-view.ts`
in different regions; U4 merges after U2 and resolves.

## Units

| Unit | Spec | Model | Wave | Branch |
|---|---|---|---|---|
| U1 Foundation | seasons.md (season, moves, generator, catalog), contracts above | opus | 0 | `feature/next-steps-foundation` |
| U1b Next steps tab UI | seasons.md "The Next steps tab", the people line | sonnet | 1 | `feature/next-steps-tab` |
| U2 ED opportunities | ed-opportunities.md | opus | 1 | `feature/next-steps-ed` |
| U4 List shape | list-shape.md | sonnet | 1 | `feature/next-steps-shape` |
| U5 Applying | applying.md | sonnet | 1 | `feature/next-steps-applying` |
| U7 Your story | your-story.md | sonnet | 1 | `feature/next-steps-story` |
| U3 Interest and visits | interest-and-visits.md | sonnet | 2 | `feature/next-steps-interest` |
| U6 Notifications | notifications.md | opus | 2 | `feature/next-steps-notifications` |
| U8 Docs and cleanup | status lines, rounds.md rule, README decisions | haiku | 3 | `feature/next-steps-docs` |
| QA | browser QA, desktop + 390 px, student and parent | sonnet | after merge | (scratchpad) |

At most five agents run at once: wave 1 is five; wave 2 two; wave 3 two.

### U1 Foundation (opus, wave 0)
Owns: the migration; `lib/planner/{seasons,moves-catalog,moves,types,tasks,read-plan,context,load,store,store-plan,plan-tabs}.ts`
(additive where shared), `lib/planner/generators/{index,season}.ts`, stubs `lib/planner/{ed-opportunities,interest,list-shape}.ts`,
`lib/student-profile.ts` (the `story` type, `emptyProfile`, `sanitizeStory`), `lib/analytics.ts`, `lib/planner/cycle.ts`
(`gradeOf` shim), `components/planner/PlanTabs.tsx` (the tab + icon + stub render), stubs `components/planner/NextSteps.tsx`,
`components/planner/moves/{types.ts,registry.tsx,MoveCard.tsx}`, tests `tests/planner-seasons.test.mts`,
`tests/planner-moves.test.mts`, `tests/planner-moves-catalog.test.mts`, `tests/planner-next-steps-migration.test.mts`,
bundles test addition.
Steps:
1. `seasons.ts` with every boundary month tested (both sides of Aug 1, Jan 1, Mar 1, Jun 1 for a class year), `gradeOf`
   shim and its callers' tests still green (`tests/planner-cycle.test.mts` may need its September boundary updated to Aug 1:
   that is the spec's change, say so in the report).
2. Types and `GENERATED_FIELDS`; `PLAN_TASK_COLUMNS`/`PLAN_ITEM_COLUMNS`; read fallbacks (review note 5) with fake-client tests.
3. The migration + its test; `plan_bundle` redefinition; the tasks column guard in `tests/bundles.test.mts`.
4. `GeneratorInput.estimates/gradYear/season`: `generatorInputFor` fills `gradYear`/`season`; `loadPlanFor` passes
   `estimates` into the input before `syncOnOpen`; `regenerate()` computes `planEstimates`; `store-plan.ts` passes its.
5. `moves-catalog.ts`: every playbook row of seasons.md (freshman through senior spring) that isn't a built task, with
   the explainer per season; the number guard test.
6. `generators/season.ts` + `moveApplies` + the rule-module stubs; registered last in `generators/index.ts` (built
   generators' keys win). Tests: a late joiner in each season sees only that season's (and carried) entries; nothing
   dated before the join is overdue; carries; idempotent on regeneration; next season's entries emitted.
7. `moves.ts` (`nowMoves`, `taskSeason`, `topMove`, `yourPartMoves`) with the ordering tests.
8. `plan-tabs.ts` + `PlanTabs.tsx` (stub `NextSteps` renders the Now titles as a plain list so the tab works end to end);
   update `tests/planner-plan-tabs.test.mts`, `tests/planner-page.test.mts`.
9. `analytics.ts` events; the story type. `npm run verify` and `npx next build` green.

### U1b Next steps tab UI (sonnet, wave 1)
Owns: `components/planner/{NextSteps,SeasonExplainer,NextYearCard}.tsx`, `components/planner/moves/MoveCard.tsx`,
`components/planner/PlanPeople.tsx` + `app/plan/page.tsx` (`detailFor`: Next: is `topMove`, linking `planHref({tab:"next", move})`;
the profile ring stays), `tests/planner-next-steps-ui.test.mts`.
The layout in seasons.md "The Next steps tab": header (season words + class year, **How this season works** sheet),
Now (≤ 6 cards), More this season, Coming up (titles; dates for dated ones), Done (count → list). A card: title, why
(college fact cited with ⓘ through `MetricLabel cited=` where the task has `source_field`), date or "this season",
assignee chip when not the viewer, one button from `action` (hrefs open in place; `open_intake` → `planHref({setup, step})`;
`open_row` → the Colleges tab with `?row=<itemId>&panel=`; `tick` → Done), **Not now** (`dismiss`), Done folds with undo for
a minute (`untick`). A guardian sees **Your part** first (`yourPartMoves`) and ticks only with edit access. "Nothing to do
this season. Enjoy it." with Coming up open. Restore `NextYearCard.tsx` from git history (`git show c2866a9d^:components/planner/NextYearCard.tsx`)
as the card for the playbook's `choose_courses` entry (kind `playbook`, key suffix `choose_courses`), reading `ctx.coursePlan`
(ask U1's loader to fill `coursePlan` again if it's absent: `lib/chances/course-plan-server.ts`). Phone: 390 px, 16px inputs,
44px targets. Telemetry: `plan_move_shown/done/skipped`, `plan_season_explainer_opened`.

### U2 ED opportunities (opus, wave 1)
Owns: `lib/planner/ed-opportunities.ts`, `lib/planner/generators/rounds.ts` (cost_check per candidate),
`lib/planner/store-ed.ts` ("use server": `startEd(itemId, round)`, `dismissEd(itemId)`, `setEdChecks(itemId, checks)`),
`components/planner/{EdPill,EdSheet}.tsx`, `components/planner/moves/EdDecideCard.tsx`, `components/planner/PlanRow.tsx`
(the pill slot: at most one pill per row, ED first; U3 adds the interest pill in the same slot through a shared
`RowPill` prop U2 defines in `PlanRow`), `components/planner/RowDrawer.tsx` (the sheet on top when opened with `panel="ed"`),
the removals above, `tests/planner-ed-opportunities.test.mts`.
Rules from the spec: candidates (offers ED, `ed === "helps"`, Reach or Target, not dismissed), the owner's rank (Dream;
Reach closeness 3,2; Target 0,1; Reach 1,0; Target 2,3; position), cap 3, round per pill (first ED; later ED II only
when offered and its deadline is after the first's ED notification; else `ed_alt`), nothing before junior_spring,
pills gone after the ED II deadline. The sheet's numbers are the college's own (`earlyFor`, `classShareLine`,
`lastCycleNote`), never the estimate's. `ed_decide` (summer before senior year, due the first candidate's ED closing,
dated card 14 days before) and `ed2_decide` (on a recorded deferral/denial of the ED college, while an ED II candidate
exists). A guard test: pill and sheet text never carry a percentage from the estimate or the word "odds".

### U4 List shape (sonnet, wave 1)
Owns: `lib/planner/list-shape.ts`, `lib/planner/rail-server.ts` (server-only) + `app/api/plan/rail/route.ts` (POST
`{ studentId, level, gap }` → cards; signed-in, `loadPlanFor` access check; candidates = `similarSchools` (lib/insights.ts)
of every listed college + Explore's "fits my numbers" set (find it in `lib/student-profile.ts` / `components/me/ExploreFitChips.tsx`),
minus the list, minus over-limit when `gap === "affordable"`; `estimateMany` with the plan's hooks; keep the missing level; ≤ 12 by
closeness desc then distance), `components/planner/moves/ShapeCard.tsx`, `components/planner/CollegeRail.tsx` (Add → `addToList`;
view-only guardian → `suggestCollege`), `balanceLineFor` rewrite in `plan-view.ts`, `tests/planner-list-shape.test.mts`.
The shape by season, the gap order, one gap move at a time (kind `shape_gap`; `shape_cost` for the parent's affordability
move), the count line, the notice and the move reading the same `shapeGaps`.

### U5 Applying (sonnet, wave 1)
Owns: `components/planner/moves/{SubmitCard,ConfirmCard,DecisionCard,Ed2Card,DecideCard,OutcomeShareCard}.tsx`,
`lib/planner/generators/apply.ts` and `offers.ts` (additive: kinds `confirm_complete`, `compare_offers`, `decide_by`,
`outcome_share` with the windows in applying.md; the built `submit`/`decision_expected`/`continued_interest`/`waitlist_accept`
rows get cards, not new rows), `components/planner/PlanRow.tsx`'s status word (coordinate: U2 owns the pill slot; U5 adds
the muted word after it, from `senior_fall` only, through `SEASON_STATUS_LABEL`), `tests/planner-applying.test.mts`.
Reuse `ApplyStatusControl`, `OutcomePicker`, `ChooseButton`, `markApplied`, `markComplete`, `recordDecision`, `choose`,
`consentOutcomeShare`. Marking applied ticks the submit move only; recording a decision ticks the decision move; the Offers
tab appears after the first decision (built). Each card's parent lane as the spec lists.

### U7 Your story (sonnet, wave 1)
Owns: `lib/student-profile.ts` (`sanitizeStory` into `sanitizeProfile`, the major condition), `lib/student-profile-store.ts`
(the guardian strip), `components/me/StorySection.tsx` (on the Numbers page after Plans, `/household/[person]/numbers`),
`components/planner/moves/StoryCard.tsx` (the three prompts inline; read-only beside the essay move for "Start from your
story"), the admin export and CSV exclusions (find `lib/admin*` / account export; never the text), `tests/student-profile-story.test.mts`.
Guard tests: a guardian's loader result carries no story text; the export carries none; the move closes when every
applicable prompt is filled (`story_missing` reads `about` and `thread`, and `majorWhy` only with a major).

### U3 Interest and visits (sonnet, wave 2; after U2)
Owns: `lib/planner/interest.ts`, `components/planner/{InterestPill}.tsx`, `components/planner/moves/InterestCard.tsx`,
`components/planner/RowDrawer.tsx` (the move's why above the capture chips when opened with `panel="capture"`; U2 has
merged, so edit after `git merge feature/next-steps`), `tests/planner-interest.test.mts`.
The three rules, the band, the three-cap, a logged act (any of `hooks.interest`) closes the move, not-considered never
fires, senior-fall dating (14 days before the chosen round's deadline), the ED-candidate visit without C7, "Not now" skips
for the season and returns next season while the condition holds (key the task by item and season). Options in the card
reuse the capture panel's actions (`logVisit`, `markInfoRequested`, `recordFollow`).

### U6 Notifications (opus, wave 2)
Owns: `lib/emails/season-brief.ts`, `app/api/cron/weekly/route.ts` (the brief step, the moves in Your week and the parent
summary), `lib/planner/timeline.ts` (`yourWeekDefault(season)`, `HARD_DEADLINE_KINDS` + `ed_decide`/`ed2_decide`),
`lib/planner/reminders-server.ts`, `app/api/cron/day-before/route.ts` (if needed), `lib/planner/plan-frame.ts` (`hasNewMove`),
`app/api/plan/next/route.ts` (dot = due soon or a move added since `plan_opens.last_at`), `lib/planner/store-opens.ts`
("use server" `recordPlanOpen(studentId)`, called by `PlanOpened` on the next tab), `app/unsubscribe/[token]/season-brief/route.ts`
(+ the SQL function pattern of `unsubscribe_your_week_by_token`: a second migration `20261014130000_season_brief_unsubscribe.sql`
is allowed for the function only), `components/account/RemindersSection.tsx` (the season-brief switch), the digest's
changed-college move line, `tests/planner-briefs.test.mts`.
Rules: one brief per person per season turn (record sends in `digests`-style rows or a `season_briefs_sent (user_id, student_id, season, cycle)`
table in the same second migration), first Sunday of the season, a late joiner's first Sunday, the February brief for
freshman/sophomore, defaults per season, a skipped move never mails, a done move once, no number in any line
(`scrubNumbers`), email dormant until configured (queue nothing; the job is idempotent by the sent-row).

### U8 Docs and cleanup (haiku, wave 3)
Mark the seven specs `> Status: **built** 2026-10-14`; update `specs/planner/redesign/rounds.md#rules` and
`specs/planner/README.md` "Decisions in short" per ed-opportunities.md "What changes in the built rules"; add the
built notes each part asks for; `grep` that nothing imports the removed ED suggestion helpers. No code changes.

## Rules for every unit agent
- Read this file, your spec, `CLAUDE.md`, `AGENTS.md`, and the code you touch. Run `npm ci` first. Rename your branch
  (`git branch -m feature/next-steps-<unit>`), then `git merge feature/next-steps` to pick up the foundation. Copy
  `.env.local` from `/Users/raymondross/Projects/college-stats/college-stats/.claude/worktrees/next-steps/.env.local`.
- Own only your files; shared registries (`lib/analytics.ts`, `lib/glossary.ts`, `lib/planner/types.ts`, the card
  registry) only additively, one line where possible. Never touch `lib/roadmap.ts`, release notes, `lib/roadmap.ts`,
  or other units' files. If you need a contract changed, say so in your report instead of changing it.
- Every term gets `<Term>`; every college date or count cites its field and edition; **nothing on a card, pill, or
  sheet is a number from the estimate** (no percentage, multiple, odds, or closeness); phone width 390 px with no
  horizontal page scroll and 16px form fields; `"use server"` files export only async functions; client components
  never import server-only modules (tests/helpers/client-reach.mts guards it).
- Tests for your unit; prove each new guard fails when its rule is broken. `npm run verify` and `npx next build`
  must pass before your final commit. Commit on your branch; don't push or open PRs.
- One git command per shell call; no heredocs that name git; stop every background process you start (dev servers on
  a free port from 3000 up, never another session's).
- Report: branch, commits, files, decisions not covered here, anything left undone.

## Integration
Merge waves in order (U1; then U2, U4, U5, U7, U1b; then U3, U6; then U8) with `--no-ff`, `npm run verify` after each,
`npx next build` after each wave; apply the migration to dev after U1 (psql, `SUPABASE_DB_URL` in `.env.local`), and
U6's after U6. Then browser QA on the dev database with throwaway accounts (a junior-spring student, a senior, a parent
of both), mark the specs built, remove the roadmap group, one release note, push, and the PR for the owner's review on
the Vercel preview. Not merged into `main` until the owner approves.
