# The Plan's Intake Guide

> Part of the [planner redesign](README.md). Written 2026-10-11 from the owner's Claude Design handoff ("Plan
> Redesign": screens 1a and 2a, the intake guide). Replaces the first-time setup card (`FirstTimeSetup`) and the
> header card's grad-year prompt. Rules live in `lib/planner/intake.ts` (pure); the one save is `saveIntake` in
> `lib/planner/store-plan.ts`; the UI is `components/planner/intake/PlanIntake.tsx`. Tests:
> `tests/planner-intake.test.mts`.

## When it shows
- **First run**: `/plan` shows the guide instead of the plan (tabs and all) when `intakeNeeded(ctx)`: the student has
  no grad year, or has neither a GPA nor a test choice (`tests.focus`) yet. Never for a guardian's own list (no
  student), and only for a viewer who can edit; a read-only guardian with no numbers sees the plan with "No numbers
  yet".
- **Edit mode**: the ✎ on the plan's numbers line links to `planHref({ person, setup: true })` (`/plan?…&setup=1`).
  The guide opens at Review with everything prefilled (`draftFromProfile`), has no Done screen, and returns to the plan
  after saving.

## Steps
One question per screen, four steps and a Done screen (`IntakeStep` 0–4). Nothing is written until the last step.

| Step | Headline | Asks |
|---|---|---|
| 0 Grades | "Start with your grades" | Class of (chips), GPA (one field, scale detected) |
| 1 Test | "Your test score" | SAT or ACT or neither; the score; practice; an optional target |
| 2 AP courses | "Your AP courses" | Courses taken, taking now, or planned; Skip jumps to Review |
| 3 Review | "Look right?" | One row per answer with Edit (jumps to its step); "Save and show my plan" |
| 4 Done | "Your numbers are in." | First run only: "Add your first college" |

