---
title: "Tiny applicant pools no longer flagged as missing data"
pr: 170
date: 2026-10-20
kind: improvement
summary: "Our internal data checks now treat a college with too few applicants for an admit rate as expected, and save the alarm for rates that are genuinely missing."
---

## What's new

- **Nothing changes on the pages you see.** This refines an internal check on the data behind admission estimates.
- **Small colleges aren't treated as broken.** We don't publish an admit rate for a college with fewer than 10
  applicants, because a rate from a handful of applications means little. Our checks now treat that as expected
  rather than as missing data.

## Behind the scenes

- On the admin Health page, a college with no admit rate and fewer than 10 applicants is Watch, not Failing. Failing
  now means the rate is genuinely missing: 2 colleges instead of 42.
- The 10-applicant threshold is one constant, `MIN_APPLICANTS_FOR_RATE` in `lib/derive.ts`, shared with the data sync.
- Spec: `specs/product/admin-health-views.md`.
