---
title: The Data tab
pr: 7
date: 2026-09-28
kind: feature
summary: A new Data tab shows how current each dataset is, when the next federal releases are due, and where every number comes from.
---

## What's new

The new **Data** tab replaces the Sources page (old links redirect). It covers:

- **Why federal data lags**, in plain terms.
- **What's on the site now**: each dataset with its year, on a timeline that runs to the next expected release.
- **Upcoming releases**: a release calendar for the federal files the site uses.
- **How we compare colleges**, plus everything that was on the Sources page.

## Behind the scenes

- The release calendar lives in `data/release-calendar.json`. `npm run sync-data` checks each upcoming release's
  files and marks it published when they appear.
- Every year shown comes from the data itself or the calendar, never from page code, so the tab stays current with each
  release. The page warns when the calendar hasn't been reviewed in 90 days.

Details: [data-page.md](../specs/data-page.md).
