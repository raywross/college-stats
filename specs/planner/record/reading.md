# Part 5, How Quad Reads Your Record

> Status: **built** 2026-10-16 (PR #165). Reads the estimate ([../../chances/estimate.md](../../chances/estimate.md) "What
> families see"; `lib/chances/what-went-in.ts`) on the record overview ([steps.md](steps.md)) and beside every college
> offered for the list ([../v3/guides/list-size.md](../v3/guides/list-size.md), the add-college search). Part 5 of
> [Your record](README.md). The owner: "Score the current student calculation on the record and recalculate it as they
> add things to their profile. When they're looking at schools they'd see how we currently think about their prospects
> based on what they've entered. That would be really helpful on the screen where we help them add schools to their list."

## Goal
The estimate already reads the record on every plan load and sorts each listed college into a level. Two things are
missing: the record never says **what the estimate is working from** right now (so a student doesn't know that adding
courses or activities changes the read), and a college the student is *about to add* carries no level until it's on the
list. This part adds both, and keeps the rule that nothing about *how* the level is computed ever shows: inputs and
outputs only.

## On the record overview
Under "How complete is this", one section:

```
HOW QUAD READS YOUR RECORD RIGHT NOW                                                       ⓘ
 Working from: your GPA (3.7, unweighted), your SAT (1350), 4 AP courses, your activities.
 Not yet: your intended major (sharpens the read at colleges that admit by major).
 Your list today: 1 Likely · 3 Targets · 4 Reaches · 1 High reach.          Build your list →
```
- **Working from**: the inputs the estimate used on the student's own list (`yourNumbersList` over the `InputKind`s the
  estimates' notes mark as used; the plan's `estimates` are already computed for the overview's student: load them the
  way `/plan` does, or read the stored `category` of each list row plus `promptedInput`). Plain words, the student's
  own numbers (never a parent's view of the score: a guardian sees the same list, as the Numbers page did, since the
  owner decided guardians see the student's numbers).
- **Not yet**: the most useful missing input (`mostUsefulMissing(estimates)`, built) as one sentence from the note
  catalog, with a link to the record step that supplies it.
- **Your list today**: the level counts (`countLine`'s inputs) and a link to the Build your list guide. Empty list:
  "Add a college and Quad sorts it as you go."
- An empty record (no grades, no test): "Quad needs your grades and a test choice to read your record." with Fill it in.
- The ⓘ opens the built "What went into this estimate" explanation (`panelParts`): kinds of inputs, never weights.
- **Recalculated as the record changes**: the overview is server-rendered from the current profile; a save in the tour
  returns here (`back=record`) and the page re-renders, so the section is always the current read. No stored score.

## Beside a college you might add
- **The add-college search** (`components/planner/AddCollegeBox.tsx`, the Colleges tab and the list guide's "Search any
  college"): each result row gains the level chip ("Target for you") from a live estimate of the typed results, fetched
  once per result set through `POST /api/plan/levels` `{ studentId, unitIds }` → `{ [unitId]: StandingLevel | null }`
  (server: `loadPlanFor` for access, `estimateMany` with the plan's hooks, the level only; ≤ 12 ids per call). "Not
  sorted yet" when the record has no grades or test (the chip says "Add your grades to sort" and links the record).
- **The list guide's cards** already carry the level; unchanged.
- **The college page's standing card** (signed in) already reads the record; unchanged, except the "Add your grades"
  prompt links the record instead of the old Numbers page.
- **Explore**: not in this part (its own fit chips exist; an estimate per row of a 1,900-college grid is another spec).

## Rules
- Inputs and outputs only: the words name what the estimate read and the level it gave, never a weight, threshold,
  percentage, multiple, or closeness (`tests/chances-client-guard.test.mts` and the catalog guard).
- The level chip uses the same words and colors as the list (`GROUP_CLASS`, "Target for you").
- Telemetry: `record_reading_shown { inputs: number, missing: boolean }`, `plan_add_level_shown { level }`; never a
  college.

## Files
`components/record/RecordReading.tsx` (server), `lib/planner/record-reading.ts` (pure: `readingLines(estimates,
student, profile)` over `yourNumbersList`, `mostUsefulMissing`, the level counts), `app/api/plan/levels/route.ts`,
`components/planner/AddCollegeBox.tsx` (the chip, the fetch), `components/chances/StandingCard.tsx` (the record link),
`lib/analytics.ts` (additive). Tests: `tests/planner-record-reading.test.mts` (the lines for a full record, a bare one,
an empty list; no number from the estimate in any string), `tests/planner-levels-route.test.mts` (the cap; access
denied → 404; levels only in the response).

## Open questions (answered)
1. Should the add-college results also show the chip for a signed-out visitor with local numbers? Recommendation: not
   now (the local plan is read client-side; the estimate runs on the server).
   **Adopted: signed-out plan left for later.**

## As built by R6
- Record Reading section on overview under "How complete is this" shows working-from inputs, missing input, and list count breakdown
- `readingLines` pure function reads inputs from estimate notes via `InputKind` union and maps missing inputs to record sections
- "activities" input maps to Sports section (first activity step) as a tie-break choice
- Level chip on add-college search results with "sorted" fallback when profile has no grades or test
- `/api/plan/levels` route caps at 12 colleges, returns levels dict and sorted flag; 404 for inaccessible student
- AddCollegeBox sends levels fetch on each result set and shows chip at right of college row (name/city truncate first)
- StandingCard "Add your numbers" link now targets record page directly (via `studentId`)
- `record_reading_shown` and `plan_add_level_shown` telemetry track what inputs are used and what levels appear
