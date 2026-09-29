---
title: Clearer errors when a data publish fails
pr: 30
date: 2026-09-29
kind: infra
summary: A failed data publish now reports the real error, rather than always blaming a missing database migration.
---

## What changed

A data publish failed with an empty error and a hint to apply a database migration. The migration was already there.
The likely cause was two publishes running at the same time.

- The migration hint now appears only when a table is actually missing.
- Any other failure shows its message, code, and details. An empty error says "no error message (a dropped connection,
  or another publish running?)".

Merging this also deployed the two releases before it. GitHub had dropped the push events for both merges, so neither
had deployed.
