---
title: Deployment fixes for the pre-release site
pr: 11
date: 2026-09-28
kind: infra
summary: Preview builds stop failing on an empty setting, Node is pinned to match CI, and the pre-release site is documented.
---

## What changed

- **Fixed failing preview builds.** An empty `DATA_SOURCE` setting (a dashboard variable created without a value)
  now falls back to the JSON files instead of failing the build.
- **Node 24 everywhere**, so Vercel builds with the same version as the automated checks.
- **Documented the pre-release site.** The public preview at college-stats-nine.vercel.app reads the development
  database; setting up a separate production database is left for the formal release.
