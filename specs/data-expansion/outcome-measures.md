# Outcome Measures: 8-Year Results for Every Student (IPEDS OM)

> Status: **built** 2026-10-02. Wave 2. New file: `OM{Y}`. Research 2026-09-28; files probed 2026-10-02. See
> [As built](#as-built). Part of [data-expansion](README.md). Extends [cost-outcomes.md](../cost-outcomes.md).

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

## As built
- **Probe (2026-10-02).** OM2017 through OM2024 have the same 15 cohort codes and the same columns (`OMACHRT`,
  `OMAWDN8`, `OMENRYI`, `OMENRAI`, `OMENRUN`, …); OM2015–16 use codes 1–4 and no Pell split, so history starts with
  OM2017 (fall 2009). In OM2024 1,852 of the site's 1,893 colleges have a row; every count is a plain number (no
  blanks or negative codes), award + still enrolled + elsewhere + unknown equals the adjusted cohort in every row, and
  cohorts 10 + 20 + 30 + 40 and 51 + 52 each sum to cohort 50. Vanderbilt fall 2016: 1,690 of 1,816 (93.1%) earned an
  award, 85 (4.7%) enrolled elsewhere; Pell 87.6%, non-Pell 93.9%.
- **Source.** `SourceKey`/`VintageKey` `ipeds-om` ("Students entering fall 2016", edition OM2024). `sync-data` loads
  `OM{Y}` newest-first through the shared cache (`.cache/ipeds`) and fails if a column is missing. OM has one row per
  cohort, which `fetchIpedsTable` would collapse by unit ID, so `scripts/lib/om.mts` re-reads the CSV and pivots it
  into one row per college (`OMACHRT_50`, …). The winter release on the release calendar now brings OM2025 (fall
  2017). The Data page's period parser reads "Students entering fall 2016" as fall 2016.
- **Store.** `outcomes.eight_year` (`lib/outcome-measures.ts` `eightYearFrom`, shared with history):
  `{ entering_year, all, first_time, transfer_in, pell, non_pell }`; each group is `{ cohort, award, still_enrolled,
  transferred, unknown }` (shares of the adjusted cohort, computed from counts and rounded to 4 places, not NCES's
  whole-number percents); Pell and non-Pell are `{ cohort, award }`. Rates are null when a group's adjusted cohort is
  under 30; the cohort size stays. 1,774 colleges have all-student rates.
- **Deviation: groups.** `first_time` and `transfer_in` each sum full-time and part-time (codes 10 + 20, 30 + 40)
  instead of the spec's full-time-only `first_time_ft` / `transfer_in_ft`, so the toggle's groups add up to "all
  students" and part-time students aren't dropped.
- **Display.**
  - Profile, Cost & outcomes: an "Everyone who starts here, 8 years later" card under "Staying and finishing": a 100%
    bar (earned here · still here · enrolled at another college · no record) in one hue's lightness steps plus gray,
    with a legend carrying every value, the headline sentence ("93 of 100 students who start here earn a degree or
    certificate here within 8 years; 5 more are enrolled at another college."), and a toggle for all students /
    started in college here / transferred in (groups under 30 are hidden). Beside it, Pell vs non-Pell 8-year
    completion and the national median. New chart `components/charts/OutcomeBar.tsx` (the admissions Waffle is a
    funnel, not four parts); card `components/school/OutcomeMeasures.tsx`.
  - Explore: column "8-yr completion, all" and sort "8-year completion, all students" (`sortBy=completion_8yr`).
  - Compare: rows "Credential within 8 years, all students" and "Enrolled at another college, 8 years on".
  - Metrics `completion8` and `transferOut` (domain `value`).
  - Glossary: `outcome-measures`, `transfer-out`, `adjusted-cohort` (also says why groups under 30 aren't shown).
  - **"Known for": "Most who leave go on to another college"**: the national top 5% for transfer-out (about 40% or
    more of all entering students enrolled elsewhere) where most who left without a credential enrolled elsewhere.
    **Deviation:** the spec's wording "finish elsewhere" isn't what the data says: OM records enrollment at another
    college, not completion there.
- **History.** Family `om` (OM2017 on, kind `cohort`, stored at the entering fall), series `om_award`, `om_transfer`,
  `om_award_pell`, `om_award_non_pell`, with national bands for the first two. The end-point check compares them with
  the snapshot at the newest OM class. Over time's Outcomes group has two new charts (credential within 8 years with
  Pell and non-Pell lines; enrolled elsewhere), windowed on their own last class since OM ends years before
  `grad_rate`.
- Tests: `tests/outcome-measures.test.mts` (pivot, reader, suppression, sums, Vanderbilt, rule 1).

### Follow-ups (not built)
- **Hero "Graduation" trend indicator** with OM's "plus 4% finish elsewhere" context line: its own small spec change,
  as this spec says.
- An Explore filter on 8-year completion, and a "Known for" or profile note for colleges whose transfer-in students
  finish at a higher rate than first-time students.
- The 4- and 6-year award rates and bachelor's-only counts are in the file but not stored.
