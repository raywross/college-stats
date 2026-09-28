# Faculty: Salary and Full-Time Share (IPEDS SAL, HR via Scorecard)

> Status: **planned**. Wave 2. New file: `SAL{Y}_IS`; full-time share from Scorecard. Research 2026-09-28.
> Part of [data-expansion](README.md).

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
