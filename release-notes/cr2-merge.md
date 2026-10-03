---
title: "College-reported data now ships with its own PR"
pr: 53
date: 2026-10-03
kind: infra
summary: A college-reported run's pull request now carries the updated dataset itself, so its preview shows the new figures right away.
---

## What's new

Nothing changes on the site itself yet — no college has published figures through the automated pipeline. This is
what makes the *next* run's figures show up faster: when the college-reported agent ([college-reported-data.md](../specs/college-reported-data.md))
finds a newer admit rate or class size on a college's own site, its pull request now carries the updated
`data/schools.json` alongside its own files. The PR's preview shows the new figures right away, and merging it
publishes them with no extra step.

The pull request also now separates colleges whose site blocked the automated fetch from colleges whose figures
failed one of the automated checks, and lists exactly which colleges published this run with their term, source,
and numbers.

## Behind the scenes

- `npm run merge-reported` strips every school's `reported` block and `reported.*` lineage, then re-applies the
  current `data/college-reported.json` entries — the same merge `npm run sync-data` does, now shared through one
  function (`lib/reported-merge.ts`) so the two can't drift apart. It refuses to write if the result fails the
  lineage guard.
- The workflow runs it right after the ingestion pipeline, before opening the pull request, so `data/schools.json`
  rides along with the rest of the run's files.
- `npm run report-college-reported` prints a readable snapshot of what's published and whether the merge has run.
- See [specs/college-reported-round-2.md](../specs/college-reported-round-2.md) (Decision 5) for the full design.
