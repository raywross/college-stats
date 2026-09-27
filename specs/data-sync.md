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
| **`data/overrides.json`** | Hand-maintained | Verified patches (e.g. newer Common Data Set figures), deep-merged last |

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
```json
{
  "221999": {
    "_source": "Vanderbilt Common Data Set 2024-25 …",
    "admissions": { "year": 2024, "applicants": 45409, … },
    "sources": ["College Scorecard", "Vanderbilt Common Data Set 2024-25"]
  }
}
```
Keys starting with `_` are notes and are ignored. Arrays replace rather than merge.

## Output
One school per line in `data/schools.json` (~1.5 MB) so diffs between syncs stay readable. Commit it: the app reads it
at runtime (`lib/data.ts`), and `next.config.ts` traces it into server deployments.

## Files
- `scripts/sync-data.mts`: the whole pipeline (Node 24 runs TypeScript directly; no extra dependencies). Uses the
  system `unzip`.
- `data/overrides.json`: manual patches.
- `data/schools.json`: generated output.
