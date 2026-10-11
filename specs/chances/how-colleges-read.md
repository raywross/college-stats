# How This College Reads a Record: Rigor, Crowded GPAs, and What Counts

> Status: **built** 2026-10-11 on `feature/chances` (see "As built"; planned 2026-10-10). Part 1 of [admission chances, revisited](README.md). Profile only; needs no account
> and no student numbers. Builds on the C7 grid already on the admissions page
> ([admission-factors.md](../data-expansion/admission-factors.md), [cds-admissions.md](../data-expansion/cds-admissions.md)),
> the C11 GPA bands (`GpaChecker`), C10 class rank, C8 course units (`HsPrepBox`), and the test policy block
> ([cds-test-scores-and-policy.md](../data-expansion/cds-test-scores-and-policy.md)).

## Goal
At a growing number of colleges a 3.9 unweighted GPA no longer tells a selective college much, so the college
leans on course rigor, tests, and the rest of the file. The site already stores every piece of evidence for that per
college, but shows them as separate tables: a factor grid, a GPA bar, a units box, a test-policy line. A family has
to do the reading. This part adds one short block at the top of "What they look at" that does the reading in plain
words, from the college's own filings, before any student numbers are involved:

> **How Vanderbilt reads a record.** Course rigor, GPA, and class rank are all *very important*; tests are
> *important*. **88% of first-years had a 3.75 or higher**, so a high GPA is common here and rarely sets an applicant
> apart; the courses behind it carry more of the weight. 24% of first-years sent an SAT and 28% an ACT. Of the 20%
> whose high school reported a rank, 91% were in the top tenth. Vanderbilt recommends 4 years of math and science
> (3 of each required).

