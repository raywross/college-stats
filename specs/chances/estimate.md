# Quad's Estimate: Interface, Private Model, and What Families See

> Status: **planned** 2026-10-10. Part 4 of [admission chances](README.md). After
> [rigor-in-context.md](rigor-in-context.md), [base-rates.md](base-rates.md), and
> [major-and-grades.md](major-and-grades.md) (the inputs), and after PR #105 (the planner redesign, whose
> `standingFor` in `lib/planner/standing.ts` this moves behind the interface). The method itself is confidential and
> specified in the private model repository, not here ([README](README.md#quads-estimate-is-proprietary)).

## Goal
One function the profile, the planner, Compare, Explore, and the iPhone API all call for Reach, Target, or Likely,
computed on the server by a private model package that can improve without changes to this repository, and shown
with enough about its inputs that a family understands what it rests on, without disclosing how it is calculated.

## Architecture
```
page / planner / API ──► POST /api/estimate (server) ──► lib/chances/estimate.ts (interface, public)
                                                            │
                                     @quad/chances-model (private package)  ── or ──  open baseline (public)
```
- **`lib/chances/estimate.ts`** (public, server-only) defines the contract and nothing else:
  ```
  estimate(input: EstimateInput): EstimateResult
  EstimateInput  = { student: { gpa, gpaScale, test, sections, classRank, courses, subjectGpa, state, majors, round,
                     highSchoolId }, college: unit_id, unit?: major unit id }
  EstimateResult = { group: "reach" | "target" | "likely" | null,
                     label: "reach-for-everyone" | "guaranteed" | null,
                     used: InputKind[],            // which of the student's inputs this college's estimate used
                     missing: InputKind[],         // inputs that would have been used if given
                     facts: FactRef[],             // cited college facts to show beside it (field paths)
                     notes: NoteKey[],             // fixed, reviewed sentences from a public catalog (below)
                     modelVersion: string }
  ```
- **`@quad/chances-model`** lives in a private repository (owner to create; recommended name
  `raywross/quad-model`), with its own spec, tests, and history. Vercel installs it at build time from GitHub
  Packages with a read-only token stored as a Vercel environment variable. It exports one function matching the
  contract.
- **The open baseline** (`lib/chances/baseline.ts`, public) implements the same contract with the rules already
  published in [chances-and-fit.md](../product/chances-and-fit.md) and the planner redesign. It runs in local
  development, CI, forks, and preview deployments without the token.
- **Production must run the private model.** `next build` with `VERCEL_ENV=production` fails if the package can't be
  resolved, so the baseline can never silently serve production.
- **Server only.** The interface imports `server-only`; nothing from the package reaches a client bundle (a test
  scans the built client chunks for the package name). The planner's numbers form, which today re-sorts in the
  browser, calls the endpoint with a short debounce instead.

## Protecting the method
- **No bulk or probing access.** `/api/estimate` takes one student and up to 25 colleges per call, requires a session
  for anything but the profile's single-college check, and is rate-limited per account and per IP. The public
  [data API](../product/data-api.md) never exposes estimates.
- **Results carry no internals.** The response is the group, the label, which inputs were used or missing, cited
  facts, and sentences from a fixed catalog. No scores, distances, weights, or intermediate values.
- **Notes come from a catalog.** `lib/chances/notes.ts` (public) holds every sentence the estimate can show, reviewed
  like any copy ("Your SAT is inside the middle 50% of enrolled students here", "Scores are optional here; you might
  apply without yours", "Engineering applicants here get an extra look at math and science grades"). The model picks
  note keys and fills in cited values; it never returns free text.
- **Telemetry** logs the group, the label, and the model version, never the inputs.
- **Terms of use** prohibit scraping or systematically querying the estimate.

## What families see
### The output
- **Reach, Target, or Likely**, the same chips and colors the planner uses today, labeled **Quad's estimate**.
- Two labels on top: **Reach for everyone** (no student's numbers make this college predictable) and **Guaranteed for
  you** (a published automatic-admission program applies; [base-rates.md](base-rates.md#automatic-admission)).
- Never a percentage, a probability, or a score.

### What went into it
Like Zillow's "what affects the Zestimate", every estimate has a panel listing the kinds of inputs and the facts it
looked at, without saying how they were combined:
> **What went into this estimate**
> Your numbers: GPA 3.85 · SAT 1300 · 6 advanced courses · Indiana resident
> Purdue's numbers: admit rate for Indiana applicants 71% (fall 2025) ⓘ · SAT middle 50% 1220–1470 ⓘ · 71% of
> first-years had a 3.75+ ⓘ · course rigor and GPA rated *very important* ⓘ
> Not used here: class rank (Purdue doesn't weigh it)
> *Quad's estimate is our own assessment from these inputs and outcomes reported by students. It isn't a prediction
> from Purdue, and holistic admission weighs things no estimate can see: essays, recommendations, and the college's
> needs that year.*

- `missing` becomes one prompt when it would matter: "Adding your courses could change this estimate."
- The panel's facts are ordinary cited fields; the notes are catalog sentences.

### On the profile
The "Where you stand" chip and card planned in [chances-and-fit.md](../product/chances-and-fit.md#display) call the
endpoint; the card shows the group, its labels, the "what went into it" panel, and the existing ScoreChecker and
GpaChecker below it.

### In the planner
The Colleges tab's automatic groups ([../planner/redesign/standing.md](../planner/redesign/standing.md#suggested-until-changed))
come from the endpoint; a group the student picked is still never overwritten. The Scores tab's retake suggestion and
the [course plan](course-plan.md)'s "what it changes" line ask the endpoint the counterfactual ("this score",
"this course added") as one more call, within the same rate limits.

### Compare, Explore, iPhone
Compare's "Where you stand" row and Explore's standing facet call the endpoint for the colleges in view (Explore in
pages of 25). The iPhone API returns the same `EstimateResult`.

## Changing the method
- Method changes ship as new versions of the private package; each result carries `modelVersion`, and outcome
  snapshots record it ([calibration.md](calibration.md)).
- A version reaches production only after it passes the private repository's own release checks against held-out
  outcomes; the public accuracy summary is updated each season.
- A change that would alter what the site *says* (a new note, a new input kind, a new label) is a public change here:
  the catalog, the input contract, or the display.

## Files (planned)
Public: `lib/chances/estimate.ts` (contract, server-only), `lib/chances/baseline.ts` (the open baseline: the
existing published rules moved out of `lib/planner/standing.ts`), `lib/chances/notes.ts` (the sentence catalog),
`app/api/estimate/route.ts` (session, limits, batching), `components/chances/WhatWentIn.tsx`, the production build
check, `tests/chances-estimate.test.mts` (the contract, the baseline against the published examples, the build check,
no package code in client chunks, rate limits, notes only from the catalog).
Private (`raywross/quad-model`): the method's spec, implementation, tests, and release checks.

## Open questions
1. Private package or a separate service (a Supabase Edge Function or a small API)? Recommendation: a private package
   now (one deploy, no network hop); a service later if the model grows heavy or needs its own data.
2. Should preview deployments get the private model? Recommendation: yes, for the owner's previews only (the token in
   the Preview environment), so a change can be checked before production; forks and CI keep the baseline.
3. Should the open baseline stay public at all? Recommendation: yes; it is already published, lets contributors run
   the site, and gives the private model a fixed yardstick to beat.
