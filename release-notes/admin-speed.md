---
title: A plan to make the admin console fast
pr: 242
date: 2026-11-10
kind: plans
summary: A review of why every page of the admin console is slow, measured against the live database, and a plan in three waves, from a one-line index to storing the review queue as a table.
---

## What's new

Nothing changes on the site yet. This is the review behind the next build: the owner found the redesigned console
good to use but slow on every page, and slowest on the Inbox.

## Behind the scenes

The review (`specs/product/admin-speed.md`) timed each console read against the live project and found five causes:

- The review queue, 21,977 open items and 11 MB, is read whole in 22 sequential pages (2.6 s) whenever an instance's
  cache is cold, and the Inbox starts that read twice in one request. The check that decides whether the cache is
  still good scans the whole table, because the document table has no index on `(collection, updated_at)`.
- Every page reads a 446 KB snapshot row to show one badge.
- The college, person, and student pages read in six to eight dependent waves.
- The Inbox waits on 13 GitHub calls before its first byte, and nothing on it streams.
- The database is the smallest Supabase offers and is busy with the visit-events sync, whose single-row writes take
  two thirds of a second each on average.

The plan: a first wave of cheap fixes (the index, the snapshot's columns, one queue read per request, shared reads
between the badge and the Inbox, streaming panels, GitHub off the response path, waves collapsed); a second wave that
moves the review queue into a table of its own with a status column and indexes, with the Steward writing the
Findings clusters as one small document; and a third wave for the platform: a compute add-on, batched sync writes,
version retention, and timing lines for the admin routes. The owner's decisions are listed at the end of the spec.
