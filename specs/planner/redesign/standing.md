# Standing: Numbers First, One Test, and Groups Sorted for the Student

> Status: **built** 2026-10-10 on feature/plan-redesign ([build plan](build-plan.md)). Part 2 of the [planner redesign](README.md). Implements the rules of
> [chances-and-fit.md](../../product/chances-and-fit.md) (planned since 2026-10-02) in the form the planner needs, and
> replaces stage 1's "Suggested" chip ([../list-building.md](../list-building.md#suggested-category)) with groups that
> start sorted. The pure model is drafted in `lib/planner/standing.ts` with tests in
> `tests/planner-standing.test.mts`, used by the preview.

## Goal
Ask for three things (GPA, which test, the score) and sort every college on the list into Reach, Target, or Likely
from them, so a student who adds eight colleges sees a sorted list without doing the sorting. The student can change
any group with one tap; the site never overrides that choice.

## The numbers
The numbers form, in the plan's header card and on the first-time setup:

| Field | Input | Stored as |
|---|---|---|
| GPA | number, two decimals, with the scale (4.0 / 5.0 / 100) behind "Different scale?" | `academics.gpa`, `academics.gpaScale` (built) |
| Which test | segmented: **SAT · ACT · Not testing** | new `tests.focus: 'sat' \| 'act' \| 'none' \| null` |
| Score | a slider plus a number box (SAT 900–1600 by 10, ACT 15–36) | `tests.satTotal` or `tests.actComposite` (built) |
| It's a practice score | checkbox, shown until a real score is entered | new `tests.practice: boolean` (a PSAT or practice test counts; the PSAT's 1520 scale reads as SAT) |

- Hint under the test choice: "Most students pick one and work on it. If you haven't taken it yet, use a practice
  score."
- A student with both scores on file is asked once which one they're working on; the other stays in their numbers
  (section scores, superscore flag) and is never used by the plan. Switching tests keeps both stored values.
- "Not testing" sets `tests.focus = 'none'` and the plan uses GPA alone; it replaces the old "I plan to apply
  test-optional" checkbox for the plan's purposes (`plansTestOptional` stays for the profile's other readers).
- The class year and state are already on the student record and household; the setup asks for the class year only
  when it's missing (as the Plan tab does today).
- The full `/me` and Numbers pages keep every other field (section scores, rank, rigor, weighted GPA, preferences);
  the plan never asks for them.
- Every change re-runs the model at once in the browser (the functions are pure), so the student watches the list
  re-sort as they drag the slider.

## The rules
`standingFor(student, school)` in `lib/planner/standing.ts`. Inputs: the student's unweighted GPA on 4.0 and their one
test; the college's admit rate, SAT total and ACT composite 25th–75th, average first-year GPA (only when unweighted;
CDS C12), and test policy (IPEDS ADMCON7).

1. **Score position**: `below` the 25th percentile, `in` the middle 50%, `above` the 75th. If the college reports
   only the other test's range, the score is converted with the 2018 ACT/SAT concordance (ACT composite → SAT total
   table; SAT → the ACT whose concorded SAT is nearest, within 40 points) and the reason says so.
   - **Test-blind** (policy "not considered"): the score isn't used.
   - **Test-optional** (policy "considered" or unknown) and the score is below the range: the score is assumed
     withheld (it neither helps nor counts) and the row says "Optional here: consider not sending". When there's no
     GPA to judge by, the withheld score is still the only measure and is used.
   - Required or recommended: always used.
2. **GPA position**: `above` if more than 0.15 over the college's average, `below` if more than 0.15 under, else `in`.
   Only when the college reports an unweighted average; many don't, and then GPA isn't used for that college.
3. **Group**, from the known positions:
   - No admit rate on record (open admission): **Likely** ("Admits everyone who applies").
   - Admit rate under 20%: **Reach**, shown as "Reach for everyone", whatever the numbers.
   - Every position `above`: **Likely** at 50%+, else **Target**.
   - One `above` and one `in`: **Likely** at 60%+, else **Target**. (Added 2026-10-09: without it, a student well
     above a 63%-admit college's scores came out Target because their GPA was merely "close to" the average.)
   - Any `below`: **Reach**, unless the admit rate is 70%+ and not every position is below, then **Target**.
   - Otherwise (`in`, nothing below): **Likely** at 70%+, else **Target**.
   - No known position: no group; the chip says "Add a number".
4. **Reasons**: plain sentences with the numbers used, e.g. "Your SAT 1390 is below the middle 50% of enrolled
   students. Scores are optional here; you might apply without yours." Each value is cited with its edition (the
   score range's ⓘ, the policy's ⓘ). No admit rate is shown on the list row; it appears in the reason only for the
   two admit-rate rules.

