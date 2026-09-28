# Graduation by Group: Pell and Race/Ethnicity (IPEDS GR)

> Status: **planned**. Wave 2. New file: `GR{Y}_PELL_SSL`; race/ethnicity from Scorecard (or `GR{Y}`).
> Research 2026-09-28. Part of [data-expansion](README.md).

## Question it answers
*Do lower-income students graduate as often as everyone else here? Do Black and Hispanic students?* Gaps say more
about how a college supports students than the overall rate does.

## Source
**Pell: `GR{Y}_PELL_SSL`** (6-year, 150% of normal time, first-time full-time; one row per college per cohort type).
Three groups: Pell recipients (`PG*`), subsidized-loan recipients without Pell (`SS*`), neither (`NR*`), plus total
(`TT*`). Present from **GR2016** (GR2015 doesn't exist).

Vanderbilt GR2024: Pell 218 of 244 finished a bachelor's (89.3%); neither Pell nor subsidized loan 1,240 of 1,316
(94.2%); all students 1,491 of 1,594 (93.5%). Gap: 4.9 points.

**Race/ethnicity: Scorecard** `latest.completion.completion_rate_4yr_150_{white, black, hispanic, asian, …}`
(coverage for Black students 1,575, Hispanic 1,614 of 1,893; year keys from 2010/2011 to 2024). The same numbers are
in IPEDS `GR{Y}` by `GRTYPE`, but the Scorecard fields are already per-college rates, and history comes from the same
batches as `grad_rate`.

Rejected: Scorecard `completion.title_iv.pell_recip.*` (stops at the 2019 key).

## Ingest
- `sync-data` loads `GR{Y}_PELL_SSL` newest-first; rates = completers ÷ adjusted cohort. Suppress under 30 in the
  adjusted cohort.
- Race fields join the Scorecard call; history adds them to `scorecard.mts` (year Y = entering Y − 6, like `grad_rate`).

## Store
```ts
outcomes.grad_rate_pell: number | null
outcomes.grad_rate_no_pell_no_loan: number | null
outcomes.grad_rate_by_race: { white, black, hispanic, asian, two_or_more, … } | null
```
Plus cohort sizes for the suppression rule and for tooltips. `SourceKey` `ipeds-gr`.

## Display
- **Cost & outcomes:** a dot plot with the overall rate and each group's rate on one line, gaps labeled
  ("Pell recipients: 89%, 5 points below students with no need-based aid"). Groups under 30 are hidden, with a note.
- **Explore:** "Pell graduation gap" sort; filter "Pell gap under 5 points".
- **Compare:** rows for Pell and for each race group.
- **Glossary:** `pell-graduation-gap`, `adjusted-cohort`.

## Keep history?
**Series, yes.** Pell rate from entering fall 2010 (GR2016) on; race rates from ~2004 entering cohorts via Scorecard.
Small groups swing year to year; chart with a 3-cohort rolling average option and always show cohort sizes.

## Top-level trend?
- **Hero: no.** The gap direction is noisy at small colleges.
- **Home fact: candidate.** "The Pell graduation gap nationally": fixed panel, entering 2010 → newest; is it
  narrowing? Compute first.
- **"Known for":** "Pell students graduate at the same rate" (gap ≤ 2 points, 100+ Pell students in the cohort,
  overall rate ≥ 60%).
- **Explore change column:** Pell gap change.
