# Chances and Fit: Where You Stand

> Status: **planned** (not built). After [student-profile.md](student-profile.md) and [saved-lists.md](saved-lists.md);
> better with [cds-admissions.md](../data-expansion/cds-admissions.md) (GPA bands) and
> [scattergrams.md](scattergrams.md) (local outcomes). Part of [product](README.md).
> *2026-10-10:* the rules below became the planner's `standingFor` (planner redesign, PR #105). They are now the
> **open baseline** only: production uses Quad's proprietary estimate, whose method is not published
> ([chances/README.md](../chances/README.md#quads-estimate-is-proprietary), [chances/estimate.md](../chances/estimate.md)).
> The pilot became [chances/calibration.md](../chances/calibration.md). The **Display**, **Fit**, and **Caveats** here
> remain this spec's work.

## Goal
For each college, tell a student where their numbers sit relative to admitted students, and suggest **Reach /
Target / Likely** with the reasons spelled out. It is a classification with published rules, **not a probability**.
Sites that print "42% chance" invite false precision: CollegeVine's own users report its chancing overestimates at
colleges admitting under 30%, and no public data supports a per-student probability at a holistic college. Quad
says what the data can say and stops.

## What the data can say
| Signal | Source on the site today | How it's used |
|---|---|---|
| Admit rate | IPEDS ADM (`admissions.acceptance_rate`) | The base rate: under 20% is Reach for everyone, whatever the scores |
| SAT / ACT middle 50% | IPEDS ADM | Where the student's score falls: below 25th, inside, above 75th |
| Test policy and submission shares | IPEDS ADM | Test-optional with low submission: scores matter less, say so; test-blind: scores unused |
| High school GPA bands and average | CDS C11/C12 (when [cds-admissions.md](../data-expansion/cds-admissions.md) ships) | Which band the student's unweighted GPA is in and the share of the class above it |
| Admission factors | IPEDS ADM ([admission-factors.md](../data-expansion/admission-factors.md)) and CDS C7 | Wording: "GPA is required and very important here; essays are considered" |
| Early rounds | CDS C21/C22 ([early-decision-strategy.md](early-decision-strategy.md)) | "Applying ED here admitted 28% vs 11% overall (fall 2025)" |
| Local outcomes | [scattergrams.md](scattergrams.md) | When 10+ applicants from the student's high school exist, their outcomes replace the national ranges as the primary view |
| In-state status | Student's state vs college's state | CDS C1 by residency where the college publishes it ([cds-residency-admissions.md](../data-expansion/cds-residency-admissions.md); `rateForStudent` in `lib/cds/residency-display.ts`): rule 3's base rate becomes the student's group rate, and the reason sentence names it ("Applicants from {State} were admitted at {rate}"), cited. Elsewhere, the overall rate with wording only ("Public colleges often admit in-state applicants at higher rates"). Tests: one row for a college with a grid (in-state, out-of-state, international) and one without |

## Rules
Computed in `lib/chances.ts`, pure and tested, and published on the glossary page under `standing`.

1. **Score position.** For each test the student has: `below` (under the 25th percentile), `in` (inside the middle
   50%), `above` (over the 75th). The better position across SAT and ACT counts. Test-blind → `unused`. Test-optional
   with the student planning not to submit → `unused`. Missing college ranges → `unknown`.
2. **GPA position** (only with CDS bands): `above` if the student's unweighted GPA is at or above the band holding
   the 75th percentile of enrolled students, `in` if within the middle 50%, `below` otherwise. Missing → `unknown`.
3. **Standing:**
   - Admit rate < 20% → **Reach** always (shown as "Reach for everyone").
   - Otherwise, take the positions that are known. All `above` and admit rate ≥ 50% → **Likely**. All `above` and
     admit rate 20–50% → **Target**. Any `in` → **Target**, unless admit rate ≥ 70% → **Likely**. Any `below` →
     **Reach**, unless admit rate ≥ 70% and the other position is `above` → **Target**.
   - Everything `unknown` → **No standing** ("Add a score or GPA", or "This college doesn't report ranges").
4. Open-admission colleges → **Likely** with "Admits everyone who applies".
5. The result carries its **reasons** as sentences with the numbers used, each cited like any other figure, and the
   profile fields used ([student-profile.md](student-profile.md#behavior)).

Thresholds live in one constants object so the pilot can tune them; a test pins the examples below.

| Student | College | Standing | Why |
|---|---|---|---|
| SAT 1450, GPA 3.8 | Admit 6%, SAT 1500–1560 | Reach | Reach for everyone |
| SAT 1450, GPA 3.8 | Admit 45%, SAT 1280–1450 | Target | SAT at the 75th percentile; a Target, not Likely, at 45% |
| SAT 1450 | Admit 78%, SAT 1100–1300 | Likely | SAT above the range at a college admitting most applicants |
| ACT 24 | Admit 40%, ACT 29–33 | Reach | ACT below the 25th percentile |
| No tests, GPA 3.9 | Test-optional, admit 35%, CDS GPA bands | Target | GPA in the top band; scores unused |

## Fit
Separate from standing, **fit** says how well a college matches the student's stated preferences
([student-profile.md](student-profile.md#fields)): size, setting, region, max cost, type, and whether the college
has the intended major with a meaningful program size ([majors.md](../data-expansion/majors.md)). Shown as a short
list of matches and mismatches ("Matches: size, region, has nursing (210 graduates a year). Doesn't match: average
cost $38K vs your $25K limit"), never as a score out of 100.

## Display
- **Profile hero and the overview's admissions card**, signed in with numbers: a "Where you stand" chip (Reach / Target / Likely) linking to the
  Admissions section, where a `StandingCard` lists the reasons with the existing `ScoreChecker` bars and the
  `GpaChecker` under it. Signed out: the ScoreChecker as today, with "Save your scores to see this everywhere".
- **Saved list:** the standing per row and the balance line ([saved-lists.md](saved-lists.md#display)).
- **Explore:** a "Standing" facet (Reach / Target / Likely) for signed-in students with numbers, and a sort by
  "best fit" (count of preference matches, ties by applicants).
- **Compare:** a "Where you stand" row.
- **Glossary:** `standing`, `reach-target-likely`, `yield-protection`, `holistic-admission`.

## Caveats shown every time
- Colleges read essays, recommendations, courses, and context; numbers alone don't decide. "Target" means your
  numbers are typical of admitted students, not that you're likely to be admitted.
- Ranges describe **enrolled** students, who are a subset of admitted ones.
- Recruited athletes, legacies, and other hooked applicants are inside the ranges; unhooked applicants may need to
  be higher.
- If a college is unaffordable it isn't a Likely, whatever the standing: the net price estimate sits beside it.

## Pilot
Before the standing chip goes on profiles: compute standings for a panel of self-reported outcomes (the first
pooled scattergram data from [scattergrams.md](scattergrams.md#self-reported-outcomes), or a hand-collected set of
~300 published outcomes) and check that Likely outcomes are admitted far more often than Reach ones. Publish the
check on the Data page. If "Likely" turns out to be wrong more than 15% of the time at any admit-rate band, raise
the thresholds.

## Files (planned)
- `lib/chances.ts` (pure), `components/school/StandingCard.tsx`, `components/school/GpaChecker.tsx`,
  `tests/chances.test.mts` (the table above, missing-data cases, thresholds).

## Open questions
1. Weighted GPA: use only unweighted now; weighted standing waits for high school scales
   ([high-school-data.md](high-school-data.md)).
2. Should standing be a Plus feature? Recommendation: free on the profile (one college at a time), Plus on lists
   and Explore (across many); see [commercialization.md](commercialization.md#feature-map).
