# Plan v3: Build Plan

> Written 2026-10-16 for the build of [plan v3](README.md) (roadmap group `plan-v3`: nine parts). Method: the
> `build-roadmap-section` skill. Every unit agent reads this file first, then its own spec, then the built code it
> touches. Integration branch `feature/plan-v3` (worktree `.claude/worktrees/plan-v3-build`); unit branches
> `feature/plan-v3-<unit>`. The previous section's brief, [../next-steps/build-plan.md](../next-steps/build-plan.md),
> describes what is already built (its "As built" sections are accurate); this plan changes it.

## Review notes (decisions this plan makes where the specs are silent or the code disagrees)
1. **A guide is a page, found by a registry.** `lib/planner/guides.ts` (pure) maps a task to its guide (`guideFor(task)`),
   and `lib/planner/guides-server.ts` (server-only) maps a slug to the component that renders it plus an optional
   server loader. `MoveCard` asks `guideFor` first: when a task has a guide, its one button is the guide's; only a task
   with no guide keeps its built `action` button. No new `MoveAction` kinds are needed for the guides.
2. **Stored actions stay.** The generated tasks' `action` column keeps its built values (`open_row`, `show_rail`,
   `story`, …); the cards no longer read them for a kind that has a guide. `open_row` with `panel: "ed"` now opens the
   ED sheet as a dialog from the row (U2b); `panel: "capture"` has no target any more and renders nothing.
3. **One migration** for the section (U1): `supabase/migrations/20261016120000_plan_v3.sql`: `plan_tasks.dismissed_at`,
   `plan_tasks.dismissed_by`, the table `plan_interest_acts`, `plan_bundle()` recreated with the two new task columns.
   Read fallbacks before it is applied, as in the last build (`read-plan.ts` retries without the two columns; `writeMerge`
   never writes them). The lead applies it to dev right after U1 merges.
4. **The story keeps its data without a script.** `StudentStory` becomes `{ narrative: string; updatedAt: string | null }`.
   `sanitizeStory` accepts the old three-prompt shape and joins it ("About you: …\n\nThe thread: …\n\nWhy {major}: …"),
   so an old profile reads correctly and the next save writes the new shape. No `scripts/migrate-story.mts`.
5. **Connections are a profile fact.** `academics.connections: ConnectionEntry[]`; `hooksFromPlan(items, visits, profile)`
   reads them by `unitId`. The `list_items.legacy / legacy_sibling / recruited` columns stay in the schema, stop being
   written or read by the app, and `scripts/backfill-connections.mts` copies them into profiles once (lead runs it on dev
   after U2a merges).
6. **Season gate (now.md "Ranking").** A move is eligible for the student's Now when `seasonRank(taskSeason(t)) <=
   seasonRank(current)` (its own season or an earlier one that carried; the generators only emit earlier entries that
   carry), **or** it is dated within `SOON_DAYS` (14). A later season's move is otherwise invisible to the student: not
   in Now, not in a fold, not counted. `nowMoves` keeps returning `more` and `comingUp` for the parent's view (U9);
   the student's tab renders only `now`, `done`, and `skipped`.
7. **Skip is `dismiss`** (built), now stamped: `dismiss(taskId, true)` also sets `dismissed_at = now()` and
   `dismissed_by = auth.uid()`; `undismiss(taskId)` clears all three. Telemetry `plan_move_skipped` unchanged;
   `plan_move_restored {kind, season, by}` is new.
8. **`reach_score` is a playbook entry**, one per season junior fall → senior fall (keys `reach_score_{season}`, so
   each season's skip is its own), `applies: "below_target"`, `carries: false`, title "Work toward your {target}", why
   as the spec. Titles may hold `{target}`; `playbookTask` fills it from `profile.tests.target`. Without a target the
   built retake notice stays a notice (the guide shows it); no move is generated for it in this build (owner question).
9. **The PSAT entries get `applies: "no_real_score"`**: false when `tests.satTotal` or `tests.actComposite` is set and
   `tests.practice` is false. Overview question 4 adopted: the junior PSAT/NMSQT is dropped too for such a student.
10. **`pick_recommenders` replaces `notice_teachers`**: season `junior_spring`, carries, `applies: "recommenders_open"`
    (fewer than two entries with status asked/agreed/invited). `notice_teachers` is removed from the catalog (its
    generated rows orphan on the next regeneration, which hides them).
11. **Act tracking is one table for every guide.** `plan_interest_acts.act` includes `test_register`, so the test guide's
    Register button is the same `ActButton`. `item_id` is nullable (a test registration has no college).
12. **The return prompt arms on `visibilitychange`/`focus`** and asks once per act (`prompted_at` set on first ask,
    whatever the answer). "Not yet" leaves the act pending for the next-morning email. The email is one per person per
    day from a new cron route `app/api/cron/interest-confirm/route.ts` (13:30 UTC in vercel.json), the digest's pattern.
13. **The intake gains step 6, Connections**; Other → 7, Review → 8, Done → 9. `IntakeStep` = 0–9; `ACTIVITY_STEP_INDEX`
    other → 7; `intakeStepParam` accepts 0–7; `plan_intake_step.step` type gains 8. `ProfileSection` gains `connections`
    (after `work`, before `other`), done when any connection is entered or `activitiesNone.connections` is true.
14. **Open-question recommendations adopted** as owner assumptions: recruiting lives in the Connections step; social
    follows stay as the last option in the Show interest guide; no "Add it to your list" from a connection; no snooze
    state; Done and skipped shows this season; likeness is three points of six (two when the anchor has under four facts
    known); 150 miles fixed; no anchor level on a card; no `.ics` email; the request-information link is the admissions
    page until the links pipeline has `request_info`; the test move is undated and carries; STORY_MAX 2,000 with the
    auto-tick at 200; APs only in the courses guide's add box; recommenders from March of junior year; no nudge about
    a teacher; a parent never skips for the student, only brings back.
15. **Guides on a phone**: every guide is one column at 390 px, 16px inputs, 44px targets, no horizontal page scroll;
    desktop keeps the plan's width (`PlanFrame`'s container) without the tab strip.

## Shared contracts (decided up front; units implement against these names)

### Guides (`lib/planner/guides.ts`, pure, U1)
```ts
export type GuideSlug = "list" | "interest" | "test" | "story" | "courses" | "recommenders" | "ed";
export interface GuideEntry { slug: GuideSlug; title: string; button: string; purpose: string; hrefFor: (task: PlanTask | null, opts: { person: string | null }) => string }
export const GUIDES: Record<GuideSlug, GuideEntry>;
/** The guide a move opens, or null: by kind (shape_gap, show_interest, visit_ed, story, ed_decide, ed2_decide, test_register, test_day,
 *  recommendation), by playbook key (build_list, long_list, fall_break_visit, spring_break_visit, *_visit_travel, pick_test,
 *  register_spring_test, reach_score_*, brag_sheet, *_choose_courses, junior_choose_courses, pick_recommenders), by cycle key
 *  (ask_recommenders, thank_recommenders, personal_essay_draft → story). */
