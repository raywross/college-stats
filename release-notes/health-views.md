---
title: "Selectivity cites the year it read, and a closer watch on estimate data"
pr: 167
date: 2026-10-19
kind: improvement
summary: "Quad's selectivity now names the figures it was rated on, and our data-health checks track how current each fact behind a college's admission estimate is."
---

## What's new

- **Selectivity names the figures it read.** Where a college's selectivity is rated on its own newer numbers, the
  source note now says so, for example "Fall 2025, the college's own figures" instead of a federal survey from a year
  earlier. This corrects the note at 143 colleges.
- **A closer watch on the data behind each estimate.** For each college we can now see where every fact behind its
  Reach, Target, or Likely estimate came from, which year it describes, and when it was published. Colleges whose
  estimate leans on last year's numbers stand out, so we can go after their newest Common Data Set first.
- **Open-admission colleges are recorded.** We now know from federal data which colleges admit everyone who applies.
  That lets us find colleges whose admit rate is missing for some other reason.

## Behind the scenes

- The admin Health page has two views. **Estimate inputs** judges each college by the facts the estimate reads.
  **Files** lists every federal file we use with its publish date, the next expected release, and its health,
  followed by each college's own documents.
- `admissions.open_admission` comes from the newest IPEDS Institutional Characteristics file that answers it (IC2024
  for now, since IC2025 leaves it blank until NCES revises it).
- A derived field can name the input that cites it (`primary` in `lib/fields.ts`). Selectivity names the admit rate
  it read.
- `npm run source-files` records each federal file's date from the publisher's server. `npm run verify` now fails
  if a file is missing its date.
- Spec: `specs/product/admin-health-views.md`.
