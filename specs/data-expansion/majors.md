# Majors: Degrees Awarded by Field (IPEDS Completions)

> Status: **built** 2026-10-02. Wave 3. New file: `C{Y}_A`. Research 2026-09-28; files probed 2026-10-02. See
> [As built](#as-built) and [Refresh and maintenance](#refresh-and-maintenance). Part of [data-expansion](README.md).
> Pairs with [field-of-study.md](field-of-study.md). Uses the per-college detail file, which [residence.md](residence.md) built (see below).

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

> **Detail file: built 2026-10-02 by [residence.md](residence.md#as-built)** (home states). As built: `lib/detail.ts`
> holds the shape `{ unit_id, tables: { home_states?: { source, vintage, year, rows } } }` (no per-file `built` date,
> so a re-sync only diffs files whose data changed), `DETAIL_TABLES` (each table → a registered field, e.g.
> `detail.home_states`, plus a row check), `validateDetail()`, `detailMismatches()` (table vs. snapshot), and
> `formatDetail()`. sync-data writes every file whole (scripts/lib/residence-sync.mts `writeDetails`), so majors adds
> its table to the same build step. Supabase `school_details` is published like history (staged in batches, swapped in
> one transaction), not inside `publish_dataset()`: majors would make one call too big. To add majors: a `majors`
> entry in `DetailTables` and `DETAIL_TABLES`, a `detail.majors` field, and fill it in sync-data.

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

## As built
- **Probe (2026-10-02).** `C2014_A`–`C2025_A` all have `UNITID, CIPCODE, MAJORNUM, AWLEVEL, CTOTALT` (C2025_A: 313,566
  rows, no `_rv` yet). `AWLEVEL` is `"05"` through C2020_A-era files and `"5"` in C2025_A (parsed as a number).
  **CIP 2020 starts with C2020_A** (degrees awarded 2019–20: 30.70 Data Science first appears, distinct codes jump from
  1,424 to 1,559), so the spec's "around the 2020–21 collection" is the 2020 file. The `99` row (per award level and
  major) equals the sum of first-major programs exactly for every site college in every year.
- **CIP reference (owned here).** `data/reference/cip2020.json`, built by `npm run build-cip` (`scripts/build-cip.mts`)
  from NCES's `CIPCode2020.csv` and `Crosswalk2010to2020.csv`: 2,687 titles (50 families, 464 4-digit groups, 2,173
  programs; codes NCES marks "Moved from" or "Deleted" left out; family titles title-cased) and the 149 CIP 2010 →
  2020 moves (`moved_from_2010`; 134 cross families, e.g. veterinary 51.24/51.25 → 01.80/01.81). One entry per line,
  sorted. `lib/cip.ts` (server-side; the table is ~150 KB): `normalizeCip` (any spelling: "11.0701", "110701",
  "1107", "11.07", "1.0101", `="01.0101"` → canonical dotted), `cipLevel`, `cipFamily`, `cip4`, `cipTitle`,
  `cip4Title`, `cipFamilyTitle`, `hasCip`, `hasCip4` (does a 4-digit group exist; for field-of-study.md), `isCipField`
  (not `99`), `fromCip2010`, `cipCodes(level)`, `CIP_SOURCE`.
