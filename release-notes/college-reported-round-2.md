---
title: "Profiles show the newest admissions figures, and the first 22 are in"
pr: 54
date: 2026-10-03
kind: feature
summary: A college's profile now leads with the newest admissions figures it has published itself, 22 colleges have them already, and the agent that collects them costs about a tenth of what its first run did.
---

## What's new

- **The newest numbers first.** When a college has published admissions figures for a newer class than the federal
  data covers, its admissions page and overview card lead with those: applicants, admitted, enrolled, the admit rate
  and yield for the newest class, each with its year and a chip saying it came from the college itself. The
  federal figure stays one line below, so you can see the change. A profile can now mix years, and every number
  says which year it describes.
- **22 colleges already have them.** Ten from their 2025–26 Common Data Sets (fall 2025 class): Baylor, Berkeley,
  Columbia, Harvard, Michigan, MIT, Texas Christian, USC, Vanderbilt and William & Mary. Twelve from class profiles:
  Duke, Illinois, Loyola Chicago, Spelman and Villanova for fall 2026; Georgetown, Loyola Maryland, Morehouse,
  Pepperdine, Purdue, Stanford and UT Austin for fall 2025. Some class profiles give only part of the funnel (Purdue
  and UT Austin publish applicants but not admits), and the page shows what was published.
- **Comparisons are unchanged.** Explore, Compare, rankings, medians and the home page still use federal data, the
  newest year every college reports, so one college's fall 2025 is never set against another's fall 2024.
- **The Data page** explains the new rule.

## Behind the scenes

- The first 50-college pilot cost about $80 (and hit the account's credit limit before finishing), because discovery
  read whole documents with web fetch, resent them every turn, and retried blocked sites with the most expensive
  model. Discovery now returns links only, with capped page reads, streaming, one retry, and a low effort setting;
  next year's Common Data Set URL is guessed from last year's before any model is called; a blocked site goes
  straight to the review queue as "unreachable" with no model call; a failed check gets one re-read by Sonnet 5,
  and Opus is no longer used. Expected cost: about $0.05–0.12 per newly discovered college, under $5 for a quiet
  monthly run.
- **A dollar cap per run** (`--max-cost`, $25 by default for manual runs, $150 for scheduled ones) stops a run
  cleanly, keeping every college it finished. The pipeline also saves after every college, logs its running cost,
  stops at once when the account's spend limit is reached, and still opens a pull request after a stop or cancel.
- **The data pull request now carries the site's data.** `npm run merge-reported` folds the collected figures into
  the dataset with the same code the sync uses, the workflow runs it, and the PR's preview shows the figures.
  `npm run report-college-reported` prints which colleges have what.
- Two pilot misreads were corrected: a Common Data Set whose web address included an upload-date folder was read
  as the wrong year (Vanderbilt relabeled fall 2025; Cornell dropped, since its existing CDS already covers that
  class). The year now comes from the file name first.
- Specs: `specs/college-reported-round-2.md` (what the pilot showed and the decisions), with
  `college-reported-data.md`, `data-lineage.md`, `data-page.md`, `school-profile.md` and `college-reported-setup.md`
  updated.
