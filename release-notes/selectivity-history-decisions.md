---
title: "Plan: followers will hear when a college's selectivity rating changes"
pr: 148
date: 2026-10-13
kind: plans
summary: The plan for tracking selectivity ratings now records every change, keeps the record forever, and adds an update for followers when a college's public rating changes.
---

## What's new

- **Followers will hear about rating changes.** Once this is built, if you follow a college and its Quad's
  selectivity rating changes, the change will be in your update email. For example: "Quad's selectivity is now Ultra
  selective for out-of-state applicants (was Highly selective)." Nothing changes on the site yet. This is a plan.
- **When we change the formula itself, you won't get an email.** A new formula could move many colleges at once.
  That's our change, not the college's, so we'll explain it in these release notes instead.

## Behind the scenes

- `specs/chances/selectivity-history.md` records the owner's answers: record every change with no threshold, no
  alert to the owner, keep the history forever, and make the three public tier fields notify fields.
- Planned code: a `notify` entry for `selectivity.tier`, `.in_state`, and `.out_of_state`; a `NotifyDef` option so a
  tier moved by other colleges' figures still counts; and a `suppress` option in `diffSchools`, which
  `publish-changes` sets when the selectivity method version differs between the two commits.
- The score and rank stay hidden: neither ever enters `dataset_changes`.