- **Reader** (`lib/majors.ts`, pure and client-safe; `scripts/lib/majors-sync.mts`). A new `sum` option on
  `fetchIpedsTable` sums many rows per college into one: sync-data keys bachelor's rows (`AWLEVEL` 5) as `{cip}|1` /
  `{cip}|2` (first and second majors separately) plus `99|1`; history keys first majors by family (`F|{family}`).
  `fetchIpedsTable` now reads CSVs row by row (`forEachCsvRow`, skipping other colleges before building rows) instead
  of materializing every row first; rows are still built with `Object.fromEntries` (building them one property at a
  time made wide SFA rows dictionary-mode objects and pushed sync-history past Node's default heap).
- **Checks.** sync-data fails if C{Y}_A uses a code that isn't a CIP 2020 field (a new CIP edition), if programs don't
  add up to the `99` row for more than 1% of colleges (1,885 of 1,885 match), or if a top-5 code has no title.
- **Snapshot** (1,877 of 1,893 colleges; null when not in the file, `bachelors_awarded: 0` and null shares for the 8
  colleges reporting none): `academics.bachelors_awarded` (first-major bachelor's), `academics.majors_top`
  (`{ cip, title, share }`, top 5 by first majors, shares of first-major bachelor's, 4 places), and, beyond the spec,
  `academics.bachelors_by_family` (first-major counts by 2-digit family) for Explore's field filter and history's
  rule 1. `data/schools.json` grows ~0.95 MB (11.3 → 12.2 MB). Source/vintage `ipeds-c` ("2024–25 graduates",
  edition C2025_A).
- **Detail file.** `majors` table: `{ "45.0101": [283, 14], … }` (CIP → [first majors, second majors], most first
  majors first; programs with neither left out), field `detail.majors`. `DETAIL_TABLES.majors` checks every code is a
  6-digit CIP 2020 field and counts are non-negative integer pairs; `detailMismatches` checks the table reproduces the
  snapshot's total, top 5 (codes and shares), and family counts. `mergeDetails()` (lib/detail.ts) joins each sync
  step's tables (home states, majors; field of study next) in `DETAIL_TABLES` order. 1,892 files, 7.4 MB.
- **History.** Family `c-a` (kind `academic`: C{Y+1}_A is stored at Y, so C2025_A = 2024), 2013–2024 (C2014_A on,
  12 points). Series `bachelors` (count) and one share series per family, `major_{family}` (39 families,
  `MAJOR_FAMILIES` in lib/majors.ts, generated into `SERIES`). A college gets a family's series if it had that family in
  any year, with 0 in years it awarded bachelor's but none in it. Pre-2020 files read through the crosswalk (every
  code site colleges used maps to a CIP 2020 code), so **no break** is marked: the spec asks for one only for 6-digit
  use, and history keeps families only. A family not in `MAJOR_FAMILIES` stops sync-history. Rule 1 compares
  `bachelors` and every family's share at the newest C year against the snapshot (a family the snapshot lacks is 0).
- **Display.**
  - Profile, Academics (now "Majors and faculty"): `components/school/Majors.tsx` (server: resolves titles) +
    `MajorsList.tsx` (client): top 5 bars with share and count, "Show all N programs and search" (search matches word
    starts in titles and field names, or a CIP prefix; second majors shown in the full list), a "Fastest-growing field"
    line with its history footnote, and the takeaway names the most popular major. Each row shows its 4-digit group's
    earnings from [field-of-study.md](field-of-study.md) when reported, and "Top-earning majors here" follows the list.
  - **Fastest-growing is by family, not program** (deviation): history has families only, so "largest share gain
    among programs with 25+ graduates" became the family with the largest share gain over the 10 years ending with the
    newest C year (start up to 2 years late), with 25+ graduates in it now, 100+ bachelor's at both ends, and a gain of
    2+ points (`fastestGrowingField`). Vanderbilt: computer science, 2.1% → 9.3% since 2014–15.
  - Explore: a **Majors** filter (`field={family}`, `fieldMin=25|50|100|250` first-major bachelor's a year; colleges
    not reporting are hidden), a "Bachelor's degrees awarded (most)" sort (`sortBy=bachelors`), a table column
    "Bachelor's degrees, top major", and a `bachelors` metric. (Also fixed: the table's "Transfers, share of new"
    header had no cells, shifting every later column.)
  - Compare: "Bachelor's degrees awarded" and "Most popular majors" (top 3 with shares) rows.
  - Glossary: `cip-code`, `first-major`, `second-major`.
  - **Home fact built** ("What students study is shifting", `facts.majors`, `majorsShift` in scripts/history/build.mts):
    national shares of first-major bachelor's, newest C year vs. 10 years earlier, over the 1,769 colleges awarding
    bachelor's in both years, weighted by graduates. Computer science 2.8% → 6.6% (+135%, the largest and least
    expected change); biology and psychology +0.8 points; social sciences −1.4, English and communication −1.0. The card
    shows the 3 biggest gains and losses; with five facts it spans both columns.
- **Tests:** `tests/cip.test.mts`, `tests/majors.test.mts` (reader, snapshot, detail guards, mergeDetails, history and
  eras, rule 1, Home fact, fastest-growing, search, Explore, lineage, committed data). Guards were broken on purpose to
  confirm they fail. Committed-data tests skip until data/ is rebuilt with majors.

### Not built (follow-ups)
- Explore filter **by specific program** ("has a nursing program", "50+ nursing graduates"): needs 4- or 6-digit counts
  for every college, which live in the detail file, not the snapshot. Options: a small per-program index, or search
  served from the detail table.
- Compare's "your major" section was built with [field-of-study.md](field-of-study.md#as-built): broad fields, updated
  in place, with graduates, share and its 10-year change, earnings, debt, and programs per college. Remembering the
  pick in a student profile waits for accounts.
- An "Over time" chart of field shares (the series exist; only the fastest-growing line uses them today).
- Associate's, master's, and doctoral degrees (other `AWLEVEL`s) and race/sex splits are read past, not stored.

## Refresh and maintenance
- **A new completions year** (C{Y}_A, usually late July with the directory files; next C2026_A, summer 2027, listed in
  `data/release-calendar.json` as `ipeds-2026-27-completions`): nothing to change in code. `npm run sync-data` tries
  C{this year}_A down to four years back and takes the newest published one; the meta edition and vintage
  ("2025–26 graduates") follow, so every citation and year label updates. `npm run sync-history` adds the year (the
  `c-a` era is open-ended) and rule 1 checks the newest point equals the snapshot. Run both (`npm run sync-all`).
- **Revisions.** NCES republishes the prior year with an `_rv` CSV a year later; `fetchIpedsTable` prefers it, and the
  cache re-downloads files under 3 years old weekly, so revised years flow in on the next sync.
- **What can stop a sync** (on purpose): a column renamed (header check), programs no longer adding up to the `99` row
  (>1%), a code not in CIP 2020 (sync-data), a family not in `MAJOR_FAMILIES` (sync-history; add it with a short name),
  or a coverage drop >20% in a series.
- **A new CIP edition** (CIP 2030, expected around the 2030 collection): download the new CIP file and crosswalk,
  point `scripts/build-cip.mts` at them, write a new reference file, and give `lib/cip.ts` a `fromCip2020` step for
  older years; add a `c-a` era boundary in `scripts/history/registry.mts` at the first new-edition file. Until then
  sync-data fails loudly on the first new code rather than showing bare numbers.
- **Publishing.** The detail files grow with majors (~4 KB a college); `publish-data` already batches `school_details`
  (scripts/lib/publish-details.mts, `BATCH` 200).
