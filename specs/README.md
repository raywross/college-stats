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
| [college-reported-data.md](college-reported-data.md) | *Planned:* ingestion agent for newer college-published figures (CDS, class profiles) |
| [college-reported-setup.md](college-reported-setup.md) | Repo-owner setup for the college-reported workflow: API key, GitHub secrets, auto-merge, branch protection, running locally, the first pilot, resolving review-queue items |
| [data-page.md](data-page.md) | `/data` tab: data vintages and timeline, release calendar (auto-marked published by the sync), baseline rule, sources, methods |
| [data-sync.md](data-sync.md) | Building `data/schools.json` from College Scorecard + IPEDS; API key setup; overrides |
| [trends-data.md](trends-data.md) | Year-by-year history (`npm run sync-history`): how far back each series goes, per-era file mapping, storage, checks. Built (phases 1–3) |
| [trend-indicators.md](trend-indicators.md) | Four 10-year directions (cost, applications, diversity, selectivity) on the profile hero, Explore filters/cards/table, and Compare. Built |
| [trends-design.md](trends-design.md) | How trends appear, from Home facts to the profile's "Over time" charts, Explore, and Compare. Built (phases 1–3) |
| [religious-life.md](religious-life.md) | *Planned:* religious affiliation, faith intensity, faith communities on campus; source tiers and per-school crawl |
| [greek-life.md](greek-life.md) | *Planned:* fraternity/sorority participation, councils, housing, recruitment; CDS F1 and FSL office reports |
| [lgbtq-life.md](lgbtq-life.md) | *Planned:* LGBTQ+ centers and groups, inclusive policies, conduct rules, state laws, IPEDS "another gender" counts; rules for sensitive facts |
| [national-trends.md](national-trends.md) | *Planned:* national trend studies (not one college): the shared method, breakdowns by region, type, size, and selectivity, a `/trends` page; Study 1: men and women in admissions |
| [data-expansion/](data-expansion/README.md) | *Planned:* public data not yet on the site, one spec per source (admission factors incl. GPA, housing, setting, residence, student-faculty ratio, 8-year outcomes, Pell graduation, finances, faculty, majors, earnings by major, and CDS GPA/class sizes/transfer/next-year price after the college-reported agent); each decides history and top-level trends |
| [product/](product/README.md) | *Planned:* accounts and households (parent-only finances), student profile, saved lists, following colleges with update emails; planning tools (standing, net price estimator, award letters, early decision); high school data and scattergrams; telemetry, paid tiers, counselor portal, data API. Input idea documents in `product/ideas/` |
| [backlog.md](backlog.md) | Planned work (CDS PDF import, scheduled sync, tests) |
| [roadmap.md](roadmap.md) | `/roadmap`: the planned specs with complexity ratings, each readable at `/roadmap/{slug}`; registry in `lib/roadmap.ts` must list every planned spec |
| [release-notes.md](release-notes.md) | `/release-notes`: one note per merged PR in `release-notes/`, how to write one, and the CI check that every PR adds its note |
| [migration-plan.md](migration-plan.md) | Checklist for Vercel + Supabase + API migration |
| [supabase.md](supabase.md) | Serving the dataset from Supabase: `DATA_SOURCE`, schema, `publish-data`, keys, dev/prod projects, transition plan |
| [database-architecture.md](database-architecture.md) | *Guide:* published JSON-document collections vs typed application tables; when the in-memory pattern stops fitting; the generic publish shape; rules for user-data tables; the open decision on serving the dataset from the build or Supabase |
| [implementation-checklist.md](implementation-checklist.md) | Original MVP build order |
