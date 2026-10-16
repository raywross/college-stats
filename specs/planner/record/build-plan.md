# Your Record: Build Plan

> Written 2026-10-16 for the build of [Your record](README.md) (roadmap group `record`: record-steps, record-majors,
> record-ranking, record-less-text). Method: the `build-roadmap-section` skill. Every unit agent reads this file first,
> then its own spec, then the built code it touches. Integration branch `feature/plan-v3` (the same worktree and PR #165
> as plan v3: this round answers the owner's review of that preview); unit branches `feature/record-<unit>`.
> [../v3/build-plan.md](../v3/build-plan.md) describes what plan v3 built and its "As built" sections are accurate.

## Review notes (decisions this plan makes where the specs are silent or the code disagrees)
1. **`lib/planner/intake.ts` keeps its name and exports**; `RecordStep` is the new step type and `IntakeStep` becomes
   `export type IntakeStep = RecordStep` so the many imports still compile. `INTAKE_REVIEW`/`INTAKE_DONE` are re-exported
   from `RECORD_REVIEW`/`RECORD_DONE`. `IntakeDraft` gains the new fields; `IntakeSave`, `parseIntakeSave`, `applyIntake`,
   `draftFromProfile`, `reviewLines` grow with them. The spec's `applyRecord`/`RecordDraft` names are aliases of these.
2. **Step numbers**: 0 Grades, 1 Test, 2 AP, 3 Sports, 4 Clubs, 5 Work, 6 Connections, 7 Other, 8 Major, 9 Basics,
   10 Where you'd go, 11 Your story, 12 Recommenders, 13 Review, 14 Done. `ACTIVITY_STEP_INDEX` unchanged;
   `intakeStepParam` accepts 0–12; `plan_intake_step.step` type gains 8–13.
3. **The story step writes through the profile save like any other field** (the draft carries `story.narrative`; a
   guardian's draft carries `null` and `applyIntake` keeps the stored story when the draft's is null). The story guide
   stays the richer editor and the overview links it.
4. **The recommenders step reuses the recommenders guide's rows** (`RecommenderRow`, `lib/planner/recommenders.ts`
   helpers) inside the tour; saving goes through the same `IntakeSave` (the draft holds `recommenders`).
5. **`firstGeneration: boolean | null`** joins `StudentProfileBasics` (sanitizer, `emptyProfile`, account export). Nothing
   reads it yet beyond the record.
6. **Profile sections** (`lib/planner/profile-progress.ts`): `PROFILE_SECTIONS` becomes `high_school, grades, test,
   courses, sports, clubs, work, connections, other, major, basics, where, story, recommenders` (fourteen; `state` folds
   into `basics`). `SECTION_STEP` maps each to its step. `sectionDone`: `major` = any intended major; `basics` = state set
   or either yes/no answered; `where` = any preference (the built `hasAnyPreference`); `story` = `!storyMissing`;
   `recommenders` = any entry. `profile_missing:<section>` applies-keys follow automatically; the catalog's `profile`
   entry's `titleFor` reads `SECTION_MOVE_TITLE` for the new sections ("Add a major", "Add a few basics", "Add where
   you'd go"; story and recommenders are never the profile move's title: they have their own moves).
7. **`recordProgress`** = the thirteen tour steps (Review excluded) with done/total and per-step state, built on
   `sectionDone`; `profileProgress` stays as a thin wrapper for the people line (`done/total/next/nextLabel` over the
   fourteen sections, with story and recommenders excluded from `next` before `summer_before_senior`).
8. **The overview replaces the Numbers page**; `app/household/[person]/numbers/page.tsx` becomes a `redirect()` to
   `/record`. `StudentNumbers.tsx`, `ProfileForm.tsx`, `CompletenessMeter.tsx` are deleted; `completeness()` and
   `completenessScore()` stay in `lib/student-profile.ts` (other readers), with the overview's unlock lines in
   `SECTION_UNLOCK`.
9. **Importance** lives in `lib/planner/importance.ts` exactly as ranking.md's table; `nowMoves` sorts by it. `MoveGroups`
   keeps its shape; `more` is the rest of the eligible set in importance order (the parent view code still reads it).
   `plan_move_shown` gains `rank`.
10. **Catalog timing**: `story` → season `summer_before_senior`, carries; `pick_recommenders` → `summer_before_senior`,
    carries; `reach_score_*` entries stay per season but `baseImportance` returns 0 when `datesFor` finds no date whose
    scores arrive before the earliest listed deadline (the test-guide module is pure; import it).
11. **Less text edits the final copy**, so that unit runs after the tour and the guides are in their final shape (wave 2).
12. **Open-question recommendations adopted**: the name "Your record" (`RECORD_LABEL`); three majors; the cost limit in
    Where you'd go, a parent's field; the tour's first run keeps every step; a guardian sees the story row as
    Written / Not yet; a parent's Your part stays separate; the activities-vs-list ranking as written.

## Shared contracts

