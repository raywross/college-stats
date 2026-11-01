---
title: "Past visit events archived"
pr: 202
date: 2026-10-31
kind: infra
summary: Visit events that have already happened or were taken off a college's calendar are archived in the repository and removed from the live table, so the database stays within its plan.
---

## What's new

Nothing on the site: the visit calendars still show every upcoming event. Events that have already happened, or
that a college removed from its calendar, are no longer kept in the live table.

## Behind the scenes

- `archive/visit-events/` holds the archived rows (150,521 of 405,778; one JSON row per line, gzipped, every column)
  and a script that restores them into a database, skipping rows already present.
- The same rows were deleted from the development project's `visit_events` table and the table compacted, freeing most
  of the 385 MB it had grown to. The daily sync keeps every upcoming event it has seen; pruning the same way on a
  schedule is a follow-up for the visit-events feature.
