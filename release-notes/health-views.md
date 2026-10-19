---
title: "A closer watch on the data behind admission estimates"
pr: 167
date: 2026-10-19
kind: infra
summary: "Our data-health checks now track how current each fact behind a college's admission estimate is, where it came from, and when its source published it."
---

## What's new

- **Nothing changes on the pages you see.** This is an internal tool that helps us keep the figures behind each
  college's Reach, Target, or Likely estimate up to date.
- **Every fact traced to its source.** For each college we can now see where its admit rate, test scores, GPA, and
  admission factors came from, which year they describe, when the source published them, and when we collected
  them.
- **Older figures flagged first.** Colleges whose estimate leans on last year's numbers stand out, so we can go
  after their newest Common Data Set first.

## Behind the scenes

- The admin Health page has two views. **Estimate inputs** judges each college by the facts the estimate reads.
  **Files** lists every federal file we use with its publish date, the next expected release, and its health,
  followed by each college's own documents.
- `npm run source-files` records each federal file's date from the publisher's server. `npm run verify` now fails
  if a file is missing its date.
- Spec: `specs/product/admin-health-views.md`.
