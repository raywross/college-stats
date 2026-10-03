# Student Profile: Your Numbers

> Status: **planned** (not built). After [accounts.md](accounts.md). Read by [chances-and-fit.md](chances-and-fit.md),
> [saved-lists.md](saved-lists.md), [net-price-estimator.md](net-price-estimator.md), and
> [scattergrams.md](scattergrams.md). Part of [product](README.md).

## Goal
One place for a student's own numbers and preferences, entered once and read everywhere: the profile's
`ScoreChecker` is prefilled, Explore can filter to "colleges where my scores are in the middle 50%", the net price
estimator knows the state of residence, and chances use the GPA. Today `ScoreChecker` asks for a score on every
profile and forgets it.

## Fields
| Group | Fields | Used by |
|---|---|---|
| **Basics** | graduation year; state of residence (including "Outside the U.S."); high school (NCES id, from [high-school-data.md](high-school-data.md); free text until then) | residency pricing, in-state rules, scattergrams, the admit rate for you ([cds-residency-admissions.md](../data-expansion/cds-residency-admissions.md): the profile card's "(you)" marker, Compare's "Acceptance rate for you", chances' base rate) |
| **Academics** | unweighted GPA (0–4.0) and the scale it's on (4.0, 5.0, 100-point) with a weighted GPA optional; class rank (percentile) optional; course rigor (count of AP/IB/dual-enrollment courses) optional | chances (GPA bands from [cds-admissions.md](../data-expansion/cds-admissions.md)) |
| **Tests** | SAT total and sections; ACT composite and sections; superscore flag; "I plan to apply test-optional" | ScoreChecker, Explore fit filter, chances |
| **Plans** | intended majors (up to 3, 2-digit CIP families from [majors.md](../data-expansion/majors.md)); early round interest (ED / EA / none) | majors and earnings-by-major views, [early-decision-strategy.md](early-decision-strategy.md) |
| **Preferences** | size buckets, setting (city / suburb / town / rural, from [campus-profile.md](../data-expansion/campus-profile.md)), regions or states, max average cost, type | "Fits you" filter and fit score ([chances-and-fit.md](chances-and-fit.md#fit)) |
| **Hooks** (optional, private by default) | first-generation; legacy at specific colleges; recruited athlete; Pell-likely | Chances wording only ("Colleges that consider legacy status: …"), never shown to guardians unless the student allows |

**GPA normalization.** Weighted scales differ by high school, so chances use the **unweighted 4.0 GPA** only. A
100-point or 5.0 GPA is converted with the student's scale and shown back as "about 3.7 unweighted (from 93/100)".
When [high-school-data.md](high-school-data.md) has the school's own scale, that conversion is used and cited.

## Behavior
- Works signed out: stored in `localStorage` under one key (`student-profile`), imported on sign-in
  ([accounts.md](accounts.md#sign-in)).
- Signed in: one row per `students.id` in `student_profiles` (`jsonb` for the groups above, plus `updated_at`).
  Guardians read it; they can edit when `can_edit` ([accounts.md](accounts.md#privacy-model)).
- A **completeness meter** on `/me` lists what each tool needs ("Add a GPA to see where you stand").
- Every tool shows which profile values it used, the way citations show sources: "Using your SAT 1450 and GPA 3.8
  (edit)".
- Numbers from the profile are **never** sent to analytics ([telemetry.md](telemetry.md#privacy)); only "profile
  has GPA: yes/no" style flags.

## Display
- `/me`: the profile form (grouped, each group collapsible), the completeness meter, links to lists and tools.
- **Profile pages:** the "Where would you land?" block uses the saved scores with a "You" marker and the verdict
  copy already written for `ScoreChecker`; a `GpaChecker` appears when the college has CDS GPA bands.
- **Explore:** a "Fits my scores" chip (`fit=scores`: colleges whose SAT or ACT middle 50% contains the student's
  score, or that are test-blind), and "Fits my preferences" (`fit=prefs`). Both are URL params like other filters
  and resolve server-side from the profile, so links stay shareable only for the same signed-in student (for anyone
  else they're ignored with a note).
- **Compare:** a "You" column in Test scores when the profile has scores.

## Files (planned)
- `lib/student-profile.ts` (types, GPA conversion, validation; pure, tested), `app/me/page.tsx`,
  `components/me/ProfileForm.tsx`, migration `…_student_profiles.sql`.
- `tests/student-profile.test.mts`: GPA conversions, fit filters with missing data (a college without SAT ranges is
  neither in nor out of "fits my scores"; test-blind counts as in).

## Open questions
1. Should the profile allow more than one "scenario" (e.g. "if I retake the SAT")? Recommendation: not in v1.
2. Hooks are sensitive; keep them off the form until chances can use them well.
