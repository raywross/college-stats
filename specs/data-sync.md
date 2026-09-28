# Data Sync

`npm run sync-data` rebuilds `data/schools.json`: every operating, predominantly bachelor's-granting U.S. college
(~1,900). Run it whenever you want fresher data; it takes ~20 seconds.

## Setup
1. Get a key at https://api.data.gov/signup/ (1,000 requests/hour).
2. Put it in `.env.local` (git-ignored):
   ```
   COLLEGE_SCORECARD_API_KEY=your-key
   ```
   Never prefix it with `NEXT_PUBLIC_`; that would ship it to browsers. `.env.example` documents the name.
   On Vercel, add the same variable in Project → Settings → Environment Variables (only needed if the sync runs there).

## Sources (merged by IPEDS unit ID)
| Source | Access | Provides |
|---|---|---|
| **College Scorecard API** | `api.data.gov`, key required, 100 schools/page | The institution list, city/state/zip, ownership (type), undergrad size, race/ethnicity shares, Pell share, first-gen share, and cost & outcomes (net price overall and by income, sticker price, tuition, earnings at 6/10 yrs, graduation and retention rates, median debt). See [cost-outcomes.md](cost-outcomes.md) |
| **IPEDS Admissions survey (ADM)** | Bulk CSV zip from `nces.ed.gov/ipeds/datacenter/data/ADM{year}.zip`, no key | Applicants, admitted, enrolled, SAT/ACT 25th–75th percentiles, SAT/ACT submission rates, test policy (ADMCON7) |
| **IPEDS Student Financial Aid survey (SFA)** | Bulk CSV zip `SFA{yy}{yy+1}.zip`, no key | Share of full-time first-years receiving any aid, grants, institutional grants, Pell, state grants, loans (with averages); federal-aid recipients and average grant by family income (the `GRN4*2` fields = the file's newest year) |
| **IPEDS Institutional Characteristics (IC_AY)** | Bulk CSV `IC{year}_AY.zip`, the same academic year as the SFA file | Tuition & fees for in-district, in-state, and out-of-state students; books; on-campus room & board; other expenses. Used for sticker prices by residency and the all-student average cost ([cost-outcomes.md](cost-outcomes.md)) |
| **`data/overrides.json`** | Written by `npm run import-cds` (or by hand) | A college's own Common Data Set figures, deep-merged last. See [sources-and-citations.md](sources-and-citations.md) |

All admissions fields come from one IPEDS year so counts, rates, and scores describe the same class. The script
tries the newest ADM file first (current year, then back up to 5 years), so it upgrades automatically when NCES
publishes a new one. It prefers the revised `_rv.csv` when the zip contains one.

## Rules applied
- Included: `school.degrees_awarded.predominant = 3`, `school.operating = 1`.
- Excluded: online-only institutions (42 as of Sept 2026). Pass `--include-online` to keep them. Some large mostly-online
  schools (SNHU, Phoenix) aren't flagged online-only and remain.
- Excluded: schools reporting no undergraduates.
- Acceptance rate = admitted ÷ applicants, only when applicants ≥ 10 (otherwise `null`). Scorecard's rate is a fallback
  for schools missing from IPEDS ADM.
- Race: `other` = American Indian + Pacific Islander + unknown. International = Scorecard's `non_resident_alien`.
- Region is derived from state (see `REGIONS` in the script); territories get "Territories".
- Missing values are `null` everywhere, never 0. The UI shows "–" / "Not reported" and leaves them out of medians and ranks.

## Overrides
Each override must say where its values came from: a `cds` record (`{ edition, url }`, written by `import-cds`) or,
for a hand patch, `"_lineage": { "source": …, "url": …, "year": … }`. Every value the patch sets is attributed to
that source, field by field. A patch with neither, or with the retired `provenance` key, stops the sync.

```json
{
  "221999": {
    "_source": "Vanderbilt University Common Data Set 2024-25: https://…",
    "_imported": "2026-09-27",
    "cds": { "edition": "2024-25", "url": "https://…" },
    "admissions": { "year": 2024, "applicants": 45409, … }
  }
}
```
Keys starting with `_` are notes and are ignored (except `_imported`, used as the retrieval date, and `_lineage`).
Arrays replace rather than merge.

## Release calendar check
Before anything else, the sync checks NCES (HEAD requests, both file locations below) for the files of each unpublished
release in `data/release-calendar.json` and marks a release `published` once all of them exist (for revisions, once
each file's `Last-Modified` is after the entry's `filesUpdatedAfter`). A network failure only warns. Run just this step
with `npm run sync-data -- --releases-only` (no API key needed). See [data-page.md](data-page.md#release-calendar-schema-additions-to-the-plan).

## Where IPEDS files live (changed Dec 2025)
NCES moved newer releases to `https://nces.ed.gov/ipeds/complete-data-files/`; older ones remain at
`/ipeds/datacenter/data/`. The sync tries the new location first. Its own "Complete Data Files" listing page lags
behind what's downloadable, so don't use it to decide what's available.

The newest year is usually a **provisional** release that NCES revises about a year later; re-running the sync
picks up revisions (same file names).

### Layout change from the 2023–24 release
| Data | Up to 2022–23 | From 2023–24 |
|---|---|---|
| Aid totals (AGRNT, IGRNT, PGRNT, SGRNT, LOAN, SCUGFFN) | `SFA{yy}{yy}` | `SFA{yy}{yy}` |
| Residency (SCFA11–13P), income-band aid (GRN4*), aided net price (NPIST/NPGRN) | `SFA{yy}{yy}` | **`COST2_{end year}`** |
| Tuition & fees, books, room & board, other | `IC{start}_AY` (`CHG*AY3`) | `IC{start}_AY` or **`COST1_{end year}`** (`chg*ay2`) |

The sync detects this: if the SFA file lacks `GRN4N12` it merges `COST2_{end}` by unit ID, and for prices it takes
whichever of `IC{start}_AY` / `COST1_{end}` exists and detects the `…AY3` vs `…AY2` column convention.
Verified on the 2023–24 files: Vanderbilt's income-weighted federal-aid net price rebuilt from COST2 = $15,846, the
same as Scorecard's 2023–24 figure, and its full price ($89,590) matches Scorecard's cost of attendance.

## Citation metadata and lineage
Every stored value is traceable to its source; see [data-lineage.md](data-lineage.md).
- `data/meta.json`: retrieval date; each source's label, publisher, edition (e.g. "Fall 2024 (ADM2024)", "2023–24
  (SFA2324 + COST2_2024)") and URL; and `vintages`, the year each release describes
  (`{ "ipeds-adm": "Fall 2024", "scorecard-enrollment": "Fall 2024", "scorecard-cost": "2023–24", … }`). Scorecard
  years are detected by matching `latest.*` against year-keyed fields; `scorecard-latest` (outcomes etc.) is `null`
  because those fields each describe different cohorts.
- `school.lineage`: only for fields whose source differs from the default in `lib/fields.ts` (IPEDS ADM missing →
  `admissions.acceptance_rate` from Scorecard; every field an override sets → that override's source).
- **The sync validates before writing** (`validateLineage` in `lib/lineage.ts`): an unregistered field, an incomplete
  lineage record, or a release without a year stops the sync with nothing written. Adding a field to the output means
  registering it in `lib/fields.ts`.

## Output
One school per line in `data/schools.json` (~1.5 MB) so diffs between syncs stay readable. Commit it: the app reads it
at runtime (`lib/data.ts`), and `next.config.ts` traces it into server deployments.

## Files
- `scripts/sync-data.mts`: the whole pipeline (Node 24 runs TypeScript directly; no extra dependencies). Uses the
  system `unzip`.
- `data/overrides.json`: manual patches.
- `data/schools.json`: generated output.
