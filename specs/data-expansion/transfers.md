# Transfers: Students Coming In and Going On (IPEDS EF part A + OM)

> Status: **built** 2026-10-02 with wave 2 (PR #41). Part of [data-expansion](README.md). Uses
> [outcome-measures.md](outcome-measures.md) for transfers out.

## Question it answers
*How many students transfer in each year? How many leave for another college?* This matters for transfer applicants
judging whether a college takes transfers, and for families gauging how many students leave.

## Source
**Transfers in, every fall: `EF{Y}A`** (Fall Enrollment part A), one row per college per enrollment level
(`EFALEVEL`), total in `EFTOTLT`. The data dictionary (EF2024A, EF2008A) defines the levels read:

| EFALEVEL | Meaning |
|---|---|
| 4 / 24 / 44 | Undergraduate, degree/certificate-seeking, **first-time** (all / full-time / part-time) |
| 19 / 39 / 59 | Undergraduate, other degree/certificate-seeking, **transfer-ins** (all / full-time / part-time) |

Probed 2026-10-02:
- **Missing rows are zeros:** NCES leaves out zero rows, so a missing level means 0 for a college that reported
  part A. 49 site colleges have no transfer-in row, and DRVEF2024 shows 0 for them.
- **Full-time plus part-time equals the total:** level 19 = 39 + 59 for every site college in EF2024A.
- **NCES's derived file agrees:** `DRVEF{Y}` `EFUGTRN` (transfer-ins) and `EFUG1ST` (first-time) match levels 19 and
  4 for 1,891 of 1,893 site colleges in 2024. `DRVEF` exists only for recent years; the raw `EF{Y}A` files go back further.
- **Coverage over time:** transfer-in levels exist from EF2008A. EF2006A has none (not probed: 2007).
- **Vanderbilt fall 2024:** 359 transfer-ins and 1,630 first-time students. Michigan: 1,580 and 7,278. SF State:
  2,318 and 2,340.

**Transfers out: by entering class, not by year.** No federal file counts students leaving for another college in a
given year. The closest measure is Outcome Measures, already on the site: of each entering class, the share who left
without an award and were **enrolled at another college 8 years later** (`OMENRAI`). The page says exactly that and
never presents it as an annual count.

## Store
```ts
demographics.transfer_in: {
  count: number,           // new transfer-in undergraduates this fall (level 19)
  full_time: number,       // level 39
  part_time: number,       // level 59
  share_of_new: number | null  // transfer-ins ÷ (transfer-ins + first-time degree-seeking); null when both are 0
} | null
```
Null when the college isn't in `EF{Y}A`. `SourceKey`/`VintageKey` `ipeds-ef-a` ("Fall 2024"). It's separate from
`ipeds-ef` (part D) and `ipeds-ef-c` (part C), so each citation links the file it came from. The reader is
`transferInFrom` in lib/transfers.ts, shared by sync-data and history.

Transfers out need no new storage: `outcomes.eight_year.*.transferred` and `.cohort` give the share and count.

**As built (2026-10-02):** 1,892 colleges. The level codes were checked against the derived file for all 1,892.
Vanderbilt: 359 (18.0% of new undergraduates). Michigan: 1,580 (17.8%). SF State: 2,318 (49.8%). History: Vanderbilt
172 (2008) → 359 (2024).

## Display
- **Profile, Students → "Transfers in and out"**:
  - **In:** "359 students transferred in this fall, 18% of new undergraduates", with the full-time/part-time split
    and a national comparison.
  - **Out:** "Of students who entered in fall 2016, 5% (≈90) had left and were enrolled at another college 8 years
    later".
  - Each half shows its own year and citation, since the two come from different files and years.
- **Over time → Students**: "New transfer students each fall", with the count and the share of new undergraduates,
  2008 → newest.
- **Explore**: sort "Transfer students (largest share of new students)", and a table column.
- **Compare**: rows for transfer-ins and their share.
- **Glossary**: `transfer-in`.

## Keep history?
**Series**: `transfer_in_count` and `transfer_in_share`, every fall from 2008 (family `ef-a`, `EF{year}A`).

## Refresh and maintenance
How each yearly part A file carries forward, and what fails loudly if NCES changes something:

| When NCES publishes… | What happens | Guard |
|---|---|---|
| A new `EF{Y}A` (spring release) | sync-data takes the newest file, so "Fall 2025" comes from the file name through lineage; history adds a point | Release calendar spring entry lists `EF{Y}A` and now `ipeds-ef-a` |
| Renumbered or redefined levels | sync-data stops before writing: (1) level 19 must equal 39 + 59 for at least 99% of colleges; (2) levels 19 and 4 must match NCES's own `DRVEF{Y}` totals for at least 99% of the colleges in both | `checkTransferLevels` in scripts/lib/transfers-sync.mts, tested |
| `DRVEF{Y}` not out yet when `EF{Y}A` is | sync-data warns and skips check (2); check (1) still runs | Warning in the sync log |
| A college missing from the newest file | `transfer_in` is null for it, never 0 | Reader test |
| A new history year | Rule 1: each series' last point equals the snapshot | `scripts/history/build.mts` end-point checks |
| A college reports 0 first-time and 0 transfer students | `share_of_new` is null, not 0% or a divide-by-zero | Reader test |

The UI never hard-codes a year. Transfer-in years come from the `ipeds-ef-a` vintage, transfer-out years from
`entering_year`.

## Out of scope / follow-ups
- Transfer admissions (applicants, admit rate): Common Data Set section D, in
  [cds-transfer.md](cds-transfer.md).
- Where transfer-outs go: not in federal data.
