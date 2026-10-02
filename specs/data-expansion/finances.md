# Finances: Endowment and Spending (IPEDS F / DRVF)

> Status: **built** 2026-10-02. Wave 2. New file: `DRVF{Y}` (derived per-student finance). Research 2026-09-28; files
> probed 2026-10-02. See [As built](#as-built). Part of [data-expansion](README.md).

## Question it answers
*How rich is this college, per student? How much does it spend on teaching each student?*

## Source
Finance is reported on three different forms by sector, which aren't directly comparable:

| Form | Sector | Raw file |
|---|---|---|
| F1 (GASB) | Public | `F{yy}{yy}_F1A` |
| F2 (FASB) | Private nonprofit | `F{yy}{yy}_F2` |
| F3 | For-profit | `F{yy}{yy}_F3` |

**`DRVF{Y}`** has the per-student figures already computed for each form. Verified for Vanderbilt (DRVF2024 = fiscal
year 2023–24):

| Column | What | Vanderbilt |
|---|---|---|
| `F2ENDMFT` / `F1ENDMFT` | Endowment assets (year end) per FTE student | $827,497 |
| `F2INSTFT` / `F1INSTFT` | Instruction expenses per FTE student | $34,184 |
| `F2STSVFT`, `F2ACSPFT` | Student services, academic support per FTE | $19,798, $16,416 |
| `F2TUFEPC` | Tuition as a share of core revenue | 20% |

Scorecard carries `school.endowment.end` ($10.25B, = `F2H02`) and `school.instructional_expenditure_per_fte`
($34,184, same as DRVF) for 1,602 and 1,889 colleges, with year keys 2005–2024. Use **DRVF** for per-student figures
(more measures, one source) and Scorecard year keys for history (already batched).

**Caveat:** many public universities' endowments sit in a separate foundation that IPEDS may not include, so publics
look poorer than they are. Never rank publics and privates together on endowment.

## Ingest
`sync-data` loads `DRVF{Y}` newest-first and picks F1 or F2 columns by the college's form (the `F1`/`F2` prefix that has
values; assert only one does).

## Store
```ts
finances: { fiscal_year: number, form: "gasb" | "fasb",
            endowment_per_student, instruction_per_student, student_services_per_student,
            tuition_share_of_revenue: number | null } | null
```
`SourceKey` `ipeds-f`, `VintageKey` `ipeds-f` ("Fiscal year 2023–24"). ~150 bytes.

## Display
- **Profile, Cost & outcomes** (or Academics): "Spends $34,184 a year on instruction per student", with a
  `BenchmarkBar` against the same sector only. Endowment per student as a separate fact, sector-benchmarked, with the
  foundation caveat for publics.
- **Explore:** instruction spending sort; endowment per student sort (privates only by default).
- **Glossary:** `endowment`, `fte-student`, `instruction-expenses`, `gasb-fasb`.

