---
title: "Quad v0.2: a new look and every 4-year U.S. college"
pr: 1
date: 2026-09-27
kind: feature
summary: The site becomes "Quad", with a full redesign and real federal data on 1,893 four-year colleges instead of a 20-school sample.
---

## What's new

**A new look.** Bold Bricolage Grotesque headings, electric violet with a lime accent, a warm light mode and a deep
indigo dark mode, and a Light / Dark / System switch. Each topic (admissions, size, test scores, access, diversity) has
its own color, and every chart palette was checked for color-blind safety in both themes.

**Pages that go from overview to detail:**

- **Home**: search with suggestions, "What kind of school are you after?" shortcuts, an admissions landscape chart
  (admit rate against SAT), leaderboards, a clickable state map, and preset head-to-head matchups.
- **Explore**: card, sortable table, and chart views; filter sliders with the distribution drawn behind them;
  removable filter chips; a phone filter panel; pagination.
- **School profiles**: a sticky section menu, summary tiles, an "out of 100 applicants" graphic, an admissions funnel,
  a check-your-SAT/ACT tool, national "where it ranks" charts, and similar schools.
- **Compare**: up to four schools, automatic "key differences", an overlaid profile chart, grouped bars, and a full
  numbers table.
- **Glossary**: 31 searchable terms. Every metric has an ⓘ or dotted-underline pop-up that works on hover, keyboard,
  and tap.

**Real data.** 1,893 four-year colleges from the U.S. Department of Education's College Scorecard and the IPEDS
admissions survey. Ranks and medians are national: each college is compared with every college that reports the same
measure.

## Behind the scenes

- `npm run sync-data` builds `data/schools.json` from the Scorecard API and the newest IPEDS admissions file, then
  applies hand-checked corrections from `data/overrides.json` (such as Vanderbilt's Common Data Set).
- Search and Compare look schools up through `/api/schools`, so the full list never goes to the browser.
- Most school fields can now be empty (open-admission and test-blind colleges); the site shows "not reported" rather
  than treating a missing value as 0.
- Fixed seven wrong school IDs from the old sample data.

## Known limits at launch

- 42 online-only colleges are left out by default.
- No acceptance rate is shown for colleges with fewer than 10 applicants.
- Cost and outcomes data was collected but not yet shown. It arrived in the next release.
