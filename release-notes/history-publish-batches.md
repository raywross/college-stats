---
title: Publishing history in batches
pr: 15
date: 2026-09-28
kind: infra
summary: The larger history data now publishes in batches, after a single publish timed out on the database.
---

## What changed

After the second trends release, the history data grew to about 13 MB, and publishing it in one call hit the
database's time limit. That publish rolled back cleanly, so the site kept the earlier history, but the new history
couldn't go out.

History now uploads in batches of 150 colleges to a staging table. A final step checks that every college arrived,
then swaps them all in at once, so visitors never see half a publish.

All 1,893 histories were published this way, then read back and verified.
