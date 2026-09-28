# Backlog

Planned work, roughly in priority order. Move items into a feature spec when they're picked up.

## Data
- [ ] **Read Common Data Set PDFs.** Most well-known colleges (Stanford, Harvard, Yale, Duke, Michigan, UCLA, and
  others) publish their CDS only as PDF, so `npm run import-cds` can't use them. Plan: extract the text layer
  (e.g. `pdftotext -layout`), find sections B1/B2, C1, C9, and H2/H2A by their standard headings, and parse the
  fixed tables into the same patch format the Excel importer writes (reuse the label matching and the C1
  cross-checks). Flag low-confidence parses for manual review rather than writing them silently; scanned PDFs
  without a text layer are out of scope.
- [ ] **Scheduled data refresh** (`chore/scheduled-data-sync`): monthly GitHub Action runs `npm run sync-data` and
  opens a PR with the diff; the API key goes in repository secrets.
- [ ] Re-run CDS imports when colleges publish new editions (keep a list of source URLs per college).
- [ ] Off-campus / commuter cost variant for the all-student average (IPEDS has off-campus room & board), for
  colleges where most students live at home.

## Quality
- [ ] Tests for the sync mapping (`toSchool`, `toAid`, `addPrices`), the CDS importer (fixtures for classic and
  flat layouts, including the Purdue typo case), and missing-data handling in `lib/metrics.ts`.

## Platform
- [ ] Deploy to Vercel (see [migration-plan.md](migration-plan.md)).
- [ ] Supabase only when needed (accounts, saved lists, multi-year history).
