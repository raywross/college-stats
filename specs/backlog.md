# Backlog

Planned work, roughly in priority order. Move items into a feature spec when they're picked up.

## Data
- [ ] **Trends over time.** Year-by-year history per college with `npm run sync-history`. Data:
  [trends-data.md](trends-data.md); UI: [trends-design.md](trends-design.md).
  - [x] Phase 1 (2026-09-28): cost, aid, net price, and admissions history (shards in git); national
    distributions; CPI; profile "Over time" (Cost, Aid, Admissions), Overview "10 years" tile, Home facts 1–2;
    Supabase tables + publish. History migration applied to the dev project and published 2026-09-28.
  - [x] Phase 2 (2026-09-28): scores with the SAT break and test-optional shading, undergrads, race/ethnicity,
    graduation by entering class, median debt; section-headline deltas; Home fact 3.
  - [x] Phase 3 (2026-09-28): `trends` summary in schools.json; Explore change columns and sorts; Compare "Then & now";
    trend standouts.
  - [x] Trend indicators (2026-09-28): cost, applications, diversity, selectivity as up/steady/down on the profile
    hero, Explore filters/cards/table, and Compare ([trend-indicators.md](trend-indicators.md)); `trends.diversity`.
  - [ ] Split unknown race out of "other" in history (a `race_unknown` series), so the diversity indicator can leave
    unknowns out of the index instead of skipping colleges whose unknown share moved (see
    [trend-indicators.md](trend-indicators.md#when-theres-no-indicator)).
  - [ ] Publish after each history change (`npm run publish-data`); pages that were prerendered pick it up at their
    daily regeneration unless `REVALIDATE_URL`/`REVALIDATE_SECRET` are set locally.
  - [ ] Explore test-policy filter (required / test-optional / test-blind), so Home fact 3 can link to it.
  - [ ] Review the ~50 soft median-debt differences (Scorecard `latest` vs its year fields) that sync-history lists.
  - [ ] Review the ~890 year-over-year jumps over 3× that `sync-history` lists (mostly small colleges' reporting
    errors, kept as reported). Decide whether to drop clear typos the way carried-forward repeats are dropped, or to
    exclude them from national figures only.
  - [ ] Use each IC_AY file's prior-year columns (`CHG*AY0`–`AY2`) to fill gaps and cross-check revisions.
- [x] **Per-value data lineage** ([data-lineage.md](data-lineage.md)): built 2026-09-28. Leftovers: Explore/Compare
  baseline banner and `school.reported` (with the agent below).
- [x] **Data tab** ([data-page.md](data-page.md)): built 2026-09-28. Follow-ups are the items below.
- [ ] **Keep CDS values out of comparisons when they're newer than federal data.** Cornell's override is CDS 2025–26
  (fall 2025 class) and currently replaces federal fall 2024 values in ranks, medians, Explore and Compare, against
  the federal-baseline rule. Options: use its 2024–25 edition for now, or wait for `school.reported` (agent below).
  The Data page states the current behavior (count computed from lineage); update that text when this changes.
  History is federal throughout, so for these 8 colleges the "Over time" admissions charts end a year before the
  headline (a note says so); the same fix should make charts and headlines agree.
- [ ] **Data page section 5: newer figures from colleges** (what the agent collects, its checks, the accuracy report,
  count of colleges): build with the college-reported data agent ([data-page.md](data-page.md#sections)).
- [ ] **Review the release calendar** (`data/release-calendar.json`) at least every 90 days (next by 2026-12-27; the
  page warns after that), and right after the IPEDS winter release (~Dec 2026): mark confirmed dates, add the 2026–27
  cycle's entries, and set a new `filesUpdatedAfter` for revision entries.
- [ ] **Use already-released IPEDS files?** `IC2025`, `EFFY2025`, `C2025_A` are out but unused (listed on the Data
  page). Decide whether any is worth adding (e.g. completions by field).
- [ ] **2024–25 sticker prices** from `COST1_2024` (`…AY3`), keeping same-year inputs for the all-student average
  ([data-page.md](data-page.md#research-findings-vintages-as-of-2026-09-28)). If the snapshot moves ahead, history's
  price series (`scripts/history/registry.mts`) must follow, or CI's latest-point check fails.
- [ ] **College-reported data agent** ([college-reported-data.md](college-reported-data.md)): newer admissions figures
  from colleges' CDS and class profiles, auto-published when checks pass. Pilot on ~50 colleges first. Replaces the
  former "Read CDS PDFs" and "Expand CDS coverage" items (the existing 8 CDS overrides stay until the agent covers them).
- [ ] **Religious life** ([religious-life.md](religious-life.md)). Phase 1: IPEDS affiliation for all colleges (685 of
  1,893). Then a 25-college pilot of per-school sources (CDS C7/H14, IR reports, org directories, Hillel), national
  faith-org directories, and partnership requests (Hillel, Chabad, Anthology).
- [ ] **Greek life** ([greek-life.md](greek-life.md)). Phase 1: CDS F1/F4. Then the same pilot for fraternity &
  sorority life office reports (members by council, recruitment), checked against F1.
- [ ] **Watch ACTS** (IPEDS admissions supplement): adopt if NCES publishes institution-level files. See
  [data-page.md](data-page.md#watching-acts).
- [ ] **Scheduled data refresh** (`chore/scheduled-data-sync`): monthly GitHub Action runs `npm run sync-all`
  (`sync-data` then `sync-history`, which must move together: CI checks that history ends on the snapshot's values) and
  opens a PR with the diff; the API keys go in repository secrets (Scorecard, and a free `BLS_API_KEY`: keyless BLS
  allows 25 requests a day). Cache `.cache/ipeds/` between runs (~80 zips), and
  expect NCES to drop connections now and then (the scripts retry; a file never downloaded fails the run). After each
  December IPEDS release, the provisional year gets its revised file and a new year is appended. Also updates `data/release-calendar.json` statuses:
  today the NCES release check only runs when someone runs the sync, so until this exists the Data page can list a
  release as upcoming after it has shipped. Consider a weekly `--releases-only` run around expected release months.
- [ ] Show which colleges have CDS detail in Explore (e.g. a filter or badge), so users know where richer aid data exists.
- [ ] Off-campus / commuter cost variant for the all-student average (IPEDS has off-campus room & board), for
  colleges where most students live at home.

## Quality
- [ ] Tests for the sync mapping (`toSchool`), the CDS importer (fixtures for classic and flat layouts, including the
  Purdue typo case), and missing-data handling in `lib/metrics.ts`. (Aid and price derivations moved to
  `lib/derive.ts` and are covered by `tests/history.test.mts` plus the latest-point check on every college.)

## Platform
- [x] Deploy to Vercel: pre-release dev site at https://college-stats-nine.vercel.app, reading the Supabase dev
  project (2026-09-28; [supabase.md](supabase.md#current-state-pre-release-dev-only)).
- [ ] **Formal release** (after the planned feature set is in, before circulating the site more widely): create the
  prod Supabase project and split dev/prod (apply both migrations: dataset and history), run `npm run sync-history` if
  the committed history is stale, point Vercel Production at prod, turn on publish-on-merge and
  revalidation secrets ([setup](supabase.md#setup-phase-3)), and put control procedures in place (who may publish to
  prod, review before data merges, rollback). Optionally a custom domain.
- [ ] Supabase user data (accounts, saved lists) goes in as new migrations. History stays in git as per-college JSON
  (reviewable diffs when NCES revises past years, CI checks, JSON previews) and is published 1:1 to
  `school_histories`; decided 2026-09-28 over build-and-publish-only.
