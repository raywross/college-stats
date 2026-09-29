---
title: "Trends over time, part 1: cost, aid, and admissions history"
pr: 12
date: 2026-09-28
kind: feature
summary: Year-by-year history for cost, aid, and admissions on every profile, plus a "What's changed" section on Home.
---

## What's new

**An Over time section on every profile**, with three groups of charts:

- **Cost**: average cost against full price and net price with grants, and net price by family income.
- **Aid**: how much aid students get, year by year.
- **Admissions**: applicants, admits, acceptance rate, and yield.

Controls switch between 10 years and all years, after inflation or as reported, the national median, and in-state or
out-of-state prices. Every chart has a crosshair tooltip, a table view, markers for provisional and pandemic years, and
a source line with its year range.

**A "10 years" tile** in the profile overview shows average cost and up to two notable changes, with a one-line
takeaway.

**"What's changed" on Home:**

- What students paid fell 12% after inflation since 2013–14, while full prices held steady.
- Applications to the 100 most selective colleges rose 74% since fall 2014, while enrollment rose 10%.

## Behind the scenes

- `npm run sync-history` reads about 80 federal files. A registry maps each era's file and column names, because the
  government has moved these figures between files over the years.
- Nothing is written unless every check passes. Years must be consecutive, coverage can't drop sharply from one year
  to the next, every series must end on the college's current value, and sampled values must match the Urban
  Institute's independent copy of the same data.
- History lives in `data/history/`, one file per college, with inflation from the BLS consumer price index.
- The price and aid math now lives in one place for both data syncs. That fixed a latent bug where the sync could read
  the *next* year's prices as the current year's.
- Some old reports are left out: admissions figures a college carried forward from the year before, and impossible
  yields (more enrollees than admits).
