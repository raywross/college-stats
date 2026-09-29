---
title: "Trend indicators: cost, applications, diversity, and selectivity"
pr: 16
date: 2026-09-28
kind: feature
summary: Four up, steady, or down indicators show how each college changed over 10 years, and you can search, filter, and compare by them.
---

## What's new

Each college gets four indicators of how it changed over its last 10 years of federal data. Each one is up, steady,
or down, and always shows its number:

| Indicator | Measure | Counts as steady within |
|---|---|---|
| Cost | Average total cost, after inflation | ±5% |
| Applications | Applicants | ±10% |
| Diversity | Diversity index | ±0.03 |
| Selectivity | Acceptance rate, inverted | ±3 points |

- **Profiles**: four cards in the hero, linking to Over time.
- **Explore**: "10-year direction" filters with counts, a direction block on each card, and applications and
  diversity change columns.
- **Compare**: a 10-year direction table, and diversity in "Then & now".

## Behind the scenes

- Small colleges are left out: applications and selectivity need 200+ applicants, and diversity needs 300+
  undergraduates.
- Diversity is also skipped when the "other or unknown" race share moves more than 10 points. That signals a change
  in how the college reports, not in who enrolls. 1,427 colleges have the indicator.

Design and thresholds: [trend-indicators.md](../specs/trend-indicators.md).
