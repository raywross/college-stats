# Specs Directory

Structured documentation for the Higher Education Data Explorer ("Quad").

## Files

| File | Description |
|---|---|
| [architecture.md](architecture.md) | Tech stack, project structure, key decisions |
| [design-system.md](design-system.md) | Brand, type, color tokens, palettes, motion, responsive rules |
| [design-research.md](design-research.md) | Comparable-site research and which patterns we adopted |
| [mobile.md](mobile.md) | Phone layout: bottom tab bar, swipe rails, result rows, no-sideways-scroll rules and their guards |
| [charts.md](charts.md) | Chart component catalog, dataviz rules, palette validation |
| [glossary-and-tooltips.md](glossary-and-tooltips.md) | Term definitions, InfoTip/Term components, glossary page |
| [home.md](home.md) | Home page sections |
| [search-and-filtering.md](search-and-filtering.md) | Explore page: filters, URL params, views |
| [school-profile.md](school-profile.md) | School profile as built: the overview, the six topic pages and what each shows, shared code, insight helpers |
| [profile-redesign.md](profile-redesign.md) | *Built 2026-10-02:* why the profile became a short overview of topic cards plus a page per topic: the review, comparable sites, four scored proposals, the chosen design per device, and what differed when built |
| [comparison.md](comparison.md) | Compare flow, tray, key differences, radar |
| [compare-redesign.md](compare-redesign.md) | *Planned:* the compare page as an overview of topic cards plus a page per topic, mirroring the profile; the 2026-10-02 review, four scored proposals, before/after mockups |
| [data-layer.md](data-layer.md) | Types, data access, derived metrics |
| [cost-outcomes.md](cost-outcomes.md) | Net price, earnings, graduation, debt: data, metrics, and where they appear |
| [sources-and-citations.md](sources-and-citations.md) | How every number is attributed; Common Data Set importer |
| [data-lineage.md](data-lineage.md) | Per-value source/year tracking: field registry, lineage records, citation popovers and chips, guards (`npm run verify`) |
| [college-reported-data.md](college-reported-data.md) | Ingestion agent for newer college-published figures (CDS, class profiles): built 2026-10-02, phase 1 admissions |
| [college-reported-round-2.md](college-reported-round-2.md) | Round 2 (2026-10-03): what the 50-college pilot showed, the newest-figure-first display rule, links-only discovery, escalation without Opus, a dollar cap per run, and the data PR carrying `schools.json` |
| [college-reported-round-3.md](college-reported-round-3.md) | *Planned (2026-10-03):* read every document once: a permanent archive with versioned extraction, every CDS section read in one visit (Excel and PDF sections by code first, Haiku in batches for the rest), a discovery ladder that tries free probes before any model, per-tier budgets, and the measured pilot to run before the full 1,893-college run |
| [college-reported-setup.md](college-reported-setup.md) | Repo-owner setup for the college-reported workflow: API key, GitHub secrets, auto-merge, branch protection, running locally, the first pilot, resolving review-queue items |
| [data-page.md](data-page.md) | `/data` tab: data vintages and timeline, release calendar (auto-marked published by the sync), baseline rule, sources, methods |
| [data-sync.md](data-sync.md) | Building `data/schools.json` from College Scorecard + IPEDS; API key setup; overrides |
| [trends-data.md](trends-data.md) | Year-by-year history (`npm run sync-history`): how far back each series goes, per-era file mapping, storage, checks. Built (phases 1–3) |
| [trend-indicators.md](trend-indicators.md) | Four 10-year directions (cost, applications, diversity, selectivity) on the profile hero, Explore filters/cards/table, and Compare. Built |
| [trends-design.md](trends-design.md) | How trends appear, from Home facts to the profile's "Over time" charts, Explore, and Compare. Built (phases 1–3) |
| [religious-life.md](religious-life.md) | *Planned:* religious affiliation, faith intensity, faith communities on campus; source tiers and per-school crawl |
| [greek-life.md](greek-life.md) | *Planned:* fraternity/sorority participation, councils, housing, recruitment; CDS F1 and FSL office reports |
| [campus-directories.md](campus-directories.md) | National directories of campus chapters and groups: adapter contract, polite crawler, matcher, merge, credited display (shared by the three campus-life specs) |
| [lgbtq-life.md](lgbtq-life.md) | *Phase 1 built:* IPEDS "another gender" counts and the Texas SB 17 line. *Planned:* LGBTQ+ centers and groups, inclusive policies, conduct rules, other states' laws; rules for sensitive facts |
| [national-trends.md](national-trends.md) | *Planned:* hub for national trend studies (not one college): the shared method, standard and additional breakdowns, the `/trends` page, shared computation and tests; Study 1: men and women in admissions; the list of further ideas |
| [trends/](trends/) | *Planned:* the rest of the trends family (2026-10-03): Studies 2–6 ([test-optional](trends/test-optional.md), [shrinking colleges](trends/shrinking-colleges.md), [price gap](trends/price-gap.md), [out-of-state students](trends/out-of-state.md), [Pell graduation gap](trends/pell-gap.md)), [top-10 lists](trends/top-10-lists.md), and pages by [athletic conference](trends/conferences.md) and by [state](trends/states.md), each with first-look numbers |
| [data-expansion/](data-expansion/README.md) | Public data by source: waves 1–3 built (admission factors, housing, setting, residence, student-faculty ratio, 8-year outcomes, Pell graduation, finances, faculty, majors, earnings by major); *wave 4 planned 2026-10-03* from the CDS records of round 3: admissions profile (GPA, factors, early rounds), admissions by residency, test scores and the coming cycle's policy, application logistics, financial aid (CSS Profile, international aid, need vs merit), enrollment and outcomes a year newer, class sizes and programs, transfer, next-year price and debt; each decides history and top-level trends |
| [product/](product/README.md) | *Planned:* accounts and households (parent-only finances), student profile, saved lists, following colleges with update emails; planning tools (standing, net price estimator, award letters, early decision); high school data and scattergrams; telemetry, paid tiers, counselor portal, data API. Input idea documents in `product/ideas/` |
| [school-identity/](school-identity/README.md) | *Planned (2026-10-03):* links to each college's [website, admissions, application, aid, and visit pages](school-identity/links.md); its [social accounts](school-identity/social-accounts.md) from Wikidata; a table of [short names and nicknames](school-identity/aliases.md) so search finds "UGA"; and its own [colors and mark](school-identity/brand.md) on the profile, with the legal summary for the owner's decision |
| [ideas/](ideas/README.md) | *Ideas (2026-10-03), not planned:* fresh directions from the competitive analysis (CollegeIQ, College Kickstart) and guide-and-advisor sites in other verticals: [guides](ideas/guides.md) as living lists, [cost to a degree](ideas/cost-to-a-degree.md), [the map and distance from home](ideas/near-and-far.md), [a stress test for the list](ideas/worst-plausible-spring.md), [colleges that would compete for you](ideas/would-compete-for-you.md), [cycle watch](ideas/cycle-watch.md), and [getting into the major](ideas/getting-into-the-major.md); plus smaller additions proposed for existing specs and what was considered and not added |
| [backlog.md](backlog.md) | Planned work (CDS PDF import, scheduled sync, tests) |
| [roadmap.md](roadmap.md) | `/roadmap`: the planned specs with complexity ratings and, in its own section, the ideas, each readable at `/roadmap/{slug}`; registry in `lib/roadmap.ts` must list every planned spec and idea |
| [release-notes.md](release-notes.md) | `/release-notes`: one note per merged PR in `release-notes/`, how to write one, and the CI check that every PR adds its note |
| [migration-plan.md](migration-plan.md) | Checklist for Vercel + Supabase + API migration |
| [supabase.md](supabase.md) | Serving the dataset from Supabase: `DATA_SOURCE`, schema, `publish-data`, keys, dev/prod projects, transition plan |
| [database-architecture.md](database-architecture.md) | *Guide:* published JSON-document collections vs typed application tables; when the in-memory pattern stops fitting; the generic publish shape; rules for user-data tables; the open decision on serving the dataset from the build or Supabase |
| [implementation-checklist.md](implementation-checklist.md) | Original MVP build order |
