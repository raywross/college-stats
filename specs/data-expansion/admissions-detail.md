# Admissions Detail (IPEDS ADM)

> Status: **built** 2026-09-29. Wave 1. Source file already downloaded. Research 2026-09-28; columns probed in every
> admissions file (IC2001–IC2013, ADM2014–ADM2024) on 2026-09-29. Part of [data-expansion](README.md).

## Question it answers
*Is it harder to get in as a man or a woman? What's the typical admitted score, exactly?*

## Source
Columns in `ADM{Y}` (and `IC{Y}` through fall 2013) the site didn't read before:

| Columns | What | Years (probed 2026-09-29) |
|---|---|---|
| `APPLCNM`/`W`, `ADMSSNM`/`W` | Applicants and admits by sex | every file from IC2001 |
| `ENRLM`/`W` | Enrollees by sex | IC2002 on (IC2001 splits them full-/part-time) |
| `APPLCNAN`, `APPLCNUN` (and admit/enroll equivalents) | Another gender, gender unknown | ADM2022 on |
| `SATVR50`, `SATMT50`, `ACTCM50` | **True medians** | ADM2022 on only |
| `ACTEN25`/`75`, `ACTMT25`/`75` | ACT English and Math, middle 50% | every file from IC2001 (the `…50` medians from ADM2022) |

Vanderbilt fall 2024: men 1,238 of 20,851 admitted (5.9%), women 1,424 of 24,553 (5.8%); SAT EBRW median 750, math 790;
ACT composite median 35; ACT English 35–36, Math 32–35.

Not stored: `SATNUM`/`ACTNUM` (the submission *rates* are already on the site) and `ENRLFT`/`ENRLPT` (student-body
covers part-time).

## Ingest
`sync-data` reads the extra columns from the ADM table it already loads (`bySex()` in `sync-data.mts`).

## Store
```ts
admissions.by_sex: { men: { applicants, admitted, enrolled }, women: {...} } | null
admissions.sat_reading_median, sat_math_median, act_composite_median: number | null
admissions.act_english_25_75, act_math_25_75: [number, number] | null
```
Registered under `ipeds-adm`, plus computed fields `derived.admit_rate_men`, `derived.admit_rate_women`, and
`derived.sat_median` (the section medians added, an approximation like the SAT total range). The rates use the overall
rate's rule (none under 10 applicants); `admitRatesBySex()` and `satMedian()` live in `lib/derive.ts` so the history
build shares them. "Another gender" and unknown count only in the totals, never as a rate.

Coverage at the 2026-09-29 sync (1,893 colleges): `by_sex` 1,586; both rates 1,427; true SAT medians 927; ACT median
895; ACT English/Math ranges 846–847. Of the 1,300 colleges with 200+ applicants of each sex, 708 have a gap of 3+
points: women admitted at the higher rate at 600, men at 108. So the "Men and women" card shows at about half of
colleges; raise `BY_SEX_NOTABLE_GAP` if that proves too common.

**Common Data Set overrides:** the 8 colleges with CDS admissions keep federal `by_sex`, medians, and ACT sections (no
override sets them). The profile draws a college's medians and ACT section ranges only when its score ranges are
federal too, so a federal median never sits on a college-reported range. The by-sex line carries its own source chip.

## Display
- **Profile, Admissions:** a "Men and women" card with a bar per sex and a sentence ("Women were admitted at 12%, men at
  18%") when the gap is at least 3 points (`BY_SEX_NOTABLE_GAP`) *and* both have 200+ applicants
  (`BY_SEX_MIN_APPLICANTS`). Otherwise one line under the funnel ("Men and women were admitted at similar rates…").
  Logic in `admissionsBySex()` (`lib/insights.ts`).
- **Test scores:** each college's own median as a ring on its range bars, with "median N" next to the range and a
  legend entry ("This college's median", glossary `median-vs-midpoint`); the national median midpoint line stays.
  ACT English and Math range bars sit under the ACT composite, the way SAT sections already sit under the SAT total
  (the spec's "Section scores" toggle wasn't needed: the SAT view shows sections without one).
- **Explore:** table column "Admit rate, men / women" (with the gap in points when it's 3+), sortable by the gap; sort
  option "Admit rate gap (men higher first)". No filter.
- **Compare:** "Acceptance rate, men / women" row in All the numbers.
- **Glossary:** `median-vs-midpoint`, `admit-rate-by-sex`.
- **See also:** [cds-residency-admissions.md](cds-residency-admissions.md)'s "Where applicants live" card reuses this
  card's pattern and notable-gap rule (its own thresholds: 5 points or 1.5×, 200+ applicants per group). The by-sex card
  stays federal.

## Keep history?
- **Series `admit_rate_men`, `admit_rate_women`**, fall 2001 on, same eras as applicants; charted in Over time →
  Admissions ("Acceptance rate, men and women": one hue, solid and dashed, directly labeled).
- **Series `sat_50`, `act_50`**, fall 2022 on (the ADM era is split at 2022 so the header check requires the median
  columns only where they exist). Kept but not charted until about 5 years exist.
- The history build checks each series ends on the snapshot's value (against the federal fall the snapshot was built
  from, so CDS colleges are covered too).
- ACT sections: no history (low interest).

## Top-level trend?
- **Hero: no.** The gap is interesting at few colleges.
- **"Known for":** "Admits men at a higher rate" (or women) when the gap's size is in the national top 5% among colleges
  with 1,000+ applicants of each sex (metric `admitGapSize`). Neutral wording, no verdict. At the 2026-09-29 sync, 910
  colleges qualify and the chip goes to about 46, with gaps of 12+ points (e.g. Harvey Mudd: men 8.6%, women 21.1%;
  Kalamazoo: men 85.8%, women 65.6%).
- **Home fact: not now (computed 2026-09-29).** Over a fixed panel of 912 colleges with both rates and 1,000+ applicants
  in fall 2004 and fall 2024: colleges admitting men at a rate 3+ points higher fell from 13% to 6%; colleges admitting
  women at a 3+ point higher rate rose from 43% to 48%. A steady drift, not a surprise, so it isn't a Home card. Revisit
  if the "men higher" share keeps falling.

## Open questions
None. ("Another gender" counts: totals only, never a rate.)
