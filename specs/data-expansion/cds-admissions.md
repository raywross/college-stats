# CDS Admissions Profile: GPA, Factors, Early Rounds, Wait List

> Status: **skeleton**. Wave 4. **Blocked on the [college-reported data agent](../college-reported-data.md)**, which
> finds and reads CDS files for many colleges. The Excel importer can read these items for the 8 colleges with CDS
> overrides today, but a GPA shown for 8 of 1,893 colleges isn't worth building a UI for.
> Research 2026-09-28 (Vanderbilt 2024–25 and Cornell 2025–26 workbooks). Part of [data-expansion](README.md).

## Question it answers
*What GPA do admitted students have? How much does GPA matter here? Does applying early help? What are my chances off
the wait list?*

## Source: CDS section C
| Item | What | Vanderbilt 2024–25 |
|---|---|---|
| **C11** | Share of enrolled first-years by high school GPA band (4.0, 3.75–3.99, 3.50–3.74, …, below 1.0). Since the 2023–24 template: three columns, for students who **submitted a test score**, who **didn't**, and **all** | all: 35.9% at 4.0, 53.1% at 3.75–3.99, 7.2% at 3.50–3.74 |
| **C12** | Average high school GPA of first-years who submitted one; share who submitted | 3.89; 99.94% |
| C10 | Class rank bands; share who submitted rank | 23.4% submitted |
| **C7** | Importance of 19 factors: Very important / Important / Considered / Not considered (academic GPA, rigor, rank, test scores, essay, recommendations, interview, extracurriculars, talent, character, first generation, alumni relation, geographic residence, state residency, religious commitment, race/ethnicity, volunteer work, work experience, level of interest) | GPA and alumni relation marked (column by position) |
| **C2** | Wait list: offered, accepted a place, admitted from it | 279 admitted from the wait list |
| **C21** | Early decision: offered, deadlines, applications, admits | 5,363 applied, 825 admitted (15.4%) |
| **C22** | Early action: offered, restrictive or not, deadlines | offered |

**Many selective colleges leave C11/C12 blank** (Cornell 2025–26: every GPA cell is "-"). Coverage will be partial
even with the agent; the pilot should measure it by selectivity tier.

**Two layouts** (the importer already handles both, see `import-cds.mts`): the classic template (labels in column B,
values beside them; C7 answers are an "X" in the importance column) and the flat "Answer Sheet" with question codes
(`C.1101` … `C.1202` for C11–C12, `C.2110` for C21 applications). In **PDFs**, C7's checkmarks lose their column, as
[college-reported-data.md](../college-reported-data.md#campus-life-sources) found for UT, so C7 needs a layout-aware
or vision pass.

### ACTS alternative
If NCES publishes the ACTS supplement ([data-page.md](../data-page.md#watching-acts)) at the institution level, it may
give GPA for every college. Prefer it as the baseline then, with CDS as the newer, college-reported value.

## Ingest (when unblocked)
- Extend the agent's extraction schema with `c11` (three columns × 9 bands), `c12` (average, share), `c7` (19
  factors × 4 levels), `c2`, `c21`, `c22`, each with a quote. Excel files: extend `import-cds.mts` by label and by code.
- Checks: each C11 column sums to 100% ± 1; C12 average falls inside the C11 distribution's band range; C21 admits ≤
  applications; C21 admits ≤ C1 total admits; wait-list admits ≤ wait-list accepted.

## Store
```ts
reported.admissions.gpa: { average, submitted_share, bands: { all, with_test, without_test }: number[9] }
reported.admissions.factor_weights: Record<C7Factor, "very_important" | "important" | "considered" | "not_considered">
reported.admissions.early_decision: { applicants, admitted } | null, early_action: { offered, restrictive } | null
reported.admissions.wait_list: { offered, accepted, admitted } | null
```
Under `school.reported` ([college-reported-data.md](../college-reported-data.md)), each value with CDS lineage
(edition, URL, quote). **Never** used in ranks, medians, or Explore percentile comparisons (partial, self-reported).

## Display
- **Profile, Admissions:** "Admitted students' GPA": average plus a GPA band bar (all students; toggle for
  test-submitters vs not). A `GpaChecker` like `ScoreChecker` ("Your GPA: 3.8 → in the middle 50%"), with the caveat
  that GPAs aren't standardized across high schools.
- **Factors:** C7 replaces the IPEDS grid from [admission-factors.md](admission-factors.md) when present.
- **Early rounds:** "Early decision: 15% admitted vs 6% overall", always with the ED caveat (binding; recruited
  athletes and legacies are often in the ED pool).
- **Wait list:** "279 admitted from the wait list of N who accepted a place".
- **Explore:** only "Has GPA data" as a filter; no GPA sorting while coverage is partial.

## Keep history?
**Series per CDS edition** once two or more editions are collected for a college (the agent re-reads each year's
file). Average GPA and ED admit rate are the only series worth charting. No backfill of old editions in phase 1.

## Top-level trend?
- **None until coverage is broad.** Later candidate: "Average GPA of admitted students keeps rising" (grade inflation)
  as a Home fact, only on a fixed panel of colleges with 5+ editions.
