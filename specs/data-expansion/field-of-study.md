# Earnings and Debt by Major (Scorecard Field of Study)

> Status: **planned**. Wave 3. After [majors.md](majors.md) (uses the detail file and CIP table). Research 2026-09-28.
> Part of [data-expansion](README.md).

## Question it answers
*What do graduates in my major from this college earn? Is it more than the same major elsewhere?*

## Source
College Scorecard Field of Study data, per college × 4-digit CIP × credential. Available through the same API key
(`latest.programs.cip_4_digit`, an array per college) or as a bulk CSV (`Most-Recent-Cohorts-Field-of-Study`).

Vanderbilt: 181 programs, **53 bachelor's**, of which **19** have 4-year median earnings (the rest are suppressed for
small cohorts). Example, Computer Science bachelor's:

| Measure | Value |
|---|---|
| Graduates (two pooled years) | 205, 198 |
| Median earnings 1 year after completion | $122,244 |
| Median earnings 4 years after | $160,021 |
| National median, same field and credential, 4 years | $107,009 |
| 4 years, Pell / non-Pell | $126,718 / $189,399 |

Each program also has Parent PLUS and graduate debt, and repayment. Fields are per program, so 1,893 colleges ×
~50 bachelor's programs ≈ 100K rows.

## Ingest
- Prefer the **bulk CSV** (one download, ~100K rows) over paging the API for 1,893 colleges' arrays. Keep bachelor's
  (credential level 3) only.
- A program with fewer than the suppression threshold shows as "Too few graduates to report", never as missing.
- Validate: 4-digit CIP codes exist in the CIP table from [majors.md](majors.md).

## Store
- **Detail shard only** (`data/detail/schools/{unitid}.json`, from majors.md):
  `programs[cip4].earnings: { y1, y4, y4_national, y4_pell, y4_non_pell }`, `debt_median`, `graduates`.
- **Snapshot:** none, except a count `academics.programs_with_earnings` for Explore.
- `SourceKey` `scorecard-fos`, vintage = the cohort years the dataset labels (register in `meta.sources`).

## Display
- **Profile, Academics → majors list:** each major row expands to earnings 1 and 4 years out, with the national
  median as a tick. "Top-earning majors here" list (top 5 with data).
- **Compare:** a "your major" row: pick a 4-digit field, compare earnings across the colleges.
- **Explore:** later, a "major" mode that lists colleges by earnings for one field (needs an index across shards:
  build `data/detail/by-cip/{cip4}.json` at sync time).
- **Glossary:** `field-of-study`, `earnings-after-completion` (measured from completion, unlike the institution-level
  "after entry" earnings the site shows today; say so).

## Keep history?
**None.** Cohorts are pooled across years and the methodology changed between releases (as with institution earnings
in [trends-data.md](../trends-data.md), which aren't trended either). Show the latest release only.

## Top-level trend?
**None.** A snapshot comparison, not a trend.
