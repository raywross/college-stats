---
title: The data pipeline now keeps its documents in the permanent archive
pr: 218
date: 2026-11-08
kind: infra
summary: The college-reported workflow passes the archive repository and its token to the run and collect jobs, so fetched documents go to the private archive instead of a cache that expires after a week.
---

## Why

Round 3 of the college-reported pipeline keeps every fetched document forever in a private GitHub repository, so no
college's site is visited twice for the same file. The repository and the `COLLEGE_DOCS_REPO` variable were set up
on 2026-11-03, but a one-college test run on 2026-11-08 showed the pipeline never read the variable: documents were
still landing only in the Actions cache, which is evicted after seven days unused. Only the Data Steward's workflow
reached the archive.

## What changed

- The pipeline step and the collect job in `college-reported.yml` now receive `COLLEGE_DOCS_REPO` and
  `COLLEGE_REPORTED_TOKEN`, as section 9 of the setup spec has asked since round 3.
- Nothing else changes. With the variable unset the pipeline behaves as before. With it set and a token that cannot
  reach the repository, the run stops at once rather than archiving to a cache that will be lost.
