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
  - [ ] **Common App** ([data-expansion/common-app.md](data-expansion/common-app.md), planned 2026-10-06): deadlines
    and early rounds, fees and waivers, essay, supplement and recommendation requirements, and this cycle's test
    policy for about 1,000 member colleges from the Requirements Grid; aliases and an international-aid flag from the
    Explore pages; national and state application trends from the research reports. **First step is the permission
    letter**: the terms of use forbid scraping and commercial reuse, so nothing is built until Common App says yes.
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
- [ ] **Campus life rollout** ([campus-directories.md](campus-directories.md); religious, Greek, and LGBTQ+ life).
  Built: phase 1 (#72); national directories, state laws, organization logos, and the redesign (#73); the
  college-page pilot over 75 colleges in three scored rounds (#73, #75, #76; $0.16 a college by round 3). Open:
  - [ ] Accuracy fixes before a full run (nondiscrimination policies, LGBTQ+ centers, membership tables, faith
    offices, recall), a re-score, then one full run of about $300: [campus-pilot-accuracy.md](campus-pilot-accuracy.md).
    Full run needs the owner's go-ahead.
  - [ ] Sources we couldn't read — hand reading, directories that only render in a browser, and data partnerships to
    ask for — are collected in [campus-sources-later.md](campus-sources-later.md), one source at a time with what
    it would give and a candidate fix.
  - [ ] Unmatched directory entries in `data/directories/unmatched/` (Tri Delta's short names especially): review by hand
    into `matches.json`.
  - [ ] State laws (nine states built, Ohio, Tennessee, and North Carolina as general DEI bans): hand-read Indiana
    SEA 289; re-check after each legislative session and the Mississippi and New Hampshire injunctions.
- [ ] Build "Known for: Big Greek life": the threshold (50 reporters) was met 2026-10-10 with 102.
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
Built 2026-10-04 on `feature/national-trends`: the hub, Studies 1–6, movers, conferences, and states (`npm run
build-trends` writes `data/history/trends/`). What's left:
- [ ] `applicants_men`/`applicants_women` history series, so Study 1 can use the 200-per-sex rule and weight by
  applicants by sex (it uses a 1,000-total-applicant floor and total-applicant weighting today).
- [ ] Distance-education share (`EF{Y}A_DIST`) as `demographics.online_share`, replacing the reviewed
  `data/trends/online-first.json` list the movers use. Specified 2026-10-05:
  [online-share.md](data-expansion/online-share.md) (two fields, one history series, an Explore filter).
- [ ] **Study 7: Where the students went** ([trends/where-students-go.md](trends/where-students-go.md), specified
  2026-10-05): the students view, each kind of college's share of all undergraduates then and now, by size and
  selectivity as of the window start, research tier, public or private, region and state, and price, over a
  campus-based panel, with the pandemic as a question inside the ten years (before · pandemic · after periods and
  the pace of each shift). First look: 20,000+ campuses 30% → 34% of students, rising every year; R1s 40% → 46%; the
  colleges that cut prices most lost the most students; the pandemic sped every shift up and since 2022 they've
  slowed to their old pace, not reversed.
- [ ] **First-years crossing state lines** ([trends/states.md](trends/states.md), planned addition 2026-10-05): each
  state's inflow, outflow, and net of first-years from the residence tables, as a sixth measure on the states map and
  an in/out block on state pages, over campus-based colleges; build with Study 7, after the online-share field.
- [ ] Per-conference movers lists, and an Explore conference-filter chip linking to the conference page.
- [x] **Trends page and shared breakdowns:** `/trends` with a card per study, `/trends/{study}` pages, the standard
  breakdowns (region, type, size, selectivity) computed by `sync-history`, and a test that recomputes each study.
- [x] **Study 1: Men and women in admissions.** Share of colleges admitting men vs women at a notably higher rate, 2001 to
  now, and where the change is concentrated (first look: the Northeast and moderately selective colleges drive it; the
  West moved the other way).
- [x] **Studies 2–6** (specified 2026-10-03 in [trends/](trends/), each one registry entry, one build function, one
  page once the hub exists): [test-optional](trends/test-optional.md) (66% → 5% requiring tests; needs the Explore
  test-policy filter), [shrinking colleges](trends/shrinking-colleges.md) (half of colleges 10%+ smaller),
  [price gap](trends/price-gap.md) (who is discounting), [out-of-state students](trends/out-of-state.md) (publics),
  [Pell graduation gap](trends/pell-gap.md) (widened 9 → 11 points).
- [x] **Top-10 lists** ([trends/top-10-lists.md](trends/top-10-lists.md)): `/trends/movers`, ten lists with floors and
  reviewed exclusions (online-first, closed or merged); Explore `minApplicants`/`minUndergrads` params; later the
  distance-education share from `EF{Y}A_DIST` as `demographics.online_share`.
- [x] **By athletic conference** ([trends/conferences.md](trends/conferences.md)): index with the Power 4 side by side,
  a page per conference (members, medians over time under today's-members and members-at-the-time rules, realignment
  timeline). Slugs added to `lib/conferences.ts`.
- [x] **By state** ([trends/states.md](trends/states.md)): tile map colored by measure, a page per state (10-college
  floor, public/private split, origins, movers, public research universities). Metro pages later reuse the template.
- [ ] More ideas (HBCU applications, legacy and factors, majors by group, transfers, faculty, borrowing, an annual
  "year in college data") are listed in the hub; spec one before building it.

## Links, names, and looks
Specified 2026-10-03 in [school-identity/](school-identity/README.md); all four built 2026-10-04 (each spec's "As
built" has the numbers), with the monthly refresh workflow and older icon formats from
[follow-ups.md](school-identity/follow-ups.md). Left open: the Haiku visit picker's first run (~$1.50, 492 colleges;
on the roadmap under Later) and a permanent mark-removal address (chosen at the formal release).
- [x] **Official links** ([school-identity/links.md](school-identity/links.md)): website (already stored, unused),
  admissions, application, financial aid, veterans', disability services from `HD{Y}` columns the sync already
  downloads; the campus visit page found on each college's admissions page by a scored link probe (Haiku picker for
  the rest); a liveness check. Hero links row, compact-header Website link, Cost and Students placements.
- [x] **Social accounts** ([school-identity/social-accounts.md](school-identity/social-accounts.md)):
  `npm run sync-wikidata` (one SPARQL query by IPEDS id → `data/wikidata.json`: accounts, other names, article,
  logo file, 1,719 colleges); homepage footer scan fills ~350 more; icon row in the hero.
- [x] **Short names and nicknames** ([school-identity/aliases.md](school-identity/aliases.md)): `data/aliases.json`
  from IPEDS `IALIAS`, Wikidata other names, the homepage domain, and a curated file; one scorer for the typeahead and
  Explore's `q`; the matched alias shown in results; Supabase `school_aliases` table indexed by key.
- [x] **Colors and marks** ([school-identity/brand.md](school-identity/brand.md)): colors from Wikipedia's college
  color data (cited to brand guides) joined through each article's infobox, tints derived per theme at sync time;
  the college's site icon at 192 px in `public/brand/` in place of the monogram; opt-out file, `/data` trademark line,
  removal route. Decided 2026-10-03: show colors and icons, with the safeguards in the spec; colors ship first.

## Design and usability
- [x] **Compare redesign** ([compare-redesign.md](compare-redesign.md)), built 2026-10-05: the compare page was
  10,000px on desktop and 15,000px on a phone (2026-10-02 review), half of it the 91-row table. Mirrors the
  profile: an overview with the school chips, topic pills, Key differences, the radar, and six topic cards (two or
  three metrics as a bar per college, a comparative takeaway), then `/compare/{topic}?ids=` pages and
  `/compare/table` with a differences-only switch. Chosen over tabs, a re-chunked page, and side-by-side profiles
  by the scoring in the spec.
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
- [x] **Telemetry** (built 2026-10-07; dashboards and the PostHog projects are the owner's setup steps)
  ([product/telemetry.md](product/telemetry.md)): PostHog (cookieless, no replay, typed event registry with a guard
  test) + Vercel Speed Insights; `/privacy` page; dashboards for traffic, engagement, funnels, retention, performance,
  errors. Built first so later features ship measured.
- [x] **Accounts and households** (built 2026-10-05; Google sign-in waits for the new domain, under Platform) ([product/accounts.md](product/accounts.md)): Supabase Auth (magic link, Google),
  server-side sessions, households (guardians and students, invitations), RLS privacy model where a guardian's
  finances are never readable by a student, export and delete, 13+ only.
- [x] **Student profile** (built 2026-10-05) ([product/student-profile.md](product/student-profile.md)): GPA (unweighted, with scale
  conversion), scores, majors, state, preferences; prefilled ScoreChecker; Explore "fits my scores / preferences".
- [x] **Saved lists** (built 2026-10-05) ([product/saved-lists.md](product/saved-lists.md)): Reach / Target / Likely, status and
  outcomes (Scoir vocabulary), notes, deadlines, guardian view, share link, CSV/PDF export.
- [x] **Follow colleges** (built 2026-10-05; emails start with the new domain) ([product/follow-colleges.md](product/follow-colleges.md)): Follow button, list items
  followed automatically; `publish-data` diffs the previous publish against the new one into a public
  `dataset_changes` table (new year / revised / appeared / disappeared, years from lineage, tolerances per field); a
  daily job emails one digest per user per publish (Resend, one-click unsubscribe, no tracking pixels);
  `/me/updates`, `/me/following`, and a public "What changed" panel on profiles. Added 2026-10-02; worth building
  as soon as accounts exist and the scheduled data refresh (above) is running.
- [ ] **Household hub** (planned 2026-10-06 from the owner's review of the accounts build)
  ([product/household-hub.md](product/household-hub.md)): add a person by role (parent: name, email, phone;
  student: name, then optional email, phone, class year); invited people land on a password, not a sign-up; everyone
  by name (no email initials, no "?"); invitations in the roster with Copy link; `/household` as the hub with a page
  per person (list + numbers); one list per person, guardians included, with "updates" as a per-college switch
  replacing Follow, plus visited and social tracking. Owner decisions: the secret key in Vercel, storing pending
  tokens in clear, household-visible guardian lists.
- [ ] **The planner** (specified 2026-10-07 in [planner/](planner/README.md); the primary paid feature; the application
  plan of 2026-10-06 became its timeline stage). Build with the `build-roadmap-section` skill, one unit per spec:
  [model](planner/model.md) (tables, stage machine, the Plan tab, entitlement hooks), [list](planner/list-building.md)
  (suggested categories, a Dream, sorts), [early rounds](planner/early-rounds.md) (ED I / ED II / EA / REA proposal with
  advantage, conflicts, money), [actions](planner/actions.md) (one-click follows, information requests, visit log),
  [timeline](planner/timeline.md) (`data/application-cycle.json`, generators, month and college views, calendar feed,
  weekly email), [applications](planner/applications.md) (requirements, submitted/complete, deferrals, wait lists),
  [offers](planner/offers.md) (decisions, letter upload, offers side by side, the choice), and
  [parents](planner/parents.md) (summary line, nudges, Your part, weekly summary). Owner questions in the README: the
  paid line, texts, photos, the letters pilot, Common App screenshot import.
- [x] **The planner, redesigned** (built 2026-10-10 on feature/plan-redesign, [build plan](planner/redesign/build-plan.md); planned 2026-10-09 in [planner/redesign/](planner/redesign/README.md) from the
  owner's review of the build and student feedback; preview at `/plan/preview`). Six units:
  [standing](planner/redesign/standing.md) (numbers first, one test, groups sorted for the student),
  [page](planner/redesign/page.md) (Plan in the main navigation, `/plan`, three tabs, the child switcher),
  [list](planner/redesign/list.md) (one row per college, ranking removed), [rounds](planner/redesign/rounds.md)
  (started from the Dream, one-line conflicts, ED II offer, parent cost check), [scores](planner/redesign/scores.md)
  (where the score stands, retake only when it would move a college), and [calendar](planner/redesign/calendar.md)
  (the family timeline). Owner decisions (2026-10-10): every recommendation accepted, including the phone tab bar, signed-out Plan,
  and the retake threshold. Follow-ups: delete `/plan/preview` once approved; drop `list_items.priority` and
  `lists.rounds_plan_accepted_at` once no release reads them; the share image; the old family dossier print.
- [ ] **Chances and fit** ([product/chances-and-fit.md](product/chances-and-fit.md)): rules-based standing with
  reasons (never a probability), fit against preferences, a pilot against real outcomes before the chip ships.
- [ ] **Admission chances** (planned 2026-10-10 in [chances/](chances/README.md)). Quad's estimate is proprietary: these
  site shows inputs and outputs only; the method is in [chances/method/](chances/method/standing.md) until launch, then
  moves private. Seven units:
  [how colleges read a record](chances/how-colleges-read.md), [rigor in context](chances/rigor-in-context.md) (a course
  list with grades), [the admit rate for your pool](chances/base-rates.md), [major and grades](chances/major-and-grades.md),
  [the estimate](chances/estimate.md) (after PR #105), [outcomes and accuracy](chances/calibration.md), and the
  [course plan](chances/course-plan.md). Never a percentage.
- [x] **Cost by income** (built 2026-10-10; estimates gated until the pilot passes; [product/cost-by-income.md](product/cost-by-income.md)): each college's
  cost as a curve over family income to $400K+, published to $110K and calibrated above it from the $110K+ band;
  the break point where need-based aid ends; merit classes from CDS H2A or the IPEDS grants-without-federal-aid proxy;
  curated published promises (`data/aid-policies.json`); a 25-college pilot against net price calculators gates every
  estimate. Redesigns the Cost page, the overview card, Compare, and Explore.
- [ ] **Net price estimator** ([product/net-price-estimator.md](product/net-price-estimator.md)): 2026–27 Student
  Aid Index and Pell as versioned reference data; per-college range from income-band net price, CDS need met, and
  H2A merit; 4-year projection from history; pilot of 20 colleges × 5 scenarios against their own calculators.
- [ ] **Award letter analyzer**: moved 2026-10-07 into the planner as its decisions-and-offers stage
  ([planner/offers.md](planner/offers.md)): College Financing Plan layout, form first and upload with Pro, one upload
  for admission and aid letters, loans separated, renewability flags, 4-year totals, questions to ask, appeal summary,
  the choice and its tasks; pooled anonymized offers as a later decision.
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

## iPhone app
Specs in [iphone-app/](iphone-app/README.md) (2026-10-06): every feature and function of the site as a native iPhone app.
- [ ] **App API** ([iphone-app/api.md](iphone-app/api.md)): `/api/app/v1` screen documents built from the same `lib/`
  code as the pages, a citation on every value, a fixed block catalog, OpenAPI document for the Swift models, bearer-token
  user routes that reuse the Server Actions' logic once it moves into `lib/`.
- [ ] **The app** ([iphone-app/app.md](iphone-app/app.md)): native SwiftUI, server-described screens, Supabase Auth with
  Sign in with Apple, universal links for every site URL, offline document cache, the design tokens generated from
  `globals.css`, accessibility, telemetry, App Store release, test plan; phase 1 signed-out parity, phase 2 accounts.
- [ ] **Screens** ([iphone-app/screens.md](iphone-app/screens.md)): the parity map every phase is checked against, and a
  `check-app-parity` script so a new site route must be added to the map in the same PR.

## Ideas
Not planned work: directions from the 2026-10-03 competitive analysis (CollegeIQ, College Kickstart) and a survey of
guide-and-advisor sites in other verticals (travel, real estate, camps, cars, measured product reviews), each written
up in [ideas/](ideas/README.md) far enough to judge and shown in their own section of `/roadmap`. An accepted idea
moves into a section above.
- [ ] **Guides** ([ideas/guides.md](ideas/guides.md)): common questions answered as living lists, each a published
  query with its criteria shown, recomputed at every publish.
- [ ] **Cost to a degree** ([ideas/cost-to-a-degree.md](ideas/cost-to-a-degree.md)): the four-year plan beside the
  typical time to finish and the debt of those who leave.
- [ ] **Near and far** ([ideas/near-and-far.md](ideas/near-and-far.md)): an Explore map view, distance and drive time
  from a home ZIP, visit trips from the list, and the cost of getting home in the projection. *Built 2026-10-05:* the
  home address, Explore's distance filter, and distance on lists ([product/home-and-distance.md](product/home-and-distance.md));
  the map, airports, trips, and travel cost remain.
- [ ] **Worst plausible spring** ([ideas/worst-plausible-spring.md](ideas/worst-plausible-spring.md)): a stress test
  of the saved list under three scenarios, with gaps as facts, instead of a grade.
- [ ] **Colleges that would compete for you** ([ideas/would-compete-for-you.md](ideas/would-compete-for-you.md)):
  above the range, merit without need routine, demand softened, with the reasons.
- [ ] **Cycle watch** ([ideas/cycle-watch.md](ideas/cycle-watch.md)): what changed for the coming cycle at every
  college, from the agent's editions, plus an opt-in brief for counselors.
- [ ] **Getting into the major** ([ideas/getting-into-the-major.md](ideas/getting-into-the-major.md)): admission
  unit, direct admission, secondary admission, and change-of-major rules, read by the agent with quotes.
- [ ] Smaller additions proposed for existing specs (standing with its direction, the list as a calendar feed, follow
  a search, the household timeline, "check this number", a price after merit, a home ZIP, what the money never buys,
  counselor-invited students free) are listed in the ideas README, unapplied.

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
  prod, review before data merges, rollback). Optionally a custom domain. Choose the permanent address colleges use to
  ask for their mark to come down (`BRAND_REMOVAL_CONTACT` in `lib/brand.ts`, a GitHub issue link until then;
  [brand.md](school-identity/brand.md)).
- [ ] **New domain, then Google sign-in and email** (owner registering a domain, 2026-10-05): once it's live, point
  Vercel at it, update Supabase Auth's Site URL and redirect URLs, add **Google sign-in** (Google Cloud OAuth client
  with the new domain as authorized origin, Supabase Google provider, a second button on `/login`), and verify a
  sending subdomain in Resend (SPF/DKIM/DMARC) so magic links, invitations, and update digests leave Supabase's
  rate-limited built-in mailer (`RESEND_API_KEY`, `EMAIL_FROM`; [accounts.md](product/accounts.md),
  [follow-colleges.md](product/follow-colleges.md)). Accounts were built without either on purpose.
- [ ] **Address suggestions as you type** (built 2026-10-05, dormant until the key exists;
  [home-and-distance.md](product/home-and-distance.md#autocomplete-2026-10-05)): in Google Cloud, a project with a
  billing account, **Places API (New)** enabled, and an API key restricted to it; set `GOOGLE_MAPS_API_KEY` in
  Vercel (all environments) and `.env.local`. The household's home field then suggests U.S. addresses as you type,
  with the required Google logo; free up to 10,000 requests a month. Until then the field is plain and says nothing
  about suggestions.
- [ ] **Generic document collections** ([database-architecture.md](database-architecture.md#generalize-the-document-tables-do-this-before-the-detail-file)):
  replace the per-table publish functions (`publish_dataset`, `stage_history`, `publish_history_staged`) with
  `published_documents` / `publishes` / `stage_documents()` / `publish_collection()`, migrating `schools` and
  `school_histories` in. Do it before the per-college detail file or the high school dataset adds a third copy.
- [ ] **Serving architecture** (decided 2026-10-07 in [serving-architecture.md](serving-architecture.md), after the
  owner's review of failed deploys, database outages, and slow search): production reads the dataset from the files
  it deploys with (`DATA_SOURCE=json`), the dataset publish becomes a small change-log action after each deploy, search
  moves into the browser over a build-time index, Explore's render gets its facets memoized, the dataset tables are
  retired a cycle later, and Supabase moves to Pro with a prod project now. Owner steps and open questions in the spec.
  This closes the item below.
- [ ] ~~**Decide how production serves the public dataset**~~ before the formal release: bundle the JSON into the build
  (every data change deploys anyway) or keep Supabase and read one gzipped object per collection
  ([database-architecture.md](database-architecture.md#serving-the-public-dataset-an-open-decision)). Measure
  cold-start counts with telemetry first.
- [ ] Supabase user data (accounts, saved lists; specified in [product/accounts.md](product/accounts.md) and
  [product/saved-lists.md](product/saved-lists.md)) goes in as new migrations. History stays in git as per-college JSON
  (reviewable diffs when NCES revises past years, CI checks, JSON previews) and is published 1:1 to
  `school_histories`; decided 2026-09-28 over build-and-publish-only.
