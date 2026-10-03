# Backlog

Planned work, roughly in priority order. Move items into a feature spec when they're picked up. Planned specs are
published at `/roadmap` ([roadmap.md](roadmap.md)): add each new one to `lib/roadmap.ts` (a test enforces it).

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
  - [x] Explore test-policy filter (required / test-optional / test-blind), so Home fact 3 can link to it: built as
    `policy=required,optional,blind` ([cds-test-scores-and-policy.md](data-expansion/cds-test-scores-and-policy.md)).
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
- [ ] **Data expansion** ([data-expansion/](data-expansion/README.md)): public data not yet on the site, one spec
  per source, in four waves. Answers the "already-released IPEDS files" question: `IC2025` →
  [campus-services.md](data-expansion/campus-services.md), `C2025_A` → [majors.md](data-expansion/majors.md),
  `EFFY2025` left out.
  - [x] Wave 1 (files already downloaded, or fields on the Scorecard call; one PR per spec), built 2026-09-29: student
    body, admissions detail, loans and repayment, housing and policies, and admission factors (with the events log).
  - [ ] Wave 2 (one new NCES file each): campus profile (HD, built 2026-09-30), campus services and athletics (IC, built 2026-09-30), student-faculty
    ratio (EF-D, built 2026-09-30), residence (EF-C, built 2026-10-02), 8-year outcomes (OM, built 2026-10-02), Pell/race graduation (GR, built 2026-10-02), finances (DRVF,
    built 2026-10-02), faculty (SAL, built 2026-10-02).
  - [x] **Per-college detail file** `data/detail/schools/{unitid}.json` (decided 2026-09-28: a new file, not the
    history shard) for large snapshot tables: majors, home states, earnings by major. Validation, lineage check,
    Supabase `school_details` table + publish, fail-soft `getDetail()`. Built 2026-10-02 with residence (home states;
    `lib/detail.ts`, [residence.md](data-expansion/residence.md#as-built)); majors and field of study add tables.
    The migration `20261002120000_school_details.sql` must be applied before the next publish.
  - [x] Wave 3, built 2026-10-02: majors (completions, C{Y}_A, [majors.md](data-expansion/majors.md#as-built)) and
    earnings by major ([field-of-study.md](data-expansion/field-of-study.md): the `detail.programs` table, "Top-earning
    majors here" and Compare's "your major"). Both use the detail file; Field of Study codes are checked against CIP 2020.
  - [ ] Wave 4, from the CDS records of [round 3](college-reported-round-3.md) (specified in full 2026-10-03 after an
    inventory of 19 real 2025–26 CDS files): [admissions profile](data-expansion/cds-admissions.md) (GPA, factors,
    early rounds, wait list), [admissions by residency](data-expansion/cds-residency-admissions.md),
    [test scores and the coming cycle's policy](data-expansion/cds-test-scores-and-policy.md),
    [application logistics](data-expansion/cds-application-logistics.md) (deadlines, deposits, gap years),
    [financial aid](data-expansion/cds-financial-aid.md) (CSS Profile, aid for international students, need vs merit,
    full H2), [enrollment, retention and graduation a year newer](data-expansion/cds-student-body-and-outcomes.md),
    [class sizes and programs](data-expansion/cds-academics.md), [transfer](data-expansion/cds-transfer.md),
    [next-year price and graduates' debt](data-expansion/cds-cost-and-debt.md). Every item each spec needs is in the
    round-3 extraction scope, so the one full run captures them all before any of these ships.
  - [ ] Graduation as a fifth trend indicator ([outcome-measures.md](data-expansion/outcome-measures.md#top-level-trend)).
- [ ] **2024–25 sticker prices** from `COST1_2024` (`…AY3`), keeping same-year inputs for the all-student average
  ([data-page.md](data-page.md#research-findings-vintages-as-of-2026-09-28)). If the snapshot moves ahead, history's
  price series (`scripts/history/registry.mts`) must follow, or CI's latest-point check fails.
- [x] **College-reported data agent** ([college-reported-data.md](college-reported-data.md)): built 2026-10-02 (#50),
  pilot run 2026-10-03 (22 colleges published), round 2 the same day ([college-reported-round-2.md](college-reported-round-2.md):
  profiles lead with the newest published figures, discovery costs a tenth as much, saves as it goes, data PRs carry
  `schools.json`). Setup: [college-reported-setup.md](college-reported-setup.md). Leftovers:
  - [ ] **Round 3** ([college-reported-round-3.md](college-reported-round-3.md), planned 2026-10-03): build before the
    full 1,893-college run so no document is visited twice: permanent archive + manifest, template-workbook and
    fillable-PDF readers keyed by CDS code (no model), layout-aware PDF text, the full code-keyed extraction scope
    (sections B–I) into per-document records, batch extraction, free discovery probes, per-tier budgets, the measured
    pilot (`--pilot --rediscover --max-cost 10`) and its go/no-go table. Owner decisions listed in the spec's open
    questions (archive location, prior editions, cap).
  - [ ] Measure discovery cost on that pilot and update the round-3 estimates (the round-2 figures were never measured).
  - [ ] Re-run the 15 pilot colleges that never got a full attempt (6 timeouts, 9 stopped by the credit limit).
  - [ ] Check Duke (61,935 vs 61,395 applicants) and Stanford (enrolled 1,866 vs 1,839) against their sources.
  - [ ] Update the 8 hand-imported CDS overrides to their 2025–26 editions (`npm run import-cds`), or retire them
    now that the agent reads CDS files.
- [ ] **Religious life** ([religious-life.md](religious-life.md)). Phase 1: IPEDS affiliation for all colleges (685 of
  1,893). Then a 25-college pilot of per-school sources (CDS C7/H14, IR reports, org directories, Hillel), national
  faith-org directories, and partnership requests (Hillel, Chabad, Anthology).
- [ ] **Greek life** ([greek-life.md](greek-life.md)). Phase 1: CDS F1/F4. Then the same pilot for fraternity &
  sorority life office reports (members by council, recruitment), checked against F1.
- [ ] **LGBTQ+ life** ([lgbtq-life.md](lgbtq-life.md)). Phase 1: IPEDS "another gender" counts (add `EF{Y}A` to the
  sync; blank means not collected, never ranked). Then a state-law table for public colleges (Texas SB 17 first),
  Trans Policy Clearinghouse and campus-center leads matched to colleges, permission requests (Beemyn, Consortium,
  oSTEM), and a 25-college pilot verifying policies on each college's own pages, with human review of conduct-code
  findings.
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

## National trends
How college is changing across the country, not at one college: nationally, and by region, public or private, size,
and selectivity ([national-trends.md](national-trends.md)). Each idea is a study in that spec; add new ones there and
list them here.
- [ ] **Trends page and shared breakdowns:** `/trends` with a card per study, `/trends/{study}` pages, the standard
  breakdowns (region, type, size, selectivity) computed by `sync-history`, and a test that recomputes each study.
- [ ] **Study 1: Men and women in admissions.** Share of colleges admitting men vs women at a notably higher rate, 2001 to
  now, and where the change is concentrated (first look: the Northeast and moderately selective colleges drive it; the
  West moved the other way). Needs `applicants_men`/`applicants_women` history series first.
- [ ] **Studies 2–6** (specified 2026-10-03 in [trends/](trends/), each one registry entry, one build function, one
  page once the hub exists): [test-optional](trends/test-optional.md) (66% → 5% requiring tests; needs the Explore
  test-policy filter), [shrinking colleges](trends/shrinking-colleges.md) (half of colleges 10%+ smaller),
  [price gap](trends/price-gap.md) (who is discounting), [out-of-state students](trends/out-of-state.md) (publics),
  [Pell graduation gap](trends/pell-gap.md) (widened 9 → 11 points).
- [ ] **Top-10 lists** ([trends/top-10-lists.md](trends/top-10-lists.md)): `/trends/movers`, ten lists with floors and
  reviewed exclusions (online-first, closed or merged); Explore `minApplicants`/`minUndergrads` params; later the
  distance-education share from `EF{Y}A_DIST` as `demographics.online_share`.
- [ ] **By athletic conference** ([trends/conferences.md](trends/conferences.md)): index with the Power 4 side by side,
  a page per conference (members, medians over time under today's-members and members-at-the-time rules, realignment
  timeline). Slugs added to `lib/conferences.ts`.
- [ ] **By state** ([trends/states.md](trends/states.md)): tile map colored by measure, a page per state (10-college
  floor, public/private split, origins, movers, public research universities). Metro pages later reuse the template.
- [ ] More ideas (HBCU applications, legacy and factors, majors by group, transfers, faculty, borrowing, an annual
  "year in college data") are listed in the hub; spec one before building it.

## Links, names, and looks
Specified 2026-10-03 in [school-identity/](school-identity/README.md), in build order:
- [ ] **Official links** ([school-identity/links.md](school-identity/links.md)): website (already stored, unused),
  admissions, application, financial aid, veterans', disability services from `HD{Y}` columns the sync already
  downloads; the campus visit page found on each college's admissions page by a scored link probe (Haiku picker for
  the rest); a liveness check. Hero links row, compact-header Website link, Cost and Students placements.
- [ ] **Social accounts** ([school-identity/social-accounts.md](school-identity/social-accounts.md)):
  `npm run sync-wikidata` (one SPARQL query by IPEDS id → `data/wikidata.json`: accounts, other names, article,
  logo file, 1,719 colleges); homepage footer scan fills ~350 more; icon row in the hero.
- [ ] **Short names and nicknames** ([school-identity/aliases.md](school-identity/aliases.md)): `data/aliases.json`
  from IPEDS `IALIAS`, Wikidata other names, the homepage domain, and a curated file; one scorer for the typeahead and
  Explore's `q`; the matched alias shown in results; Supabase `school_aliases` table indexed by key.
- [ ] **Colors and marks** ([school-identity/brand.md](school-identity/brand.md)): colors from Wikipedia's college
  color data (cited to brand guides) joined through each article's infobox, tints derived per theme at sync time;
  the college's site icon at 192 px in `public/brand/` in place of the monogram; opt-out file, `/data` trademark line,
  removal route. Decided 2026-10-03: show colors and icons, with the safeguards in the spec; colors ship first.

## Design and usability
- [ ] **Compare redesign** ([compare-redesign.md](compare-redesign.md)): the compare page is 10,000px on desktop and
  15,000px on a phone (2026-10-02), half of it the 91-row table. Mirror the profile: an overview with the school
  chips, topic pills, Key differences, the radar, and six topic cards (two or three metrics as a bar per college,
  a comparative takeaway), then `/compare/{topic}?ids=` pages and `/compare/table` with a differences-only switch.
  Chosen over tabs, a re-chunked page, and side-by-side profiles by the scoring in the spec.
- [x] **Profile redesign** ([profile-redesign.md](profile-redesign.md)), built 2026-10-02 (PR #47): the profile was 22,000px on desktop and
  32,000px on a tablet (2026-10-02 review). Replace it with an overview of seven topic cards (headline figure,
  supporting numbers, ten-year line, takeaway) and a page per topic (`/schools/{id}/admissions` … `/history`);
  tablets fold like phones; Over time becomes a segmented control; "How it ranks" dissolves into the topics. Chosen
  over tabs, a re-chunked single page, and detail panels by the scoring in the spec. Pilot with Playwright height
  measurements at three widths.

## Later
Worked out, then set aside until another feature needs them; each spec says what it gets built with. Also the last
section on `/roadmap`.
- [ ] **Metro area** ([metro-area.md](data-expansion/metro-area.md)): each college's metro and county from the directory
  file, for a "nearby colleges" list, a metro filter, or metro-level national trends. Deferred from campus profile
  (2026-09-30).

## Product: accounts, planning tools, high schools, business
Specified 2026-10-02 in [product/](product/README.md) from three idea documents plus research; build order and
shared rules for user data are in that README. All user data lives only in Supabase (new migrations, dev first).
- [ ] **Telemetry** ([product/telemetry.md](product/telemetry.md)): PostHog (cookieless, no replay, typed event
  registry with a guard test) + Vercel Speed Insights; dashboards for traffic, engagement, funnels, retention,
  performance, errors. Build first so later features ship measured.
- [ ] **Accounts and households** ([product/accounts.md](product/accounts.md)): Supabase Auth (magic link, Google),
  server-side sessions, households (guardians and students, invitations), RLS privacy model where a guardian's
  finances are never readable by a student, export and delete, 13+ only.
- [ ] **Student profile** ([product/student-profile.md](product/student-profile.md)): GPA (unweighted, with scale
  conversion), scores, majors, state, preferences; prefilled ScoreChecker; Explore "fits my scores / preferences".
- [ ] **Saved lists** ([product/saved-lists.md](product/saved-lists.md)): Reach / Target / Likely, status and
  outcomes (Scoir vocabulary), notes, deadlines, guardian view, share link, CSV/PDF export.
- [ ] **Follow colleges** ([product/follow-colleges.md](product/follow-colleges.md)): Follow button, list items
  followed automatically; `publish-data` diffs the previous publish against the new one into a public
  `dataset_changes` table (new year / revised / appeared / disappeared, years from lineage, tolerances per field); a
  daily job emails one digest per user per publish (Resend, one-click unsubscribe, no tracking pixels);
  `/me/updates`, `/me/following`, and a public "What changed" panel on profiles. Added 2026-10-02; worth building
  as soon as accounts exist and the scheduled data refresh (above) is running.
- [ ] **Chances and fit** ([product/chances-and-fit.md](product/chances-and-fit.md)): rules-based standing with
  reasons (never a probability), fit against preferences, a pilot against real outcomes before the chip ships.
- [ ] **Net price estimator** ([product/net-price-estimator.md](product/net-price-estimator.md)): 2026–27 Student
  Aid Index and Pell as versioned reference data; per-college range from income-band net price, CDS need met, and
  H2A merit; 4-year projection from history; pilot of 20 colleges × 5 scenarios against their own calculators.
- [ ] **Award letter analyzer** ([product/award-letter-analyzer.md](product/award-letter-analyzer.md)): College
  Financing Plan layout, form first and upload later, loans separated, renewability flags, 4-year totals, questions
  to ask, appeal summary; pooled anonymized offers as a later decision.
- [ ] **Early decision strategy** ([product/early-decision-strategy.md](product/early-decision-strategy.md)): ED
  vs non-ED admit rates and share of class filled early from CDS C21/C22 (after
  [cds-admissions.md](data-expansion/cds-admissions.md)); a three-question checklist for signed-in students.
- [ ] **High school data** ([product/high-school-data.md](product/high-school-data.md)): NCES CCD + EDFacts + CRDC
  for all public high schools (phase 1), state report cards (phase 2), school profile PDFs through the
  college-reported engine (pilot of 100 schools, phase 3), private schools (phase 4); `/high-schools/{ncessch}`.
- [ ] **Scattergrams** ([product/scattergrams.md](product/scattergrams.md)): counselor CSV upload (Scoir/Naviance
  columns) scrubbed in the browser, binned, 10-point threshold; shown to that school's verified students over the
  national ranges; opt-in pooled self-reported outcomes.
- [ ] **Commercialization** ([product/commercialization.md](product/commercialization.md)): Free / Plus ($1.99 or
  $15.99/yr) / Pro ($49 pass); the feature map as one entitlement object; Stripe Checkout, Billing, webhooks;
  pricing page; legal setup; public data stays free.
- [ ] **Counselor portal** ([product/counselor-portal.md](product/counselor-portal.md)): organizations (IECs first,
  schools with a data agreement), caseload dashboard, co-branded PDF dossiers, scattergram uploads, seats.
- [ ] **Data API** ([product/data-api.md](product/data-api.md)): `/api/v1` with keys, limits, lineage and history
  endpoints, bulk downloads, `/developers` docs; free and paid tiers.

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
- [ ] **Generic document collections** ([database-architecture.md](database-architecture.md#generalize-the-document-tables-do-this-before-the-detail-file)):
  replace the per-table publish functions (`publish_dataset`, `stage_history`, `publish_history_staged`) with
  `published_documents` / `publishes` / `stage_documents()` / `publish_collection()`, migrating `schools` and
  `school_histories` in. Do it before the per-college detail file or the high school dataset adds a third copy.
- [ ] **Decide how production serves the public dataset** before the formal release: bundle the JSON into the build
  (every data change deploys anyway) or keep Supabase and read one gzipped object per collection
  ([database-architecture.md](database-architecture.md#serving-the-public-dataset-an-open-decision)). Measure
  cold-start counts with telemetry first.
- [ ] Supabase user data (accounts, saved lists; specified in [product/accounts.md](product/accounts.md) and
  [product/saved-lists.md](product/saved-lists.md)) goes in as new migrations. History stays in git as per-college JSON
  (reviewable diffs when NCES revises past years, CI checks, JSON previews) and is published 1:1 to
  `school_histories`; decided 2026-09-28 over build-and-publish-only.