export function guideFor(task: Pick<PlanTask, "kind" | "key" | "item_id">): GuideEntry | null;
/** `/plan/guide/{slug}?for=…&move=…&college=…&level=…` */
export function guideHref(slug: GuideSlug, q: { person?: string | null; move?: string | null; college?: string | null; level?: StandingLevel | null; from?: GuideFrom }): string;
export type GuideFrom = "move" | "pill" | "notice" | "profile" | "numbers" | "card";
```
`hrefFor` for `interest` adds `college=<unit id>` from the task's item; for `list` adds `level` from a `shape_gap`
task's `action.level`; for `ed` adds `college`. The buttons: list "Help me build it", interest "Show me how", test
"Help me get there", story "Write it", courses "Help me choose", recommenders "Help me pick", ed "See the facts".

### The guide page (U1)
- `app/plan/guide/[slug]/page.tsx` (server): parses the slug (404 for an unknown one), resolves the student like
  `/plan` does (`?for=` for a guardian, else the viewer's own; `planViewer()` + `loadPlanFor`), finds the move
  (`?move=<task id>` that belongs to this plan, else null), runs the slug's server `load` when it has one, and renders
  `GuideFrame`. Signed out: redirect to `/plan`. A plan that isn't ready: the same fallbacks as `/plan`.
- `lib/planner/guides-server.ts` (server-only): `GUIDE_PAGES: Record<GuideSlug, { Component: ComponentType<GuideProps>;
  load?: (ctx: PlanContext, view: PlanView, query: GuideQuery) => Promise<unknown> }>`. U1 ships every entry with a stub
  component (a titled card saying the guide is coming) so every slug renders; owners replace their entry.
- `components/planner/guides/GuideFrame.tsx` (server): the header (← Back to your plan, season · class year, the guide's
  title, the move's why under it when a move led here, else `purpose`), the body (the guide component), and
  `GuideFooter` (client): **Done with this** and **Skip for now** when a move is open and the viewer can edit (the built
  `tick`/`dismiss`, optimistic, then `router.push` back to `/plan`), else "Back to your plan". Telemetry
  `plan_guide_opened {slug, from}` once on mount (from `?from=`, default `"move"` when `?move=` is present else `"profile"`).
- `components/planner/guides/types.ts`:
```ts
export interface GuideQuery { college: string | null; level: StandingLevel | null; move: string | null }
export interface GuideProps { ctx: PlanContext; view: PlanView; move: PlanTask | null; query: GuideQuery; data: unknown; person: string | null }
```
  `person` is the `?for=` value to carry on links (null for a student's own plan). Client guide components receive
  `ctx`/`view` serialized exactly as the tabs do.

### The Next steps view (`lib/planner/moves.ts`, U1)
```ts
export const NOW_MAX = 3;
export interface MoveGroups { now: PlanTask[]; more: PlanTask[]; comingUp: { title: string; date: string | null }[]; done: PlanTask[]; skipped: PlanTask[]; season: Season }
export function nowMoves(tasks, opts): MoveGroups;   // the season gate (review note 6); `skipped` = this season's dismissed moves (student view)
export function eligibleNow(t: PlanTask, opts: { season; gradYear; today }): boolean;   // the gate alone, exported for tests and U9
```
`isOpen` already excludes dismissed rows; `skipped` is computed from `live.filter(t => t.dismissed && seasonOf(t) === season)`.
`yourPartMoves`, `topMove`, `taskSeason`, `isMove`, `isFinancialMove` unchanged.

### Skip, recorded (`lib/planner/types.ts`, `read-plan.ts`, `store.ts`, U1)
`PlanTask.dismissed_at: string | null; dismissed_by: string | null` (optional-safe before the migration: read as null).
`PLAN_TASK_SKIP_COLUMNS = ["dismissed_at", "dismissed_by"]` with the retry pattern of `PLAN_TASK_MOVE_COLUMNS`
(`isMissingSkipColumn`). `dismiss(taskId, true)` patches `{ dismissed: true, dismissed_at: now, dismissed_by: userId }`;
`dismiss(taskId, false)` and the new `undismiss(taskId)` patch `{ dismissed: false, dismissed_at: null, dismissed_by: null }`
(on a missing-column error, retry with `{ dismissed }` alone).

### Catalog and applies (`lib/planner/moves-catalog.ts`, `generators/season.ts`, U1)
```ts
export type MoveApplies = /* built */ | "no_real_score" | "below_target" | "recommenders_open";
```
- `no_real_score`: true unless the profile has `tests.satTotal !== null || tests.actComposite !== null` with
  `tests.practice === false`. On `freshman_psat_practice`, `sophomore_psat_practice`, `psat_nmsqt`.
- `below_target`: `tests.focus` is sat or act, a score is set (practice or real), `tests.target !== null`, and the
  score is below the target. On the new `reach_score_{season}` entries (junior_fall, junior_winter, junior_spring,
  summer_before_senior, senior_fall), `who: "student"`, `source: "advisors"`, `action: () => null` (the guide is the
  button), title "Work toward your {target}", why "Your target is your own. The dates below are the ones whose scores
  would arrive in time."
- `recommenders_open`: fewer than two `recommenders` entries whose status is asked, agreed, or invited. On the new
  `pick_recommenders` (junior_spring, carries, who student, source advisors, action null), title "Pick your
  recommenders", why "Junior-year teachers in core subjects know your work best. Advisors say ask before summer, while
  they remember it." `notice_teachers` is deleted.
- `playbookTask` fills `{target}` in the title from `input.profile?.tests.target` (the catalog guard allows the
  placeholder; a title with an unfilled placeholder is never emitted: skip the entry when the target is null).
- The `story` entry's why becomes "One page in your own words. The counselor's questionnaire and the essay both start
  from it."; `MOVE_TEXT.story.why` the same. `story_missing` reads the new `storyMissing` (narrative under 200 chars).
- `SEASON_EXPLAINER.junior_fall.paragraph` loses "Notice the teachers who know your work, and" (now "Write your story
  while there's no deadline."); `junior_spring.paragraph` keeps "asking two teachers before summer".

### Profile (`lib/student-profile.ts`, U1 adds every type and sanitizer; owners use them)
```ts
export interface ConnectionEntry { id: string; unitId: string; family: ("parent" | "grandparent" | "sibling")[]; recruited: RecruitedPick }
export const CONNECTIONS_MAX = 10;
export function sanitizeConnections(input: unknown): ConnectionEntry[];   // drops an entry with nothing set; dedupes by unitId; unit ids are validated by the caller (U2a passes the index) — the sanitizer keeps any non-empty string id up to 12 chars
// StudentProfileAcademics gains `connections: ConnectionEntry[]` (emptyProfile → []); ActivityNoneStep gains "connections"
export function connectionFor(profile: Pick<StudentProfileData, "academics"> | null, unitId: string): ConnectionEntry | null;

export interface RecommenderEntry { id: string; name: string; subject: string | null; courseId: string | null; years: (9 | 10 | 11 | 12)[]; rank: number; status: "thinking" | "asked" | "agreed" | "invited"; askedOn: string | null; agreedOn: string | null; invitedOn: string | null }
export const RECOMMENDERS_MAX = 4; export const RECOMMENDER_NAME_MAX = 60;
export function sanitizeRecommenders(input: unknown): RecommenderEntry[];   // StudentProfileData gains `recommenders: RecommenderEntry[]` (top level, beside story)
export function recommendersAsked(profile): number;   // asked | agreed | invited

export interface StudentStory { narrative: string; updatedAt: string | null }
export const STORY_MAX = 2000; export const STORY_DONE_CHARS = 200;
export function sanitizeStory(input: unknown): StudentStory | null;   // review note 4: joins the old shape
export function storyMissing(profile): boolean;   // narrative.trim().length < STORY_DONE_CHARS
export function redactStoryForGuardian(story): StudentStory | null;   // { narrative: "", updatedAt }

