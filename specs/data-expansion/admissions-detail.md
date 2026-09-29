# Admissions Detail (IPEDS ADM)

> Status: **planned**. Wave 1. Source file already downloaded. Research 2026-09-28. Part of [data-expansion](README.md).

## Question it answers
*Is it harder to get in as a man or a woman? What's the typical admitted score, exactly?*

## Source
Columns in `ADM{Y}` the site doesn't read yet (verified in ADM2024):

| Columns | What | Years |
|---|---|---|
| `APPLCNM`/`W`, `ADMSSNM`/`W`, `ENRLM`/`W` | Applicants, admits, enrollees by sex | fall 2001 on (history already reads them to build IC2001 totals) |
| `APPLCNAN`, `APPLCNUN` (and admit/enroll equivalents) | Another gender, gender unknown | fall 2022 on |
| `SATVR50`, `SATMT50`, `ACTCM50` | **True medians** | fall 2022 on (absent in ADM2021) |
| `ACTEN25/50/75`, `ACTMT25/50/75` | ACT English and Math | fall 2001 on (verified back to IC2005) |
| `SATNUM`, `ACTNUM` | Number submitting | fall 2001 on |
| `ENRLFT`, `ENRLPT` | Full-/part-time enrollees | fall 2001 on |

Vanderbilt fall 2024: men 1,238 of 20,851 admitted (5.9%), women 1,424 of 24,553 (5.8%); SAT EBRW median 750, math 790;
ACT composite median 35.

## Ingest
`sync-data` reads the extra columns from the ADM table it already loads. Admit rate by sex uses the same `applicants ≥ 10`
rule as the overall rate (lib/derive.ts), per sex.

## Store
```ts
admissions.by_sex: { men: { applicants, admitted, enrolled }, women: {...} } | null
admissions.sat_reading_median, sat_math_median, act_composite_median: number | null
admissions.act_english_25_75, act_math_25_75: [number, number] | null
```
Registered under `ipeds-adm`. The derived SAT midpoint (`derived.sat_mid`) keeps working; where a true median exists,
the range bar's median tick uses it and the citation says "median" instead of "midpoint".

## Display
- **Profile, Admissions:** "By sex" pair of rates when the gap is at least 3 points *and* both groups have 200+
  applicants ("Women were admitted at 12%, men at 18%"). Otherwise a single line in the funnel's details.
- **Test scores:** median tick from the true median; ACT English/Math range bars behind a "Section scores" toggle.
- **Explore:** sort by admit-rate gap (men minus women) in the table; no filter.
- **Glossary:** `median-vs-midpoint`, `admit-rate-by-sex`.

## Keep history?
- **Series: yes** for admit rate by sex (back to fall 2001, same eras as applicants). The shard already downloads the
  columns; store `admit_rate_men`, `admit_rate_women`.
- **Medians: series from fall 2022** only (3 points today). Don't chart until 5 years exist; the older midpoint series
  continues for long views.
- ACT sections: no history (low interest).

## Top-level trend?
- **Hero: no.** The gap is interesting at few colleges.
- **"Known for":** "Admits men at a higher rate" (or women) when the gap is in the national top 5% with 1,000+ applicants
  per sex. Neutral wording, no verdict.
- **Home fact: maybe later:** the national share of colleges where men are admitted at a higher rate, over 20 years.
  Compute first; only use it if it's surprising.

## Open questions
1. "Another gender" counts are tiny; include in totals only, never as a rate.