### Record (`lib/planner/record.ts`, pure, R1a)
```ts
export const RECORD_LABEL = "Your record";            // "{First}'s record" via recordTitle(firstName | null)
export type RecordStep = 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14;
export const RECORD_REVIEW = 13; export const RECORD_DONE = 14;
export type RecordSection = "grades" | "test" | "courses" | "sports" | "clubs" | "work" | "connections" | "other" | "major" | "basics" | "where" | "story" | "recommenders";
export interface RecordStepInfo { step: RecordStep; section: RecordSection; rail: string; headline: { lead: string; pop: string; tail?: string }; line: string; required: boolean; why: string }
export const RECORD_STEPS: readonly RecordStepInfo[];   // the thirteen, in order; `line` is the one-line lead, `why` the folded note
export const SECTION_UNLOCK: Record<RecordSection, string>;   // "Add a major: unlocks "like your list" matches and majors and earnings"
export function recordProgress(p: StudentProfileData | null): { done: number; total: number; rows: { section: RecordSection; step: RecordStep; done: boolean; summary: string | null; unlock: string }[] };
export function recordNeeded(ctx): boolean;            // = intakeNeeded
export function recordHref(opts: { person: string | null; step?: RecordStep; back?: "plan" | "record" }): string;  // /plan?…&record=1&step=n&back=…
export function recordPageHref(studentId: string): string;   // /household/{id}/record
```
`railSummary(draft, step)` (PlanIntake's) moves into `record.ts` as `stepSummary(profile-or-draft, step)` so the
overview and the rail share it.

### Majors (`lib/majors-search.ts`, pure, R1a)
```ts
export const MAJOR_ALIASES: Record<string, MajorFamily[]>;  // lower-case alias → families
export const POPULAR_MAJORS: readonly MajorFamily[];        // eight, in order
export function searchMajors(query: string, exclude: readonly MajorFamily[], limit = 6): { family: MajorFamily; name: string; via: string | null }[];
```

### Importance (`lib/planner/importance.ts`, pure, R1b)
```ts
export interface ImportanceFacts { season: Season; today: string; gradYear: number | null; profile: StudentProfileData | null; cycle: Cycle; listDeadlines: { name: string; round: string; iso: string }[] }
export function baseImportance(task: Pick<PlanTask, "kind" | "key" | "season" | "window_start" | "window_end" | "due_on">, facts: ImportanceFacts): number;
export function timingBoost(task, today): number;   // +30 overdue, +20 ≤7d, +10 ≤14d, +5 ≤30d
export function importance(task, facts): number;    // clamp(base + timing − carried, 0, 100)
export const MOVE_IMPORTANCE: ...;                  // the table, one entry per row of ranking.md
export function compareByImportance(a, b, facts): number;   // desc; dated first; catalog order; title
```
`nowMoves(tasks, opts)` gains `facts` in `opts` (the callers have `ctx`; `NextSteps` builds it from `ctx` + `view.rows`'
deadlines) and sorts the eligible set with `compareByImportance`; a move whose importance is 0 is left out of `now`
and `more`.

### Telemetry (`lib/analytics.ts`)
R1b: `plan_move_shown { kind, season, rank }`. R1a: `record_major_picked { count }`, `record_step { step, mode }`
(rename of `plan_intake_step`: keep the old name, widen `step`), `record_overview_opened { viewer }`. R4:
`plan_why_opened { screen, section }`.

### What's removed
R3: `components/me/{StudentNumbers,ProfileForm,CompletenessMeter}.tsx`; the Numbers page's body; the person header's
"Numbers" label; `ParentsCanEdit` on the Numbers page (moves to `/account`). R1b: `nowMoves`' buckets (`bucket`,
`compareMoves`). R3: `PlanPeople`'s "Edit {name}'s grades, test, and courses" label and `editHref` → the overview.

## Units

| Unit | Spec | Model | Wave | Branch |
|---|---|---|---|---|
| R1a Record data: steps, draft, save, progress, majors search | steps.md, majors.md (data) | opus | 0 | `feature/record-data` |
| R1b Importance ranking | ranking.md | sonnet | 0 | `feature/record-ranking` |
| R2 The tour's new steps (UI) | steps.md "The steps", majors.md (UI) | sonnet | 1 | `feature/record-tour` |
| R3 The overview, routes, header, account, people line | steps.md "The overview", "The people line", "Parents can edit" | sonnet | 1 | `feature/record-overview` |
| R4 Less text | less-text.md | sonnet | 2 | `feature/record-less-text` |
| R5 Docs | status lines, As built | haiku | 3 | `feature/record-docs` |
| QA | browser QA, desktop + 390 px, student and parent | sonnet | 3 | (scratchpad) |

At most two agents run in wave 0, two in wave 1, one in wave 2, two in wave 3.

