---
title: "Plan: a history of every college's selectivity rating"
pr: 147
date: 2026-10-13
kind: plans
summary: A plan to record each change to a college's selectivity rating, for applicants overall, in state, and out of state, so our team can see who moved and why.
---

## What's new

- **Nothing changes on the site yet.** This is a plan. When a college publishes new figures, its Quad's selectivity
  rating can move. UT Austin's fall 2025 report, for example, made it Ultra selective for out-of-state applicants.
  Today nothing keeps a record of moves like that.
- **What the plan adds.** Each time the site updates, we'll record which colleges changed rating and the figures
  behind each change, separately for applicants overall, in state, and out of state. Only our team will see this
  record, in our admin tools.

## Behind the scenes

- `specs/chances/selectivity-history.md`: admin-only Supabase tables `selectivity_publishes` and
  `selectivity_history`, written after each production deploy and kept out of `dataset_changes`. A row is written on a
  tier change, a new pool, or a score move of at least 0.25 since the last recorded row.
- Plans a `SELECTIVITY_METHOD` version so method changes read as such, and a one-time backfill from git.
- Defines the admin console's history panel, a `/admin/selectivity` movers page, and the reader in
  `lib/admin/selectivity-history.ts`.
- Plans `build-selectivity` in the college-reported workflow, which data PR #145 needed.
