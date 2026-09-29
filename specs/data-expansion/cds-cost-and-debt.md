# CDS Cost and Debt: Next Year's Price, Graduates' Total Debt

> Status: **skeleton**. Wave 4. **Blocked on the [college-reported data agent](../college-reported-data.md)**; its
> "Later" scope already lists 2026–27 tuition and section H. Research 2026-09-28 (Vanderbilt CDS 2024–25).
> Part of [data-expansion](README.md).

## Question it answers
*What will it cost next year?* (Federal prices lag: the site shows 2023–24.) *How much do graduates owe, counting
private loans?* (The federal median debt counts only federal loans.)

## Source
| Item | What | Vanderbilt |
|---|---|---|
| **G1** | Tuition, required fees, food and housing for the **coming** year (the 2024–25 CDS lists 2025–26) | tuition $67,934, fees $3,292, food & housing $23,048 |
| G5 | Estimated books, personal, transportation | |
| **H4** | Bachelor's graduates who started as first-time students | |
| **H5** | Of those: number and share who borrowed from federal, non-federal (private, institutional, state), and any source; **average cumulative principal** borrowed | |
| H6 | Aid to international students | |

G1 is a year ahead of both the IPEDS file the site uses (2023–24) and the newest IPEDS release (COST1_2024's
2024–25 column). The trend spec requires "the latest point equals the snapshot", so G1 must never replace the federal
price; it shows as a separate, labeled "Next year" value.

## Ingest (when unblocked)
- Extraction schema: `g1` (tuition by residency, fees, food & housing), `h5` (rows: federal, non-federal, any; columns:
  number, share, average principal).
- Checks: G1 tuition ≥ the latest federal tuition × 0.95 (prices rarely fall; a drop goes to review); H5 "any loan" share ≥
  federal share; average principal within ×0.5–×2 of Scorecard median debt.

## Store
```ts
reported.cost.next_year: { year: "2025–26", tuition_in_state, tuition_out_of_state, fees, food_housing } | null
reported.outcomes.graduate_debt: { any: { share, avg_principal }, federal: {…}, non_federal: {…}, class_year } | null
```

## Display
- **Cost:** "Next year (2025–26, reported by the college): $94,274 before aid", beside the federal figure, with the
  change in % ("+6% from 2024–25 federal"). Chip: `CDS 2024-25`.
- **Outcomes:** "N% of graduates borrowed; average $X including private loans" (illustrative; H5 wasn't read in the research) beside the federal median.
- Never in ranks or Explore.

## Keep history?
- **Next-year price: none** (it becomes federal history a year or two later; keep only the current edition).
- **Graduate debt: series per CDS edition** (H5 has been in the CDS for many years; backfill possible if old editions
  are found).

## Top-level trend?
**None.** Next year's price feeds the existing cost indicator's *context* line later ("and 2025–26 is up 6% more"),
not the indicator itself.
