# Student-to-Faculty Ratio (IPEDS EF part D)

> Status: **built** 2026-09-30. Wave 2. New file: `EF{Y}D`. Research 2026-09-28; files probed 2026-09-30. See
> [As built](#as-built). Part of [data-expansion](README.md).

## Question it answers
*How many students per faculty member?* One of the most-asked-for numbers on college sites.

## Source
`EF{Y}D`, column `STUFACR` (whole number, "N to 1"). Present from **EF2009D** (absent in EF2004D and EF2008D).
Same file has retention (`RET_PCF`, which the site already takes from Scorecard) and cohort counts.

| | Fall 2014 | Fall 2019 | Fall 2024 |
|---|---|---|---|
| Site colleges reporting | 1,788 | 1,830 | 1,892 |
| Median | 14 | 13 | 13 |
| 25th–75th percentile | 11–17 | 10–17 | 10–16 |

Vanderbilt fall 2024: 8 (CDS I-2 agrees: "8 to 1, based on 7,190 students"). Scorecard doesn't carry it.

IPEDS computes it as FTE students ÷ FTE instructional staff, excluding staff who teach only graduate or professional
students. It's reported by the college, so definitions drift (some count research faculty).

## Ingest
`sync-data` loads `EF{Y}D` newest-first. Treat 0 and negatives as null. Latest is EF2024D (fall 2024); EF2025D is due
with the winter release.

## Store
```ts
academics.student_faculty_ratio: number | null
```
New `SourceKey` `ipeds-ef`, `VintageKey` `ipeds-ef` ("Fall 2024"). New topic `academics` (shared with
[majors.md](majors.md), [faculty.md](faculty.md), [cds-academics.md](cds-academics.md)).

## Display
- **Profile:** Overview bento gains "8 : 1 students per faculty" with rank. A new **Academics** section (section nav)
  holds it with class sizes ([cds-academics.md](cds-academics.md)), faculty ([faculty.md](faculty.md)), and majors.
- **Explore:** sort and max-ratio filter.
- **Compare:** row.
- **Glossary:** `student-faculty-ratio` (say what it isn't: it's not average class size).

## Keep history?
**Series, fall 2009 on** (16 years). Cheap: one column per year. Goes in "Over time" → a new Academics group.

## Top-level trend?
- **Hero: no.** The national median moved 1 point in 10 years; most colleges will read "Steady", which wastes a card.
- **"Known for":** "Very small student-faculty ratio" at the national bottom 5% (a snapshot standout, not a trend).
- **Explore change column: no.**

## As built
- **Source.** `SourceKey`/`VintageKey` `ipeds-ef` ("Fall 2024", edition EF2024D). `sync-data` loads `EF{Y}D`
  newest-first and fails if the file has no `STUFACR`. The winter release entry on the release calendar now brings
  EF2025D. The probe confirmed the research: `STUFACR` from EF2009D (EF2008D has none), 1,892 of 1,893 colleges in
  fall 2024, median 13 (10–16), no zero or negative codes in any year.
- **Store.** `academics.student_faculty_ratio` (whole number; `lib/academics.ts` `studentFacultyRatioFrom`, shared with
  history), new topic `academics` ("Academics" on the Data page).
- **Metric.** `METRICS.studentFaculty` (domain `size`: no new palette color; ratios read as "8 to 1", format kind
  `ratio`). Comparisons flip at the median: "fewer students per faculty member than at 96% of colleges" below it,
  "more … than at 90%" above it, never "fewer than at 10%".
- **Display.**
  - Profile: an Overview tile ("8 to 1") and a new **Academics** section (nav included) with the national distribution
    strip and a note that it isn't class size. The section is where class sizes, faculty, and majors will go.
  - "Known for": "Very small student-faculty ratio" at the national bottom 5%, which works out to 5 to 1 or lower
    (83 colleges, e.g. Yale, Duke, Princeton).
  - Explore: sort "Students per faculty (fewest)" and a **Students per faculty** filter (8, 10, 12, or 15 or fewer;
    `maxRatio=`); unreported ratios never match.
  - Compare: a row in "All the numbers".
  - Glossary: `student-faculty-ratio` (says it isn't class size).
- **History.** Family `ef-d` (EF2009D on, fall), series `student_faculty_ratio`, with a national band; the end-point
  check compares it at the newest EF year. Over time has a new **Academics** group. The change reads "9 → 8", not a
  percent (`TINY_BASE`); the chart panel now honors `TINY_BASE` too, which also fixes small applicant pools there.
- **Also fixed:** the profile's section nav hid "Campus life" for colleges with athletics or programs but no housing
  data (from #36).
- Tests: `tests/student-faculty-ratio.test.mts`.
