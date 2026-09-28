# Specs Directory

Structured documentation for the Higher Education Data Explorer ("Quad").

## Files

| File | Description |
|---|---|
| [architecture.md](architecture.md) | Tech stack, project structure, key decisions |
| [design-system.md](design-system.md) | Brand, type, color tokens, palettes, motion, responsive rules |
| [design-research.md](design-research.md) | Comparable-site research and which patterns we adopted |
| [charts.md](charts.md) | Chart component catalog, dataviz rules, palette validation |
| [glossary-and-tooltips.md](glossary-and-tooltips.md) | Term definitions, InfoTip/Term components, glossary page |
| [home.md](home.md) | Home page sections |
| [search-and-filtering.md](search-and-filtering.md) | Explore page: filters, URL params, views |
| [school-profile.md](school-profile.md) | School profile sections and insight helpers |
| [comparison.md](comparison.md) | Compare flow, tray, key differences, radar |
| [data-layer.md](data-layer.md) | Types, data access, derived metrics |
| [cost-outcomes.md](cost-outcomes.md) | Net price, earnings, graduation, debt: data, metrics, and where they appear |
| [sources-and-citations.md](sources-and-citations.md) | How every number is attributed; Common Data Set importer |
| [data-lineage.md](data-lineage.md) | Per-value source/year tracking: field registry, lineage records, citation popovers and chips, guards (`npm run verify`) |
| [college-reported-data.md](college-reported-data.md) | *Planned:* ingestion agent for newer college-published figures (CDS, class profiles) |
| [data-page.md](data-page.md) | `/data` tab: data vintages and timeline, release calendar (auto-marked published by the sync), baseline rule, sources, methods |
| [data-sync.md](data-sync.md) | Building `data/schools.json` from College Scorecard + IPEDS; API key setup; overrides |
| [trends-data.md](trends-data.md) | Year-by-year history (`npm run sync-history`): how far back each series goes, per-era file mapping, storage, checks. Phase 1 built |
| [trends-design.md](trends-design.md) | How trends appear, from Home facts to the profile's "Over time" charts. Phase 1 built |
| [backlog.md](backlog.md) | Planned work (CDS PDF import, scheduled sync, tests) |
| [migration-plan.md](migration-plan.md) | Checklist for Vercel + Supabase + API migration |
| [supabase.md](supabase.md) | Serving the dataset from Supabase: `DATA_SOURCE`, schema, `publish-data`, keys, dev/prod projects, transition plan |
| [implementation-checklist.md](implementation-checklist.md) | Original MVP build order |
