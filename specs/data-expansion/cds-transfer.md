# CDS Transfer Admissions

> Status: **skeleton**. Wave 4. **Blocked on the [college-reported data agent](../college-reported-data.md).**
> Research 2026-09-28. Part of [data-expansion](README.md).

## Question it answers
*Can I transfer in? How many transfer applicants get in, and what do they need?* No federal file has transfer
applicants or admits; IPEDS only counts transfer students once enrolled (EF, OM).

## Source: CDS section D
| Item | What |
|---|---|
| D1 | Enrolls transfer students? |
| **D2** | Transfer applicants, admitted, enrolled (by sex and total) |
| D3 | Terms transfers may enroll |
| D4–D5 | Minimum credits; required materials (transcript, essay, interview, standardized tests) |
| D6–D7 | Minimum high school GPA; **minimum college GPA** (on a 4.0 scale) |
| D8–D9 | Other requirements; application deadlines |
| D10–D16 | Credit limits, residency requirements, credit policies |

## Ingest (when unblocked)
- Extraction schema: `d2` (applicants, admitted, enrolled), `d7` minimum college GPA, `d4` minimum credits, deadlines.
- Checks: admitted ≤ applicants, enrolled ≤ admitted; transfer enrollment is within 25% of the federal count of new
  transfer students (`DRVEF` `EFUGTRN`; Vanderbilt fall 2024: 359), otherwise review.

## Store
```ts
reported.transfer: { applicants, admitted, enrolled, min_college_gpa: number | null, min_credits: number | null,
                     terms: ("fall" | "spring" | "summer")[] } | null
```
Plus the federal count of new transfer students (from DRVEF, no agent needed) under `demographics.new_transfers`;
that part can ship earlier, with [residence.md](residence.md), which loads the same file.

## Display
- **Profile, Admissions:** a "Transferring in" card: transfer admit rate beside the first-year rate, minimum college
  GPA, terms.
- **Explore:** "Admits transfers" filter (from D1, or the federal count > 0).

## Keep history?
**Series per CDS edition** for the transfer admit rate, once 2+ editions exist. Federal new-transfer count: **series**
from DRVEF (yearly).

## Top-level trend?
**None.** Useful at the college level only.
