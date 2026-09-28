# Backlog

Planned work, roughly in priority order. Move items into a feature spec when they're picked up.

## Data
- [ ] **Trends over time.** Year-by-year history per college (cost and aid from 2008–09, admissions from fall 2001)
  with a separate `npm run sync-history`. Data plan: [trends-data.md](trends-data.md); UI plan:
  [trends-design.md](trends-design.md). Built in three phases (cost + admissions first).
- [x] **Per-value data lineage** ([data-lineage.md](data-lineage.md)): built 2026-09-28. Leftovers: Explore/Compare
  baseline banner and `school.reported` (with the agent below).
- [x] **Data tab** ([data-page.md](data-page.md)): built 2026-09-28. Follow-ups are the items below.
- [ ] **Keep CDS values out of comparisons when they're newer than federal data.** Cornell's override is CDS 2025–26
  (fall 2025 class) and currently replaces federal fall 2024 values in ranks, medians, Explore and Compare, against
  the federal-baseline rule. Options: use its 2024–25 edition for now, or wait for `school.reported` (agent below).
  The Data page states the current behavior (count computed from lineage); update that text when this changes.
- [ ] **Data page section 5: newer figures from colleges** (what the agent collects, its checks, the accuracy report,
  count of colleges): build with the college-reported data agent ([data-page.md](data-page.md#sections)).
- [ ] **Review the release calendar** (`data/release-calendar.json`) at least every 90 days (next by 2026-12-27; the
  page warns after that), and right after the IPEDS winter release (~Dec 2026): mark confirmed dates, add the 2026–27
  cycle's entries, and set a new `filesUpdatedAfter` for revision entries.
- [ ] **Use already-released IPEDS files?** `IC2025`, `EFFY2025`, `C2025_A` are out but unused (listed on the Data
  page). Decide whether any is worth adding (e.g. completions by field).
- [ ] **2024–25 sticker prices** from `COST1_2024` (`…AY3`), keeping same-year inputs for the all-student average
  ([data-page.md](data-page.md#research-findings-vintages-as-of-2026-09-28)).
- [ ] **College-reported data agent** ([college-reported-data.md](college-reported-data.md)): newer admissions figures
  from colleges' CDS and class profiles, auto-published when checks pass. Pilot on ~50 colleges first. Replaces the
  former "Read CDS PDFs" and "Expand CDS coverage" items (the existing 8 CDS overrides stay until the agent covers them).
- [ ] **Watch ACTS** (IPEDS admissions supplement): adopt if NCES publishes institution-level files. See
  [data-page.md](data-page.md#watching-acts).
- [ ] **Scheduled data refresh** (`chore/scheduled-data-sync`): monthly GitHub Action runs `npm run sync-data` and
  opens a PR with the diff; the API key goes in repository secrets. Also updates `data/release-calendar.json` statuses:
  today the NCES release check only runs when someone runs the sync, so until this exists the Data page can list a
  release as upcoming after it has shipped. Consider a weekly `--releases-only` run around expected release months.
- [ ] Show which colleges have CDS detail in Explore (e.g. a filter or badge), so users know where richer aid data exists.
- [ ] Off-campus / commuter cost variant for the all-student average (IPEDS has off-campus room & board), for
  colleges where most students live at home.

## Quality
- [ ] Tests for the sync mapping (`toSchool`, `toAid`, `addPrices`), the CDS importer (fixtures for classic and
  flat layouts, including the Purdue typo case), and missing-data handling in `lib/metrics.ts`.

## Platform
- [ ] Deploy to Vercel (see [migration-plan.md](migration-plan.md)).
- [ ] Supabase only when needed (accounts, saved lists). Multi-year history fits in per-college JSON files first; the
  table design for later is in [trends-data.md](trends-data.md#storage).
