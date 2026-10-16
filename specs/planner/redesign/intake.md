# The Plan's Intake Guide

> Part of the [planner redesign](README.md). Written 2026-10-11 from the owner's Claude Design handoff ("Plan
> Redesign": screens 1a and 2a, the intake guide). Replaces the first-time setup card (`FirstTimeSetup`) and the
> header card's grad-year prompt. Rules live in `lib/planner/intake.ts` (pure); the one save is `saveIntake` in
> `lib/planner/store-plan.ts`; the UI is `components/planner/intake/PlanIntake.tsx`. Tests:
> `tests/planner-intake.test.mts`.
>
> **Updated 2026-10-11 (owner feedback on the built guide):** the high school picker moved onto the Grades step
> (it only lived on `/me` before); the AP step asks one question — which of the student's four high-school years —
> instead of a status pick plus a separate "When?"; a guardian can now pick an AP exam score for a taken course even
> while the student keeps scores private (`mergeCoursesForSave`).

## When it shows
- **First run**: `/plan` shows the guide instead of the plan (tabs and all) when `intakeNeeded(ctx)`: the student has
  no grad year, or has neither a GPA nor a test choice (`tests.focus`) yet. Never for a guardian's own list (no
  student), and only for a viewer who can edit; a read-only guardian with no numbers sees the plan with "No numbers
  yet".
- **Edit mode**: the ✎ on the plan's numbers line links to `planHref({ person, setup: true })` (`/plan?…&setup=1`).
  The guide opens at Review with everything prefilled (`draftFromProfile`), has no Done screen, and returns to the plan
  after saving.