// StudentProfileTests gains `registeredDates: string[]` (a subset of plannedDates; sanitizer keeps only keys also in plannedDates)
```
`STORY_FIELD_MAX` is removed; `tests/student-profile-story.test.mts` is rewritten by U1 for the new shape (the
guardian redaction and `profileForViewer` keep working). `lib/student-profile-store.ts saveStory` takes the one field
`narrative` (U1 updates the action's form parsing; U6 the UI).

### Hooks (`lib/planner/hooks.ts`, U2a)
```ts
export function hooksFromPlan(items: readonly HooksItem[], visits = [], profile: Pick<StudentProfileData, "academics"> | null = null): Record<string, CollegeHooks>;
```
`legacy` = the matching connection has parent or grandparent; `sibling` = sibling; `recruited` = its pick; `interest`
unchanged. A third argument with a default keeps every caller compiling; U2a threads `ctx.profile` through the callers
that have it (`plan-estimates.ts`, `rail-server.ts`, `generators/season.ts moveFacts`, `RowDrawer`'s replacement) and
removes the row columns from `HooksItem`.

### Act tracking (`lib/planner/interest-acts.ts` pure, `store-interest.ts` "use server", U4; the table U1)
```ts
export type InterestAct = "tour" | "info_session" | "open_house" | "fair" | "event" | "info_request" | "mailing_list" | "follow" | "test_register";
export type ActStatus = "pending" | "confirmed" | "declined" | "expired";
export interface InterestActRow { id: string; item_id: string | null; user_id: string; act: InterestAct; network: SocialNetwork | null; url: string; event_id: string | null; event_starts_at: string | null; event_place: string | null; event_title: string | null; clicked_at: string; prompted_at: string | null; emailed_at: string | null; status: ActStatus; resolved_at: string | null; resolved_via: "prompt" | "email" | "manual" | null; visit_id: string | null; confirm_token: string }
export const PROMPT_WINDOW_MS = 5 * 60_000;
export function expiresAt(row: Pick<InterestActRow, "clicked_at" | "event_starts_at">): string;   // event date + 7 days, else click + 14 days
export function promptQuestion(row, collegeName: string | null): string;   // "Did you register for Duke's tour on Nov 3 at 10 AM?"
export function pendingForPrompt(rows, now): InterestActRow | null;   // the newest pending, unprompted, under PROMPT_WINDOW_MS old
// store-interest.ts (async only): recordAct(input) → { ok, id, token }; resolveAct(id, "confirmed" | "declined", via, extra?: { visitDate?: string; visitTime?: string | null }); pendingActs(itemId | null)
```
A confirmed act writes through the built stores inside `resolveAct`: tour/info_session/open_house/fair/event →
`logVisit` (kind via `planVisitKind`, `registered: true`, `registration_url`, venue in `notes.free`) and `visit_id`;
info_request/mailing_list → `markInfoRequested(itemId, true)`; follow → `recordFollow(itemId, network, true)`;
test_register → the planned date into `tests.registeredDates` (via `saveProfile`) and `tick` of the matching
`test_register` task. Confirming an act with an item regenerates the list (`regenerate`) so the interest move closes.

### Database (U1: `supabase/migrations/20261016120000_plan_v3.sql`)
```sql
alter table public.plan_tasks add column dismissed_at timestamptz;
alter table public.plan_tasks add column dismissed_by uuid references auth.users on delete set null;
create table public.plan_interest_acts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.list_items on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  act text not null check (act in ('tour','info_session','open_house','fair','event','info_request','mailing_list','follow','test_register')),
  network text, url text not null, event_id text, event_starts_at timestamptz, event_place text, event_title text,
  clicked_at timestamptz not null default now(), prompted_at timestamptz, emailed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','confirmed','declined','expired')),
  resolved_at timestamptz, resolved_via text check (resolved_via in ('prompt','email','manual')),
  visit_id uuid references public.plan_visits on delete set null,
  confirm_token text not null unique default encode(gen_random_bytes(24), 'hex')
);
-- RLS: select for the actor and for anyone who can see the item's list (the plan_visits policy pattern, plus user_id = auth.uid() for item-less rows);
-- insert/update for user_id = auth.uid(); service_role all. Index on (user_id, status), (status, emailed_at).
-- plan_bundle(): same body + dismissed_at, dismissed_by in the tasks select.
```
`PLAN_TASK_COLUMNS` gains the two; `tests/bundles.test.mts`'s tasks guard covers them; `tests/planner-plan-v3-migration.test.mts`
reads the SQL. Account export (`lib/account-export.ts`) and deletion: U4 adds `plan_interest_acts` (own rows).

### Telemetry (`lib/analytics.ts`, U1 adds every event)
`plan_guide_opened {slug, from}`, `plan_move_restored {kind, season, by}`, `plan_guide_added {level, likeness}`,
`plan_guide_shape_explained {}` (use `{ season }`), `plan_interest_confirmed {act, via}`, `plan_interest_expired {act}`,
`plan_test_registered {test, via}`, `plan_courses_added {count}`, `plan_recommender_status {status}`,
`recommenders_count {n}`, `plan_parent_season_viewed {season}`, `plan_connection_added {kind: "family" | "recruited"}`;
`story_filled` becomes `{ length_band: "short" | "medium" | "long" }`; `plan_intake_step.step` gains `8`;
`plan_interest_act.action` stays (its values gain the act names). Server: `interest_confirm_sent {acts}`.
Removed: `plan_drawer_opened`, `plan_rail_opened`, `plan_rail_added` (U2b/U3 delete the callers; U1 deletes the events).

### What's removed
- U2b: `components/planner/RowDrawer.tsx`, `AboutYouAndCollege.tsx`, `components/planner/row/*`, `lib/planner/capture.ts`'s
  `rowToDo` (keep `visitPageLink`, `visitedState`, `followTargets`: the interest guide uses them), `RowControls.tsx` if
  nothing else imports it, the `RowPill`/`RowPanel` types (the pill becomes a plain `ReactNode` prop).
- U2a: `setItemLegacy`, `setItemSibling`, `setItemRecruited` (`store-list.ts`), `legacy`/`recruited`/`legacy_sibling`
  reads in `hooks.ts`; `tests/planner-read-sibling.test.mts` becomes a test that the columns are still read harmlessly
  (or is deleted if it only tested the setters).
- U3: `components/planner/CollegeRail.tsx`, `components/planner/moves/ShapeCard.tsx`, `lib/planner/rail.ts`,
  `rail-server.ts`, `app/api/plan/rail/route.ts` (the guide's own candidate code replaces them; keep `excludeOverLimit`'s
  idea inside `list-guide.ts`).
- U6: `components/planner/moves/StoryCard.tsx` (registry entry removed; `story` renders `MoveCard` with the guide button),
  `components/me/StorySection.tsx`'s three fields → one field (or a link to the guide plus the status line).
- U7: `components/planner/NextYearCard.tsx` out of the registry (`playbook` falls to `MoveCard`); the file is deleted once
  `CoursesGuide` holds its UI.
- U1: `components/planner/moves/InterestCard.tsx` out of the registry (`MoveCard` + guide button); delete the file.

## Units

| Unit | Spec | Model | Wave | Branch |
|---|---|---|---|---|
| U1 Foundation: Now, guide pattern, skip record, catalog, profile types, migration | now.md; contracts above | opus | 0 | `feature/plan-v3-foundation` |
| U2a Connections: intake step, profile section, hooks, backfill | connections.md (step, stored, what reads it, migration) | sonnet | 1 | `feature/plan-v3-connections` |
| U2b The row: trash, no drawer, ED dialog, pills to guides | connections.md "The row" | sonnet | 1 | `feature/plan-v3-row` |
| U3 Build your list guide | guides/list-size.md | opus | 1 | `feature/plan-v3-list-guide` |
| U4 Show interest guide + act tracking + email | guides/show-interest.md | opus | 1 | `feature/plan-v3-interest-guide` |
| U7 Choose APs guide | guides/ap-choices.md | sonnet | 1 | `feature/plan-v3-courses-guide` |
| U5 Reach your score guide | guides/test-prep.md | sonnet | 2 (after U4) | `feature/plan-v3-test-guide` |
| U6 Your story guide | guides/your-story.md | sonnet | 2 | `feature/plan-v3-story-guide` |
| U8 Recommenders guide | guides/recommenders.md | sonnet | 2 | `feature/plan-v3-recommenders-guide` |
| U9 The parent's Next steps | parents.md | sonnet | 2 | `feature/plan-v3-parents` |
| U10 Docs | status lines, README decisions, roadmap | haiku | 3 | `feature/plan-v3-docs` |
| QA | browser QA, desktop + 390 px, student and parent | sonnet | 3 | (scratchpad) |

At most five agents run at once: wave 1 is five; wave 2 four; wave 3 two.

### U1 Foundation (opus, wave 0)
Owns: the migration and `tests/planner-plan-v3-migration.test.mts`; `lib/planner/{types,read-plan,context,store,moves,moves-catalog,guides}.ts`,
`lib/planner/guides-server.ts`, `lib/planner/generators/season.ts` (the three applies keys, `{target}`), `lib/student-profile.ts`
(every type above), `lib/student-profile-store.ts` (`saveStory` → narrative), `lib/analytics.ts`, `app/plan/guide/[slug]/page.tsx`,
`components/planner/guides/{GuideFrame,GuideFooter,types,stubs}.tsx`, `components/planner/NextSteps.tsx`,
`components/planner/moves/{MoveCard,registry}.tsx` (guide button; InterestCard out), `components/planner/SeasonExplainer.tsx`
(next season's line kept), tests `tests/planner-moves.test.mts`, `tests/planner-guides.test.mts`, `tests/planner-moves-catalog.test.mts`,
`tests/planner-season-generator.test.mts`, `tests/student-profile.test.mts`, `tests/student-profile-story.test.mts`,
`tests/planner-read-plan.test.mts`, `tests/bundles.test.mts` (additions).
Steps, each green before the next:
1. Profile types and sanitizers (contract "Profile"), `emptyProfile`, `sanitizeProfile`; the story's new shape with the
   legacy join; `storyMissing`; `saveStory` reads `narrative`. Tests: round trips; the join; the 200-char rule; the cap;
   `registeredDates ⊆ plannedDates`; a connection with nothing set dropped; recommenders capped at 4.
2. Types and columns: `dismissed_at`/`dismissed_by` with the read fallback; `dismiss` stamps; `undismiss`. Fake-client tests.
3. The migration + its test (every column, the acts table's check lists, RLS present, `plan_bundle` selects the two columns);
   the bundles guard.
4. Catalog and applies: `no_real_score`, `below_target`, `recommenders_open`; `reach_score_*`, `pick_recommenders`;
   `notice_teachers` gone; `{target}` filled; the story why; explainer edits. Tests: a student with a real SAT gets no
   PSAT move in any season and a practice-only student does; `reach_score` only below target, title filled, none without
   a target; `pick_recommenders` in junior spring and not junior fall; closes at two asked; the catalog guard still rejects
   a planted bare number and accepts `{target}`.
5. `moves.ts`: `NOW_MAX` 3, `eligibleNow` (review note 6), `skipped`. Tests: a junior's cycle `apply`/`decision_expected`
   tasks (season senior_fall by date) are invisible; a carried freshman entry shows in junior fall; "Common App opens Aug 1"
   shows on Jul 20 and not Jul 10; a skipped move is in `skipped` and not `now`; three cards, the fourth surfaces when one
   is ticked.
6. `guides.ts` with every mapping in the contract; `guides-server.ts` with stub components; the page; `GuideFrame`;
   `GuideFooter`. Tests (`tests/planner-guides.test.mts`): every kind/key in now.md's table maps as written; a kind with no
   guide maps to null; `guideHref` shapes; every `GUIDES` slug has a `GUIDE_PAGES` entry; no guide title/button/purpose
   has a number (reuse the catalog guard).
7. `MoveCard`: the guide button first (its words from `GUIDES`), then the built action only without a guide; Done and
   Skip move into a corner menu (`⋯` → "Done" · "Skip for now"; a `<details>` or a small popover with 44px items;
   keyboard reachable). `NextSteps`: three cards, no More/Coming up for the student, **Done and skipped (n)** folded with
   dates and **Bring back** (`undismiss`, optimistic, `plan_move_restored`), header unchanged, explainer keeps the next
   line. A guardian without edit: cards without the menu. `tests/planner-next-steps-ui.test.mts` updated.
8. Analytics events; `InterestCard` deleted; `npm run verify` and `npx next build` green.

### U2a Connections (sonnet, wave 1)
Owns: `lib/planner/intake.ts` (the step, `IntakeDraft.connections`, `connectionsNone`, `reviewLines`, `intakeToSave`,
`parseIntakeSave`, `applyIntake`, `draftFromProfile`, the renumbering in review note 13), `lib/planner/profile-progress.ts`
(`connections` section), `lib/planner/activity-steps.ts` (only if `ActivityStep` needs `connections` for the None
mechanism; prefer handling None in intake.ts directly), `components/planner/intake/{PlanIntake,ReviewStep}.tsx` (the new
step, rail label "Connections", step count), `components/planner/intake/ConnectionsStep.tsx`, `ConnectionCard.tsx`,
`components/me/ConnectionsForm.tsx` + its place on the Numbers page (`components/me/StudentNumbers.tsx`, additive, after
Activities), `lib/planner/hooks.ts` (contract), its callers (`plan-estimates.ts`, `rail-server.ts` if still present at
merge, `generators/season.ts moveFacts`, `components/planner/EdSheet.tsx` if it calls hooks), the college profile's
standing card (find "to your list to mark a legacy" under `components/` and `app/college`), `lib/planner/store-list.ts`
(delete the three setters), `scripts/backfill-connections.mts` (reads every `list_items` row with `legacy`,
`legacy_sibling`, or `recruited <> 'none'` through the secret-key client like `scripts/purge-accounts.mts`, writes
`academics.connections` into the student's `student_profiles.data`, skipping colleges already present; `--dry-run` prints
what it would do), tests `tests/planner-intake.test.mts`, `tests/planner-hooks.test.mts`, `tests/planner-profile-progress.test.mts`.
The step: headline and sub-line from the spec; search over `searchSchoolsApi` (the add-college box's client search) with
the list's colleges as the first suggestions (pass `ctx.items`' unit ids and names into the intake as `listColleges`);
a card per college with three family chips, the recruiting select (the built picks from `AboutYouAndCollege.tsx`:
copy its labels before U2b deletes it), the state-ban sentence via `banForSchool` (needs the school's state and type:
the search index entry has `state`; type comes from `/api/schools`? If not cheaply available, show the ban line only on
the Numbers form where the school record is loaded, and say so in the report), `None` chip, `CONNECTIONS_MAX`.
Review line "Connections: Duke (parent), Michigan (sibling)" / "None". Telemetry `plan_connection_added`.

### U2b The row (sonnet, wave 1)
Owns: `components/planner/PlanRow.tsx`, `components/planner/PlanList.tsx` (pill wiring, `?row=&panel=ed` opens the ED
dialog, remove `rowToDo`), `components/planner/EdSheet.tsx` (`SheetDialog` wrapper: `EdSheetDialog({ row, ctx, candidate,
open, onOpenChange })`; the "Visit before you decide" line links `guideHref("interest", { college })`; the "ED offered; no
counts published" line inside the sheet), `components/planner/EdPill.tsx` (onOpen opens the dialog), `components/planner/InterestPill.tsx`
(a `Link` to `guideHref("interest", { college, from: "pill" })`), `components/planner/moves/EdDecideCard.tsx` (`edRowHref`
stays: `?row=<id>&panel=ed` now opens the dialog), `lib/planner/capture.ts` (`rowToDo` removed), the deletions listed
above, `tests/planner-list-view.test.mts`, `tests/planner-capture.test.mts`.
The row: heart, crest and name, one pill, the status word, **trash** (`Trash2`, 44px, editors only, `aria-label="Remove
{name} from the list"`, `window.confirm` in the built words, then `onRemove`). No expand control, no drawer, no
`plan_drawer_opened`. `MoveCard`'s `open_row` with `panel: "ed"` keeps linking to the Colleges tab with `?row=&panel=ed`;
with any other panel it renders nothing.

### U3 Build your list guide (opus, wave 1)
Owns: `lib/planner/list-guide.ts` (pure: `SIZE_BANDS`, `sizeBand`, `likeness(anchor, candidate, student)`, `alike`,
`rankAlike`, `likenessSentence`, `preferenceCards` ordering, `GUIDE_CANDIDATE_CAP` 200, `GUIDE_PAGE` 12),
`lib/planner/list-guide-server.ts` (server-only: anchors, candidates over `getData().getAllSchools()`, `estimateMany`
with `hooksFromPlan(ctx.items, ctx.visits, ctx.profile)`, cards; `listGuideFor(ctx, view, { level })` returning the shape
row counts, the gaps in order, the first open gap's cards, and the freshman/empty view's cards), `app/api/plan/list-guide/route.ts`
(POST `{ studentId, level, offset }` → the next page; the access check through `loadPlanFor`), `components/planner/guides/{ListGuide,ShapeRow,AlikeCard,ShapeExplainer}.tsx`,
the `list` entry in `guides-server.ts`, `components/planner/PlanNotice.tsx` / `ListNotices.tsx` (the balance notice's
link → `guideHref("list", { from: "notice" })`), `PlanList.tsx`'s add pill (a "Help me build it" link beside it; coordinate:
U2b owns the file's row wiring, so touch only the `AddCollegeBox` block, additively), the deletions above,
`tests/planner-list-guide.test.mts`.
Likeness facts and sentences exactly as the spec's table (`type`, `undergrad_enrollment` bands, `campus.setting.group`,
`location.region` or `distanceMiles(anchor, candidate) <= 150`, `religion.affiliation` / HBCU / women's (`designations`,
`msi` flags), the student's first intended major family offered: use `lib/majors.ts` and `academics.majors_top` or the
detail programs if cheap, else skip the major fact and say so). Three points (two when the anchor has fewer than four
facts known). Order: likeness desc, then closeness to the level above, then distance. `Add` → `addToList` (`lib/lists.ts`),
then `router.refresh()`; a view-only guardian → `suggestCollege`. Nothing on the page is an estimate number; a guard test
over every string the module can produce.

### U4 Show interest guide (opus, wave 1)
Owns: `lib/planner/interest-acts.ts`, `lib/planner/store-interest.ts`, `lib/emails/interest-confirm.ts`,
`app/api/cron/interest-confirm/route.ts` (+ the `vercel.json` entry at `30 13 * * *`), `app/api/plan/interest/confirm/route.ts`
(GET `?token=&answer=yes|no`: resolves by token with the secret-key client, then a small HTML page like
`app/unsubscribe/[token]/visits/shell.ts`'s), `components/planner/guides/{InterestGuide,InterestOverview,ActButton,ReturnPrompt}.tsx`,
the `interest` entry in `guides-server.ts` (its `load`: the college's events through the built `eventsForUnit` logic used by
`lib/planner/visit-feed.ts`, four of them per the spec; the overview needs none), `lib/account-export.ts` (acts, own rows),
`tests/planner-interest-acts.test.mts`, `tests/interest-confirm-email.test.mts`.
The page per the spec: the C7 line cited (`INTEREST_FIELD`), Visit (events with Register through `ActButton`, "All of
{name}'s events" → `/college/{id}/visits` or the built events route, the visit page link, "We already visited" → `VisitForm`),
Ask for information (`links.admissions`; "We already did" → `markInfoRequested` dated today), Follow (`followTargets`;
a guardian sees state only), Logged line, the move's footer (U1's). `ActButton` opens the URL in a new tab, calls
`recordAct`, and arms `ReturnPrompt` (one mounted per page; `visibilitychange`/`focus`; `pendingForPrompt`; marks
`prompted_at`). The email: one per person per day, "Yesterday you opened {College}'s {act} for {date}. Did you register?"
with Yes/No token links, a line per other pending act, the built unsubscribe (plan reminders), nothing while
`emailConfigured()` is false. `expireInterestActs()` in the same route. A guard test: no email string carries a score or
an estimate number; the token resolves once.

### U7 Choose APs guide (sonnet, wave 1)
Owns: `components/planner/guides/CoursesGuide.tsx` (the suggestion UI restored from `components/planner/NextYearCard.tsx`
before deleting that file; the by-subject track view; the AP search from `components/planner/intake/ApStep.tsx`'s
pieces, `searchAp`, `POPULAR_AP`), `lib/planner/courses-guide.ts` (pure: `courseRows(profile, classYear, today)` → rows
per subject family with one slot per year and a `?` for next year; `nextYearCourses`), the `courses` entry in
`guides-server.ts` (its `load`: `coursePlanViewFor` regardless of the window, the way `lib/planner/load.ts` calls it;
plus `courseTracks` for the track sentences), the registry line removal for `playbook`, the Numbers page's Courses
section link (additive, one line in `components/me/StudentNumbers.tsx` or the courses section component),
`tests/planner-courses-guide.test.mts`.
Writes through `saveCourses` (`lib/chances/courses-store.ts`), `dismissSuggestion`, `markScheduleDone`, `saveSchoolOffers`.
"Chosen" ticks the open move (the guide receives `move`; call `tick`). Guardian read-only with the built redaction.

### U5 Reach your score guide (sonnet, wave 2, after U4)
Owns: `lib/planner/test-guide.ts` (pure: `SCORE_LAG` 14, `datesFor(profile, cycle, season, today, listDeadlines)` from
the cycle's `sat_*`/`act_*` entries, juniors next four, seniors in-time only; `inTimeText` and `registerByText` restored
from `git show c2866a9d^:lib/planner/scores.ts`; `standingCounts(rows, score, target)` over `fitsScoreValues`),
`components/planner/guides/{TestGuide,TestDateRow}.tsx` (the built `RangeBar` from `components/charts` or the compare
page; `ActButton` with `act: "test_register"`), `lib/planner/store-plan.ts` additively (`setRegisteredDate(studentId, key, on)`),
the `test` entry in `guides-server.ts`, the Numbers page's test row link (additive), the intake's test step "see dates"
link (additive, one line), `tests/planner-test-guide.test.mts`.
"I'll take it" = the built `setPlannedDate`. The header line is the student's own numbers; a guardian reads it in the third
person (`thirdPerson`). Study resources per the spec, focus test only. No score in any email string (U4's email names
the test and date only; the test guide passes `event_title: "SAT"`, never a score).

### U6 Your story guide (sonnet, wave 2)
Owns: `components/planner/guides/StoryGuide.tsx`, `components/me/StorySection.tsx` (one field or the guide link + status;
the guardian line unchanged), the `story` entry in `guides-server.ts`, `lib/glossary.ts` (`depth`, additive),
`components/planner/moves/StoryCard.tsx` deleted + registry line, `tests/student-profile-story.test.mts` (additions for
the UI's pure helpers if any), a `tests/planner-story-guide.test.mts` for the starters and the auto-tick rule.
The page per the spec: the frame paragraph with `<Term term="depth">`, the record's sentences (`activitiesReading`,
`courseTracks` via `noteText`, the intended major), the one textarea (`STORY_MAX`, count, autosave on blur and Save
through `saveStory`), four starters appending a line, the auto-tick (when the saved narrative first reaches
`STORY_DONE_CHARS` and a move is open, `tick` it), telemetry `story_filled {length_band}`.

### U8 Recommenders guide (sonnet, wave 2)
Owns: `components/planner/guides/{RecommendersGuide,RecommenderRow}.tsx`, `lib/planner/recommenders.ts` (pure: the
ordering, `nextRank`, status transitions with dates, the "What your colleges ask for" line from `recommendations_count`
cited), `lib/student-profile-store.ts` additively (`saveRecommenders(studentId, entries)` → `saveProfile` with the field
replaced; a guardian with edit may write), the `recommenders` entry in `guides-server.ts`, the Numbers page link
(additive), `tests/planner-recommenders.test.mts`.
Ranking by arrows (and drag where cheap; arrows are enough), subject from the course list (`academics.courses` names) or
typed, years chips, statuses Thinking → Asked (dated) → Agreed → Invited (senior fall on). Two Asked ticks the open
`pick_recommenders` move (the generator also stops emitting it; tick explicitly when `move` is open). "Thank them"
section from November of senior year. Telemetry per the spec.

### U9 The parent's Next steps (sonnet, wave 2)
Owns: `components/planner/ParentNextSteps.tsx` (rendered by `NextSteps.tsx` when `ctx.viewer.isGuardian`: U1 leaves a
one-line branch calling it; until U9 lands the branch renders the built guardian view), `lib/planner/moves.ts` additively
(`seasonRows(tasks, opts): { task: PlanTask; state: "now" | "next" | "done" | "skipped"; when: string | null }[]` from
`nowMoves`' groups + `skipped`; `comingUpRows`), `lib/emails/parent-summary.ts` (the skipped line, titles only, from
tasks dismissed in the last seven days: `dismissed_at`), `app/api/cron/weekly/route.ts` only if the summary's input needs
the dismissed tasks threaded through, `tests/planner-moves.test.mts` additions, `tests/planner-parents.test.mts`.
Your part (built `yourPartMoves`, hidden while empty), "{First}'s season" rows with states, "Coming up · {next season}
(n)" folded open, "Done and skipped this season" with **Bring back** for an editor (`undismiss`, attributed), telemetry
`plan_parent_season_viewed`. A row's title links its guide read-only (`guideHref` with `person`).

### U10 Docs (haiku, wave 3)
Mark the nine specs and the overview `> Status: **built** 2026-10-16`; append each spec's "As built" notes from this
plan's final "As built" section; update `specs/planner/README.md` and `specs/planner/next-steps/README.md` pointers
("v3 changed: …"); remove the `plan-v3` roadmap group and its entries from `lib/roadmap.ts` (the overview entry too) and
run `npm test -- tests/roadmap*.test.mts`; `grep` that nothing imports the deleted files. No other code.

## Rules for every unit agent
- Read this file, your spec, `specs/planner/v3/README.md` (design principles, shared rules), `CLAUDE.md`, `AGENTS.md`
  (Next.js 16: consult `node_modules/next/dist/docs/` for anything unfamiliar), then the code you touch. Run `npm ci`
  first. Rename your branch (`git branch -m feature/plan-v3-<unit>`), then `git merge feature/plan-v3` to pick up the
  foundation. Copy `.env.local` from `/Users/raymondross/Projects/college-stats/college-stats/.claude/worktrees/plan-v3-build/.env.local`.
- Own only your files; shared registries (`lib/analytics.ts`, `lib/glossary.ts`, `lib/planner/types.ts`,
  `lib/planner/guides-server.ts`'s map, `components/planner/moves/registry.tsx`, `components/me/StudentNumbers.tsx`)
  only additively, one line or block where possible. Never touch `lib/roadmap.ts`, release notes, or other units' files.
  If a contract must change, say so in your report instead of changing it.
- Every glossary term gets `<Term>`; every college date or count cites its field and edition (`MetricLabel cited=`);
  **nothing on a card, guide, pill, sheet, or email is a number from the estimate** (no percentage, multiple, odds, or
  closeness, and never the word "odds"); the level is the only thing from the estimate that shows. The student's own
  score and target may show on their own guide, never in an email, a parent's view, or telemetry. Phone width 390 px,
  no horizontal page scroll, 16px form fields, 44px tap targets. `"use server"` files export only async functions.
  Client components never import server-only modules (`tests/helpers/client-reach.mts` guards it).
- Tests for your unit; prove each new guard fails when its rule is broken (a planted bad case). `npm run verify` and
  `npx next build` must pass before your final commit. Commit on your branch; don't push or open PRs.
- One git command per shell call; no heredocs that name git; use the Write/Edit tools for files. Stop every background
  process you start (a dev server goes on the first free port from 3000 up; never kill another session's).
- Report back: branch, commits, files changed, decisions this plan didn't cover, anything left undone.

## Integration
Merge waves in order (U1; then U2a, U2b, U3, U4, U7; then U5, U6, U8, U9; then U10) with `--no-ff`, `npm run verify`
after each, `npx next build` after each wave; apply the migration to dev after U1 (psql, `SUPABASE_DB_URL` in
`.env.local`) and run `scripts/backfill-connections.mts` after U2a. Then browser QA on the dev database with throwaway
accounts (a junior-spring student, a senior, a parent of both), mark the specs built, remove the roadmap group, one
release note, push, and the PR for the owner's review on the Vercel preview. Not merged into `main` until the owner approves.

## As built by U1 (read this; it overrides the contracts above where they differ)
1. **Profile** (`lib/student-profile.ts`): also exports `ConnectionFamily`, `CONNECTION_FAMILIES`, `RecommenderStatus`,
   `RECOMMENDER_STATUSES`, and `storyLengthBand(narrative)` (short under 200, medium under 1,000, long; for
   `story_filled`). `sanitizeConnections` keeps the first entry per unit id. `sanitizeRecommenders` drops a row without
   a name, reads an unknown status as `thinking`, keeps dates as ISO days, caps subject at 60, sorts by `rank` (then
   input order) and renumbers 1..n. The old story join labels the third answer **"Why this major: …"** (not "Why
   {major}"). `storyMissing` takes `Pick<StudentProfileData, "story">`. `ACTIVITY_NONE_STEPS` includes `connections`.
   `applyIntake` keeps a saved `activitiesNone.connections` (the activity steps own their other keys);
   `importLocalProfile`'s merge carries `recommenders`. `StorySection` and `StoryCard` are one `narrative` field
   (U6 replaces both).
2. **Skip record** (`lib/planner/read-plan.ts`): `PLAN_TASK_SKIP_COLUMNS` is `readonly ["dismissed_at", "dismissed_by"]`;
   `PLAN_TASK_COLUMNS` ends `…, season, action, dismissed_at, dismissed_by`. New: `isMissingSkipColumn`,
   `withTaskDefaults` (replaces the private `withMoveDefaults`), `skipPatch(dismissed, userId, now)`, and
   `updateTaskSkip(supabase, taskId, dismissed, userId, now?)` (the stamped patch, retried with `{ dismissed }` alone),
   which `store.ts dismiss` calls; `undismiss(taskId)` is `dismiss(taskId, false)`. `GeneratedTask` omits the two
   columns; `applyMerge` and `planDataFromBundle` (`lib/bundle-read.ts`) fill them with null. `store-parents.ts
   myYourPart` still selects `PLAN_TASK_COLUMNS` with no fallback (as it did for next steps): it reads nothing until
   the migration is applied, so apply it right after U1 merges.
3. **Migration**: `confirm_token` defaults to two `gen_random_uuid()`s without dashes (64 hex characters; the repo's
   token pattern, no pgcrypto). Added an `"Admins read"` policy on `plan_interest_acts` (the admin console's pattern);
   no delete policy or grant (acts expire). `lib/planner/interest-acts-types.ts` holds `INTEREST_ACTS`, `ACT_STATUSES`,
   `ACT_RESOLVED_VIA`, `InterestAct`, `ActStatus`, `ActResolvedVia`, and `InterestActRow`: **U4 imports these** (re-export
   from `interest-acts.ts` if you like) rather than redefining them; the migration test holds the SQL's check lists
   equal to them.
4. **Catalog**: `generators/season.ts` exports `belowTarget(profile)` and `fillTitle(title, profile)` (any `{word}` left
   unfilled → the entry is skipped). `reach_score_*` and `pick_recommenders` have `action: () => null` (the guide is the
   button); `reach_score_*` don't carry. Like every playbook entry, next season's `reach_score_*` is generated for
   Coming up. **U9 note:** a `reach_score_*` title holds the student's own target ("Work toward your 1400"); the
   parent's view must not show it (render a target-free title there).
5. **`moves.ts`**: `skipped` is this season's skipped moves: its own season, or skipped (by `dismissed_at`) this
   season, which catches a carried move; a guardian viewer's own moves are left out as in Now. New helpers
   `skippedLabel(t, today)` ("Skipped Oct 12"; "Skipped" without a date) and `doneLabel(t, today)` ("Done Oct 3").
   `NOW_MAX` 3 also shortens the weekly email's child moves and the calendar week's moves (they read `.now`); the season
   brief passes its own `max`.
6. **`guides.ts`**: also exports `GUIDE_SLUGS`, `GUIDE_FROMS`, `GuideHrefQuery`, `GuideHrefOpts`, `GUIDE_BY_KIND`,
   `GUIDE_BY_PLAYBOOK_KEY`, `GUIDE_BY_CYCLE_KEY`, `parseGuideSlug`, `parseGuideQuery` (college: digits up to 12; level:
   a `StandingLevel`; move: a uuid), `parseGuideFrom(v, hasMove)`. `hrefFor(task, opts)`'s `opts` is `{ person; items? }`:
   pass `ctx.items` to get `college=<unit id>` (the interest and ED guides); with a task it adds `move` and
   `from=move`; with null it's the bare guide URL. Beyond the brief: the cycle's `choose_courses_YYYY` (the built
   course choice) maps to `courses`. Titles: list "Build your list", interest "Show a college you're interested", test
   "Reach your score", story "Your story", courses "Choose next year's courses", recommenders "Pick your recommenders",
   ed "Early decision: the facts"; owners may refine their own title and purpose (the guard test reads them).
7. **Guide page**: `lib/planner/guides-server.ts` exports `GuidePage { Component; load? }`; stubs live in
   `components/planner/guides/stubs.tsx` (`ListGuideStub`, …; no props): replace your entry in `GUIDE_PAGES`, then
   delete your stub. `GuideFrame` takes `GuideProps` plus `slug`, `from`, `Component`; the lead under the title is
   `move.detail ?? purpose`. `GuideFooter` (`{ move: { id, kind, season } | null; canEdit; isGuardian; person }`) shows
   Done with this / Skip for now only for a move that is still open and an editor, **Skip never for a guardian**
   (review note 14), then `router.push(planHref({ person, tab: "next" }))`. `GuideOpened` (client) sends
   `plan_guide_opened`. A guardian without `?for=` gets the last child viewed (the cookie), else the first child.
8. **Cards**: `MoveCard`'s one button is the guide's (`guideFor`) else the built `ActionLink` (unchanged: an `open_row`
   with `panel: "capture"` still links the row; U2b changes that). The corner menu (`<details>`, 44px `⋯`,
   `aria-label="More for {title}"`) holds Done and Skip for now, only with edit access; **a guardian's menu has Done
   alone**. Every card button is 44px at every width now. `NextSteps` is a wrapper: `GuardianNextSteps`
   (`components/planner/ParentNextSteps.tsx`, the built guardian tab moved verbatim, for U9 to rewrite) or the
   student's three cards.
9. **Telemetry**: `act` is a denied property token (the ACT), so the act events carry **`action`**:
   `plan_interest_confirmed { action, via }`, `plan_interest_expired { action }`. Types: `plan_guide_opened { slug:
   GuideSlug; from: GuideFrom }`, `plan_move_restored { kind; season; by: "student" | "guardian" }`, `plan_guide_added {
   level: StandingLevel; likeness: number }`, `plan_test_registered { test: "sat" | "act"; via }`,
   `plan_recommender_status { status }`, `recommenders_count { n: number }`, `interest_confirm_sent { acts: number }`
   (server). The three removed events stay registered until their callers go: `plan_drawer_opened` (U2b,
   `PlanRow.tsx`), `plan_rail_opened` and `plan_rail_added` (U3, `CollegeRail.tsx`); each owner deletes its event.
10. **Tests**: the catalog's words guard is shared as `tests/helpers/copy-guard.mts` (`numberProblems`); use it for any
    guide's words. Test fixtures that build a `PlanTask` need `dismissed_at: null, dismissed_by: null`.

## As built by waves 1 and 2 (U2a, U2b, U3, U4, U5, U6, U7, U8, U9)
Filled by the lead from the unit reports; U10 copies what concerns each spec into its "As built" section.

- **Connections (U2a):** intake step 6 Connections, Other 7, Review 8, Done 9 (`INTAKE_CONNECTIONS`); `IntakeDraft.connections`,
  `newIntakeConnection`, `sanitizeIntakeConnections` (unit ids format-checked, 1–10 digits); `reviewLines` takes an optional
  `names` map for the Connections line; `ProfileSection` has eleven sections (`connections` after `work`); the state-ban line
  shows on the step itself (`SchoolIndexEntry` carries `state` and `type`); `listColleges` computed inside `PlanIntake` from
  `ctx`; `ConnectionsForm` sits after the story section on the Numbers page; `connectionSentence` in `lib/student-profile.ts`;
  `hooksFromPlan(items, visits, profile)` reads `academics.connections` only (row columns ignored); the standing card reads
  `connectionFor`; `scripts/backfill-connections.mts` (`npm run backfill-connections [-- --dry-run]`) ran on dev 2026-10-16
  (one student, one sibling connection). The three `setItem*` setters were removed by the lead at merge.
- **The row (U2b):** `PlanRow` is heart · crest+name · one pill (`ReactNode`) · status word · trash (`Trash2`, 44px,
  `aria-label="Remove {name} from the list"`); `RowDrawer.tsx`, the `AboutYouAndCollege` component, `rowToDo`, and
  `plan_drawer_opened` are gone; `RowControls.tsx` and `components/planner/row/*` stay (the Lists page's `ListPage.tsx` renders
  them); `AboutYouAndCollege.tsx` keeps only `AddToListForHooks` (the standing card's). `EdSheetDialog` wraps `EdSheet` in
  `SheetDialog`; `EdPill` owns the dialog state (`openInitially`); `PlanList` opens it for `?row=&panel=ed`; the sheet's
  "Visit before you decide" links the interest guide. `InterestPill` is a `Link` to the interest guide. `MoveCard`'s `open_row`
  renders a button only for `panel: "ed"`. The old drawer-only "ED offered; no counts published" notice for non-candidate rows
  has no row-level home now (accepted scope reduction).
- **Build your list (U3):** `lib/planner/list-guide.ts` holds the pure half and the data types (`ListGuideData`,
  `GuideSection`, `FreshmanView`, `GuidePageResult`, `AlikeCard` with `level: StandingLevel | null`); `likenessSentence(anchorName,
  result)` takes the likeness result; place matched by distance reads "nearby"; facts in the order character, place, setting,
  size, control, major; the major fact reads `academics.bachelors_by_family`; character = same affiliation (Catholic, Jewish,
  Latter-day Saint spelled; else NCES's label), both HBCU, both women's. `GUIDE_CANDIDATE_CAP` 200 estimated once per page so
  folded sections show counts; sections come only from `shapeGaps` (Likely-or-Safe is one combined gap); `fallback: boolean` per
  section (the near-home rail; distance from the list's colleges when home is unknown); the affordability gap stays hidden
  (`excludeOverLimit` kept for later). `app/api/plan/list-guide/route.ts` POST `{ studentId, level, gap, offset }` or
  `{ studentId, chips, offset }` (freshman view). The shape row stacks per level on phones, five columns from `sm`; cards scroll
  inside their own box on phones, grid from `md`. "Explore with your numbers" → `/explore?mySAT=…&myACT=…` for the student,
  plain `/explore` for a guardian. `plan_shape_gap_shown` fires from the guide; `plan_guide_added {level, likeness}`.
  `AddCollegeBox` moved to `components/planner/AddCollegeBox.tsx`. `CollegeRail`, `ShapeCard`, `rail.ts`, `rail-server.ts`,
  `/api/plan/rail`, `plan_rail_opened/added` are gone; `shape_gap`/`shape_cost` render `MoveCard`.
- **Show interest (U4):** `lib/planner/interest-acts.ts` (pure), `interest-guide.ts` (pure: events shown, the C7 sentence,
  the logged line, the overview order), `interest-acts-server.ts` (server-only: `writeConfirmedAct` the one confirm writer,
  `expireInterestActs`, `runInterestConfirm`), `store-interest.ts` (`recordAct`, `markPrompted`, `resolveAct`, `pendingActs`),
  `interest-guide-server.ts` (`loadInterestGuide`: `eventsForUnit` + `myMeasuringPoint` + the family's radius; two near-you
  events then on-campus, four in all). `recordAct` checks `can_edit_item`; only the student records a follow. Event kind → act:
  tour, info_session, open_house, travel → fair, online/other → event; a confirmed act maps back through `planVisitKind`
  (tested). The visit-page link records an undated `tour`; Yes opens the visit form for the date; a virtual-tour link isn't
  tracked. `resolveAct`'s extra accepts the visit kind, who, and notes. **The email's Yes/No links open a page with one button**
  (a scanner's prefetch writes nothing; two taps, not one). Cron `app/api/cron/interest-confirm/route.ts` at `30 13 * * *`:
  expiry first, then one email per person with `your_week !== false`, address via `auth.admin.getUserById`, footer = the Your
  week unsubscribe; `plan_interest_confirmed`/`plan_interest_expired` are server events too (`action` property). Event times
  are printed in the event's zone via `visit_events.timezone`; no zone → date only. `VisitForm` gained an optional `onSubmit`;
  its inputs are still 14px inside the sheet (QA item). `lib/account-export.ts` exports acts without the token.
- **Reach your score (U5):** `lib/planner/test-guide.ts` (`SCORE_LAG`, `datesFor`, `inTimeText` over `{ name, round, iso }[]`
  per college's chosen round, `registerByText`, `standingCounts` via `readScore`/`positionIn` through `scoreAt`, `resourcesFor`,
  `plannedState`); `toggleRegisteredDate` (pure, `plan-writes.ts`) + `setRegisteredDate` (`store-plan.ts`); `writeConfirmedAct`'s
  `test_register` branch uses the pure toggle (it runs under three clients); a guardian's confirmed registration resolves the
  student through `studentForTestRegister` (the one household child with that date's `test_register` task open; ambiguous or
  none → nothing written). `plan_test_date_picked {test}` re-added. The no-target fallback to the retake notice is not built
  (owner question).
- **Your story (U6):** `lib/planner/story-guide.ts` (`storyStarters(majorName)`, `appendStarter`, `crossesStoryDone(before,
  after)`: the auto-tick fires only on the save that crosses 200, tracked in a ref seeded from the saved length); `StoryGuide`
  renders every `activitiesReading` note and every track sentence; `StorySection` on the Numbers page is the status line plus
  a link to the guide; `StoryCard` deleted; glossary `depth` under "How we measure".
- **Choose APs (U7):** `lib/planner/courses-guide.ts` (`courseRows`, `nextYearCourses`, `kindMark`; status recomputed through
  `yearStatus`); `CoursesGuide` restores `NextYearCard`'s suggestion UI (that file is deleted; `playbook` renders `MoveCard`);
  `loadCoursesGuide` runs `coursePlanViewFor` regardless of the window plus `courseTracks`; the depth tie-in line "A fourth
  year makes this a deep track."; "not on your school's list" compares against `academics.schoolOffers`; once `plan.done` the
  Suggested section hides; the Numbers page's links live in `components/me/ProfileForm.tsx` (`EditInThePlan`). `ctx.coursePlan`
  in `lib/planner/load.ts` is now unused (follow-up cleanup).
- **Recommenders (U8):** `lib/planner/recommenders.ts` (`orderRecommenders`, `nextRank`, `moveRank`, `setStatus` — forward
  only, dated once, explicit reset to thinking clears dates, thinking may jump to agreed; `subjectsFrom`, `collegesAskLine`
  returning `{ text, cites: unitIds }` since `recommendations_count` is the student's own per-college entry, not a dataset
  fact, so it carries no lineage citation; `thankSeason`, `yearsLabel`, `THINK_ABOUT`, `HOW_TO_ASK`); `saveRecommenders`
  reads the stored profile (not the guardian-redacted copy) so a guardian's save never blanks the story; advisor sources as
  plain links (College Board, NACAC); reset lives in the row's edit panel. Not built: linking an Invited status to a college's
  `recommendation` tasks (an entry carries no college).
- **The parent's Next steps (U9):** `seasonRows`, `comingUpRows`, `parentSafeTitle` (a `reach_score_*` row reads "Work toward
  the target score", never the number), `SeasonRowState`/`SeasonRow` in `moves.ts`; `ParentNextSteps.tsx` exports
  `GuardianNextSteps`: Your part → "{First}'s season" (Now and Next rows only) → "Coming up · {next season} (n)" open →
  "Done and skipped this season" folded with Bring back; `ParentSummaryStudent.skipped?: string[]` and the summary's one
  skipped line, threaded in `app/api/cron/weekly/route.ts` (dismissed within seven days).
- **Lead, at merge:** `list-guide-server.ts` passes `ctx.profile` to `hooksFromPlan`; `guides-server.ts` conflicts resolved by
  keeping every import and entry; `verify-u4.log` was cut off mid-run under load (node --test killed), covered by the wave 1
  rerun (3,790 pass). Dev: migration applied 2026-10-16; backfill run.
