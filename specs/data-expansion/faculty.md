# Faculty: Salary and Full-Time Share (IPEDS SAL, HR via Scorecard)

> Status: **built** 2026-10-02. Wave 2. New file: `SAL{Y}_IS`; full-time share from Scorecard. Research 2026-09-28;
> files probed 2026-10-02. See [As built](#as-built). Part of [data-expansion](README.md).

## Question it answers
*Are classes taught mostly by full-time faculty? How well does it pay them?* A rough proxy for teaching investment.

## Source
- **`SAL{Y}_IS`**: instructional staff salaries by academic rank (`ARANK` 1 Professor … 6 No rank, **7 All
  instructional staff**). `SAEQ9AT` = average salary equated to a 9-month contract. Vanderbilt SAL2024 all staff:
  **$148,484** (1,249 staff); professors $221,801.
- **Scorecard** `school.faculty_salary` is `AVGFACSAL`, a **monthly** average (Vanderbilt $16,361 × 9 ≈ $147,249, close
  to but not the same as SAL's equated figure). Don't mix the two.
- **Full-time share:** Scorecard `school.ft_faculty_rate` (from IPEDS HR; 1,772 colleges; Vanderbilt 84.7%;
  year keys 2005–2024). IPEDS HR files weren't found at the usual names (`HR2023`, `HR2024` missing; staff data is now in
  `S{Y}_IS`, which exists for 2024), so use Scorecard.

## Ingest
- `sync-data` loads `SAL{Y}_IS` and keeps the `ARANK = 7` row. Assert that rank 7 exists for each college with salary
  rows.
- `school.ft_faculty_rate` joins the Scorecard call.

## Store
```ts
academics.faculty: { avg_salary_9mo: number | null, full_time_share: number | null, count: number | null } | null
```
`SourceKey` `ipeds-sal` (salary) and `scorecard` (full-time share), cited separately.

## Display
- **Academics:** "85% of faculty are full-time" (a `BenchmarkBar`) and "Average faculty salary $148,484" with
  the regional cost-of-living caveat in the ⓘ.
- **Explore:** full-time faculty share sort and filter.
- **Compare:** both rows.
- **Glossary:** `full-time-faculty`, `instructional-staff`, `nine-month-equated-salary`.

## Keep history?
- **Full-time share: series**, 2005 on (Scorecard year keys, verified at two colleges). The long national slide toward
  adjunct faculty is real.
- **Salary: series**, after inflation, from the SAL files (years *unverified* beyond 2024; SAL has been collected yearly
  for decades).

## Top-level trend?
- **Hero: no.**
- **Home fact: candidate, lower priority.** National full-time faculty share over 20 years on a fixed panel, if it
  shows a clear decline.
- **"Over time" → Academics:** full-time share line.

## As built
- **Source.** `SourceKey`/`VintageKey` `ipeds-sal` ("Fall 2024", edition SAL2024_IS) for salary; full-time share stays
  under the existing `scorecard`/`scorecard-enrollment` vintage, since `school.ft_faculty_rate`'s year key matches
  enrollment's exactly (checked at three colleges). `sync-data` loads `SAL{Y}_IS` newest-first and fails if the file
  has no `ARANK`/`SAEQ9AT`, and separately if more than 1% of colleges' last CSV row isn't ARANK 7 (see below).
- **The ARANK 7 row, without re-deriving it.** SAL has one row per academic rank (1 Professor … 6 No rank, 7 all
  ranks combined). The probe found rows are grouped by college with ARANK ascending in every year checked
  (2016–2024), so the all-ranks row is always the *last* row NCES lists for a college — which is exactly the row the
  snapshot's "last row wins" CSV-to-map fetch keeps (the same `fetchIpeds`/`fetchIpedsTable` helpers every other IPEDS
  file uses). `lib/academics.ts` `facultySalaryFrom` still asserts `ARANK === "7"` on the row it's given, so a future
  NCES layout change (a different row order, or colleges that skip rank 7) fails loudly instead of silently reading
  a single rank's salary as if it were everyone's.
- **SAL years probed.** `SAL{Y}_IS` exists under that name from 2012 (2011 and earlier use different file names, not
  checked). 2012–2015 lack `SAEQ9AT` (they carry `SAMNTHT`/`SAAVMNT` instead, a different, non-equated figure); 2016
  on all have it. Vanderbilt SAL2024 ARANK 7: `SAEQ9AT` **$148,484** — matches the spec's research exactly, as does
  ARANK 1 (professors) at $221,801. Coverage: 1,821 of 1,893 colleges in fall 2024.
- **Full-time share.** `school.ft_faculty_rate` added to the Scorecard call; year-prefixed values checked back to
  2005 at three colleges (public, private, and a college under 50% full-time) — all matched `latest`. Coverage: 1,772
  of 1,893. Vanderbilt 84.73%, matching the spec.
- **Don't mix the two**, enforced: `facultySalaryFrom` only ever reads `SAEQ9AT`; `school.faculty_salary`
  (`AVGFACSAL`, Scorecard's plain monthly figure) isn't read into this field anywhere, and a test pins that Vanderbilt's
  stored salary isn't the monthly figure's ×9 approximation.
- **Store.** `academics.faculty: { avg_salary_9mo, full_time_share, count }`, `null` when neither value is reported
  (so a college with only one of the two still shows a `faculty` object with the other field present and `count:
  null`). **Deviation:** `count` is always `null`. SAL_IS carries no headcount column for the all-ranks row (only
  salary dollar figures); IPEDS publishes instructional-staff counts separately (the Human Resources component's
  `S{Y}_IS` table), a second large file this spec didn't scope. Noted as a follow-up below; nothing displayed today
  needs it.
- **Metrics.** `METRICS.facultyFullTime` and `METRICS.facultySalary` (domain `size`, same as the student-faculty
  ratio; no new palette color).
- **Display** (Academics section, next to the ratio tile from #38):
  - A `BenchmarkBar` for full-time faculty share against the national median.
  - Average faculty salary as a plain figure with the cost-of-living caveat in its glossary ⓘ
    (`nine-month-equated-salary`), not a benchmark bar — comparing raw salary dollars across regions without
    adjusting for cost of living would be misleading in a way a bar chart doesn't flag.
  - The section's takeaway sentence covers both the ratio (if present) and the full-time share.
  - Explore: sort "Full-time faculty share (most)" and a **Full-time faculty** filter (50%, 70%, or 90% or more;
    `minFullTimeFaculty=`, stored as a percent in the URL); unreported shares never match.
  - Compare: two rows in "All the numbers".
  - Glossary: `full-time-faculty`, `instructional-staff`, `nine-month-equated-salary` (the salary term's "why" carries
    the cost-of-living caveat).
- **History.** Two new families: `ipeds-sal` (SAL2016_IS on, fall) and `scorecard-faculty` (Scorecard
  `ft_faculty_rate`, fall 2005 on). Two new series, `faculty_salary` and `faculty_full_time_share`, both charted in
  the existing "Academics" group in Over time (added by #38) alongside the student-faculty ratio.
- **"Known for": not added** — the spec didn't ask for one, and a salary standout would conflate pay with cost of
  living; left out on purpose.
- **Follow-ups (out of scope here):** the Home fact (national full-time share over 20 years on a fixed panel) and the
  `count` field (would need the IPEDS HR `S{Y}_IS` headcount file) are candidates for later, smaller changes.
- Tests: `tests/faculty.test.mts`.