Thresholds live in one `STANDING` constants object; tests pin the examples:

| Student | College | Group | Why |
|---|---|---|---|
| SAT 1450 | Admit 6%, SAT 1500–1560 | Reach (for everyone) | Under 20% |
| SAT 1450 | Admit 45%, SAT 1280–1450 | Target | Inside, under 50% |
| SAT 1450 | Admit 78%, SAT 1100–1300 | Likely | Above, 50%+ |
| ACT 24 | Admit 40%, ACT 28–33, test required | Reach | Below |
| No test, GPA 3.9 | Admit 35%, average GPA 3.7 | Target | GPA above, under 50% |
| SAT 1390, GPA 3.82 | Admit 63%, SAT 1170–1350, average GPA 3.88 | Likely | Above and in, 60%+ |
| SAT 1200, GPA 3.8 | Test-optional, admit 45%, SAT 1280–1450, average GPA 3.75 | Target | Score withheld; GPA in |

When [chances-and-fit.md](../../product/chances-and-fit.md) is built (local outcomes from
[scattergrams.md](../../product/scattergrams.md), in-state rates from the residency grid), it replaces this module's
internals behind the same `standingFor` signature; the plan doesn't change.

## Suggested until changed
- `list_items.category` stays the stored group. New column `list_items.category_source: 'auto' | 'student'`
  (default `'auto'`).
- While `auto`, the stored category is whatever the model says: recomputed when the numbers change, when a college's
  data changes at a publish, and when a college is added. The chip shows ✦ ("sorted for you").
- A tap on the chip cycles Reach → Target → Likely and sets `category_source = 'student'`. From then on the model
  never writes that row; the ⓘ shows "You picked this group" and **Use the suggestion** (sets it back to `auto`).
- A college with no group from the model stays `unsorted` ("Add a number") until the student adds one or picks.
- A parent with edit access can change a group too; the change is attributed (`updated_by`, built) and also becomes
  `student` source.
- Migration: existing rows with a category the student chose (anything but `unsorted`) become `student`; `unsorted`
  rows become `auto` and are sorted on the next plan open.

## First-time setup
Two steps, one card, shown in place of the tabs the first time a student opens Plan (or when the numbers are empty):
1. **Start with your numbers.** The form above. "We use them to sort your colleges into Reach, Target, and Likely.
   You can change any of it later."
2. **Is there a Dream school?** The list with a heart on each row: "The one you'd pick over all the others today. If
   it has an early decision round, your plan starts it there. Skip it if there isn't one yet." (`list_items.dream`,
   built; one per list.)

Then **Show my plan** opens the Colleges tab with every group and round marked ✦. A student with no colleges yet does
step 1, then gets the empty list with search.

## Rules
- The model never shows a probability or a percentage chance.
- A group the student set is never changed by the site.
- "Reach for everyone" appears in the reason, not as a separate chip; the chip says Reach.
- Telemetry: `plan_numbers_set {test: sat|act|none, practice}`, `plan_group_changed {from_auto}`; never a score.

## Files (planned)
`lib/planner/standing.ts` (drafted), `tests/planner-standing.test.mts` (drafted); migration
`…_plan_redesign.sql` (`category_source`, `round_source`, and `student_profiles` needs nothing: `tests.focus` and
`tests.practice` are fields in the JSON document); `lib/student-profile.ts` (the two fields, validation, the
one-test reader `planTest(profile)`); `components/planner/NumbersForm.tsx`, `FirstTimeSetup.tsx`; the regenerate
step in `lib/planner/context.ts` writes `auto` categories alongside tasks.

## Open questions
1. Should a practice score be visibly marked on the chips ("based on a practice score")? Recommendation: once, in the
   header card ("SAT 1300 · practice"), not on every row.
2. The concordance predates the digital SAT and the enhanced ACT. Recommendation: use it, say "through the official
   concordance" in the reason, and swap tables when College Board and ACT publish new ones.