### R1a Record data (opus, wave 0)
Owns: `lib/planner/record.ts` (new), `lib/planner/intake.ts` (steps 8–12 in the draft/save/parse/apply/review/
`draftFromProfile`/`stepValid`/`intakeStepParam`/`activityStepAt`; `RecordStep`; the aliases of review note 1),
`lib/planner/profile-progress.ts` (review note 6; `SECTION_MOVE_TITLE` for the new sections), `lib/student-profile.ts`
(`firstGeneration`), `lib/account-export.ts` if it lists basics fields, `lib/majors-search.ts` (new), `lib/analytics.ts`
(additive), `lib/planner/moves-catalog.ts` only for `SECTION_MOVE_TITLE` use if needed, tests `tests/planner-record.test.mts`
(new), `tests/majors-search.test.mts` (new), `tests/planner-intake.test.mts`, `tests/planner-profile-progress.test.mts`,
`tests/student-profile.test.mts`, `tests/planner-season-generator.test.mts` (the `profile_missing:*` completeness list).
Steps: (1) `firstGeneration`; (2) `record.ts` with `RECORD_STEPS` (headlines, lines, whys from steps.md and the built
steps' current headlines), `SECTION_UNLOCK`, `stepSummary`, `recordProgress`, `recordHref`, `recordPageHref`; (3) the
draft and save for steps 8–12 with `parseIntakeSave` checks mirroring `sanitizeProfile`; `applyIntake` writes them (the
story only when the draft's isn't null; recommenders via `sanitizeRecommenders`); `draftFromProfile` reads them back;
`reviewLines` rows ("Major: Engineering, Computer science" / "Undecided"; "Basics: NC · fee waiver: not sure · first
generation: no"; "Where you'd go: Mid-sized, suburban, Southeast, up to $35,000"; "Your story: Written" / "Not yet";
"Recommenders: 2 teachers"); (4) profile sections and `SECTION_MOVE_TITLE`; (5) `majors-search.ts`; (6) tests:
round trips for each new step, a skipped step leaves the profile's field untouched, the story step for a guardian keeps
the stored story, `recordProgress` for three planted profiles, the unlock lines contain no digit, every alias resolves
to a real family, `searchMajors` excludes picked ones and caps. Note for R2 in your report: the exact draft field names.

### R1b Importance ranking (sonnet, wave 0)
Owns: `lib/planner/importance.ts` (new), `lib/planner/moves.ts` (`nowMoves` sorts by importance; `bucket`/`compareMoves`
go; `MoveGroups` unchanged; `eligibleNow` unchanged), `lib/planner/moves-catalog.ts` (the `story` and
`pick_recommenders` entries' seasons → `summer_before_senior`; `recommenders_open` applies stays), `lib/planner/generators/season.ts`
(nothing unless the season move needs it), `components/planner/NextSteps.tsx` (build `ImportanceFacts` from `ctx` and
`view.rows` and pass `facts`; `plan_move_shown` rank), `components/planner/moves/MoveCard.tsx` (the `rank` prop for
telemetry), `app/plan/page.tsx` (`detailFor`'s `nowMoves` call gets `facts`), `lib/analytics.ts` (additive), tests
`tests/planner-importance.test.mts` (new), `tests/planner-moves.test.mts` (the sort replaces the bucket tests),
`tests/planner-season-generator.test.mts` (the two entries' seasons), `tests/planner-recommenders.test.mts` (the March
case becomes summer).
`MOVE_IMPORTANCE` is the table in ranking.md, row by row, with a comment per row quoting its "why"; `baseImportance`
resolves a task to a row by kind, then playbook key (`:playbook:<key>`), then cycle key (`:cycle:<key>`), then the
shape_gap variant (`:shape_gap:<kind>`); the season rules as small functions (`story`, `pick_recommenders`,
`ask_recommenders`, `choose_courses*` in window, `reach_score*` with `datesFor` from `lib/planner/test-guide.ts`,
`build_list`/`long_list` by season, `major` by season, `psat*`). The default 50 is explicit (`DEFAULT_IMPORTANCE`) and the
test lists every `TaskKind` and playbook key, asserting each is in the table or in an allowlist of "default on purpose".
The worked example in ranking.md is a test (plant those tasks and dates; assert the three and the order; tick one and
assert the fourth surfaces).

### R2 The tour's new steps (sonnet, wave 1, after R1a)
Owns: `components/planner/intake/{PlanIntake,ReviewStep,Headline}.tsx` (the five steps wired, the rail from
`RECORD_STEPS`, Skip/"I'll add this later" on every optional step, the one-line note on steps 11–12 on first run, the
`?record=1&step=n&back=` params with `back` honored on save/close, the Done screen's "Your record is in."),
`components/planner/intake/{MajorStep,MajorChips,BasicsStep,WhereStep,StoryStep,RecommendersStep}.tsx` (new),
`components/planner/PlanFrame.tsx` (`record` param alongside `setup`), `app/plan/page.tsx` (parse `record`, `step`,
`back`: additive), tests `tests/planner-intake-ui.test.mts` (new: source-level guards that every step is wired and the
rail has thirteen labels; the major chips' reorder helper). Reuse: `components/activities/chips` for chips,
`HighSchoolPicker`-style comboboxes for the state and the regions type-ahead (`lib/regions` or the Explore filter's state
list: find it), `RecommenderRow` from the recommenders guide, the story guide's textarea and starters
(`lib/planner/story-guide.ts`). A guardian's story step: "Written" / "Not yet" only.

### R3 The overview, routes, header, account, people line (sonnet, wave 1, after R1a)
Owns: `components/record/{RecordOverview,RecordRow}.tsx` (new), `app/household/[person]/record/page.tsx` (new, from the
Numbers page's loader), `app/household/[person]/numbers/page.tsx` (redirect), `components/account/PersonHeader.tsx`
(Plan | Record), `app/account/page.tsx` + `components/account/ParentsCanEdit.tsx` (an `AccountSection` under Household
for a student with guardians: find the guardians the way the Numbers page did), `components/planner/PlanPeople.tsx`
(the ✎ → `recordPageHref`, label "{Name}'s record"; the ring from `recordProgress`), `app/plan/page.tsx` (`detailFrom`
reads `recordProgress`; additive), `components/me/ImportLocalProfile.tsx` (kept, placed on the overview), deletions
(`StudentNumbers`, `ProfileForm`, `CompletenessMeter`; `grep` for importers), `specs`-free. Tests
`tests/planner-record-overview.test.mts` (source-level: the redirect, the header label, the account section, the
overview's rows come from `recordProgress`, no "Open in the plan"/course/test links), `tests/planner-people-line.test.mts`.

### R4 Less text (sonnet, wave 2, after R2 and R3)
Owns: `components/ui/why-fold.tsx` (new), the per-screen edits in less-text.md's table (the tour steps' sub-lines → one
line + `?` icon with the step's `why`; `RecordOverview` lead; `ListGuide`, `InterestGuide`, `TestGuide`, `StoryGuide`,
`CoursesGuide`, `RecommendersGuide`, `EdSheet` folds), `lib/analytics.ts` (`plan_why_opened`), tests
`tests/planner-less-text.test.mts` (a guard per screen listing the file and the elements above the first control).
Content of every folded text unchanged, citations kept.

### R5 Docs (haiku, wave 3)
Mark the four record specs and the overview `> Status: **built** 2026-10-16 (PR #165)`, add "As built" sections from
this plan's final section, update `specs/planner/README.md`, remove the `record` roadmap group and entries (keep the
overview in `ROADMAP_OVERVIEWS`), `grep` for the deleted components.

## Rules for every unit agent
As [../v3/build-plan.md](../v3/build-plan.md) "Rules for every unit agent", with these paths: merge the LOCAL
`feature/plan-v3`; copy `.env.local` from `.claude/worktrees/plan-v3-build/`; shared files additively (`lib/analytics.ts`,
`lib/planner/types.ts`, `lib/student-profile.ts` beyond R1a's field, `app/plan/page.tsx`); no number from the estimate
anywhere; 390 px, 16px inputs, 44px targets; tests for the unit; `npm run verify` and `npx next build` green; commit on
the branch, don't push.

## Integration
Merge R1a and R1b (resolve `profile-progress`/`season.ts` test overlaps), verify; launch R2 and R3; merge, verify, build;
launch R4; merge, verify; R5 and QA; final verify, build, push to `feature/plan-v3` (PR #165's preview), update the PR
body with the ranking table's link and what to check by hand.

## As built by R1a (read this; it overrides the contracts above where they differ)
- **`firstGeneration` already existed** on `academics` (`StudentProfileAcademics.firstGeneration`, from
  inputs-beyond-academics.md; the estimate shows it as a note, and the old ProfileForm wrote it). No second field was
  added to `basics` (one place for a fact): the Basics step reads and writes `academics.firstGeneration`. `sanitizeProfile`,
  `emptyProfile`, and the account export (which exports the whole profile) already carry it.
- **`lib/planner/intake.ts`** (review note 1): `RecordStep` (0–14), `RecordEntryStep` (0–12), `RECORD_REVIEW` 13,
  `RECORD_DONE` 14 live here (record.ts re-exports them, so there's no import cycle); `IntakeStep = RecordStep`,
  `INTAKE_REVIEW`/`INTAKE_DONE` alias them. `intakeStepParam` takes 0–12 and returns `RecordEntryStep | null`.
  `ACTIVITY_STEP_INDEX`/`activityStepAt` unchanged.
- **The draft's new fields** (`IntakeDraft`, for R2): `majors: MajorFamily[]`, `stateOfResidence: string | null`,
  `feeWaiverEligible: boolean | null`, `firstGeneration: boolean | null` (null = "not sure" or unanswered, for both),
  `sizes: SizeBucket[]`, `settings: SettingGroup[]`, `statesOrRegions: string[]`, `types: SchoolType[]`,
  `maxAverageCost: string` (as typed), `earlyRoundInterest: EarlyRoundInterest | null`, `story: string | null` ("" for
  nothing written; null for a guardian), `storyWritten: boolean` (derived: what a guardian's step and summary show;
  not saved), `recommenders: RecommenderEntry[]`. `draftFromProfile(profile, gradYear, today, { relation? })`: a
  guardian (or a redacted profile, story text "") gets `story: null`.
- **`IntakeSave`** gains the same names as optional fields (`maxAverageCost: number | null`, `story: string | null`);
  a field left out keeps the stored value (`applyIntake` writes only what's present), so an older client can't blank
  anything. `intakeToSave` always sends them and never blocks on them (a cost that isn't a number is left out; empty
  clears it). `parseIntakeSave` runs the new fields through `sanitizeProfile` itself (a one-off profile), so the rules
  can't drift: unknown values dropped, three majors, recommenders via `sanitizeRecommenders`; it never refuses a save
  over them. A story that isn't text reads as left out.
- **`applyIntake`**: the story is kept when the save's is null/absent or the same text (so `updatedAt` survives);
  changed text goes through `sanitizeStory` dated `today`; empty clears it. **`saveTheirProfileNow`
  (lib/planner/store-plan.ts) now puts the stored story back for a guardian** before the write: a guardian's
  `profileFor` copy is redacted, so any guardian save through the plan (intake, numbers, test dates) used to write the
  story back as null. One extra read (`student_profiles.data`) on guardian saves only; the save fails rather than blank
  the story if that read fails.
- **New pure helpers in intake.ts** (for R2's steps): `maxCostOf(typed)` (null empty, NaN invalid, whole dollars
  0–400,000), `maxCostCheck(typed)` (`{ ok, hint }`, amber hint, never blocks), `MAX_COST_LIMIT`, `dollars(n)`,
  `placeLabel(place)` ("Outside the US" for `OUTSIDE_US`), `majorsSummary`, `basicsSummary(d, withFirstGeneration?)`,
  `whereSummary(d, withCost?)` (the list guide's `SIZE_CHIPS`/`SETTING_CHIPS` words), `storySummary`, `recommendersSummary`.
  `reviewLines` adds Major ("Undecided"), Basics ("Not set"), Where you'd go ("Not set"; with the cost and the early
  round), Your story ("Written"/"Not yet"), Recommenders ("Not yet"/"2 teachers, 1 asked"); its `step` is `RecordEntryStep`.
- **`lib/planner/record.ts`**: `RECORD_LABEL`, `recordTitle(firstName | null)` ("Your record" / "Jordan's record"),
  `RecordSection`, `RecordStepInfo` (`step: RecordEntryStep`), `RECORD_STEPS` (rail, headline, line, required, why),
  `SECTION_RECORD_STEP`, `SECTION_UNLOCK`, `stepSummary(draft, step)` (PlanIntake's `railSummary` plus steps 8–12; the
  component still has its own copy until R2 rewires it), `recordProgress(profile, { relation? })` →
  `{ done, total: 13, rows: { section, step, done, summary, unlock }[] }`, `recordNeeded`, `recordHref({ person, step?,
  back? })` (`/plan?for=…&record=1&step=n&back=…`; no `step` for Review), `recordPageHref(id)`.
- **`lib/planner/profile-progress.ts`** (review note 6): fourteen `PROFILE_SECTIONS` in the brief's order; `SECTION_STEP`
  maps every section to a step (its type still admits the retired `"numbers"` so `app/plan/page.tsx` and
  `moves-catalog.ts` compile; R3 can drop it). `LATER_SECTIONS` (story, recommenders) and `LATER_SECTIONS_SEASON`.
  `firstMissingSection` never returns story or recommenders, and `profile_incomplete` (season.ts, two lines) now reads
  `firstMissingSection(p) !== null`, so the profile move closes once everything else is in. `profileProgress(p, opts?:
  { season?: Season })`: `next` skips story and recommenders before `summer_before_senior`; **without a season they are
  never `next`** (callers that don't pass one today: `app/plan/page.tsx` `detailFrom`; R3 should pass `ctx.season`).
  `sectionDone("story")` uses `storyWritten` (a guardian's redacted copy counts once a story exists, the guardian
  line's own rule). `SECTION_MOVE_TITLE`: "Add a major", "Add a few basics", "Add where you'd go" (story/recommenders
  have entries but are never used). The order change means the profile move's title after the high school is now
  "Add your grades" (was courses).
- **`lib/student-profile.ts`**: `hasAnyPreference` exported; `storyWritten(profile)` added.
- **`lib/majors-search.ts`**: `MAJOR_ALIASES` (the spec's table plus a few common ones: "nurse", "pharmacy",
  "neuroscience", "psych", "politics", …), `POPULAR_MAJORS`, `searchMajors(query, exclude, limit = 6)` →
  `{ family, name, via }[]`, empty query → the popular chips not yet picked.
- **Telemetry**: `plan_intake_step.step` is 0–13; `record_major_picked { count }`, `record_overview_opened { viewer:
  "student" | "guardian" }`.
- **`PlanIntake.tsx` (kept compiling for R2)**: shows steps 0–7 and Review (13) only; a `&step=8…12` link or a Review
  Edit on a new row opens Review until R2 adds the screens. Note the profile move's "Add a major" now opens step 8 (was
  the Numbers page), so R2 must land before release.

## As built by R1b

**`lib/planner/importance.ts`** (new, pure, client-safe): `ImportanceFacts`, `DEFAULT_IMPORTANCE = 50`,
`MOVE_IMPORTANCE` (ranking.md's table, one entry per row, keyed `kind:<TaskKind>`, `playbook:<key>`, `cycle:<key>`,
`shape_gap:<variant>`, or `profile:<section>`), the season-varying rules as small functions (`storyImportance`,
`recommendersImportance`, `chooseCoursesImportance`, `reachScoreImportance`, `buildListImportance`,
`majorImportance`), `baseImportance(task, facts)`, `timingBoost(task, today)`, `importance(task, facts)`,
`compareByImportance(a, b, facts)`. `baseImportance`'s resolution order: the season-varying rules first (by kind or
playbook-key match), then the table by kind, then playbook key, then cycle key, then shape-gap variant, then —
for the catalog's own `profile` key — `firstMissingSection(facts.profile)` (from `lib/planner/profile-progress.ts`,
unchanged by this unit; R1a's richer `record.ts` section list isn't merged yet, so this reads the current eleven
sections). `DEFAULT_IMPORTANCE` otherwise. `profile:major` isn't a literal table entry; `majorImportance` (50, 60
from junior spring) covers it whenever `firstMissingSection` returns `"major"`.

**`lib/planner/importance-facts.ts`** (new, pure, client-safe): `importanceFactsFrom(ctx, view)` builds
`ImportanceFacts` from a `PlanContext` and a `PlanView`'s `rows` (deadline, round via `ROUND_SHORT`, school name),
the one shape `NextSteps.tsx`, `ParentNextSteps.tsx` (kept-but-unused, per plan-v3-fix-cards), and `app/plan/page.tsx`
(`detailFor`) all build it from, so a `reach_score` move reads the same list deadlines everywhere.

**`lib/planner/moves.ts`**: `nowMoves`'s `opts` gains a required `facts: ImportanceFacts`; the eligible set is
sorted with `compareByImportance(a, b, facts)` and a move whose `importance(t, facts)` is 0 is filtered out before
`now`/`more` are cut (not just ranked last — left out of both). `bucket` and `compareMoves` are deleted.
`eligibleNow`, `skipped`, `yourPartMoves`, `topMove`, `taskSeason`, `seasonRows`, `comingUpRows`, `parentSafeTitle`
are unchanged in shape; `seasonRows`/`comingUpRows` now require `facts` in their `opts` too (they call `nowMoves`).
Every other caller of `nowMoves`/`yourWeekTasks`/`briefContent` needed a `facts` value to keep compiling even though
they weren't the brief's "owned" files: `app/plan/page.tsx` (`detailFor`, via `importanceFactsFrom`),
`components/planner/ParentNextSteps.tsx` (via `importanceFactsFrom`), `app/api/cron/weekly/route.ts` (two call
sites: `yourWeekTasks` and the parent-summary `childMoves`; both build a minimal `ImportanceFacts` with
`profile: null` and `listDeadlines: []`, since the weekly job reads neither — `reach_score`'s "no date would count"
check can't run there, so it resolves true rather than silently hiding the move), `lib/emails/season-brief.ts`
(`briefContent`'s `opts` gains `facts`, threaded through its own two `nowMoves` calls) and its caller `sendBrief` in
the same cron route (same minimal-facts construction). `lib/planner/timeline.ts`'s `yourWeekTasks` opts gains
`facts: ImportanceFacts` for the same reason.

**Catalog (`lib/planner/moves-catalog.ts`)**: `story`'s entry moved from `junior_fall` to `summer_before_senior`
(title, why, `carries`, `applies: "story_missing"`, `kind: "story"` unchanged); `pick_recommenders`'s entry moved
from `junior_spring` to `summer_before_senior` (unchanged otherwise). `SEASON_EXPLAINER.junior_fall`'s paragraph
drops "Write your story while there's no deadline."; `SEASON_EXPLAINER.summer_before_senior`'s paragraph gains it
(appended after the existing sentence). No other explainer text changed (`junior_spring`'s "asking two teachers
before summer" line is informational prose, not the move itself, and was left as written per the brief).

**Telemetry (`lib/analytics.ts`)**: `plan_move_shown` gains `rank: number | null` (the card's 1-based position in
Now; `null` for a card outside the ranked set — Your part, a parent's rows). `MoveCardProps` (`components/planner/
moves/types.ts`) gains `rank?: number`; `MoveCard.tsx`'s mount effect sends `rank: rank ?? null`. `NextSteps.tsx`'s
`renderCard(task, rank?)` passes `i + 1` for `groups.now.map`, and no rank (`undefined` → `null`) for `yourPart.map`.
No other card in `components/planner/moves/registry.tsx` tracks `plan_move_shown` itself (only the default
`MoveCard` does), so only that one file needed the change.

**Tests**: `tests/planner-importance.test.mts` (new) — every `TaskKind` resolves to `kind:<k>` in the table or is in
an explicit `DEFAULT_ON_PURPOSE` allowlist (`reply_by`, `housing_deposit`, `cycle`, `decide_rounds`,
`waitlist_deposit_elsewhere`, `add_offer`, `withdraw`, `summer`, `playbook`, `shape_gap`, `own` — the generic kinds
resolved by key suffix rather than kind, plus the to-do kinds the brief hasn't ranked, plus `own`); `story`'s kind
is season-ruled, never the flat default; every `PLAYBOOK` key resolves (season rule or `playbook:<key>` row — none
of the current catalog's keys need the default allowlist); `timingBoost`'s four boundaries (7/14/30 days, overdue,
undated); the four season-zero rules (`story`, `pick_recommenders`/`ask_recommenders`, `choose_courses*` outside its
window, `reach_score` with no counting date); `build_list`/`long_list` and the record's major's season steps;
carried −10; `compareByImportance`'s tie order; the worked example from ranking.md (today 2026-10-16, class of
2028): the three shown and their order, then the PSAT ticked to show the interest move surfacing into Now with
"Add your clubs" next in line (`more[0]`). `tests/planner-moves.test.mts`: the old bucket-order test replaced with
an importance-order one (`kind:apply` and `kind:ed_decide`'s high base now outrank a bare `overdue`/`due soon`
built task of default importance — the old "ED window" sub-case was dropped, since importance no longer special-
cases an unopened ED window); every other test updated only to add a `facts` fixture (`factsFor`, a real cycle via
`loadCycle(cycleFor(gradYear))`, `profile: null`, `listDeadlines: []`) to its `opts`; their expected orders were
unchanged by the switch (all the planted tasks tie at `DEFAULT_IMPORTANCE`, so the same dated-first/position/title
tie-break reproduces the old `compareTasks` order). `tests/planner-season-generator.test.mts` and
`tests/planner-recommenders.test.mts`: `pick_recommenders`'s presence/absence checks moved to `summer_before_senior`
/ `junior_fall` (not `junior_spring`, since `entriesFor`/`generate` legitimately preview a season's "next" entries,
and `summer_before_senior` is `junior_spring`'s next); the story/explainer test updated for the new season and
paragraph. `tests/planner-next-steps-ui.test.mts`: the people-line regex now expects `importanceFactsFrom(ctx,
view)` and `nowMoves(..., facts)`. `tests/planner-briefs.test.mts`: every `briefContent`/`yourWeekTasks` call site
needed a `facts` fixture (same `factsFor` pattern) to keep compiling.

**Left for later / noted, not built**: `show_interest`'s importance (55 for every instance) doesn't distinguish
"important" from "considered" interest (ranking.md's 55-vs-48 split) because the season generator's
`interest.ts`/`interest-acts.ts` don't carry that distinction onto the generated `PlanTask` (no field says which
rule produced it) — flagged in the code as an R1b simplification, not fixed here since `interest.ts` isn't this
unit's file. `reach_score`'s "no date would count" rule reads `facts.profile?.tests.focus`; without a real `sat`/
`act` focus test it answers 72 rather than consulting dates (the move is only ever generated when the student is
below a real target, which implies a real focus test, per ranking.md's own note). R1a's richer profile-section list
(fourteen sections, `lib/planner/record.ts`) isn't merged yet; `profile:<section>` keys in the table use the
current eleven-section `ProfileSection` from `lib/planner/profile-progress.ts` (`state`, not `basics`/`where`/
`story`/`recommenders`) — when R1a lands, whoever merges should re-check that every new section still has a
`profile:<section>` row (`connections`, `basics`, `where` is written "`profile:state`" today and will need renaming/
adding alongside R1a's `SECTION_MOVE_TITLE` change).

## As built by R2
- **`PlanIntake.tsx` rewired**: `RAIL_LABELS` is `[...RECORD_STEPS.map(s => s.rail), "Review"]` (fourteen, the
  thirteen entry steps plus Review) and `UI_STEPS` is `[...RECORD_STEPS.map(s => s.step), INTAKE_REVIEW]`; the local
  `railSummary` is gone, replaced by `record.ts`'s `stepSummary(draft, step)` for every rail row. `REQUIRED_STEPS`
  (a `Set` built from `RECORD_STEPS.filter(s => s.required)`) replaces the old ad hoc `step === 2 || step === 6 ||
  activityStep !== null` check, so Skip (phone) and "I'll add this later" (desktop) cover every step 2–12 the same
  way; the AP step keeps its own extra "I'm not taking any AP courses" desktop link (step 2 is excluded from the
  generic "I'll add this later" so the two never show together). Steps 8–12 render `MajorStep`, `BasicsStep`,
  `WhereStep`, `StoryStep`, and `RecommendersStep`. `firstRunNote` (`mode === "first" && (step === 11 || step ===
  12)`) is passed to `StoryStep`/`RecommendersStep` as `firstRun`, which render steps.md's exact sentence under the
  headline.
- **`?record=1&step=n&back=plan|record`**: `app/plan/page.tsx` folds `record=1` into the same `setup` boolean as
  `setup=1` (record.ts's own rule: they mean the same thing) and parses `back` into `"plan" | "record"` (default
  `"plan"`), passed through `PlanFrame` (a new optional `back` prop, additive beside `setup`) to `PlanIntake` (a new
  optional `back` prop, default `"plan"`). `step` needs no server-side parsing — `PlanIntake` already reads it itself
  via `useSearchParams`. `PlanIntake` computes `closeHref` once (`back === "record" && studentId ?
  recordPageHref(studentId) : planHref({ person, tab: null })`) and both the edit-mode save and (unchanged) the
  first-run Done flow use it where the old code always went to the plan.
- **Done screen**: `DoneStep.tsx`'s headline is now `{RECORD_LABEL} is <pop>in.</pop>` ("Your record is in."), so a
  future rename of `RECORD_LABEL` moves this text with it, as the brief asks. Not listed in build-plan's R2 "Owns"
  line for this unit, but steps.md and the R2 prompt both call for it, so it's included here.
- **`MajorStep.tsx` + `MajorChips.tsx`** (new): the search input over `searchMajors`, eight common chips (hidden once
  three are picked, replaced by the cap message "Three is the most; remove one to add another."), the result list's
  muted `· {via}` alias text, and the picked list with "First choice" under the first row, ▲▼ arrows, native HTML5
  drag-and-drop (cheap over three rows), and ✕. `lib/majors-search.ts` gains `moveMajor(majors, index, dir)` (additive,
  mirrors `moveRank`), used by both the arrows and the drop handler. `record_major_picked { count }` fires on every
  pick, never on reorder or remove (majors.md only calls for it "on each pick").
- **`BasicsStep.tsx`** (new): a local combobox (`StateField`, HighSchoolPicker's shape, no network — it filters
  `lib/states.ts STATES` plus `OUTSIDE_US` locally) for state of residence; Yes/No/Not sure chips for fee-waiver
  eligible and first generation, mapped to `true`/`false`/`null`. A small `<details>`-based `InfoNote` (not a shared
  component — R4's `why-fold.tsx` is the real fold; this is a stand-in `?` icon per the R2 prompt) holds the one-
  sentence fee-waiver criteria. Decision: `null` reads as "Not sure" on a fresh draft too (the brief's own rule:
  `firstGeneration`/`feeWaiverEligible` null means "not sure or unanswered, for both"), so that chip can appear
  selected before the student has touched anything; there's no separate "untouched" state in the draft to distinguish
  it.
- **`WhereStep.tsx`** (new): size and setting chips read straight from `list-guide.ts`'s `SIZE_CHIPS`/`SETTING_CHIPS`
  (`.label`, not `.word`, for the chip text — `.word` is the list guide's own sentence-building form). A local
  `PlaceField` type-ahead (same no-network combobox shape as Basics' `StateField`) offers the 50 states, DC, the
  territories, `OUTSIDE_US`, and the six region names (`REGIONS`, a local literal copied from
  `lib/trend-groups.ts`'s own list — Northeast, Southeast, Midwest, Southwest, West, Territories — kept local since
  trend-groups.ts pulls in more than this pure step needs); each pick adds a ✕-removable chip to
  `draft.statesOrRegions`. `TYPE_OPTIONS` (public/private-nonprofit/private-forprofit) is copied from
  `ProfileForm.tsx`'s `SCHOOL_TYPES` before that file is deleted, with the shorter chip words ("Public"/"Private"/
  "For-profit") that `whereSummary`'s own word list already uses. The cost field is a single `$`-prefixed text input
  over `maxCostOf`/`maxCostCheck` from `intake.ts` (no new helpers needed); its hint is the field's own amber error
  when `maxCostCheck` isn't ok, else the steps.md hint text. Early-round chips (ED/EA/None yet) toggle off on a second
  tap, like the built test step's optional picks.
- **`StoryStep.tsx`** (new): `draft.story === null` (a guardian's draft, per R1a) renders only "Written"/"Not yet"
  (`draft.storyWritten`); otherwise the guide's own textarea, character count, and `storyStarters`/`appendStarter`
  from `lib/planner/story-guide.ts`, writing straight into `draft.story` (saved through the one `IntakeSave` at
  Review, per review note 3 — no separate save here, unlike the guide's own `saveStory` action). `majorName` (for the
  "Why {major}" starter) is computed in `PlanIntake` from `draft.majors[0]` and passed down, lowercased, matching
  `story-guide.ts`'s own convention.
- **`RecommendersStep.tsx`** (new): reuses `RecommenderRow` and `lib/planner/recommenders.ts`'s `moveRank`,
  `nextRank`, `orderRecommenders`, `setStatus` directly against `draft.recommenders`; a local `InfoNote` (same shape
  as Basics') replaces the guide's "What to think about"/"How to ask" sections with one sentence, per the prompt.
  `subjects` (the subject chip suggestions) are derived from `draft.courses` (the AP picker's `IntakeCourse[]`, not
  the full saved `CourseEntry[]` the guide's `subjectsFrom` expects) via a small inline `catalogCourse(c.key)?.name`
  map rather than reusing `subjectsFrom` itself — the intake draft doesn't carry enough of a `CourseEntry` to satisfy
  that function's type honestly. `canInvite` is computed once in `PlanIntake` (`seasonRank(ctx.season) >=
  seasonRank("senior_fall")`) and passed down, rather than threading `ctx` into the step component.
- **`ReviewStep.tsx`**: unchanged — it already rendered every row `reviewLines` produces (R1a's steps 8–12 rows
  included), and `onEdit` already worked once `UI_STEPS`/`shownStep` covered 0–12 directly instead of collapsing them
  to Review.
- **Tests**: `tests/planner-intake-ui.test.mts` (new) — source-level guards (regex over `PlanIntake.tsx`'s own
  source, the pattern `tests/planner-ed-dialog.test.mts` already uses) that the rail is built from `RECORD_STEPS`
  rather than a hardcoded list, that every step 0–12 has a rendered branch (direct `step === n` for 0, 1, 2, 6, 8–12;
  `activityStepAt` for 3, 4, 5, 7), and that the edit-mode save path reads `back` rather than a hardcoded
  `planHref`; each guard has a planted-bad-case test proving it isn't vacuous. `moveMajor` (pure) is tested directly.
  Ran alongside `tests/planner-intake.test.mts`, `tests/planner-record.test.mts`, `tests/majors-search.test.mts`,
  `tests/planner-recommenders.test.mts`, `tests/planner-story-guide.test.mts`: 116 passing.
- **Left for later units**: R4's real "why" fold (`components/ui/why-fold.tsx`) replaces the stand-in `InfoNote`
  `?` icons added here (Basics' fee-waiver note, Recommenders' advice note) and folds each step's `why` line from
  `RECORD_STEPS`; this unit didn't add that fold mechanism itself, only the two one-off `?` icons the prompt called
  for directly. Drag-and-drop on `MajorChips` has no touch-drag fallback on a phone (only the arrows do there,
  which is sufficient since `draggable` doesn't fire on touch); not treated as a gap since the prompt only asked for
  drag "where cheap" and arrows cover every width.
