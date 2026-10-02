# Earnings and Debt by Major (Scorecard Field of Study)

> Status: **built** 2026-10-02. Wave 3. Built before [majors.md](majors.md) (majors owns the CIP table;
> see [As built](#as-built) for how the two wire together once it merges). Research 2026-09-28; bulk CSV probed and
> live 2026-10-02. Part of [data-expansion](README.md).

## Question it answers
*What do graduates in my major from this college earn? Is it more than the same major elsewhere?*

## Source
College Scorecard Field of Study data, per college × 4-digit CIP × credential. Available through the same API key
(`latest.programs.cip_4_digit`, an array per college) or as a bulk CSV (`Most-Recent-Cohorts-Field-of-Study`).

Vanderbilt: 181 programs, **53 bachelor's**, of which **19** have 4-year median earnings (the rest are suppressed for
small cohorts). Example, Computer Science bachelor's:

| Measure | Value |
|---|---|
| Graduates (two pooled years) | 205, 198 |
| Median earnings 1 year after completion | $122,244 |
| Median earnings 4 years after | $160,021 |
| National median, same field and credential, 4 years | $107,009 |
| 4 years, Pell / non-Pell | $126,718 / $189,399 |

Each program also has Parent PLUS and graduate debt, and repayment. Fields are per program, so 1,893 colleges ×
~50 bachelor's programs ≈ 100K rows.

## Ingest
- Prefer the **bulk CSV** (one download, ~100K rows) over paging the API for 1,893 colleges' arrays. Keep bachelor's
  (credential level 3) only.
- A program with fewer than the suppression threshold shows as "Too few graduates to report", never as missing.
- Validate: 4-digit CIP codes exist in the CIP table from [majors.md](majors.md).

## Store
- **Detail shard only** (`data/detail/schools/{unitid}.json`, from majors.md):
  `programs[cip4].earnings: { y1, y4, y4_national, y4_pell, y4_non_pell }`, `debt_median`, `graduates`.
- **Snapshot:** none, except a count `academics.programs_with_earnings` for Explore.
- `SourceKey` `scorecard-fos`, vintage = the cohort years the dataset labels (register in `meta.sources`).

## Display
- **Profile, Academics → majors list:** each major row expands to earnings 1 and 4 years out, with the national
  median as a tick. "Top-earning majors here" list (top 5 with data).
- **Compare:** a "your major" row: pick a field, compare earnings across the colleges (as built: by broad 2-digit field; see As built).
- **Explore:** later, a "major" mode that lists colleges by earnings for one field (needs an index across shards:
  build `data/detail/by-cip/{cip4}.json` at sync time).
- **Glossary:** `field-of-study`, `earnings-after-completion` (measured from completion, unlike the institution-level
  "after entry" earnings the site shows today; say so).

## Keep history?
**None.** Cohorts are pooled across years and the methodology changed between releases (as with institution earnings
in [trends-data.md](../trends-data.md), which aren't trended either). Show the latest release only.

## Top-level trend?
**None.** A snapshot comparison, not a trend.

## As built

**Source.** The bulk CSV, not the API: `Most-Recent-Cohorts-Field-of-Study.csv`, inside a zip at
`https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Field-of-Study_{date}.zip` — the date in
the filename changes every release (no stable name), so `sync-data` reads it off
`https://collegescorecard.ed.gov/data/`'s own markup each run (`scripts/lib/field-of-study-sync.mts
discoverFieldOfStudyUrl`) rather than hard-coding a URL. Cached at `.cache/scorecard/field-of-study.zip` (a `.url`
file alongside it, like `scripts/lib/ipeds.mts`'s IPEDS caches), refreshed after 7 days. `SourceKey`/`VintageKey`
**`scorecard-fos`**. At build time: 153 MB CSV, 227,980 rows across every credential level; 68,181 bachelor's
(`CREDLEV` 3) rows, 3,483 of them non-main-campus (`MAIN` 0, dropped).

**Probe (2026-10-02).** Vanderbilt (221999) has 181 Field of Study rows, 53 bachelor's, confirming the spec's
numbers. Computer Science bachelor's (`CIPCODE` `"1107"`, 4 digits always, no dot) matches exactly: graduates 205 +
198, `EARN_MDN_1YR` 122244, `EARN_MDN_4YR` 160021, `EARN_MDN_4YR_NAT` 107009, `EARN_PELL_WNE_MDN_4YR` 126718,
`EARN_NOPELL_WNE_MDN_4YR` 189399. Of Vanderbilt's 53 bachelor's rows, 19 have a non-suppressed `EARN_MDN_4YR`,
matching the spec's "19 have 4-year median earnings." **Suppression marker: the literal string `"PS"`**, not
`"PrivacySuppressed"` as the data dictionary's prose describes (that's the raw per-release file's convention; this
"most recent" rollup abbreviates it). A second marker, `"NA"` ("not available" — the column wasn't calculated for
that row, a different reason than privacy), also appears on `IPEDSCOUNT1`/`2` and the earnings/debt columns; both
become `null`, never 0 or dropped (data-lineage.md's "missing is null" rule covers the data-doesn't-exist case as a
whole, not just the privacy case, so no separate suppression flag is stored — see "Suppression" below).

**Cohort years differ by column, read from `CollegeScorecardDataDictionary.xlsx`'s `FieldOfStudy_Cohort_Map` sheet
(Most Recent column), checked 2026-10-02:**

| Field | What it's based on |
|---|---|
| `IPEDSCOUNT1` | Award year 2021–22 |
| `IPEDSCOUNT2` | Award year 2022–23 |
| `EARN_MDN_1YR` | Treasury-matched AY2018–19/2019–20 completers, earnings measured CY2020–21 |
| `EARN_MDN_4YR`, `EARN_MDN_4YR_NAT` | AY2017–18/2018–19 completers, earnings measured CY2022–23 |
| `EARN_PELL_WNE_MDN_4YR`, `EARN_NOPELL_WNE_MDN_4YR` | AY2014–15/2015–16 completers, earnings measured CY2019–20 — **3 years older** than the overall 4-year figure above |
| `DEBT_ALL_STGP_EVAL_MDN` | NSLDS pooled AY2018–19/2019–20 cohort |

This is Scorecard's own design (the "most recent" file pulls each metric's latest independent calculation; see
`FieldOfStudyDataDocumentation.pdf`, "Data files available"), not a site-side inconsistency, but it means a single
program row isn't one snapshot: `graduates` describes two different years than `debt_median`, which describes two
different years than `y4`, which describes different years than `y4_pell`/`y4_non_pell`. Like `scorecard-latest`
(outcomes and other Scorecard fields with the same problem), **`vintages["scorecard-fos"]` is left `null`** ("most
recent release"); the citation's `description` in `meta.json` spells out the cohort mismatch in prose instead of a
single year, and the profile's earnings detail flags the Pell/non-Pell split specifically since it's the most
different (3 years, not ~1).

**Debt column chosen:** `DEBT_ALL_STGP_EVAL_MDN` — median federal debt (Direct/Stafford loans plus Grad PLUS,
excluding Parent PLUS and Perkins) among borrowers evaluated at the institution where they completed. Scorecard
documents five other debt variants (`PP` for Parent PLUS, `ANY` for debt from every institution attended, plus
race/sex splits); this is the one comparable to the site's existing `outcomes.median_debt`.

**Graduates:** `IPEDSCOUNT1 + IPEDSCOUNT2` summed (two different award years, per above); `null` only when *both*
are unavailable, so a program missing one year's count still shows the other.

**CIP format:** stored as the dotted 4-digit form `"11.07"` (two digits, a dot, two digits), matching
[majors.md](majors.md)'s 6-digit convention (`"11.0701"`) truncated to a family. `toCip4()`/`isPlausibleCip4()` live
in `lib/field-of-study.ts`.

**CIP integration (wired at the wave 3 merge).** [majors.md](majors.md) owns `data/reference/cip2020.json` and
`lib/cip.ts`. `isPlausibleCip4()` stays a shape check (`/^\d{2}\.\d{2}$/`) because `lib/field-of-study.ts` is pure
and client components import it; the existence check (`hasCip4`) runs where the CIP table is already loaded:
- `programEarningsFrom` (sync) leaves out a code CIP 2020 doesn't have and reports it; sync-data warns with the list
  and stops only past 25 (a sign CIP itself changed). The October 2026 file has 3 such codes, all retired CIP 2000
  groups (42.02 Clinical Psychology, 51.16 Nursing, 23.05 Creative Writing), and just one row at a college on the
  site: a fully suppressed 42.02 at a college that also reports the current 42.28.
- `DETAIL_TABLES.programs.checkRows` (`lib/detail.ts`, server and scripts only) rejects any stored code that isn't a
  4-digit CIP 2020 group, so `check:lineage` and publish catch one too.

**Store.** `programs` added to `DetailTables`/`DETAIL_TABLES` (`lib/detail.ts`), keyed by `Cip4`:
`{ title, graduates, earnings: { y1, y4, y4_national, y4_pell, y4_non_pell }, debt_median }` (`lib/field-of-study.ts`
`ProgramEarnings`). `DetailTable.year` was widened to `string | null` (previously always a string, since
`home_states`' vintage always has one) so a table whose vintage has no single year — `scorecard-fos`, like
`scorecard-latest` — can validate correctly instead of failing a "has no year" check that assumed every table's
vintage resolves to a year; `validateDetail`'s year check now compares against `meta.vintages[vintage] ?? null`
directly rather than special-casing falsy. Snapshot: `academics.programs_with_earnings` (count of programs with a
y1 or y4 figure), cross-checked against the detail file in `detailMismatches`. Fields registered: `detail.programs`,
`academics.programs_with_earnings`. `sync-data` fetches Field of Study after residence, builds `programs` tables with
`addProgramDetails` (creating a new detail file for a school residence didn't already give one), and sets
`academics.programs_with_earnings` from the same pass (`scripts/sync-data.mts`).

**Memory.** The bulk CSV (153 MB, ~190 columns × 227,980 rows) OOM'd Node's default heap when read with the
generic `parseCsv` (`scripts/lib/ipeds.mts`), which keeps every column of every row — fine for the much smaller IPEDS
files, not for this one. `field-of-study-sync.mts` has its own narrow tokenizer (`readNeededColumns`) that keeps only
the 13 columns this spec uses and discards non-bachelor's/non-main rows before ever allocating a per-row object,
instead of filtering after the fact.

**Suppression.** Every `null` in a `programs` table row means the source said `"PS"` or `"NA"` for that one
value — by construction, since a program only gets an entry here because NCES/NSLDS recognized the CIP+credential
combination at all. So no separate suppression flag is stored; the display layer (not the data model) renders a
null earnings/debt value as "Too few graduates to report" instead of a blank dash, satisfying data-lineage.md's
"never as missing or 0" without a redundant field.

**Display.**
- **Profile, Academics → "Top-earning majors here"** (`components/school/FieldOfStudy.tsx`): the 5 bachelor's
  programs with the highest post-completion earnings among those with any earnings data (`topEarningPrograms`),
  each a native `<details>` row (no client JS) expanding to 1- and 4-year earnings (`BenchmarkBar` with the national
  median as the tick, reusing the existing chart component rather than a new one), the Pell/non-Pell split with a
  note about its older cohort, median debt, and graduate count. A separate component from "Most popular majors"
  (ranked by graduate count); at the wave 3 merge it went directly under that list in Academics, and each row of the
  list shows its 4-digit group's 4-year earnings ("Graduates in this field earn $X 4 years out", joined by `cip4`).
- **Compare → "Your major"** (`components/compare/YourMajor.tsx`, a client component; numbers from
  `lib/field-compare.ts`, wired into `app/compare/page.tsx`). Revised after the user's wave 3 review (2026-10-02):
  - **Broad fields, not 4-digit programs.** The picker lists 2-digit CIP families ("Computer science", "Biology"),
    because colleges name and split programs differently and the family compares like with like. Only families at
    least one compared college awards first-major bachelor's in (`familiesOffered`, from
    `academics.bachelors_by_family`).
  - **Updates in place.** The server computes every offered field (`fieldStat`), so picking one and pressing Compare
    swaps the section without navigation or a scroll jump. The pick still goes in the URL (`?major=11`, via
    `history.replaceState`) and the form still works as a plain GET without JavaScript. Older `?major=11.07` links
    map to their family.
  - **What it compares, per college:** bachelor's in the field (first majors, plus second majors), share of the
    college's graduates with its 10-year change (from the `major_{family}` history series), earnings 4 years after
    completion with the 1-year figure and a national tick, median federal debt, and the programs in the field (count,
    largest three, top earner). Earnings and debt are each 4-digit program's median weighted by its graduates (1 when
    suppressed): a typical figure for the field, labeled as such, not a true median.
  - Notes distinguish "Doesn't offer this field" (0 first majors), "No earnings reported" (no Scorecard rows in the
    field), "Too few graduates to report" (rows, all suppressed), and "Not reported" (majors not reported).
  Not added to the "All the numbers" table, since it depends on a pick rather than a plain per-school field.
- **Explore "major mode"** (listing colleges by earnings for one field, needs `data/detail/by-cip/{cip4}.json`):
  **deferred**, as the spec says ("later"). No index was built.
- **Glossary:** `field-of-study` and `earnings-after-completion` (says plainly it's measured from completion, unlike
  the site's institution-level `median-earnings`, which is from entry).

## Refresh and maintenance

**Nothing needs to change in code for an ordinary Scorecard refresh.** The next time `sync-data` runs after Scorecard
publishes a new Field of Study release:
1. `discoverFieldOfStudyUrl()` reads the current zip link straight off the data page — it isn't hard-coded, so a new
   date in the filename (the June 2026 → next release pattern) is picked up automatically.
2. The 7-day cache (`.cache/scorecard/field-of-study.zip`) just expires and re-downloads; delete it manually to force
   a refresh sooner.
3. `vintages["scorecard-fos"]` stays `null` either way ("most recent release"), so there's no year to bump anywhere
   in code — unlike `ipeds-ef-c` or `ipeds-adm`, which have an explicit year that has to change. The citation's
   `url` in `meta.json` updates to the new zip automatically.
4. `validateDetail`/`detailMismatches`/the lineage check all re-verify the new numbers the same way; a college losing
   or gaining programs just changes which detail files exist and `academics.programs_with_earnings`.

**What *would* need a human:**
- **Scorecard renames a column.** `readNeededColumns` throws a specific "Field of Study CSV has no X column" error
  rather than silently reading blanks — the same guard `fetchResidence`/`fetchTransfers` use for their IPEDS files.
  If that happens, re-probe the new CSV's header (as this spec's research did) and update `NEEDED_COLUMNS` and the
  readers in `field-of-study-sync.mts`.
- **Scorecard changes which cohort years a metric uses**, or stops calculating one (the data dictionary already
  documents this churn — `EARN_MDN_HI_1YR` was renamed `EARN_MDN_1YR` in an earlier release, per
  `FieldOfStudyDataDocumentation.pdf`). Since the site doesn't display a year for these fields, most such changes are
  invisible to the UI; re-check the `FieldOfStudy_Cohort_Map` sheet in `CollegeScorecardDataDictionary.xlsx` if the
  Pell/non-Pell-vs-overall gap (currently 3 years) matters enough to call out again.
- **The suppression marker changes spelling** (e.g. Scorecard starts writing `"PrivacySuppressed"` in full in this
  file, matching the prose in their own documentation). `num()` in `field-of-study-sync.mts` treats anything that
  doesn't parse as a finite number as `null`, so this wouldn't break ingestion — but it's worth a quick check after
  any release that a whole college's earnings aren't unexpectedly all-null (a sign the marker, not the data, changed).
- **Retired CIP codes:** if sync-data warns about more codes missing from CIP 2020, check whether NCES published a new
  CIP edition (re-run `npm run build-cip`) before raising the limit of 25.
