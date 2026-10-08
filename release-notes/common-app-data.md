---
title: "Planned: deadlines, requirements, and this season's application trends from the Common App"
pr: 90
date: 2026-10-06
kind: plans
summary: A plan to show every Common App member college's deadlines, fees, essay and recommendation requirements, and this cycle's test policy, plus how the application season is going nationally months before federal data, once Common App agrees to the use.
---

## What's new

- **A planned "What it takes to apply" card.** About a thousand of the colleges on the site take the Common App, and
  Common App publishes, for each of them, the deadlines for every round (Early Decision, ED II, Early Action, EA II,
  restrictive EA, regular or rolling), the application fee and whether a fee waiver is accepted, whether the essay, a
  writing supplement, or a self-reported transcript is required, how many teacher recommendations and whether a
  counselor letter and mid-year report are needed, and the test policy for the cycle that is open now. Today the site
  has deadlines for a handful of colleges and a test policy that describes the cycle before last. The plan puts these
  on each college's Admissions page, adds Explore filters such as "no application fee" and "offers Early Decision",
  and feeds the application tracker and the planned early-decision view.
- **Planned: this season's application trends, early.** Common App reports each season's applicant and application
  counts, growth for first-generation and fee-waiver-eligible students, the share reporting a test score, and
  applicants by state, in monthly updates from November and a season report each August. Federal data on the same
  season arrives about a year and a half later. The plan adds a "this season" block to the trends hub and a line to
  each state's page, each cited to the report.
- **Nicknames.** Common App's pages list alternate names for 860 colleges ("Vandy", "K-State"), a fifth source for
  the site's search aliases.

## Behind the scenes

- `specs/data-expansion/common-app.md`, **planned**, in the roadmap's Planning tools group and the data-expansion
  index as wave 6. The survey behind it measured the Requirements Grid (about 1,128 rows, parsed by column position
  in a probe), the Explore pages (1,174 members, joined to the site by IPEDS id, about 1,000 of them on the site), the
  reports index (61 entries; figures and appendix tables are images), and a Tableau state workbook.
- **Nothing is built, and nothing will be until Common App agrees.** Its terms of use license the site for personal,
  non-commercial use and forbid scraping and derivative works, so the spec's first unit of work is a one-page
  request, with the contacts to send it to and what the site offers in return (attribution on every value, no bulk
  re-export, removal on request). If the answer is no, the same facts come the slow way, from each college's own
  admissions page through the college-reported data agent.
- The backlog and the specs index are updated. No data or page changes in this release.
