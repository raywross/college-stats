# Trends: Data Ingestion & Storage

> Status: **Built** (2026-09-28): Phase 1 (`feature/trends`: admissions, prices, aid, net price; national
> distributions; Home facts; CPI) and Phases 2–3 (`feature/trends-phase-2-3`: scores and test policy, undergrads,
> race/ethnicity, graduation by entering class, median debt; the `trends` summary in schools.json). Companion to [trends-design.md](trends-design.md), which covers how trends appear on the site. Research done
> 2026-09-28 by probing NCES and the Scorecard API directly; findings below are verified unless marked *unverified*.
> What the build found and how it differs from this plan: [Build notes](#build-notes-phase-1).

## Goal
Add a year-by-year history for each college so the site can show how cost, selectivity, size, and aid have changed.
History is a separate build step from the current snapshot (`npm run sync-data`), because it's slow, rarely changes,
and reads ~100 bulk files instead of ~5.

## Guiding rules
1. **The last point equals today's number.** Each series uses the same source and definition as the value the site
   already shows, so a chart never ends somewhere different from the headline above it. The sync checks this.
2. **Fail loudly, never silently.** The 2023–24 layout change (see below) would have blanked the income table for every
   college without an error. Every mapped column is asserted to exist, and each year's coverage is compared with its
   neighbors. A drop of more than 20% fails the build unless the year is in an allow-list with a reason.
3. **Breaks are data, not noise.** When a definition changes (SAT redesign, race categories, IPEDS survey split),
   store a `break` marker and never draw a line across it.
4. **Money is stored as reported** (nominal) and converted to today's dollars at display time, using a stored CPI table.
5. **Missing is `null`**, never 0 and never interpolated.

## Lessons from the 2023–24 release (why this needs a registry)
What broke the current sync, and what the history build must handle for *every* year:

| Drift | Example | Handling |
|---|---|---|
| Files move | Dec 2025+ releases live at `/ipeds/complete-data-files/`; older ones remain at `/ipeds/datacenter/data/`. The NCES listing page lags behind what's downloadable. | Try both bases for every file; never trust the listing page. |
| Surveys split or merge | Admissions lived in `IC{year}` until fall 2013, then moved to `ADM{year}` in 2014. Prices moved from `IC{year}_AY` to `COST1_{end}`, and residency shares and income-band aid moved from `SFA` to `COST2_{end}` in 2023–24. | A per-era registry maps (metric, year) → file + column. |
| Column suffixes change | `IC_AY` uses `CHG2AY3` for the file's year; `COST1` uses `chg2ay2`. SFA's `GRN4N12` = the newest year, `…11`, `…10` = the two before. | Registry records the suffix per era; tests pin a known college's value. |
| Case, quoting, encoding | Newer headers lowercase; `X…` imputation-flag columns; older files latin-1. | Normalize headers to upper case; decode latin-1 as fallback. |
| Revisions | Provisional release is replaced a year later by `…_rv.csv` inside the same zip. | Prefer `_rv`; store `revised: true`; re-fetch the last 2 years every run. |
| Totals vs parts | `IC2001` has applicants only by gender (`APPLCNM`/`APPLCNW`); totals (`APPLCN`) from `IC2003`. | Registry allows a derived column (sum of parts). *IC2002 unverified.* |

## How far back each series goes
Probed 2026-09-28. "Years" = academic year starting in the fall (see *Year convention*).

| Series | Source & files | Earliest usable | Notes |
|---|---|---|---|
| Applicants, admitted, enrolled | `IC2001`–`IC2013`, then `ADM2014`+ | Fall 2001 | 2001 (and maybe 2002) summed from men + women. ADM covers only colleges that aren't open-admission. |
| Admit rate, yield | derived | Fall 2001 | Same rules as today (applicants ≥ 10). |
| SAT/ACT 25th–75th | same as above | Fall 2001 | **Break at fall 2017:** the redesigned SAT (Mar 2016) isn't on the old scale. **Fall 2020+:** test-optional; submission rates drop, so percentiles describe a smaller, self-selected group. |
| Test policy (`ADMCON7`) | same | Fall 2001 | Code meanings shift between eras; map per era. |
| Admission factors (`ADMCON1`–`6`, `8`–`12`) | same | Fall 2001 (9 from 2005; 10–12 from 2022) | Added 2026-09-29 ([admission-factors.md](data-expansion/admission-factors.md)): raw codes, `factor_{name}`; events derived in `lib/events.ts`. |
| Acceptance rate, men / women | `APPLCNM`/`W`, `ADMSSNM`/`W` in the same files | Fall 2001 | Added 2026-09-29 ([admissions-detail.md](data-expansion/admissions-detail.md)). Same 10-applicant rule as the overall rate. |
| SAT total / ACT composite medians | `SATVR50`+`SATMT50`, `ACTCM50` | Fall 2022 | Added 2026-09-29. Absent through ADM2021, so the ADM era splits at 2022. Stored, not charted yet. |
| Undergrad size | Scorecard `{year}.student.size` | 1996 | Verified back to 1997. Same field as today's headline. |
| Men's share, part-time share | Scorecard `{year}.student.demographics.men`, `{year}.student.part_time_share` | 1996 | Added 2026-09-29 ([student-body.md](data-expansion/student-body.md)). Same years and fall 2000 gap as undergrad size. |
| Race/ethnicity shares | Scorecard `{year}.student.demographics.race_ethnicity.*` (IPEDS `EF{year}A`) | 2010 | New federal categories required from fall 2010; 2008–09 were transition years (both sets present). Earlier years aren't comparable, so the series starts in 2010. |
| Tuition & fees by residency, books, room & board, other | `IC{year}_AY` (2000–2022), `COST1_{year+1}` (2023+) | 2000–01 | Each `IC_AY` file also carries the three prior years (`CHG*AY0`–`AY2`), e.g. `IC2000_AY` reaches 1997–98. Use them to fill gaps and to cross-check revisions. |
| Full price (sticker) | derived from prices | 2000–01 | Weighted by residency share for publics, so needs SFA → starts 2001–02 for publics. |
| Residency shares | `SFA` `SCFA11P`–`13P` (`COST2` from 2023–24) | 2001–02 | |
| Grant share, average grant | `SFA` `AGRNT_N`, `AGRNT_P`, `AGRNT_A` | 2007–08 | First-time full-time cohort count (`SCUGFFN`) starts 2007–08. |
| Total grants (exact formula) | `SFA` `AGRNT_T` | 2008–09 | 2007–08 can be approximated as `AGRNT_N × AGRNT_A`, and is flagged as such. |
| **Average total cost, all students** | derived (prices + SFA) | **2008–09** | Same formula as [cost-outcomes.md](cost-outcomes.md), same-year inputs only. ~16 years. |
| Aid generosity | derived | 2008–09 | |
| Net price by family income | `SFA` `NPT4*` (`COST2` from 2023–24) | 2008–09 | Each file carries 3 years (`…2`, `…1`, `…0`). Scorecard `{year}.cost.avg_net_price.*` agrees (verified: Michigan 2009 = $15,038). |
| Graduation rate (6-yr) | Scorecard `{year}.completion.completion_rate_4yr_150nt` | ~1997 | The value for year *Y* describes students who **entered about 6 years earlier**; label by entering cohort. |
| Housing capacity (beds), application fee | `IC{year}` `ROOMCAP`, `APPLFEEU` (through IC2023), then `COST1_{year+1}` | 2001–02 | Added 2026-09-29 ([housing-and-policies.md](data-expansion/housing-and-policies.md)); family `characteristics`. Fee after inflation. |
| Student-to-faculty ratio | `EF{year}D` `STUFACR` | Fall 2009 | Added 2026-09-30 ([student-faculty-ratio.md](data-expansion/student-faculty-ratio.md)); family `ef-d`. Change shown as from → to. |
| First-years from other states, from abroad | `EF{year}C` `EFCSTATE`/`EFRES01` (one row per home state) | Fall 2004, even years | Added 2026-10-02 ([residence.md](data-expansion/residence.md)); family `ef-c` with `step: 2` (residence is required only in even-numbered falls), so series hold `null` in odd years and charts connect across them. Rows pivot to one per college (`wide` in scripts/lib/ipeds.mts). |
| Athletic association, conference (main and football), ROTC | `IC{year}` `ASSOC1`–`2`, `CONFNO1`–`4`, `SLO5` | 2014–15 | Added 2026-09-30 ([campus-services.md](data-expansion/campus-services.md)); family `services` (IC every year, unlike housing). Codes only, for events; conference codes are unit `conference`, checked against `lib/conferences.ts`. |
| Undergrads with a federal loan | Scorecard `{year}.aid.federal_loan_rate` | 2008–09 | Added 2026-09-29 ([loans-and-repayment.md](data-expansion/loans-and-repayment.md)). Key Y is the Y−1–Y school year (matches IPEDS SFA `UFLOANP`), stored at Y−1. |
| Median debt | Scorecard `{year}.aid.median_debt.completers.overall` | ~1997 | Verified to 2020; the year-prefixed field is null from 2021 (today's value comes from `latest`). Chart stops at 2020, with a note. |
| **Earnings** | Scorecard | **Not trended** | Only sporadic years (Michigan: 2007, 2009, 2011–14, 2020), and the cohort definition changed in 2020 ($63k → $84k is mostly method, not change). Show the latest value only. |

**Recommended window:** load everything above, but the default chart view is the last 10 years. "All" shows each series
back to its earliest usable year. Cost/aid series share a 2008–09 start, so they line up.

## Sources and alternatives considered
- **NCES bulk CSVs (primary).** Free, no key, primary source (best for citations), and the same files the snapshot uses.
  Cost: ~100 zips for a full backfill (~200 MB compressed, a few minutes), and the per-era mapping above.
- **College Scorecard API, year-prefixed fields (primary for Scorecard-sourced series).** e.g.
  `fields=id,2015.student.size,2016.student.size,…`. Same key and 100-per-page limit: ~1,900 colleges ÷ 100 × a few
  field chunks ≈ 80–100 requests, well under 1,000/hr. The API's year key *Y* = academic year *Y*–*Y+1*.
- **Urban Institute Education Data Portal (cross-check only).** `educationdata.urban.org/api/v1/college-university/ipeds/…`
  serves IPEDS already harmonized across years, no key (verified: Vanderbilt fall 2015 = 31,464 applied, 3,674 admitted).
  Not primary because it's a third party, lags NCES by months, and would add a second citation layer. Use it in the
  validation step to spot-check our era mappings.
- **IPEDS Access databases** (one `.accdb` per year). Rejected: needs `mdbtools`, and the tables are the same CSVs.
- **Scorecard bulk "all data" zip** (`MERGED1996_97_PP.csv` …). Rejected for now: ~400 MB, and the API covers what
  we need.

## Year convention
One integer `year` = **the calendar year the academic year starts** (the fall term):

| File | Stored as |
|---|---|
| `ADM2024` / `IC2013` (fall admissions) | 2024 / 2013 |
| `SFA2324`, `COST1_2024`, `COST2_2024`, `IC2023_AY` | 2023 |
| Scorecard `2022.cost…` | 2022 |
| Graduation rate reported in year *Y* | stored at *Y*; `cohort_year = Y − 6` in metadata |

Display always uses the label form ("Fall 2024", "2023–24"), never the bare integer.

## Inflation
- `data/cpi.json`: CPI-U (BLS series `CUUR0000SA0`), school-year averages (July–June), as NCES's *Digest* does,
  with the retrieval date and source URL. Update it in the same run (BLS public API v1 needs no key; ~1 request).
- `real(value, year) = value × CPI[latestYear] / CPI[year]` → "in 2023–24 dollars".
- Growth facts use inflation-adjusted change by default and say so. Charts offer both ("After inflation" / "As reported").

## Storage
Today `data/schools.json` is 3.6 MB for 1,893 colleges (~1.9 KB each), read on the server at startup. History is ~20
series × up to 25 years per college, and most views never need it. So it's split three ways:

```
data/
  schools.json            # unchanged snapshot + a small `trends` summary per college (below)
  history/
    national.json         # per-series, per-year distribution: p25/median/p75/n, overall and by sector
    facts.json            # the Home page trend facts, precomputed (see trends-design.md)
    schools/{unitid}.json # one college's full history, ~3 KB each (~6 MB total)
  cpi.json
.cache/ipeds/             # downloaded zips, git-ignored; reused between runs
```

**Per-college shard** (columnar: one start year + an array per series; nulls for gaps):
```json
{
  "unit_id": 221999,
  "built": "2026-09-28",
  "series": {
    "applicants":       { "start": 2001, "values": [9960, 11490, …, 46377], "source": "ipeds-adm" },
    "tuition_fees.out_of_state": { "start": 2000, "values": [24080, …, 56128], "source": "ipeds-ic", "unit": "usd" },
    "avg_paid_all":     { "start": 2008, "values": [ … ], "source": "derived", "approx": [2008] },
    "sat_mid":          { "start": 2001, "values": [ … ], "breaks": [{ "year": 2017, "reason": "sat-redesign" }] },
    "grad_rate":        { "start": 1997, "values": [ … ], "cohort_offset": -6 }
  },
  "revised_through": 2022,
  "notes": []
}
```
*(Values illustrative except Vanderbilt tuition & fees, verified: 2000–01 $24,080 → 2013–14 $42,978 → 2023–24 $63,946.
An earlier draft said $56,128 for 2023–24, which matches no year in the files.)*

**Why this shape**
- The profile page reads one ~3 KB file (server-side, cached), so the list views and the 3.6 MB snapshot don't grow.
- Per-college files give readable git diffs: a yearly refresh touches each file once, and a revision shows as a
  changed value in one college's file.
- Columnar arrays are ~4× smaller than `{year: value}` objects and map directly to chart input.
- **`trends` summary in `schools.json`** (a few numbers per college) powers sorting, filters, badges, and trend chips
  without loading history:
  ```json
  "trends": {
    "window": [2013, 2023],
    "full_price_real": 0.08, "avg_paid_real": -0.03,
    "admit_rate": { "from": 0.123, "to": 0.051 },
    "applicants": 0.94, "undergrads": 0.12, "grant_pct_pts": 0.07
  }
  ```
- **Supabase later** ([migration-plan.md](migration-plan.md)): one long table
  `metric_values(unit_id, metric, year, value, source, edition, revised, approx)` with primary key
  `(unit_id, metric, year)`, plus `national_stats(metric, year, sector, p25, median, p75, n)`. The shards convert 1:1,
  so `lib/data.ts` keeps the same `getHistory(unitId)` signature.
- Vercel: extend `outputFileTracingIncludes` in `next.config.ts` to `./data/history/**`.

## Pipeline: `npm run sync-history`
Separate script (`scripts/sync-history.mts`) with the registry in `scripts/history/registry.mts`.

1. **Registry.** One entry per series and era: file-name pattern(s), columns (or a derive function over columns),
   suffix convention, and valid year range. Example: admissions `{ years: [2001, 2013], file: y => `IC${y}`,
   applicants: ["APPLCN"] | sum(["APPLCNM","APPLCNW"]) }` and `{ years: [2014, ∞), file: y => `ADM${y}` }`.
2. **Fetch.** For each (series, year), try both NCES bases; cache zips in `.cache/ipeds/`; prefer `_rv`. Scorecard:
   batch year-prefixed fields, 100 colleges per page.
3. **Extract** only the colleges in `schools.json` (history follows the current universe; a college that closed isn't
   shown). Unit IDs are stable, but check `HD{year}` for merged or renumbered IDs and record them in `notes`.
4. **Derive** full price, average total cost, generosity, admit rate, and yield per year with the *same* functions as
   `sync-data` (move them into a shared module so they can't drift).
5. **Validate** (fails the run unless allow-listed):
   - Every mapped column exists in every year it's mapped to.
   - Coverage per (series, year) within 20% of neighboring years.
   - Last history point == current `schools.json` value for every college (rule 1).
   - Year-over-year jumps > 3× flagged for review (typos like Purdue's 30,272 vs 39,272).
   - Spot-check 20 colleges against the Urban Institute API.
6. **Write** shards, `national.json`, `facts.json`, the `trends` summary (merged into `schools.json` by the next
   `sync-data`), and history editions into `meta.json` (`sources.*.history: { from, to }`) for citations.

**Cadence.** Backfill once. After that, run yearly after NCES's December release: re-fetch the last two years (to
pick up revisions), append the new year. The monthly scheduled refresh ([backlog.md](backlog.md)) can run it with
`--recent` to fetch only the last three years.

## Known caveats to surface in the UI
- **2020–21:** the pandemic affected enrollment, yield, test-taking, and aid (emergency grants). Annotate it and don't
  treat it as a trend.
- **Test-optional era (fall 2020+):** SAT/ACT percentiles cover fewer students; show the submission rate beside them.
- **SAT redesign (fall 2017):** break in the line.
- **Composition drift in national figures:** colleges open, close, and enter the ADM survey. National facts use a
  **fixed panel** (colleges reporting in both endpoint years), not all colleges each year.
- **Provisional latest year:** mark it (hollow point) until the revised file arrives.

## Tests (add with the build)
- Registry: for a fixed college (Vanderbilt 221999), each era returns the known value (fixtures from the files above).
- Suffix handling: `IC_AY` `…AY3` vs `COST1` `…ay2`; SFA `…2/1/0`.
- Derived-sum columns (IC2001 gender split).
- Validation catches a missing column and a coverage drop.

## Build notes (Phase 1)
Built 2026-09-28. Code: `scripts/sync-history.mts` (fetch, check, write), `scripts/history/registry.mts` (eras),
`scripts/history/build.mts` (pure build and checks), `scripts/history/cpi.mts`, `scripts/lib/ipeds.mts` (shared with
sync-data), `lib/derive.ts` (shared derivations), `lib/history.ts` (types, inflation, changes, citations, validation).
Tests: `tests/history.test.mts`.

### Commands
```
npm run sync-history                          # everything: what a release runs (~80 zips cached in .cache/ipeds/)
npm run sync-history -- --ids 221999,170976   # shards for these colleges only; national.json and facts.json still cover all
npm run sync-history -- --offline             # cached files and saved CPI only (local iteration; never for a release)
npm run sync-history -- --refresh             # re-download every NCES file
npm run sync-history -- --no-crosscheck       # skip the Urban Institute spot-check
```
Recent files (the last three years) are re-downloaded when a week old, to pick up NCES revisions. When NCES can't be
reached, a stale cached copy is used with a warning; a file never downloaded fails the run, because "unreachable" must
never read as "not published".

### What the files showed
- **Prices:** `IC{Y}_AY` holds Y–Y+1 in `…AY3` (IC2000_AY has only `AY1`–`AY3`). `COST1_{Y+1}` holds Y–Y+1 in `…AY2`
  and **Y+1–Y+2 in `…AY3`** (COST1_2024: Vanderbilt $63,946 in AY2, $67,498 in AY3). sync-data picked `AY3` whenever the
  column existed, which would have labeled 2024–25 prices as 2023–24 the first year it fell back to COST1. Both syncs now
  take the suffix from the file name (`priceSuffix()` in lib/derive.ts). IC2023_AY exists, so 2023–24 still comes from it.
- **Admissions:** IC2002 already has totals (the plan had it *unverified*); only IC2001 is split by gender, and its
  enrollees are summed from full-time and part-time, men and women. ADM2023 has an `_RV` file; ADM2024 doesn't yet, so
  fall 2024 is marked provisional. The same holds for SFA2324 (aid, 2023–24).
- **Carried-forward reports:** 1–3% of colleges a year in the IC era (2002–2013) report applicants, admits, and
  enrollees identical to the year before (e.g. Vanderbilt fall 2003 = fall 2002), nearly none since ADM (0–3 a year).
  NCES flags them as reported, and the Urban Institute has the same values. History treats an exact repeat of all three
  as not reported and lists the years in the shard's `repeated`; the profile explains the gap.
- **Impossible yields:** a few colleges reported more enrollees than admits in some past year. Yield is left out for
  that year (counts kept as reported). The profile's yield uses the same rule (`yieldOf()` in lib/derive.ts); no
  current value is affected.
- **Negative net prices** are real (grants above the cost of attendance, e.g. Columbia's lowest income band): net
  price series are `signed` and may go below zero; every other series can't.
- **Net price by income:** IPEDS `NPIS4{band}2` (publics, in-state) and `NPT4{band}2` (privates) equal the Scorecard
  values the profile shows, so history reads IPEDS for every year. The build compares the latest year with the snapshot
  and fails if more than 1% differ.
- **Year-over-year jumps over 3×:** ~770 across all colleges and series, almost all at small colleges (e.g. 221 → 1,130
  → 153 applicants). Listed for review and kept as reported.
- **CPI:** BLS never collected October 2025 (funding lapse); the 2025–26 average uses 11 months and the file lists
  the gap. Stored at `data/history/cpi.json` (with the rest of history) rather than `data/cpi.json`.

### Checks the build runs (nothing is written unless all pass)
1. Every column an era maps exists in that year's file header (`missingColumns`).
2. Years are consecutive per family; a missing year before the newest fails.
3. Every shard validates (`validateShard`: registered series, trimmed arrays, possible values).
4. Coverage per series never drops more than 20% from the year before, unless allow-listed with a reason
   (`EXPECTED_DROPS` in sync-history.mts; empty today).
5. **Rule 1:** every series' latest point equals data/schools.json for every college whose value is federal (CDS
   overrides are skipped). The first full run matched all 1,893 colleges, which also shows the lib/derive.ts refactor
   reproduces sync-data exactly.
6. Urban Institute cross-check: applicants in four years spanning IC → ADM and in-state tuition & fees in three years,
   for 12 colleges (72 values matched). Two things to know: the portal blocks Node's default user agent, and its
   `tuition_fees_ft` is a different item (average full-time charges, `TUITION2 + FEE2`), so the check compares
   `tuition_fees_published` (the published price, as ours), which it leaves out (−2) before about 2010.

`npm run check:lineage` (in `npm run verify` and CI) re-validates the committed shards and meta, and the test suite
re-runs rule 1 against the committed files, so a sync-data run that changes a same-year value without re-running
sync-history fails CI.

### Differences from the plan above
- **`trends` summary in schools.json:** deferred to Phase 3 (Explore columns and sorts are its only reader). The
  profile's tile, takeaway, and charts read the shard directly.
- **Supabase:** one row per shard (`school_histories`, `json`) plus `history_files` (meta, national, facts, cpi), in
  `supabase/migrations/20260928120000_history.sql`, rather than the long `metric_values` table: the shards convert 1:1
  and read back exactly, like `schools`. `npm run publish-data` publishes history after the dataset, in one
  transaction (`publish_history`), and reads it back. Whatever is in data/history/ is what's published, so a
  subset build publishes a subset.
- **Fail-soft reads:** if history can't load (e.g. the migration isn't applied yet), `getHistoryFiles()` and
  `getHistory()` log and return null, and pages render without it. The snapshot still fails loudly.
- **Revisions and gap-filling from prior-year columns** (`CHG*AY0`–`AY2`): not used yet. Each year comes from its own
  file.

## Build notes (Phases 2–3)
Built 2026-09-28 (`feature/trends-phase-2-3`). New code: `scripts/history/scorecard.mts` (College Scorecard
year-prefixed fields, cached in `.cache/scorecard/` for a week); scores and policy added to the admissions eras in
`registry.mts`; `raceShares()` moved to lib/derive.ts (shared with sync-data).

### What the data showed
- **SAT redesign:** the break is at **fall 2017**, as planned: the same colleges' SAT midpoints jumped a median of 65
  points that year and were flat in every other year (2013–2020). Charts split the line there and `changeOver()`
  never measures across it (`SAT_BREAK`).
- **Test policy (ADMCON7):** through fall 2015, 1 = required, 2 = recommended, 3 = neither; from fall 2016 a new 5 =
  considered but not required (test-optional); from fall 2022 "recommended" disappears and 3 means not considered
  (test-blind, `TEST_BLIND_FROM`). "Required" means the same in every era, so it's the national series: 66% of 1,511
  colleges required the SAT or ACT in fall 2019, 5% in fall 2024 (Home fact 3, fixed panel, baseline fixed at the last
  pre-pandemic fall). Code 4 ("don't know") and negatives are stored as not reported.
- **Scorecard year keys:** `{Y}.student.size` and race = fall Y (key 2024 = the snapshot's fall 2024). Completion
  `{Y}.completion.completion_rate_4yr_150nt` = the class that **entered fall Y − 6** (checked against exact IPEDS counts
  at three colleges; Scorecard 2024 = entering 2018). The Urban Institute files the same rate under entering + 5, which
  the cross-check now uses. Median debt `{Y}` = Y–Y+1 graduates and stops at 2020.
- **Graduation:** the profile's headline is Scorecard's `consumer_rate`, which has no history; the chart is the 6-year
  first-time full-time rate (93.2% vs 93.7% at Michigan) and says so. Not in the latest-point check.
- **Median debt:** Scorecard's `latest` debt isn't always the newest year-prefixed value (~53 colleges: some have only
  one or the other, a few differ). It's a **soft** latest-point check (`SOFT_LAST_POINT`): the build fails past 5% of
  colleges, and lists the rest.
- **Enrollment gap:** Scorecard has no fall 2000 enrollment for any college (allow-listed in `EXPECTED_DROPS`).
- **Derived overrides:** the latest-point check now treats a derived field (the SAT total) as overridden when any input
  is, which Illinois's and Maryland's CDS SAT figures needed.
- Every college now has history (1,893; Scorecard enrollment covers the 9 without federal price or admissions data).

### New flags and fallbacks
- `--cached-nces`: NCES files from the cache only (NCES was unreachable for hours on 2026-09-28); Scorecard and CPI
  online. `--offline` covers all three.
- **CPI:** BLS allows 25 keyless requests a day. If BLS refuses, the build reuses the saved `cpi.json` when it reaches
  the newest price year (past school years don't change), with a warning. Set `BLS_API_KEY` (free registration) to use
  the v2 API's 500 a day, which the scheduled refresh should.
- Scorecard needs `COLLEGE_SCORECARD_API_KEY` (sync-history now loads `.env.local`). The first fetch takes ~30 minutes
  (about 60 requests of ~80 year-prefixed fields for 100 colleges each).

### `school.trends` (Phase 3)
`sync-history` writes a 10-year summary per college into data/schools.json (`TREND_KEYS`: average cost and full price
after inflation, acceptance rate, applicants, undergrads, grant share, men's share; plus `diversity`, the diversity index from the
race/ethnicity shares via `diversityChange`, with its own floors (see [trend-indicators.md](trend-indicators.md#when-theres-no-indicator));
`{ since, from, to, change }`), and sync-data
keeps it until the next history run. It's registered in lib/fields.ts as the derived field `trends`, so citations
expand to its inputs. A test checks it equals `trendSummary()` of every committed shard. Explore sorts, change
columns, Compare "Then & now", trend standouts, and the trend indicators read it without loading history files.
