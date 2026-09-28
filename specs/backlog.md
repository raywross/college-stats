# Backlog

Planned work, roughly in priority order. Move items into a feature spec when they're picked up.

## Data
- [ ] **Trends over time.** Year-by-year history per college (cost and aid from 2008–09, admissions from fall 2001)
  with a separate `npm run sync-history`. Data plan: [trends-data.md](trends-data.md); UI plan:
  [trends-design.md](trends-design.md). Built in three phases (cost + admissions first).
- [x] **Per-value data lineage** ([data-lineage.md](data-lineage.md)): built 2026-09-28. Leftovers: Explore/Compare
  baseline banner and `school.reported` (with the agent below).
- [ ] **Data tab** ([data-page.md](data-page.md)): `/data` replaces `/sources`; vintages, release calendar, baseline rule.
  Quick win in the same change: show 2024–25 sticker prices from `COST1_2024` (`…AY3`).
- [ ] **College-reported data agent** ([college-reported-data.md](college-reported-data.md)): newer admissions figures
  from colleges' CDS and class profiles, auto-published when checks pass. Pilot on ~50 colleges first. Replaces the
  former "Read CDS PDFs" and "Expand CDS coverage" items (the existing 8 CDS overrides stay until the agent covers them).
- [ ] **Watch ACTS** (IPEDS admissions supplement): adopt if NCES publishes institution-level files. See
  [data-page.md](data-page.md#watching-acts).
- [ ] **Scheduled data refresh** (`chore/scheduled-data-sync`): monthly GitHub Action runs `npm run sync-data` and
  opens a PR with the diff; the API key goes in repository secrets. Also updates `data/release-calendar.json` statuses.
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
