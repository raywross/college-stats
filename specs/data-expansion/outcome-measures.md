# Outcome Measures: 8-Year Results for Every Student (IPEDS OM)

> Status: **planned**. Wave 2. New file: `OM{Y}`. Research 2026-09-28. Part of [data-expansion](README.md). Extends
> [cost-outcomes.md](../cost-outcomes.md).

## Question it answers
*What happens to everyone who starts here, including transfer students and part-timers? Did students who didn't finish
here finish somewhere else?* The graduation rate on the site today counts only first-time, full-time students and
treats a transfer out as a failure.

## Source
`OM{Y}`, one row per college × cohort type (`OMCHRT`):

| OMCHRT | Cohort |
|---|---|
| 50 / 51 / 52 | All entering / Pell / non-Pell |
| 10 / 11 / 12 | First-time full-time / Pell / non-Pell |
| 20–22 | First-time part-time (all / Pell / non-Pell) |
| 30–32 | Transfer-in full-time |
| 40–42 | Transfer-in part-time |

Measures: awards at 4, 6, 8 years (`OMAWDP4/6/8`), bachelor's counts, and **status at 8 years for those without an
award**: still enrolled here (`OMENRYP`), **enrolled elsewhere** (`OMENRAP`), unknown (`OMENRUP`).

| File | Entering cohort | Notes |
|---|---|---|
| OM2015 | fall 2007 | 4 cohort types, no Pell split (13,577 rows) |
| OM2017 → OM2024 | fall 2009 → fall 2016 | Pell split, 8-year status (verified OM2017, OM2018, OM2024) |

Scorecard mirrors it (`completion.outcome_percentage.{full_time,part_time}.{first_time,not_first_time}.8yr.*`,
year keys 2015–2024; coverage 1,776 of 1,893). Vanderbilt first-time full-time: 93.1% award in 8 years, 4.5% enrolled
elsewhere. **Use the IPEDS file**: it has Pell cohorts and cohort sizes, and one source keeps the split consistent.

## Ingest
`sync-data` loads `OM{Y}` newest-first; pivots rows by `OMCHRT`. Suppress a cohort's rates when its adjusted cohort
(`OMACHRT`) is under 30 (same rule Scorecard uses for suppression).

## Store
```ts
outcomes.eight_year: {
  entering_year: number,
  all:           { cohort, award, still_enrolled, transferred, unknown },
  first_time_ft: { … }, transfer_in_ft: { … },
  pell:          { cohort, award }, non_pell: { cohort, award }
} | null
```
~300 bytes per college. `SourceKey` `ipeds-om`, `VintageKey` `ipeds-om` ("Students entering fall 2016").

## Display
- **Cost & outcomes:** an **outcome waffle/stacked bar** for all entering students: earned a credential here · still
  here · enrolled elsewhere · unknown. Headline: "93 of 100 students who start here earn a degree within 8 years; 4 more
  are enrolled at another college."
- A toggle for first-time vs transfer-in students, useful for colleges with many transfers.
- **Explore:** "8-year completion (all students)" column; this is fairer than the 6-year rate for commuter and
  transfer-heavy colleges.
- **Glossary:** `outcome-measures`, `transfer-out`, `adjusted-cohort`.

## Keep history?
**Series, entering cohorts 2009 → newest** (8 cohorts today, one more each year): all-student award rate, transfer-out
rate, Pell and non-Pell award rates. Labeled by entering year, like `grad_rate` ([trends-data.md](../trends-data.md)).

## Top-level trend?
- **Hero indicator: recommended — "Graduation: Are more students finishing?"** Use the existing 6-year `grad_rate`
  history (longer, ~1997 on) as the measure, since it's what the headline shows. OM supplies the context line ("plus 4%
  finish elsewhere"). Thresholds from the distribution, like the other four ([trend-indicators.md](../trend-indicators.md#thresholds));
  ship it as its own small spec change once computed.
- **"Known for":** "Most students who leave finish elsewhere" (high transfer-out share) is informative for small colleges.
