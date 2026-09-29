---
title: Re-running checks by hand
pr: 17
date: 2026-09-28
kind: infra
summary: The Verify checks can now be started by hand, after GitHub skipped them (and a deploy) for one merge.
---

## What changed

GitHub never sent the push event for the trend indicators merge, so neither the Verify checks nor the production
deploy ran for it.

- The Verify workflow can now also be started by hand from GitHub, for the next time that happens.
- Merging this change triggered a deploy, which put the trend indicators live.
