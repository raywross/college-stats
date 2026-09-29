---
title: Publishing to production, and pages that refresh on publish
pr: 9
date: 2026-09-28
kind: infra
summary: Merged data publishes to production automatically, and the site regenerates its pages as soon as new data lands.
---

## What changed

- **Publish on merge.** A GitHub workflow publishes to the production database when a merge to `main` changes the
  data, and refreshes pages again after each production deploy. It skips cleanly until the production secrets are set.
- **Pages refresh on publish.** A protected `/api/revalidate` endpoint regenerates the site's static pages after a
  verified publish.
- **No stale copies.** Each server instance checks whether newer data was published before answering, so it can't
  serve or bake in an old copy. If the database is unreachable, the copy in memory keeps serving.

New tests cover a reload after a publish, a publish landing mid-read, an unreachable database, and the endpoint's
access check.