(Vanderbilt's own CDS, read 2026-10-10.) Every number is cited (ⓘ) with its CDS edition. Nothing is a score or an index.

## The block: `ReadingTheRecord`
Computed by `readingTheRecord(school)` in `lib/chances/reading.ts` (pure, tested). Each line appears only when its
data exists, in this order; the block is hidden when fewer than two lines would show.

| Line | From | Rule |
|---|---|---|
| **Academic emphasis** | C7 rows rigor, GPA, test scores, class rank (CDS); else IPEDS factors (`admissions.factors`, required/considered) | One sentence naming the highest-rated academic factors together, then the lower ones: "Course rigor and GPA are both very important; tests are important; class rank is considered." With IPEDS only: "GPA and the high school record are required; class rank is considered." Never ranks colleges by it |
| **GPA crowding** | C11 bands, column `all` (with-test and without-test when `all` is blank) | `topShare = band[4.0] + band[3.75–3.99]`. Shown as "N% of first-years had a 3.75 or higher". When `topShare ≥ 0.5` add "so a high GPA is common here and rarely sets an applicant apart; the courses behind it carry more of the weight" — but only when C7 rates rigor at least *important* (otherwise "so a high GPA is common here") |
| **Weighted reporter** | C12 scale `weighted`, or bands piled into the top band (band mean ≥ 3.9 with C12 > 4.0) | Replaces the crowding sentence: "This college reports weighted GPAs (average 4.17), which pile most students into the top band; the bands can't show how crowded unweighted GPAs are." (The planner's GPA work found UGA, UNC, William & Mary, and WashU do this; see `specs/planner/redesign/gpa.md` on PR #105) |
| **Tests** | Test policy, submission shares (IPEDS or the newer CDS), C7 test row | "Tests are *important*; 24% of first-years sent an SAT and 28% an ACT." Test-optional with under 50% submitting: "Most first-years were admitted without scores." Test-blind: "Scores aren't read" |
| **Class rank** | C7 rank row, C10 `top_tenth`, `top_quarter`, `submitted_share` | Only when C7 rates rank at least *considered* and `submitted_share ≥ 0.15`: "Of the 20% whose high school reported a rank, 91% were in the top tenth." Otherwise: "Most high schools no longer rank; this college doesn't lean on it" when C7 says *not considered* |
| **Major** | `reported.major_admission[].review` ([major-and-grades.md](major-and-grades.md#data)), first wave only | "Applicants are compared within the college they apply to; engineering applicants get an extra look at math and science grades," or "The major you list doesn't affect admission." Only from a quoted statement; hidden otherwise |
| **Courses expected** | C8 units required and recommended (`admissions_hs_prep`) | The two subjects where recommended exceeds required by the most, or the four core subjects at their recommended years: "Recommends 4 years of math and science." Links to `#hs-prep` |

Coverage on 2026-10-10: emphasis from C7 at 147 colleges and from IPEDS factors at 1,586; crowding at 71 (bands
`all`) to 116 (any column); rank at 117; courses at 156. The block shows for every college with at least two lines,
so the C7 colleges get the full reading and most others get emphasis plus tests. Coverage grows with every
college-reported run (no code change).

### Crowding examples (C11, newest edition, measured 2026-10-10)
| College | Admit rate | First-years at 3.75+ | Reading |
|---|---|---|---|
| Vanderbilt | 5% | 88% | Crowded; rigor very important |
| Purdue | 43% | 71% | Crowded |
| University of Delaware | 71% | 70% | Crowded, though admitting most applicants: GPA crowding is not only an elite-college fact |
| Elon | 63% | 70% | Crowded; tests not considered, so the GPA and courses carry the file |
| Augustana College (IL) | 66% | 25% | Spread out: GPA still separates applicants |
| UNC Chapel Hill | 15% | 97% (weighted) | Weighted reporter sentence instead |

The median across the 71 colleges with an `all` column is 46%; 28 are at 50% or more.

## Where it shows
- **Admissions page**, first thing under "What they look at", above the C7 grid; the grid stays as the evidence.
- **Overview admissions card**: no change (the card stays short); its footer link already goes here.
- **Compare**: a "How they read a record" row with the emphasis sentence and the crowding share for each college.
- **Planner**: the college's row drawer ([../planner/redesign/list.md](../planner/redesign/list.md)) links to this
  block from the group's ⓘ ("How Vanderbilt reads a record"), so the plan's first screen stays free of statistics.
- **iPhone API**: one more block in the admissions screen ([../iphone-app/api.md](../iphone-app/api.md)).

## Lineage
- New derived field `derived.gpa_top_share` in `lib/fields.ts`: formula "share of first-years with a 3.75 or higher,
  summed from the college's C11 bands", inputs the two band paths, cited with the bands' edition. The block lists it
  and the existing C7, C10, C8, and test fields in its section's `fields`.
- No year is written in the component; the sentence's edition comes from lineage.

## Glossary
New terms: `gpa-crowding` ("When most admitted students have nearly the same top GPA, the GPA can't tell them apart,
so colleges read the courses behind it, the tests, and the rest of the file"), `course-rigor` ("How demanding a
student's classes are compared with what the high school offers; the counselor's report rates it"). `holistic-admission`
(already planned in [chances-and-fit.md](../product/chances-and-fit.md#display)) links both.

## Files (planned)
`lib/chances/reading.ts` (pure: the lines and their rules), `components/school/ReadingTheRecord.tsx`, the Compare row
in `lib/compare-cards.ts`, `derived.gpa_top_share` in `lib/fields.ts`, glossary terms, `tests/chances-reading.test.mts`
(each line with and without its data, the weighted-reporter case, the crowding sentence with rigor rated low, a
college with IPEDS factors only, the block hidden below two lines).

## As built (2026-10-11)
- `lib/chances/reading.ts` (pure, client-safe) holds the lines and the display rules (`CROWDED_SHARE` 0.5, `RANK_MIN_SUBMITTED`
  0.15); `lib/chances/reading-major.ts` holds the Major line, kept apart so the curated major file stays out of bundles that
  only need the other lines (Compare). `components/school/ReadingTheRecord.tsx` renders it above the C7 grid;
  `components/compare/CompareReading.tsx` is the Getting in page's "How they read a record" block, and the Getting in card
  carries a one-line row (`READING_ROW`: a short emphasis phrase and the 3.75+ share).
- GPA share column: `all`, else the students who sent scores, else those who didn't, and the sentence says which
  (`derived.gpa_top_share` uses the same order).
- "Most first-years were admitted without scores" is said only when the SAT and ACT shares add to under half (a student can
  send both, so two shares under half don't prove it).
- The class-rank line (both forms) needs the college's own C7 rating; the federal yes/no never stands in for it.
- The Major line reads only a quoted statement in `data/major-admission.json` (a university-level "doesn't affect
  admission", or a unit that says applicants are compared within it, with the subjects it names); hidden otherwise.
- The iPhone API block is not built (no block registry exists yet); `readingWithMajor(school)` is the function it will call.

## Open questions
1. Should the crowding sentence use 50% or a comparison with all colleges ("more crowded than 8 in 10 colleges that
   report")? Recommendation: 50% now, in one constant; a percentile reads as a ranking, which the site avoids.
2. Should Explore get a "GPA crowding" filter? Recommendation: no; it is context for reading one college, not a reason
   to choose one.