### Grades
- **Class of**: four chips starting at the current senior class (`classYearOptions`: from July on, next year's
  seniors; on 2026-10-11 that's 2027–2030). A stored grad year outside those four shows as a fifth chip so it's never
  lost.
- **GPA**: typed the way the transcript shows it. The scale is detected (`detectScale`): empty or above 10 →
  100-point scale; above 4 up to 10 → 5.0 weighted; up to 4 → 4.0 scale. The student can pick a scale, and that pick
  wins and sticks (`scaleOverride`). The three scales map to the profile's `GpaScale`: `"100"`, `"4.0"`, `"5.0"`.
- **Valid** (`gpaCheck`): 100-point 40–120 (over 100 is fine: many schools weight honors and AP above 100; the band
  table reads 97 and up as a 4.0), 4.0 up to 4.0, 5.0 up to 5.0. Continue waits for a valid GPA and a class.
- **Hints**: empty "Enter it the way your transcript shows it. We'll work out the scale."; detected "Looks like a
  {scale}. Change it if that's wrong."; picked "Using a {scale}."; errors (amber, never red) "On a 100-point scale,
  enter a number like 92.5. Over 100 is fine." / "On a 4.0 scale, GPA goes up to 4.0." The scale button's caption is
  Default (empty), Detected, or Scale (picked).
- `gpaMaxFor("100")` is 120 everywhere a GPA is checked: the profile's sanitizer and the numbers form's `parseNumbers`.
  The estimate's request takes the GPA already converted to 4.0, so its bound doesn't change.

### Test
- One test (the plan's rule): SAT, ACT, or "I'm not taking either test" (`tests.focus` `"none"`). Switching tests
  clears the score and the target.
- **Score** (`scoreCheck`): a whole number, SAT 400–1600, ACT 1–36. Required when testing. Hint "Your best single
  sitting."; error "SAT scores run from 400 to 1600." / "ACT scores run from 1 to 36."
- **Practice** checkbox: `tests.practice`.
- **Target score** (`targetCheck`), optional: out of range → the range message (amber, blocks Continue); at or below
  the current score → "That's at or below your current score." (allowed); else "We'll show which colleges a {n} would
  move." Stored as `tests.target`, kept only within the focus test's range, cleared when the focus test changes (here
  or in the numbers form, `applyNumbers`) or is "none".
- The target never feeds the grouping: it drives the Scores tab's "A {target} would move N colleges up a group", read
  from each row's existing move-up (rows whose `moveUp.score ≤ target`).

### AP courses
- **Search** (`searchAp`): with no query, the popular courses (`POPULAR_AP`, the design's eight; later popular ones
  fill in as earlier ones are added); with one, every AP course whose name or aliases contain it, A–Z, up to 10.
  Aliases are the catalog's own (`data/reference/ap-courses.json`) plus the design's search words (apush, calc, lang,
  lit, csp, csa, euro, hug, whap, apes, gov, physics), which live in `intake.ts`, not the catalog: several are
  ambiguous ("calc", "gov", "physics" name more than one course), and the catalog's aliases map a printed course name
  to exactly one course (`apKeysForName`). Courses already added never appear. Names are the design's short ones
  (`apName`: "US History", "Physics C: E&M"); the UI prefixes "AP".
- **Each course asks one thing**: Took it → the exam score (5, 4, 3, 2, 1, Not back yet); Taking / planned → when
  (`termOptions`): for each school year from this one until graduation, "Full year" (this year) or "Full year 27–28",
  "Fall 2026", "Spring 2027". Picking collapses the card; its pill reads "Score 4", "Score pending", "Spring 2027",
  or "Choose" while incomplete (`courseSummary`).
- A guardian looking at a student who keeps AP scores private (`apExamsPrivate`) sees "Score hidden" instead of the
  score chips for a taken course (`courseSummary(…, { examsHidden: true })`).
- AP courses never block Continue. A course with nothing picked isn't saved.

### Review and saving
- Review lists Class, GPA ("3.82 · 4.0 scale"), Test ("SAT 1390 (practice) · aiming for 1450" / "Not testing"), and
  AP courses ("2 taken · 1 taking or planned" / "None") (`reviewLines`). Save needs the grades and test steps valid.
- **One save** (`intakeToSave` → `saveIntake`): the server checks everything again (`parseIntakeSave` refuses the
  whole save on any bad value: a class year outside the profile's window, a GPA outside its scale, a missing or
  out-of-range score, a target without a test or out of range, a course that isn't an AP catalog course, an unknown
  exam or term, a course listed twice), then `applyIntake` and the usual profile save.

## Mapping to the profile (`applyIntake`)
- `basics.gradYear` = the class. `saveProfile` keeps `students.grad_year` in step (the column `setGradYear` writes),
  and the follow-up regenerates every list's tasks.
- `academics.gpa` and `gpaScale`; `tests.focus`, the focus test's score (`satTotal` or `actComposite`; the other
  test's score is kept), `practice`, `target`.
- **AP courses** replace the profile's AP rows that have a catalog key; every other row (IB, dual enrollment, honors,
  regular, and unnamed placeholder AP rows from the count-only entry) is kept untouched, in place:
  - **Took it** → `status: "taken"`, `exam` 1–5 or null ("Not back yet"), `year` = the most recently finished grade
    (current grade − 1, clamped 9–12; 9 for a student in 9th). A row that was already taken keeps its year.
  - **Taking / planned** → a term chip for school year Y–Y+1: `year` = 12 − (class − (Y+1)), clamped 9–12;
    `status` = `"in_progress"` for this school year, `"planned"` for a later one; `CourseEntry.term` = `"full"`,
    `"fall"`, or `"spring"` (an optional field; absent means null).
  - A course the student didn't change keeps its saved row exactly (grades and all); a changed one keeps its grades
    (a planned course drops its final grade, as the sanitizer always does).
  - `courseRigorCount` follows the list (never re-adds placeholder rows for removed courses).
- **A guardian's save** goes through `mergeCoursesForSave`: their copy of the profile has no exam scores while the
  student keeps them private, so the saved scores are put back by course id and the privacy switch stays as saved.
- `draftFromProfile` reads it back: AP rows with a key become courses (taken → its score or "pending"; in progress or
  planned → its year's term chip), a GPA's saved scale becomes the override only when detection would pick another (a
  GPA above 4.0 saved on the 4.0 scale is weighted by definition and opens on 5.0 weighted), and with no focus test
  but one score on file, that test. Saving an unchanged draft gives back the same profile.

## Groups
Groups are Quad's only (owner, 2026-10-11; the design's "no group override"): `planView` ignores
`category_source === "student"` (group = the estimate's group, else the stored group until an estimate arrives;
`groupAuto` is always true), and `autoWrites` rewrites a stored student group to the model's and sets
`category_source` back to `auto`, so stored data converges. The `setGroup` action, the group chip, "Use the
suggestion", and "✦ = sorted for you" are gone. A signed-out plan's local group picks aren't imported on sign-up.
Rounds are unchanged: still the student's own once picked.

## Not here
- How Quad sorts colleges (proprietary; see [../../chances/README.md](../../chances/README.md)). The guide asks for
  kinds of inputs only.
- Whether AP courses or the target score should feed the grouping (the design's open question): not yet; the target
  drives only the Scores tab's line.
