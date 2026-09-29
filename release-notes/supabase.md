---
title: Serving the data from a database
pr: 8
date: 2026-09-28
kind: infra
summary: The site can now read its dataset from Supabase, while the reviewed JSON files in git stay the source of truth.
---

## What changed

- **One switch, two sources.** `DATA_SOURCE=json|supabase` picks where the site loads its data: the JSON files in the
  repository (the default, used by automated checks) or a Supabase database.
- **A safe publish.** `npm run publish-data` runs the lineage check, refuses to drop more than 10% of published
  colleges, replaces everything in one transaction, then reads it all back and requires an exact match.
- **Locked down.** The public can read, and only the publishing key can write.

## Checks

Pages were built from both sources and compared across 17 URLs. They matched apart from build hashes, React's streaming
order, and the "today" marker on the Data timeline. Paging past the database's 1,000-row limit has its own test.

Design details: [supabase.md](../specs/supabase.md).
