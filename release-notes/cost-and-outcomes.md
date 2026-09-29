---
title: Cost and outcomes, financial aid, and source citations
pr: 2
date: 2026-09-28
kind: feature
summary: What college really costs, who gets aid, and what it leads to, on every page, with every number linked to its source.
---

## What's new

**On each school profile, a Cost & outcomes section:**

- What families at each income level actually pay, from $0–30K up to $110K+, and sticker price against what aided
  students pay ("grants cover 82%").
- Median debt with its monthly payment, and a rough payback estimate in years of median salary.
- Earnings against every college, and how they grow from year 6 to year 10.
- Retention and graduation rings, and a cost-vs-earnings map with the school highlighted.

**The average cost for all students.** Published "average net price" only counts students who got grants, so it
understated what a typical student pays (at Vanderbilt, $15,846 shown against about $46,300 in reality). The site now
estimates the average paid by *all* first-years, with students who got no grants counted at full price. This figure is
used everywhere cost appears.

**Who actually gets aid.** The share of first-years who got grants and who didn't ("about 1 in 3 got no grant aid and
paid close to the sticker price"), where aid comes from (college, Pell, state, loans), and a link to each college's
net price calculator.

**Public universities** show in-state and out-of-state prices side by side, with the share of students paying each.

**Everywhere else:**

- **Explore**: a net price meter on cards, cost and outcome columns, a net price filter, new sorts, and a
  "Cost vs. earnings" chart.
- **Compare**: a Cost & outcomes group, a "what families at each income level pay" chart, and new key differences such
  as "UCLA costs $3.3K less per year than Vanderbilt".
- **Home**: an "Is it worth it?" chart, Highest earnings and Lowest net price leaderboards, and a "Low cost, high
  earnings" lens.
- **Glossary**: 15 new terms, including net price, sticker price, median debt, merit aid, and percent of need met.
- New "Known for" badges: Great value, High earners, Low net price, High graduation rate.

**Every number is cited.** Each section ends with its source and edition, profiles list their sources, and a new
Sources page explains the datasets, coverage, and how each figure is calculated.

## Behind the scenes

- New data: College Scorecard cost and outcomes, the IPEDS Student Financial Aid survey, and IPEDS Institutional
  Characteristics prices.
- `npm run import-cds` reads a college's official Common Data Set spreadsheet. Imported for Vanderbilt, NYU,
  William & Mary, UIUC, UC Berkeley, Maryland, Purdue, and Cornell. The importer cross-checks totals and caught a typo
  in Purdue's own file.
- Cost and outcomes share one new amber color, validated for color-blind safety in both themes.
