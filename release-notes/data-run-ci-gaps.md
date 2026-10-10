---
title: "College-reported data runs stay in sync with directory listings"
pr: 0
date: 2026-10-10
kind: infra
summary: "Fixed two automatic-check gaps a growing college-reported dataset had exposed: a stale reporter-count tripwire, and data runs that skipped re-merging directory listings."
---

## What's new

Nothing changes on the site. Two automatic checks on college-reported data updates had fallen behind as the
dataset grew, and both are fixed.

## Behind the scenes

- `tests/cds-greek.test.mts` had a tripwire asserting fewer than `KNOWN_FOR_MIN_REPORTERS` (50) colleges report
  Greek life, meant to fail once that threshold was reached so a person would decide whether to build "Known for:
  Big Greek life" (specs/greek-life.md). It fired as designed: 102 colleges now report. Building the feature is
  the owner's decision ([specs/backlog.md](../specs/backlog.md)), so the tripwire is replaced with a test that
  keeps enforcing the actual guard — Greek fields never reach "Known for" — regardless of reporter count.
- `.github/workflows/college-reported.yml`'s `run` and `collect` jobs ran `npm run merge-reported` then
  `npm run build-trends`, but never `npm run merge-directories`, so a data run's committed `data/schools.json`
  could drift from a fresh merge of `data/directories/`, failing the "merge: idempotent" CI check. Both jobs now
  run `merge-reported` → `merge-directories` → `build-trends`.
