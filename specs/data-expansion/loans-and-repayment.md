# Loans and Repayment (Scorecard)

> Status: **built** 2026-09-29. Wave 1. New fields on the existing Scorecard call. Research 2026-09-28; every field
> probed 2026-09-29 (Vanderbilt, Michigan, Berkeley, Georgia Tech). Part of [data-expansion](README.md). Extends
> [cost-outcomes.md](../cost-outcomes.md).

## Question it answers
*How many students borrow? Do lower-income students leave with more debt? Are graduates paying it down?*

## Source
| Field | What | Coverage (of 1,893) | Vanderbilt | Newest year |
|---|---|---|---|---|
| `latest.aid.federal_loan_rate` | Share of all undergrads with a federal loan | 1,882 (median 45%) | 9.6% | key 2024 = **2023–24** (matches IPEDS SFA2324 `UFLOANP`) |
| `latest.aid.median_debt.pell_grant` / `.no_pell_grant` | Median debt, Pell recipients / not | 1,687 | $9,500 / $14,635 | key 2020, like `median_debt` |
| `latest.aid.median_debt.income.0_30000` / `30001_75000` / `greater_than_75000` | Median debt by family income | 1,721 | $7,500 / $11,981 / $14,000 | key 2020 |
| `latest.repayment.3_yr_bb_fed_repayment.ug.*` (8 categories) | Borrower status 3 years into repayment | 1,735 | paid in full 31–32%, making progress 27–28%, default ≤2% | **2019 key only** |

**Repayment has eight categories, not four:** paid in full, making progress, not making progress, deferment,
forbearance, delinquent, default, discharged. Together they add to 100%, so all eight are stored. Values arrive as
numbers, exact strings (`"0.31"`), bands (`"0.27-0.28"`), or bounds (`"<=0.02"`); `parseShareBand()` in `lib/derive.ts`
turns each into `{ low, high }`, and anything else (`"PrivacySuppressed"`) into null. The repayment cohort's exact years
are *unverified*, so it's cited as the Scorecard's most recent release, like the other outcome fields.

The debt medians cover everyone who borrowed and left (graduates and not), unlike `median_debt` (graduates only).

Rejected: cohort default rates (near 0 for recent cohorts because of the 2020–23 repayment pause; see
[README](README.md#considered-and-left-out)).

## Store
```ts
outcomes.federal_loan_rate: number | null           // vintage scorecard-cost ("2023–24"): same key rule as net price
outcomes.median_debt_pell, median_debt_no_pell: number | null
outcomes.median_debt_by_income: { low, mid, high } | null
outcomes.repayment_3yr: Partial<Record<RepaymentStatus, { low, high }>> | null
```
The loan rate lives in `outcomes` with the debt figures (the spec first said `aid`, but `aid` comes from the IPEDS SFA
file and can be missing when Scorecard has the rate).

## Display
- **Cost & outcomes:** a "Borrowing and repayment" card below the net price and debt cards (folded behind "Show
  borrowing and repayment" on phones; [mobile.md](../mobile.md)): the loan rate against the median college with a plain
  line ("About 1 in 10 undergrads borrows federally"), median debt by background (Pell / no Pell / three income bands),
  and a 100% bar of repayment status in six groups (paid in full; paying it down; payments paused = deferment +
  forbearance; not paying it down; behind or in default; forgiven or discharged), each with its range. The bar shows
  only when all eight categories are published and their midpoints add to within 10 points of 100%
  (`repaymentGroups()` in `lib/repayment.ts`): 1,680 of the 1,735 colleges with repayment data at the 2026-09-29 sync.
- **Explore:** "Borrow" column and "Share who borrow" sort; a "Few students borrow" chip (at most 20% with a federal
  loan, `FEW_LOANS_MAX`; 271 colleges). "Borrow, then → now" in the 10-year changes view comes with the history (below).
- **Compare:** "Undergrads with a federal loan" and "Median debt, Pell Grant recipients" rows.
- **Glossary:** `federal-loan-rate`, `repayment-status`, `in-default`.

## Keep history?
- **Federal loan rate: series `federal_loan_rate`** (*in a follow-up PR*: the Scorecard API was too slow on 2026-09-29 to
  rebuild history in time for the first PR). Key 2009 on, stored at its school year (key Y → Y−1–Y), so it lines up
  with the aid series; history family `scorecard-loans`; the build checks it ends on the snapshot's value. Charted in
  "Over time" → Aid next to grant share, with the national band, and summarized in `school.trends.federal_loan_rate`.
- **Debt by Pell/income: none.** Year-prefixed values exist but stop at 2020, like `median_debt`.
- **Repayment: none** (one cohort).

## Top-level trend?
- **Hero: no.** Borrowing depends on aid policy and family income; direction isn't a clean question.
- **Explore change column (with the history follow-up):** loan rate change in points (`school.trends.federal_loan_rate`), because "fewer students need
  loans" is a real selling point of no-loan aid policies. Left out under 300 undergrads at either end.
- **"Known for":** "Few students borrow" for the lowest 5% of loan rates among colleges with 1,000+ undergrads (metric
  `loanRateLarge`). About 5% of all colleges report 0%: mostly colleges outside the federal loan program; the profile
  line says so.
