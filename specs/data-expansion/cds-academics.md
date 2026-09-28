# CDS Academics: Class Sizes

> Status: **skeleton**. Wave 4. **Blocked on the [college-reported data agent](../college-reported-data.md).**
> Research 2026-09-28 (Vanderbilt 2024–25). Part of [data-expansion](README.md).

## Question it answers
*How big are my classes?* Families ask this more than student-faculty ratio, and only the CDS has it.

## Source: CDS section I
| Item | What | Vanderbilt 2024–25 |
|---|---|---|
| **I-3** | Number of undergraduate class **sections** by size: 2–9, 10–19, 20–29, 30–39, 40–49, 50–99, 100+; and subsections (labs, discussions) separately | 489 / 605 / 362 / 204 / 40 / 104 / 39 = 1,843 sections |
| I-2 | Student-to-faculty ratio, with its student and faculty counts | 8 to 1 (7,190 students) |
| I-1 | Full-time and part-time instructional faculty, with terminal degrees, by sex and race | |

I-2 duplicates the federal ratio ([student-faculty-ratio.md](student-faculty-ratio.md)); use it only as a check (flag
differences over 2 points). I-1 overlaps [faculty.md](faculty.md); skip it.

## Ingest (when unblocked)
- Extraction schema: `i3.sections[7]`, `i3.subsections[7]`, `i2.ratio`, each with a quote.
- Checks: the 7 counts sum to the stated total (± 1); the ratio is within 2 of the federal ratio, otherwise review.

## Store
```ts
reported.academics.class_sections: { sizes: number[7], total: number, term: "Fall 2024" }
```
Derived: share of sections under 20 (Vanderbilt (489 + 605) ÷ 1,843 = 59%), share over 50.

## Display
- **Profile, Academics:** "59% of classes have fewer than 20 students": a 7-bar histogram of sections. The caveat that
  it counts sections, not students (a student is more likely to sit in a large lecture than 59% suggests).
- **Compare:** "Classes under 20 students" row.
- **Explore:** no filter (partial coverage).

## Keep history?
**Series per CDS edition** for "share under 20" once 2+ editions exist. Low priority.

## Top-level trend?
**None.** "Known for: small classes" once coverage is broad enough to set a percentile.
