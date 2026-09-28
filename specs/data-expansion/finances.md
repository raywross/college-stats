# Finances: Endowment and Spending (IPEDS F / DRVF)

> Status: **planned**. Wave 2. New file: `DRVF{Y}` (derived per-student finance). Research 2026-09-28.
> Part of [data-expansion](README.md).

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
