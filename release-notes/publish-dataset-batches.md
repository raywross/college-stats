---
title: "Wave 2 data goes live: the dataset publishes in batches"
pr: 43
date: 2026-10-02
kind: fix
summary: The data publish after wave 2 timed out because the dataset outgrew a single upload. It now uploads in batches, and the publish's database checks really stop it when a migration is missing.
---

## What's fixed

- **Wave 2's numbers reach the live site.** After wave 2 (#41) the dataset grew from 8.4 MB to 11.3 MB, and the
  single upload that replaces it timed out. The site kept serving the previous data. Colleges now upload 150 at a
  time and are swapped in all at once, so visitors never see half an update.

## Behind the scenes

- New migration `school_staging`, the same pattern history and detail files already use.
- The publish checks that a database migration has been applied before writing anything, but that check always passed:
  the database answers the kind of request it used with "no content" even when a table doesn't exist. It now asks
  for one row, which fails properly. A test keeps it that way.