## Steps
One question per screen, nine steps and a Done screen (`IntakeStep` 0–9; `INTAKE_REVIEW` 8, `INTAKE_DONE` 9). Nothing
is written until the last step. The single optional "More about you" step (U3, 2026-10-12) became four optional
activity steps after AP courses (U13, 2026-10-12; owner: "sports and clubs their own items… autocomplete similar to
the way we did APs… work and internships its own screen… other stuff as the last screen"), see
[Activities, four steps](#activities-four-steps).
**(Plan v3, 2026-10-16: step 6 Connections added; Other → 7, Review → 8, Done → 9; see [../v3/connections.md](../v3/connections.md).)**

| Step | Headline | Asks |
|---|---|---|
| 0 Grades | "Start with your grades" | Class of (chips), GPA (one field, scale detected), high school (optional) |
| 1 Test | "Your test score" | SAT or ACT or neither; the score; practice; an optional target |
| 2 AP courses | "Your AP courses" | Which year for each AP course (a score once that year is over); Skip jumps to the next step |
| 3 Sports | "Your sports" | Optional: type-ahead over the sports catalog; per year a level (JV · Varsity · Captain, more behind "More…"); hours a week in season; recognition |
| 4 Clubs | "Clubs and organizations" | Optional: type-ahead over the clubs catalog (acronyms: DECA, HOSA, MUN) or a typed name plus a one-tap "What's it about?"; a title per year; recognition |
| 5 Work | "Work and internships" | Optional: jobs, internships, research positions, family responsibilities, as typed; type, hours, a role per year |
| 6 Connections | "Your college connections" | Optional: add colleges (search or list), pick family relation (parent, grandparent, sibling) and recruiting status |
| 7 Other | "Anything else?" | Optional: awards (type-ahead over the awards catalog), then volunteering, projects, anything else |
| 8 Review | "Look right?" | One row per answer with Edit (jumps to its step); "Save and show my plan" |
| 9 Done | "Your numbers are in." | First run only: "Add your first college" |

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
- **High school** (owner feedback, 2026-10-11): the same picker as `/me` (`components/high-schools/HighSchoolPicker`),
  under "Class of"; optional, prefilled from `basics.highSchool`/`highSchoolId`. Picking a result fills both; typing
  without picking saves the free-text name and clears a previous pick, same as the picker's own behavior inside the
  `/me` form. Review shows a "School" line (Edit → Grades).

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
- **Each course asks one thing** (owner feedback, 2026-10-11 — "Might be easier to just list as freshman, sophomore,
  junior, and senior then store as years behind the scenes"): "Which year?" — four chips, Freshman through Senior,
  the school year under each once a class is picked (`yearOptions`; "24–25" from `classYear`; grade names only
  without one). Picking a year collapses the card unless it also asks for a score (below) and none is chosen yet.
  AP exams are scored 1–5, so a year whose school year is already over then asks "Your exam score": 5, 4, 3, 2, 1,
  or "Not back yet". `IntakeCourse` stores the pick directly — `year: 9 | 10 | 11 | 12 | null` and `exam` — never a
  status or a term: whether a year reads as taken, in progress, or planned always derives from the year, the class,
  and today (`yearStatus`), so it can't drift from what was actually picked. The card's pill (`courseSummary`):
  "Junior · Score 4", "Sophomore · Score pending" (a past year), "Senior year" (a future one), "Taking now" (this
  year), or "Choose" (incomplete).
- A guardian sees the saved scores and picks them exactly like the student (owner, 2026-10-11: scores are never
  private from parents).
- AP courses never block Continue. A course with no year picked isn't saved.

### Activities, four steps
Rules in `lib/planner/activity-steps.ts` (pure); cards in `components/activities/` (`ActivityStepEditor`,
`ActivityCard`, `YearTitles`, `AwardsEditor`), shared with `/me`'s Activities and Awards groups
(`components/me/ActivitiesForm.tsx`, `AwardsForm.tsx`); the intake screen is `components/planner/intake/ActivitiesStep.tsx`.
Modeled on the AP step: on desktop the list sits beside a search panel, on a phone the search is under the list.
- **Every step is optional**: Skip in the phone header, "I'll add these later" on desktop, and Continue never waits.
- **One list**: the draft holds every activity in `activities` (and awards in `awards`); each step shows the entries
  `stepOfActivity` gives it: sport → Sports; club and arts → Clubs; a catalog research or service entry (Science
  Research Program, Key Club) → Clubs; typed research, work, and family → Work; typed service (volunteering) and
  other → Other. Deterministic, so entries saved on `/me` or by the old form land on one step.
- **Adding**: Sports and Clubs search their catalog (`searchStep`; popular chips before anything is typed; Enter adds
  an exact acronym or name, else the first match, else the typed name) and always offer "+ Add “…”" for a name that
  isn't listed. Work and Other take a name plus quick chips ("Part-time job", "Internship", "Research position",
  "Family responsibilities"; "Volunteering", "Independent project"). The new card opens and finished ones fold, so
  several can be added without leaving the list. A typed entry's type is guessed from its words ("lab" → research,
  "babysitting" → family, "volunteer" → volunteering) and is one tap to change.
- **Card**: collapsed, the name and a pill ("3 years · Captain", "Pick years"); open, the name (editable), "What's it
  about?" for a typed club (`CLUB_FAMILY_PICKS`: an arts pick makes it an arts entry), the type for Work and Other,
  the four year chips (one tap on or off, with the school year under each once the class is known), a title per
  checked year from `titlesFor(kind)` (the common ones first, the rest behind "More…"), hours a week (1–60; "in
  season" for a sport), recognition (None · School · State or regional · National, worded per step; none for Work),
  and "Connected to the major I want to study" (not on sports). Nothing is required.
- **Smart defaults**: a newly checked year takes the title of the nearest earlier checked year (else the nearest
  later, else the kind's first title: JV, Member, Employee); a job named as an internship starts as Intern.
- **Stored** as `ActivityEntry`: `kind`, `catalogKey` and `family` (from the catalog, or the family pick), `titles`
  per year with `roles` derived by `roleForTitle`, `hoursPerWeek`, `recognition`, `relatedToMajor`. The profile's
  sanitizer takes kind and family from the catalog for a catalog key, keeps a title only for a checked year and only
  when the kind offers it (and sets that year's role from it), and writes the three new keys only when set, so rows
  saved before them read back unchanged. At most `ACTIVITIES_MAX` (20) activities across all four steps and
  `AWARDS_MAX` (6) awards.
- **Awards** (Other step): `searchAwards` over data/reference/awards.json (popular first; nicknames such as "nmsf",
  "eagle", "pvsa"); a catalog award carries its tier; a typed one starts at School and has a level pick; a one-tap
  year, optional.
- **None** (owner, 2026-10-12): each of the four steps opens with a one-tap **None** chip, stored as
  `academics.activitiesNone` (`{ sports?: true; clubs?: true; work?: true; other?: true }`, sanitized by
  `sanitizeActivitiesNone`; a profile saved before it reads as `{}`, every step unanswered). Choosing None clears that
  step's entries (and, on Other, its awards) after a confirm when there are any; tapping it again un-answers the step.
  Adding an entry clears that step's None (`reconcileStepNone`, applied in the step and again in `intakeToSave` and
  `parseIntakeSave`). Review and the desktop rail say "None" only when chosen; an empty, unanswered step reads "Not
  added". Skipping a step is not None. The people line's progress ring counts a step done with an entry or None.
  When all four steps are answered, entries or None, `estimateInputFromProfile` sends `activitiesAnswered: true` and
  the estimate reads activities as answered for completeness (method/standing.md "Revision 1"), so a student with
  truly no activities isn't counted as a gap; the activities list stays empty, so there's no depth credit.

### Scrolling (owner, 2026-10-12)
"When you move from step to step or if you add something like a sport or activity, it should bring you back to the
top of the screen." A step change scrolls the page to the top and moves focus to the step's heading (for screen
readers); adding an entry (a sport, club, work entry, other activity, award, or AP course) scrolls the step's top, its
search box included, into view, at every width. Smooth, or instant under `prefers-reduced-motion`. Removing or editing
an entry doesn't scroll, and neither does opening the guide (`lib/planner/intake-scroll.ts`; `useIntakeScroll` in
`PlanIntake.tsx`).

### Review and saving
- Review lists Class, GPA ("3.82 · 4.0 scale"), Test ("SAT 1390 (practice) · aiming for 1450" / "Not testing"),
  AP courses ("2 taken · 1 taking or planned" / "None"), and one line per activity step: Sports, Clubs, Work (the
  names, "Soccer, Track and Field +1 more", or "None") and Other ("2 awards · Food bank volunteer") (`reviewLines`). Save needs the grades and test steps valid.
- **One save** (`intakeToSave` → `saveIntake`): the server checks everything again (`parseIntakeSave` refuses the
  whole save on any bad value: a class year outside the profile's window, a GPA outside its scale, a missing or
  out-of-range score, a target without a test or out of range, a bad high-school id, a course that isn't an AP
  catalog course, an unknown exam or year, a course listed twice), then `applyIntake` and the usual profile save.

## Mapping to the profile (`applyIntake`)
- `basics.gradYear` = the class. `saveProfile` keeps `students.grad_year` in step (the column `setGradYear` writes),
  and the follow-up regenerates every list's tasks. `basics.highSchool`/`highSchoolId` = the picker's pick (or the
  free-typed name), checked by `parseIntakeSave` the way the profile's own sanitizer checks them (a string up to 200
  characters; an id that's a real NCES or PSS id, `isHighSchoolId`) — a bad id refuses the whole save, like a bad
  GPA; an overlong free-typed name is just dropped, the sanitizer's own leniency for free text.
- `academics.gpa` and `gpaScale`; `tests.focus`, the focus test's score (`satTotal` or `actComposite`; the other
  test's score is kept), `practice`, `target`.
- **AP courses** replace the profile's AP rows that have a catalog key; every other row (IB, dual enrollment, honors,
  regular, and unnamed placeholder AP rows from the count-only entry) is kept untouched, in place. The picked year
  (`IntakeCourse.year`) becomes `CourseEntry.year` directly, and `status` is always `yearStatus(year, class, today)`
  — `"taken"` (that school year's over), `"in_progress"` (this one), or `"planned"` (later) — worked out fresh on
  every save, never carried over from what the row used to say. `exam` is kept only when the row comes out `"taken"`
  (1–5, or null for "Not back yet"); a year that doesn't drops whatever exam was chosen for a previous pick.
  `CourseEntry.term` is always cleared now that there's no term chip; the sanitizer drops a null `term` key
  entirely, so a row the intake writes never carries one.
  - A course the student didn't change keeps its saved row exactly (grades and all); a changed one keeps its grades
    (a planned course drops its final grade, as the sanitizer always does).
  - `courseRigorCount` follows the list (never re-adds placeholder rows for removed courses).
- **A guardian's save** goes through `mergeCoursesForSave`: their courses and scores are taken as sent, like the
  student's; only `apExamsPrivate` (hidden from other students in the household) stays as saved.
- `draftFromProfile` reads it back: AP rows with a key become courses, the saved `year` carried over as-is and, for
  an already-taken one, its score (its exam, or "pending"). Status is never read off the saved row — the card works
  it out the same way `applyIntake` will, from the year, the class, and today. A GPA's saved scale becomes the
  override only when detection would pick another (a GPA above 4.0 saved on the 4.0 scale is weighted by definition
  and opens on 5.0 weighted), and with no focus test but one score on file, that test. Saving an unchanged draft
  gives back the same profile.

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