## Keep history?
**Series: instruction spending per student**, fiscal 2005 on, **after inflation** (CPI like prices). Endowment per
student: series too, but charted only for private nonprofits (publics' coverage issue).

## Top-level trend?
- **Hero: no.** Spending isn't a question families ask directly.
- **"Over time":** instruction spending per student after inflation, in a new Academics group.
- **"Known for":** "Big endowment per student" (top 5% within its sector).
- **Home fact: no.**

## As built

- **Source.** `SourceKey`/`VintageKey` `ipeds-f` ("Fiscal year 2023–24", edition DRVF2024). `sync-data` loads
  `DRVF{Y}` newest-first and fails if no `F1INSTFT`/`F2INSTFT`/`F3INSTFT` column exists. Winter release entry now
  brings DRVF2025. The probe confirmed the spec's research exactly (Vanderbilt and Michigan's values matched) and
  found more:
  - **For-profits report too, on a third form.** `F3` (for-profit) has `TUFEPC`/`INSTFT`/`ACSPFT`/`STSVFT` columns
    like F1/F2, just no `ENDMFT` (endowment) column — for-profits don't report one. All 130 for-profit colleges in
    the dataset report cleanly under F3, so the "one form per college" rule and benchmarking extend to all three
    sectors, not just public/private nonprofit as the spec's table implied.
  - **The form is detected from the data, not `school.type`.** 31 of 1,892 colleges (1.6%) report under a different
    form than the site's sector classification would predict (a college that changed control type, most likely).
    Every college reports exactly one form (0 report two, 0 report none, verified against all 1,892), so `sync-data`
    picks whichever of F1/F2/F3 actually has values and throws if a row ever reports more than one — more robust
    than trusting a separately-sourced `type` field, and it's also the sector that college's own figures were
    benchmarked within.
  - **Store** (`lib/finances.ts` `financesFrom`, shared with sync-data): `school.finances` is a new top-level field
    (not nested under `academics`, to avoid colliding with the faculty agent's edits to that object), with
    `form: "gasb" | "fasb" | "forprofit"` added to the spec's two. `fiscal_year` is the fiscal year's start year
    (2023 for fiscal 2023–24), matching the site's year convention. 1,892 of 1,893 colleges have a value.
  - **Scorecard's history fields** (`instructional_expenditure_per_fte`, `endowment.end`) were verified to equal
    DRVF2024 exactly at two colleges (Vanderbilt $34,184, Michigan $29,014), confirming the spec's plan to use them
    for history.
- **Benchmarking** (`lib/metrics.ts`): six new `MetricKey`s — `financesInstruction` (global, for Explore's sort) and
  `instructionGasb`/`instructionFasb`/`instructionForprofit`/`endowmentGasb`/`endowmentFasb` (each returns the value
  only for that form, `null` otherwise). Reusing the existing `rankOf`/`distribution` machinery against these
  sector-gated getters gives within-sector percentiles "for free" (a null-filtered getter is already a sector
  subset), rather than needing new sector-percentile math. The profile picks the right key from
  `school.finances.form`. No `endowmentForprofit`: for-profits have no endowment column.
- **Display.**
  - Profile: the existing Academics panel (from #38) gains a second card when `school.finances` exists (the panel
    now shows for a college with either a ratio or finances, not just a ratio). It names the fiscal year, says
    comparisons are within-sector only, and adds the public foundation caveat; a `DistributionStrip` each for
    instruction spending and endowment per student (sector-only distributions).
  - "Known for": "Big endowment per student" at the national top 5% **within sector** (`lib/insights.ts`), using the
    same sector-gated metric key.
  - Explore: sort "Instruction spending per student (most)" — global, all sectors, since the spec didn't ask for a
    sector split there — and "Endowment per student (most, private nonprofits)", which **always** scopes to private
    nonprofits (reuses `endowmentFasb`) rather than a togglable default, to keep scope small.
  - Compare: three rows (instruction spending, endowment per student, tuition share of revenue), each showing the
    accounting form inline since the raw numbers would otherwise look directly comparable across rows.
  - Glossary: `endowment`, `instruction-expenses` (spec said "instruction-expenses"), `gasb-fasb`, `fte-student`.
- **History.** Family `scorecard-finances` (Scorecard API, not an NCES file), series `instruction_per_student`, fiscal
  2004 on (key 2005+, stored at its start year). **Deviation:** found a break — Vanderbilt's figure jumped from
  $80,096 (fiscal 2014–15) to $30,205 (2015–16) and was flat on either side, so NCES evidently redefined what counts
  as "instruction" expense; a `breaks` marker is added at 2015 (`FINANCE_BREAK`), which the spec didn't anticipate.
  The chart draws **no national band**: `national.json` has one global distribution per series, and banding it would
  mix GASB/FASB/for-profit figures in the same chart, violating the sector rule — shows only the college's own line.
  **Endowment per student has no history** (deviates from "Keep history: series too"): Scorecard's endowment total
  has no FTE-consistent historical denominator before DRVF existed (DRVF itself only goes back to 2021, confirmed
  while probing — not fiscal 2005 as hoped). Dividing by Scorecard's undergraduate headcount instead of true FTE
  would overstate it by roughly 70% at a research university with a large graduate population (checked at
  Vanderbilt: $1.42M by headcount vs. $827K by FTE), so it ships as a snapshot-only fact. A real fix needs a
  historical FTE-enrollment source (IPEDS EF total FTE across years), noted as a follow-up.
- **Not built** (out of scope for this spec change, per the shared wave-2 brief): an Explore table column, a
  "compare all sectors" toggle for the endowment sort, and the "no Home fact" / "no hero" items the spec already
  ruled out.
- Tests: `tests/finances.test.mts`.
