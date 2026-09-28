# Student Body (Scorecard)

> Status: **planned**. Wave 1. New fields on the existing Scorecard call. Research 2026-09-28.
> Part of [data-expansion](README.md).

## Question it answers
*What's the gender balance? Are most students full-time and traditional age?*

## Source
College Scorecard (from IPEDS fall enrollment). Coverage across the site's 1,893 colleges, and Vanderbilt:

| Field | What | Coverage | Vanderbilt | Years (year-prefixed) |
|---|---|---|---|---|
| `latest.student.demographics.men` / `.women` | Share of degree-seeking undergrads | 1,893 | 47.5% men | 2005–2024 |
| `latest.student.part_time_share` | Share part-time | 1,890 | 0.6% | 2005–2024 |
| `latest.student.share_25_older` | Share aged 25+ | 1,848 | 0.2% | *unverified* |
| `latest.student.demographics.age_entry` | Average age at entry | 1,814 | 19 | *unverified* |

Year keys follow `student.size`: key Y = fall Y (see [trends-data.md](../trends-data.md#build-notes-phases-23)).

## Ingest
Add the four fields to `FIELDS` in `sync-data.mts`. History: add `{Y}.student.demographics.men` and
`{Y}.student.part_time_share` to `scripts/history/scorecard.mts` (same batches).

## Store
```ts
demographics.men_share, women_share, part_time_share, age_25_plus_share: number | null
demographics.avg_entry_age: number | null
```
Registered with `scorecard(…, "demographics", "scorecard-enrollment")`.

## Display
- **Profile, Students:** a men/women split bar beside race/ethnicity; "Almost everyone studies full-time" or "38% study
  part-time"; "Many adult students" chip when 25+ is above the national 75th percentile.
- **Explore:** gender-balance filter ranges (e.g. "At least 40% men"), part-time max; table columns.
- **Compare:** rows for all four.
- **Glossary:** `part-time-student`, `degree-seeking`.

## Keep history?
**Series: men's share and part-time share**, fall 2005 on (20 years, verified at Vanderbilt and Michigan). Age fields:
none (noisy, low interest).

## Top-level trend?
- **Home fact: candidate.** The national decline in men's share of undergraduates is a known, real story; compute it
  on a fixed panel of site colleges (fall 2014 → newest). Use it only if the change is at least 2 points.
- **Hero: no.** Direction without a question families ask of every college.
- **Explore change column:** men's share change (points), next to diversity.
- **"Over time" → Students:** men's share line, with the national median band.

## Open questions
1. Scorecard's men/women shares use degree-seeking undergrads; our headcount is `student.size` (also degree-seeking).
   Confirm they share a denominator before showing counts.
