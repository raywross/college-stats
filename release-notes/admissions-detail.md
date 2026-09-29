---
title: "Admissions detail: rates for men and women, true medians, and ACT sections"
pr: 26
date: 2026-09-29
kind: data
summary: Acceptance rates for men and women, each college's true median test scores, and ACT English and Math ranges.
---

## What's new

- **Profile → Admissions**: acceptance rates for men and women. A "Men and women" card appears when the gap is 3+
  points and each group has 200+ applicants. Otherwise one line sits under the funnel, such as Vanderbilt's "similar
  rates (5.9% and 5.8%)". A neutral chip marks the top 5% of gaps among larger colleges (about 46 colleges).
- **Profile → Test scores**: each college's own median appears as a ring on its score bars, and ACT English and Math
  ranges sit under the composite, the way SAT sections already did.
- **Over time → Admissions**: acceptance rates for men and women from fall 2001.
- **Explore**: an "Admit rate, men / women" column and an "Admit rate gap" sort. **Compare**: a new row.
- **Glossary**: admit rate by sex, and median vs. midpoint.

## Behind the scenes

- Coverage: rates by sex for 1,586 colleges, SAT medians for 927, ACT medians for 895, ACT sections for about 846. No
  existing value changed.
- A federal median is never drawn on a score range that came from a college's own Common Data Set.
- About half of colleges show the "Men and women" card, because 708 of 1,300 have a gap of 3+ points (women higher at
  600, men at 108).
- No Home fact: colleges admitting men at a notably higher rate fell from 13% to 6% over 20 years, a steady drift
  rather than a surprise. It became the first [national trends](national-trends-spec.md) study instead.

Second of the five wave 1 specs: [admissions-detail.md](../specs/data-expansion/admissions-detail.md).
