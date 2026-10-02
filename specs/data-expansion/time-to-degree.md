# Time to Degree: Finishing Within 4, 6, and 8 Years (IPEDS OM)

> Status: **built** 2026-10-02 with wave 2 (PR #41). Part of [data-expansion](README.md). Extends
> [outcome-measures.md](outcome-measures.md), which already reads the file.

## Question it answers
*How many students finish on time? How many need 6 years, or 8?* The site's graduation rate is a single 6-year
number for first-time, full-time students. Families planning for four years of tuition want to know how many students
actually finish in four.

## Source
The same `OM{Y}` file as [outcome-measures.md](outcome-measures.md), one row per college per cohort (`OMCHRT`). It
reports, for each cohort, the number who **earned any award by 4, 6, and 8 years** after entry: `OMAWDN4`, `OMAWDN6`,
`OMAWDN8` (the data dictionary: "receiving an award at 4 years (August 31, 2020)" for OM2024). The counts are
**cumulative**: someone who finished in 4 years is also counted at 6 and 8.

Probed 2026-10-02:
- `OMAWDN4 ≤ OMAWDN6 ≤ OMAWDN8` in every site cohort row of OM2017 (23,438 rows) and OM2024 (24,202 rows).
- The columns exist with the same names in OM2017 through OM2024.
- Vanderbilt, first-time full-time students who entered fall 2016: 1,410 / 1,479 / 1,484 of 1,594 (88% / 93% / 93%).
  Pell recipients 80% / 87% / 87%.

**Why OM and not the graduation-rate file:** GR reports 4-, 5-, and 6-year bachelor's rates for first-time full-time
students only. OM covers every cohort the profile already shows (first-time, transfer-in, Pell). It is also one file
with one entering class, so the three numbers always describe the same students. GR's 4-year rate would be about
2 years fresher; that's a possible follow-up, not built.

## Store
Each `EightYearGroup` (`all`, `first_time`, `transfer_in`) and the Pell and non-Pell awards gain two shares beside the
existing 8-year `award`:

```ts
award_4: number | null  // earned an award within 4 years, share of the adjusted cohort
award_6: number | null  // within 6 years
award:   number | null  // within 8 years (unchanged)
```
The same 30-student rule hides all three together. Read by `eightYearFrom` (lib/outcome-measures.ts), so sync-data
and history share one reader. The 4- and 6-year counts are kept apart from the counts that must sum to the cohort,
so a problem in them can never hide the 8-year outcomes.

**As built (2026-10-02):** 1,774 colleges, the same as the 8-year outcomes. No shown group lacks its 4- and 6-year
shares. Vanderbilt, all entering students: 88.7% / 92.8% / 93.1%. SF State, first-time students: 26% / 53% / 57%.

## Display
- **Profile, Cost & outcomes → "Everyone who starts here, 8 years later"**: a "How long it takes" table. It has a row
  each for all students, students who started in college here, and students who transferred in, and columns for within
  4, 6, and 8 years. Hidden groups show "–".
  - Headline: "62 of 100 finish within 4 years, 74 within 6, 76 within 8."
  - Note for transfer students: their clock starts when they arrive at this college, not when they first started college.
- **Over time → Outcomes**: a "How long it takes" chart with 4-, 6-, and 8-year lines for all entering students, by
  entering class.
- **Explore**: sort "Finish within 4 years (all students)".
- **Compare**: a row "Credential within 4 years, all students".
- **Glossary**: `time-to-degree`.

## Keep history?
**Series**: `om_award_4` and `om_award_6` beside the existing `om_award`, entering classes 2009 → newest, same family
(`om`).

## Refresh and maintenance
How each yearly OM file carries forward without anyone touching code, and what fails loudly if it can't:

| When NCES publishes… | What happens | Guard |
|---|---|---|
| A new `OM{Y}` | sync-data takes the newest file (`OM_NAMES`, newest first); the entering year comes from the file name (`Y − 8`), so labels such as "entered fall 2017" update on their own | The release calendar's winter entry lists `OM{Y}` and `ipeds-om`, so /data shows when it's due and when it landed |
| The same file with the columns renamed | sync-data stops: `OM_COLUMNS` now includes `OMAWDN4` and `OMAWDN6`, and a missing column throws before anything is written | `fetchOutcomeMeasures` column check; history's `requiredColumns` |
| Counts that aren't cumulative (4 > 6 or 6 > 8), or a blank 4/6-year count | The reader drops that group's 4- and 6-year shares (null) instead of showing an impossible step down; the 8-year outcome bar is unaffected. sync-data prints how many groups lost them and **stops if more than 1% did**, since that means the file changed, not a few colleges' reporting | `timeToDegreeCoverage` in sync-data; `tests/time-to-degree.test.mts` asserts 4 ≤ 6 ≤ 8 for every stored group and that broken and blank rows are rejected |
| A new entering class in history | `om_award_4`/`_6` extend by one point; rule 1 checks each series' last point equals the snapshot | `scripts/history/build.mts` end-point checks for all three |
| A college drops below 30 students | All three shares go null together, so the table never mixes shown and hidden years | Reader test |

No year is written in UI code: the profile reads `entering_year` from the data, and citations come from lineage.

## Out of scope / follow-ups
- GR's fresher 4- and 5-year bachelor's rates (`GR{Y}`, 100% and 125% of normal time), as a "newest class" line.
- Bachelor's-only counts (`OMBACH4/6/8`): nearly identical at 4-year colleges.
