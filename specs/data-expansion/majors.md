# Majors: Degrees Awarded by Field (IPEDS Completions)

> Status: **planned**. Wave 3. New file: `C{Y}_A`. Research 2026-09-28. Part of [data-expansion](README.md).
> Pairs with [field-of-study.md](field-of-study.md). **Builds the per-college detail file** (see below).

## Question it answers
*What do students here actually study? Is my major big here or a niche? Which programs are growing?*

## Source
`C{Y}_A`: one row per college × CIP code (6-digit field) × award level × first/second major. `C2025_A` (awards
July 2024–June 2025) is released and listed on the Data page as "released, not used"; 313,566 rows.

| Column | What |
|---|---|
| `CIPCODE` | Classification of Instructional Programs, e.g. `11.0701` (computer science); `99` = institution total |
| `AWLEVEL` | 5 = bachelor's (also associate's, master's, doctoral, certificates) |
| `MAJORNUM` | 1 = first major, 2 = second major |
| `CTOTALT`, `CTOTALM/W`, by race | Awards |

**Format drift (verified):** `AWLEVEL` is zero-padded (`"05"`) in C2020_A and not (`"5"`) in C2025_A. Parse as numbers.
The CIP taxonomy changed from CIP 2010 to CIP 2020 around the 2020–21 collection (*unverified*: confirm the year and
use NCES's crosswalk for history).

National shares of first-major bachelor's degrees at site colleges (2-digit CIP):

| Field | 2019–20 | 2024–25 |
|---|---|---|
| Business (52) | 18.6% | 18.5% |
| Health professions (51) | 11.6% | 11.2% |
| Psychology (42) | 6.1% | 7.2% |
| Biology (26) | 6.6% | 7.0% |
| Computer science (11) | under 6.1% (not in top 6) | 6.5% |
| Social sciences (45) | 7.1% | 6.4% |

Scorecard has `academics.program_percentage.*` (share of degrees by 2-digit field, 1,891 colleges, year keys
2005–2024): a cheap fallback for field *shares*, but no counts and no 6-digit detail.

## Ingest
- `sync-data` (or a new `sync-programs` if runtime grows) loads `C{Y}_A` with `keep`; bachelor's (`AWLEVEL` 5), first
  majors plus second majors counted separately; drop `CIPCODE` 99 (institution totals).
- A checked-in CIP title table (`data/reference/cip2020.json`) for readable names and 2-digit families.
- Validate: sum of first-major bachelor's ≈ the institution total row (99).

## Store (and the detail file)
- **Snapshot:** `academics.majors_top: { cip, title, share }[]` (top 5 by first-major bachelor's) and
  `academics.bachelors_awarded` (total). Enough for cards and filters.
- **Detail file (decided 2026-09-28):** the full list (~50–150 programs per college, ~4 KB) goes in
  `data/detail/schools/{unitid}.json`, a new per-college file for large *snapshot* tables (majors, home states,
  field-of-study earnings). It's separate from the history shard, because history has a strict
  last-point-equals-snapshot contract and columnar year arrays. This spec builds it:
  - Shape: `{ unit_id, built, tables: { majors?, home_states?, programs? } }`, each table with its own source and
    vintage for lineage; a `validateDetail()` beside `validateShard()`.
  - Committed to git like history shards, and published 1:1 (a Supabase `school_details` table, one row per college,
    `json`, in a new migration applied to dev first; `publish-data` publishes it in the same transaction).
  - Read with `getDetail(unitId)` in `lib/data.ts`, fail-soft like `getHistory()` (log and return null).
  - `outputFileTracingIncludes` gains `./data/detail/**`; `npm run check:lineage` validates every file.
- `SourceKey` `ipeds-c`, `VintageKey` `ipeds-c` ("2024–25 graduates").

## Display
- **Profile, Academics:** "Most popular majors" bar list (share of graduates), expandable to all programs; search
  box ("Do they have nursing?").
- **Explore:** filter by major family ("Has 50+ nursing graduates a year"), and by specific program via search.
- **Compare:** top majors per college; a "your major" row once a major is picked.
- **Glossary:** `cip-code`, `first-major`, `second-major`.

## Keep history?
**Series: yes, by 2-digit family** (share of bachelor's), for each college: ~40 families × 10 years is small in the
detail or history shard. 6-digit programs: none (too big; CIP recoding adds noise). Mark a break at the CIP 2020 switch
for any 6-digit use.

## Top-level trend?
- **Home fact: strong candidate.** "What students study is shifting": psychology, biology, and computer science up;
  social sciences down (fixed panel, 5 or 10 years). Pick the change that's largest and least expected once the full
  10-year panel is computed.
- **Profile:** "Fastest-growing major" line in Academics (largest share gain among programs with 25+ graduates).
- **Hero: no.**
