# Loans and Repayment (Scorecard)

> Status: **planned**. Wave 1. New fields on the existing Scorecard call. Research 2026-09-28.
> Part of [data-expansion](README.md). Extends [cost-outcomes.md](../cost-outcomes.md).

## Question it answers
*How many students borrow? Do lower-income students leave with more debt? Are graduates paying it down?*

## Source
| Field | What | Coverage (of 1,893) | Vanderbilt | Years |
|---|---|---|---|---|
| `latest.aid.federal_loan_rate` | Share of undergrads with a federal loan | 1,882 | 9.6% | 2009–2024 |
| `latest.aid.median_debt.pell_grant` | Median debt, Pell recipients | 1,687 | $9,500 | *unverified* |
| `latest.aid.median_debt.income.0_30000` / `30001_75000` / `greater_than_75000` | Median debt by family income | *probe* | | *unverified* |
| `latest.repayment.3_yr_bb_fed_repayment.ug.{fullypaid, makingprogress, noprogress, default}` | Borrower status 3 years into repayment | *probe* | paid in full 31–32%, making progress 27–28%, default ≤2% | **2019 key only** |

Repayment values arrive as **bands** (strings like `"0.27-0.28"`, `"<=0.02"`), not numbers. Parse to `{ low, high }`.

Rejected: cohort default rates (near 0 for recent cohorts because of the 2020–23 repayment pause; see
[README](README.md#considered-and-left-out)).

## Ingest
Add the fields to `sync-data.mts`; a `band()` parser for repayment strings (tested on `"<=0.02"`, `"0.27-0.28"`,
`">=0.98"`, `"PrivacySuppressed"` → null). History: add `{Y}.aid.federal_loan_rate` to `scorecard.mts`.

## Store
```ts
aid.federal_loan_rate: number | null
outcomes.median_debt_pell: number | null
outcomes.median_debt_by_income: { low, mid, high } | null
outcomes.repayment_3yr: { paid_in_full, making_progress, not_progressing, default }: { low: number, high: number } | null
```
`outcomes.repayment_3yr` is registered with its cohort described in the field label ("borrowers entering repayment in
…"); its vintage is `scorecard-latest`.

## Display
- **Cost & outcomes:** "1 in 10 students takes a federal loan" beside median debt. A small debt-by-income bar set
  ("Pell recipients: $9,500"). A 100% stacked bar for repayment status with the band shown as a range in the tooltip.
- **Explore:** "Share who borrow" column and filter.
- **Glossary:** `federal-loan-rate`, `repayment-status`, `in-default`.

## Keep history?
- **Federal loan rate: series**, 2009–2024 (16 years). Belongs in "Over time" → Aid next to grant share.
- **Debt by Pell/income: none** until year-prefixed availability is probed; the existing `median_debt` series already
  stops in 2020.
- **Repayment: none** (one cohort).

## Top-level trend?
- **Hero: no.** Borrowing depends on aid policy and family income; direction isn't a clean question.
- **Explore change column:** loan rate change (points), because "fewer students need loans" is a real selling point
  of no-loan aid policies.
- **"Known for":** "Few students borrow" (bottom 5% of loan rate among colleges with 1,000+ undergrads).
