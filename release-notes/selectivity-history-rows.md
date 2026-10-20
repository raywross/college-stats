---
title: "Selectivity history records only real changes"
pr: 169
date: 2026-10-20
kind: fix
summary: "Our internal record of each college's selectivity now keeps one entry per change, with all applicants, in-state, and out-of-state side by side."
---

## What's new

- **Nothing changes on the pages you see.** This is our internal record of how each college's selectivity rating
  has moved over time.
- **One entry per real change.** The record had been adding identical entries for hundreds of colleges every time we
  updated the site. It now adds an entry only when something about a college changed.
- **All applicants, in-state, and out-of-state together.** A college's three ratings now sit side by side in one
  entry, so a change in one is easy to compare with the others.

## Behind the scenes

- The history writer read its last recorded rows in a single request, which stops at 1,000 rows. About 660 colleges
  past that point were re-recorded on every publish. It now reads every page.
- `selectivity_history` stores one row per college per publish, with `score_*`, `tier_*`, and `held_*` for each pool
  (migration `20261020120000_selectivity_history_one_row.sql`). A publish that changes nothing records nothing.
- `npm run rebuild-selectivity-history` replayed the recorded publishes from git. Dev went from 18,812 rows to 6,154.
- Spec: `specs/chances/selectivity-history.md`, "As changed (2026-10-20)".
