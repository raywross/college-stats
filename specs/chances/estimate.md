# Quad's Estimate: Interface, Server-Side Model, and What Families See

> Status: **planned** 2026-10-10. Part 4 of [admission chances](README.md). After
> [rigor-in-context.md](rigor-in-context.md), [base-rates.md](base-rates.md), and
> [major-and-grades.md](major-and-grades.md) (the inputs), and after PR #105 (the planner redesign, whose
> `standingFor` in `lib/planner/standing.ts` this moves behind the interface). The method is
> [method/standing.md](method/standing.md); it is never shown on the site, and moves to a private repository at launch
> ([README](README.md#quads-estimate-is-proprietary)).

## Goal
One function the profile, the planner, Compare, Explore, and the iPhone API all call for Reach, Target, or Likely,
computed on the server by a model that can improve without changing what any page says, and shown
with enough about its inputs that a family understands what it rests on, without disclosing how it is calculated.

## Architecture
```
page / planner / API ──► POST /api/estimate (server) ──► lib/chances/estimate.ts (interface)
                                                            │
                                         lib/chances/model.ts (the method, server-only)
                                         falls back to lib/chances/baseline.ts (the open baseline)
```
- **`lib/chances/estimate.ts`** (server-only) defines the contract and nothing else:
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
- **`lib/chances/model.ts`** (server-only) implements [method/standing.md](method/standing.md),
  [method/rigor-reading.md](method/rigor-reading.md), and [method/major-effects.md](method/major-effects.md) behind
  that contract, with its tests in `tests/chances-model.test.mts`.
- **The open baseline** (`lib/chances/baseline.ts`) implements the same contract with the rules already published in
  [chances-and-fit.md](../product/chances-and-fit.md) and the planner redesign.
- **Server only.** The interface and the model import `server-only`; nothing from them reaches a client bundle (a
  test scans the built client chunks for the model's module). The planner's numbers form, which today re-sorts in the
  browser, calls the endpoint with a short debounce instead.

### At launch: move the method private
A short checklist, done once, when the owner locks the site down:
1. Create a private repository (recommended `raywross/quad-model`) and move `lib/chances/model.ts`, its tests, and
   `specs/chances/method/` into it as a package (`@quad/chances-model`) exporting the same contract.
2. Install it at build from GitHub Packages with a read-only token stored as a Vercel environment variable; the
   estimate interface imports it and falls back to the baseline when it can't be resolved (development, CI, forks).
3. Make `next build` with `VERCEL_ENV=production` fail if the package can't be resolved, so the baseline never
   silently serves production.
4. Delete the method files from this repository, and either make this repository private or accept that its history
   holds the pre-launch method (owner decision, 2026-10-10: deal with it at launch).
5. Update the rule in `CLAUDE.md` to "never commit the method here".

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
- Method changes are changes to the method files and `lib/chances/model.ts` (after launch, new versions of the
  private package); each result carries `modelVersion`, and outcome snapshots record it ([calibration.md](calibration.md)).
- A version reaches production only after it passes the release checks in [method/outcomes.md](method/outcomes.md);
  the accuracy summary on the site is updated each season.
- A change that would alter what the site *says* (a new note, a new input kind, a new label) is a public change here:
  the catalog, the input contract, or the display.

## Files (planned)
`lib/chances/estimate.ts` (contract, server-only), `lib/chances/model.ts` (the method, server-only),
`lib/chances/baseline.ts` (the open baseline: the existing published rules moved out of `lib/planner/standing.ts`),
`lib/chances/notes.ts` (the sentence catalog), `app/api/estimate/route.ts` (session, limits, batching),
`components/chances/WhatWentIn.tsx`, `tests/chances-estimate.test.mts` (the contract, the baseline against the
published examples, no model code in client chunks, rate limits, notes only from the catalog),
`tests/chances-model.test.mts` (the method's pinned examples).

## As built (2026-10-11, the estimate core)
- `lib/chances/baseline.ts` (pure) holds the published rules moved out of `lib/planner/standing.ts` (which re-exports
  them) with `baselineEstimate` behind the contract; the design preview still runs it in the browser.
- `lib/chances/model.ts` (server-only, `MODEL_VERSION` `20261011.1`) implements the method; `modelEstimateWithDetail`
  also returns the outcome snapshot's detail, which never leaves the server. With no new inputs and no new college
  evidence its group, label, send advice, and move-up equal the baseline's (`tests/chances-model.test.mts` runs the
  baseline's table through it); its notes add the two stage lines.
- `lib/chances/estimate.ts` (server-only): `estimateContext(student)`, `estimate`, `estimateWithDetail`,
  `estimateMany`, `appliedEstimator` (the snapshot's default in `snapshot-deps.ts`); the baseline answers, logged, only
  when the model throws.
- `POST /api/estimate`: validation and the response shape in `lib/chances/estimate-request.ts` (20 colleges signed
  out, 25 signed in; more is refused), the per-IP and per-user token buckets in `lib/chances/rate-limit.ts` (a request
  costs one token per five colleges), `Cache-Control: no-store`.
- The planner: `planView` takes `estimates` (the loader and the suggestion sync compute them with
  `lib/planner/plan-estimates.ts`; a guardian's copy reads no private exam scores); the numbers form and the signed-out
  plan fetch them through `components/planner/useEstimates.ts` (400 ms debounce, previous results kept while loading).
  A row without an estimate keeps its stored group and is never rewritten. The retake card is built from the
  estimates' move-ups. The session is read only to pick the limit; the profile's single-college check needs none.

## Open questions
1. At launch, private package or a separate service (a Supabase Edge Function or a small API)? Recommendation: a
   private package (one deploy, no network hop); a service later if the model grows heavy or needs its own data.
2. Should the open baseline stay after launch? Recommendation: yes; it is already published, lets contributors run
   the site, and gives the model a fixed yardstick to beat.
