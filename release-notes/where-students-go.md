---
title: "Planned: where the students went, and which colleges are really online"
pr: 82
date: 2026-10-05
kind: plans
summary: Two new plans on the roadmap — a national trend study showing where undergraduates went over ten years (toward the biggest campuses and research universities, not toward cheaper colleges), and a stored measure of how much of each college is online.
---

## What's new

- **A planned trend study, "Where the students went."** The site's trends so far tell the story college by college
  (half of colleges are smaller than ten years ago). This one tells it student by student: what share of all
  undergraduates attend each kind of college, then and now. The first look says a third of campus-based students now
  attend a college with 20,000 or more students, up from 30%, and that share rose every single year; research
  universities went from 40% to 46% of students; the Midwest's colleges lost two points of the national share; and the
  colleges that cut their prices the most lost the most students, while the priciest fifth grew. The page will show
  these as shares then and now, a map of each state's share change, and a chart of price change against enrollment
  change, with the usual notes on what the data can and can't say.
- **A planned measure of how online each college is.** Some "colleges" are mostly websites: Southern New Hampshire
  University has 163,000 undergraduates, 98% of them entirely online. Today the site sets such colleges aside with a
  hand-checked list; the plan stores the federal count of students studying entirely online for every college, shows
  it on the college's page, adds a "campus-based / mostly online" filter to Explore, and uses it wherever online
  growth would otherwise look like a campus growing.
- **On the state pages, later:** which states gain or lose first-year students to other states, and which colleges
  take them in. The first look is in the state pages' plan.

## Behind the scenes

- `specs/trends/where-students-go.md` (Study 7) and `specs/data-expansion/online-share.md`, both **planned**; the
  roadmap's National trends group returns to hold them. First-look figures were computed from the committed history
  and the movers' exclusion lists; size and selectivity are classified as of fall 2014, a stated departure from the
  hub's today's-classification rule, with the reason in the spec.
- The hub, backlog, specs index, data-expansion README, and `specs/trends/states.md` (net first-year flows as an open
  question) are updated. No data or page changes in this release.
