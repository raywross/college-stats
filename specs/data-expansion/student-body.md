# Student Body (Scorecard)

> Status: **built** 2026-09-29. Wave 1. New fields on the existing Scorecard call. Research 2026-09-28, probed again
> 2026-09-29. Part of [data-expansion](README.md).

## Question it answers
*What's the gender balance? Are most students full-time and traditional age?*

## Source
College Scorecard (from IPEDS fall enrollment). Coverage across the site's 1,893 colleges (2026-09-29 sync):

| Field | What | Coverage | Median college | Vanderbilt | Newest year |
|---|---|---|---|---|---|
| `latest.student.demographics.men` / `.women` | Share of degree-seeking undergrads | 1,893 | 43.6% men | 47.5% men | fall 2024 (key 2024) |
| `latest.student.part_time_share` | Share part-time | 1,890 | 7.5% | 0.6% | fall 2024 |
| `latest.student.share_25_older` | Share aged 25+ | 1,848 | 11.3% | 0.2% | **fall 2023** (odd falls only) |

Men and women always add to 100% (within rounding). Probed at Vanderbilt, Michigan, Harvard, and Berkeley: `latest` for
men/women and part-time equals year key 2024, the same fall as `student.size`. Age is collected in IPEDS fall enrollment
part B only in odd-numbered falls, so `latest` equals key 2023 (with 2021, 2015, 2005 before it).

**Left out:** `latest.student.demographics.age_entry` (average age at entry). Its `latest` matches the 2014–15 keys and
nothing newer exists, so it would be a decade stale.

## Ingest
`sync-data.mts` requests the four fields with the rest of the Scorecard call. `detectScorecardYears` probes
`student.share_25_older` alongside enrollment and cost to find the age year. History reads `{Y}.student.demographics.men`
and `{Y}.student.part_time_share` in `scripts/history/scorecard.mts`, in the same batches as undergrads.

## Store
```ts
demographics.men_share, women_share, part_time_share, age_25_plus_share: number | null   // rounded to 4 places
```
Men, women, and part-time are registered with `scorecard(…, "scorecard-enrollment")`. Age has its own vintage,
`scorecard-age` (meta.json `vintages`, "Fall 2023"), so it's never cited with the enrollment year. The Data page shows it as
its own row, and the release calendar's Scorecard entry lists it.

## Display
- **Profile, Students:** a "Who they are" card below campus size (folded behind "Show men, women, part-time, and age" on
  phones; [mobile.md](../mobile.md)) with three benchmark bars against the median college:
  men (with the women's share under it), part-time students, students 25 and older. A line above says "Almost everyone
  studies full-time" (under 3% part-time) or "N% of undergrads study part-time". A "Many adult students" chip when the
  25+ share is above the 75th percentile of colleges (`ADULT_STUDENTS_RANK` in `lib/insights.ts`).
- **Explore:** a "Student body" filter section: gender-balance chips (Mostly women: under 40% men; Balanced: 40–60%;
  Mostly men: over 60% men) and "Mostly full-time" (at most 10% part-time), defined once in `lib/student-body.ts`.
  URL params `balance=women,balanced,men` and `fullTime=1`. Table column "Men"; sorts by share of men and part-time
  share. At the 2026-09-29 sync: 702 mostly women, 954 balanced, 237 mostly men; 1,100 mostly full-time.
- **Compare:** "Men / women", "Part-time students", and "Students 25 and older" rows in All the numbers, and three bars
  in Students (no "Highest" flags: none of these is better or worse).
- **Glossary:** `gender-balance`, `part-time-student`, `adult-students`, `degree-seeking`.

## Keep history?
**Series: `men_share` and `part_time_share`**, from fall 1996, the same years as undergrads: 1,600–1,890 colleges a
year, with the same missing fall 2000 (allow-listed in `EXPECTED_DROPS`). The spec first said 2005; the data is consistent
back to 1996, so the series keep every year. Rounded to 4 places like the snapshot; the history build checks that each
ends on the snapshot's value. National middle-half bands come with every series. Age: none (every other year, low
interest).

## Top-level trend?
- **Home fact: no (computed, below the bar).** Men's share of all undergraduates at the site colleges reporting each
  year, weighted by enrollment: 45.1% in fall 2014, 43.8% in fall 2024, a 1.3-point drop, short of the 2-point bar.
  (Longer view: 45.4% in fall 1996, 45.3% in 2013, a low of 43.4% in 2021.) Revisit after the next enrollment release.
- **Hero: no.** Direction without a question families ask of every college.
- **Explore change column:** "Men, then → now" in the 10-year changes view, in points; sort "Men's share change". Left
  out under 300 undergrads at either end (same floor as the size change).
- **"Over time" → Students:** men's share and part-time share lines, each with the national middle-half band.

## Open questions
None. (Denominators: the site shows only shares, never counts, so Scorecard's degree-seeking base needs no reconciling
with `student.size`.)
