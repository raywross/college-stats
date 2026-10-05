---
title: "Planned: where the students went, what the pandemic did, and which colleges are really online"
pr: 82
date: 2026-10-05
kind: plans
summary: Three new plans on the roadmap — a national trend study showing where undergraduates went over ten years and whether the pandemic sped that up or reversed it, a stored measure of how much of each college is online, and which states gain first-year students from other states.
---

## What's new

- **A planned trend study, "Where the students went."** The site's trends so far tell the story college by college
  (half of colleges are smaller than ten years ago). This one tells it student by student: what share of all
  undergraduates attend each kind of college, then and now. The first look says a third of campus-based students now
  attend a college with 20,000 or more students, up from 30%, and that share rose every single year; research
  universities went from 40% to 46% of students; the Midwest's colleges lost two points of the national share; and the
  colleges that cut their prices the most lost the most students, while the priciest fifth grew. The page will show
  these as shares then and now, a map of each state's share change, what the average student actually pays by year,
  and a chart of price change against enrollment change, with the usual notes on what the data can and can't say.
- **What the pandemic did, and whether it's reversing.** The same page will split the ten years into before, the
  pandemic, and after, and show the pace of each shift in each. The first look: the pandemic sped everything up (the
  biggest campuses kept their students while every other size lost 6–8%), and since 2022 the shifts have slowed to
  their old pace but not turned around: the typical college stopped shrinking, yet only about a third of colleges are
  back to their 2019 size, against two thirds of the biggest ones. The one real reversal is in applications, where the
  research universities' share peaked in 2022.
- **A planned measure of how online each college is.** Some "colleges" are mostly websites: Southern New Hampshire
  University has 163,000 undergraduates, 98% of them entirely online. Today the site sets such colleges aside with a
  hand-checked list; the plan stores the federal count of students studying entirely online for every college, shows
  it on the college's page, adds a "campus-based / mostly online" filter to Explore, and uses it wherever online
  growth would otherwise look like a campus growing.
- **Planned for the state pages: first-years crossing state lines.** Which states gain or lose first-year students to
  other states, by how much, and which colleges take them in; a new coloring for the states map and a block on each
  state's page. The first look: 33 states and DC gain more than they lose, and in most of them one or two public
  flagships take half to two thirds of the arrivals.

## Behind the scenes

- `specs/trends/where-students-go.md` (Study 7) and `specs/data-expansion/online-share.md`, both **planned**; the
  roadmap's National trends group returns to hold them. The flows measure is a planned addition inside the built
  `specs/trends/states.md`. First-look figures were computed from the committed history, the detail files, and the
  movers' exclusion lists; size and selectivity are classified as of fall 2014, a stated departure from the hub's
  today's-classification rule, with the reason in the spec; the pandemic's low point is found by the build, not typed.
- The hub, backlog, specs index, and data-expansion README are updated. No data or page changes in this release.
