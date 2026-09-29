# Student-to-Faculty Ratio (IPEDS EF part D)

> Status: **planned**. Wave 2. New file: `EF{Y}D`. Research 2026-09-28. Part of [data-expansion](README.md).

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
