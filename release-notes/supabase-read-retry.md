---
title: Site updates survive a data publish
pr: 81
date: 2026-10-05
kind: fix
summary: A site update that lands while new data is being published now waits a moment and tries again, instead of failing.
---

## What changed

When the National trends pages shipped, the site update stalled: it tried to read the colleges at the same moment new
data was being published, and the database asked it to wait. The update now waits and tries again, and the data
publish retries once on its own, so the two can land together.

## Behind the scenes

`fetchDatasetFiles` (lib/supabase.ts) retries reads that hit Postgres's statement timeout, up to about a minute, and
fails at once on any other error. The publish workflow re-runs `npm run publish-data` once after 60 seconds if it
fails.
