# GPA in the Plan: Weighted vs. Unweighted, Filling the Gaps, and Saying What We Used

> Status: **built** 2026-10-10 on feature/plan-redesign (PR #105). Fitted on the real data that day:
> GPA ≈ 3.10 + 0.057 × (SAT midpoint ÷ 100) − 0.32 × admit rate, from 32 colleges, typical miss 0.095 (90% under
> 0.165). Sources: 36 colleges reported, 972 estimated, 4 estimated within a weighted average's limits, 881 none. Extends [standing.md](standing.md)'s GPA
> rule. Asked for by the owner after reviewing the preview: "we have commentary on ACT or SAT scores, but there is
> nothing about GPAs".

## The problem
The standing model compares the student's GPA with the college's average first-year GPA. That average comes only from
a college's Common Data Set (CDS C12); federal data has no GPA. On 2026-10-10:

| | Colleges |
|---|---|
| In the dataset | 1,893 |
| With a CDS admissions profile collected | 48 |
| With a GPA average the rule could use | 36 |

So for nearly every college, GPA silently drops out, and the row says nothing about it. Families read that as "GPA
was ignored".

## Weighted and unweighted, in plain words
- **Unweighted**: every A counts 4, B 3, and so on, whatever the class. The top is 4.0.
- **Weighted**: honors, AP, or IB classes earn extra (often +0.5 for honors and +1 for AP/IB, so an A in AP counts 5).
  It can run above 4.0, and how much extra depends on the high school.

Two consequences for the plan:
1. A weighted GPA can't be turned into an unweighted one without the transcript, but it is **bounded**. Weighting
   only adds, and adds at most 1 point per class, so the unweighted GPA lies between `weighted − 1` and
   `min(4.0, weighted)`. A weighted 4.4 means an unweighted GPA somewhere from 3.4 to 4.0.
2. A college's weighted average (UGA reports 4.17, UNC 4.47) can't be compared with a student's unweighted 3.8.

## What the data shows (measured 2026-10-10 on the 40 colleges with a CDS GPA)
- **The GPA bands are reliable for colleges that don't say "weighted".** CDS C11 reports the share of first-years in
  nine GPA bands on a stated 4.0 scale. For the 36 colleges whose C12 average isn't marked weighted, the band mean
  (band midpoints) matches the C12 average within about 0.05. So "scale not stated" averages are 4.0-scale numbers.
- **Weighted reporters' bands are not reliable.** UGA, UNC, William & Mary, and WashU pile almost everyone into the
  top band (band means of 3.92 to 3.98), because weighted GPAs above 4.0 were capped into it.
- **Similar colleges predict GPA well.** A college's average GPA follows its test scores and admit rate:
  `GPA ≈ 3.00 + 0.067 × (SAT midpoint ÷ 100) − 0.35 × admit rate`, fitted on the 36 usable colleges. In
  leave-one-out testing the typical miss is about 0.10 GPA points (90% of misses under 0.18), against a spread of
  0.20 across colleges. It applies wherever a college has test scores and an admit rate: about 1,000 colleges.

## The design

### 1. The college's GPA, best source first (`collegeGpa(school, model)`, pure)
| Order | Source | When | Range the rule uses |
|---|---|---|---|
| 1 | Reported average (C12) | Scale unweighted, or not stated and ≤ 4.0 | The value (a point) |
| 2 | Band mean (C11) | No usable C12 average, bands present, and C12 not marked weighted | Band mean ± 0.05 |
| 3 | Estimate from similar colleges, bounded | C12 marked weighted (or above 4.0) | The estimate's range, cut to `[w − 1, min(4, w)]` |
| 4 | Estimate from similar colleges | No usable CDS GPA; test scores and admit rate present | Estimate ± the model's 90th-percentile miss |
| 5 | None | Otherwise | GPA not used, and the row says why |

The result carries `kind: "reported" | "bands" | "estimated" | "none"`, the range, the point shown, and for an
estimate the number of colleges it was fitted on.

### 2. The model (`lib/planner/gpa-model.ts`, pure; fitted on the server)
- Least squares on `[1, SAT midpoint ÷ 100, admit rate]`. The SAT midpoint is the SAT total's midpoint, else the ACT
  composite midpoint through the 2018 concordance (`actToSat`).
- Training rows: colleges whose GPA comes from source 1 or 2 (never weighted reporters), with an SAT or ACT midpoint
  and an admit rate. Each row's target is its band mean when bands exist, else its C12 average.
- Fitted once per server instance from the dataset (`getData`), so it updates whenever the data does. There is no
  generated file to go stale and nothing for data PRs to rebuild.
- It reports its own leave-one-out error. **Guard:** with fewer than 25 training rows, or a 90th-percentile miss
  above 0.25, the model returns nothing and only CDS sources are used. A test pins this, and breaking it fails.
- Predictions are clamped to `[2.0, 4.0]`.

### 3. The student's GPA as a range (`planGpaRange(profile)`, pure)
- Unweighted on a 4.0 scale: the value.
- On a 4.0 scale but above 4.0: it is weighted by definition, so the range is `[g − 1, 4.0]`.
- **Weighted** (the old "5.0 scale" option, relabeled "Weighted (honors/AP count extra)"; stored value `"5.0"`
  unchanged): `[max(0, w − 1), min(4, w)]`.
- 100-point: the band table's value (built).
- The numbers form says: "Use the unweighted GPA from your transcript if you can. A weighted GPA can only be placed
  roughly."
- Other tools that read `unweightedGpa4` are unchanged; this range is the plan's reader.

### 4. Comparing two ranges (in `standingFor`)
With the student's range `[s0, s1]`, the college's `[c0, c1]`, and the band of 0.15:
- **above** when `s0 − c1 > 0.15`
- **below** when `c0 − s1 > 0.15`
- **in** when the two ranges' middles are within 0.15 of each other, and the student's range is at most 0.4 wide
  (`STUDENT_RANGE_FOR_CLOSE`; an unweighted GPA is a point, a weighted one can span a full point)
- otherwise **can't tell**: GPA isn't used for that college, and the row says so.

For two points this is today's rule exactly, so the pinned examples in standing.md still hold.

*Changed during the build (2026-10-10):* the first version required the whole college range to sit within 0.15 of
the student's, so "in" demanded a college range at most 0.30 wide. An estimate is about ±0.17 (0.33 wide), so no
estimated college could ever be "close", and the preview's student got "can't tell" at all five estimated colleges.
Comparing the middles fixes that. With the fitted model, a student with a 3.82 and a 1390 SAT is now compared at all
eight colleges on the preview list.

An estimated GPA is used like a reported one, but its range is wider, so it more often lands on "in" or "can't
tell". Not every college gets a group from GPA alone; the admit-rate rules are unchanged.

### 5. Saying what was used: one GPA sentence on every row whenever the student gave a GPA
| Case | Sentence |
|---|---|
| Reported | "Your GPA (3.82) is close to the 3.88 average of enrolled students." |
| Bands | "Your GPA (3.82) is above the 3.65 average of enrolled students, figured from the college's GPA ranges." |
| Estimated | "Your GPA (3.82) is close to the 3.7–3.9 typical of colleges with similar test scores and admit rates. This college doesn't publish an unweighted average, so this is an estimate." |
| Weighted, bounded | Same as Estimated, ending "This college publishes only a weighted average (4.17), so this is an estimate." |
| Can't tell | "Your GPA can't be placed against this college's: [why]. Your [SAT] decides the group here." |
| None | "This college doesn't publish a GPA average, and there aren't enough test scores to estimate one, so only your [SAT] is used." |
| Student's GPA is weighted | The student's number is shown as "about 3.4–4.0 unweighted (from a weighted 4.4)". |

Each value carries its citation in the ⓘ. An estimate cites `derived.gpa_estimate`, whose method names the formula,
the number of colleges, and its typical miss. It is never shown as the college's own figure. There are no chips or
banners: the sentence and the ⓘ carry it (the site's quiet-sources rule).

### 6. Closing the gaps (data, not code)
The real fix is more Common Data Sets. The college-reported pipeline (specs/college-reported-data.md) already reads
C11 and C12. Earlier runs cost about $0.06 to $0.19 per college, which puts every college at roughly $110 to $350.
The owner decides the spend. Recommended order: the colleges families add to lists most, then the most-viewed
profiles, then the rest. Every new CDS also retrains the model automatically, because the model is fitted from the
dataset.

## Files
- `lib/planner/gpa-model.ts` (pure): band midpoints, `bandMean`, `satMidpoint`, `fitGpaModel(rows)` with
  leave-one-out error, `predictGpa`, `collegeGpa`, `compareGpaRanges`.
- `lib/planner/gpa-model-server.ts` (server-only): `gpaModel()`, memoized from `getData()`.
- `lib/planner/standing.ts`: `StandingStudent.gpaRange`, `StandingSchool.gpa` (the `collegeGpa` result), the range
  comparison, and the sentences above. `gpaAverage` stays for the pinned examples.
- `lib/planner/context.ts` (`planSchoolFor`), `app/api/plan/schools/route.ts`, `app/plan/preview/page.tsx`: pass the
  model.
- `lib/student-profile.ts`: `planGpaRange`, and the relabeled scale.
- `lib/fields.ts`: `derived.gpa_band_mean` and `derived.gpa_estimate` with their formulas and inputs. Lineage and
  glossary terms: `weighted-gpa` and `unweighted-gpa` (plain-language rewrite), plus a new `gpa-estimate`.
- `components/planner/NumbersForm.tsx`: the scale label and the hint.
- Tests: the model fit and guard, `collegeGpa`'s order, the range comparison (two points equal today's rule), every
  sentence, and the student's range.
