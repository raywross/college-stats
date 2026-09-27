# School Profile

Route: `/schools/[id]`. The 50 most-applied-to profiles are pre-rendered at build; the rest render on first visit. The bottom of the drill-down.

## Structure
1. **Hero**: tinted with the school's crest color. Breadcrumb (Explore › State › School), large crest,
   name, location, type and size (as glossary `Term`s), compare button, "Known for" standout chips.
2. **Sticky section nav** (`SectionNav`) with scroll-spy: Overview · Admissions · Test scores · Students ·
   How it ranks · Similar schools. Domain color dots mark each section.
3. **Overview bento**: acceptance ring + "1 in N" + tier; SAT and ACT middle-50% mini range bars (with
   median tick); undergrads with rank; yield ring; Pell ring; diversity index with mini stacked bar.
4. **Admissions**: generated takeaway sentence; 100-applicant `Waffle`; funnel bars; yield ring + sentence;
   acceptance `DistributionStrip` against every college.
5. **Test scores**: takeaway; `ScoreChecker` (enter your SAT/ACT to see a "You" marker and a verdict) over
   range bars; submission-rate rings with a status warning when both are under 50% (test-optional caveat).
6. **Students**: takeaway; race/ethnicity `StackedBar` with legend and diversity index; Pell and first-gen
   `BenchmarkBar`s against the median; campus size `DistributionStrip`.
7. **How it ranks**: four `DistributionStrip`s (SAT, yield, Pell, diversity) against every reporting college, plus
   `LandscapeScatter` (300 most-applied-to + this school, labeled). Every dot drills into that school.
8. **Similar schools**: nearest neighbors (`similarSchools`) with "why similar" chips and one-click compare links.

## Insight helpers (`lib/insights.ts`)
- `standouts(s)`: "Known for" chips from percentile thresholds (ultra-selective, high yield, big campus,
  economic diversity, test-optional heavy…).
- `admissionsTakeaway`, `yieldTakeaway`, `scoresTakeaway`, `studentsTakeaway`: one-line plain-English summaries.
- `similarSchools(s, n)`: Euclidean distance on percentile ranks (selectivity, SAT, size, Pell, diversity),
  with a small penalty when the school type differs.

All comparisons are national: against every 4-year college that reports the measure (see the `percentile-rank` term).

## Missing data
Sections render only when their data exists, and the section nav lists only rendered sections:
- No acceptance rate → the tile says "Not reported" with an **open admission** term; Admissions section hidden unless
  counts exist.
- No SAT/ACT → Test scores section hidden (test-blind schools like UC show their policy in the hero instead).
- The "1 in N" phrasing switches to "N in 10" at 50%+ (`admitRatio`).
- A sources line at the bottom lists where the record came from (Scorecard, IPEDS year, or an override such as a CDS).

## Financial (future)
When cost/outcomes data arrives, add a "Cost & outcomes" section with `BenchmarkBar`s (net price by income,
median earnings, debt) and a new `--d-*` domain color (re-validate the domain set).
