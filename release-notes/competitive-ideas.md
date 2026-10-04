---
title: "Ideas: seven fresh directions, and a place on the roadmap for them"
pr: 61
date: 2026-10-03
kind: plans
summary: The roadmap gains an Ideas section with seven directions that aren't planned yet, written up from a look at competing college sites and at guide-and-advisor sites in other fields, so the owner can judge each one.
---

## What's planned

The [roadmap](/roadmap) now ends with an **Ideas** section: directions worth judging, each written up far enough to
say yes, no, or later, but not yet planned work. They came from two pieces of research done on 2026-10-03: a close
look at two competing college sites, and a survey of how guide-and-advisor sites in other fields (travel, real
estate, summer camps, cars, and measured product reviews) help people choose among a thousand options. None copies a
competitor; each builds on what this site has that others don't: twenty-plus years of history per college, a source
and year on every number, an agent that reads colleges' own documents, households where a parent's finances stay
private, standing from published rules, and no leads sold to anyone.

- **[Guides](../specs/ideas/guides.md)**: common questions ("where merit aid is the norm", "four years means four")
  answered as living lists. Each is a published query with its criteria shown, recomputed with every data release,
  and openable in Explore to adjust. A guidebook, re-issued every edition.
- **[Cost to a degree](../specs/ideas/cost-to-a-degree.md)**: what the degree costs here, not one year of it: the
  four-year plan beside what finishing typically takes at this college, and the debt of those who leave without a
  degree. Comparative, the way car sites compute a five-year cost to own.
- **[Near and far](../specs/ideas/near-and-far.md)**: a map view of Explore, how far each college is from home and
  what getting there costs, and the colleges on a list grouped into visit trips.
- **[Worst plausible spring](../specs/ideas/worst-plausible-spring.md)**: if every Reach says no, what the list
  leaves a family with, what it would cost, and what's missing, as facts with their figures rather than a grade.
- **[Colleges that would compete for you](../specs/ideas/would-compete-for-you.md)**: colleges where a student's
  numbers sit above the admitted range, merit awards to students without need are routine, and demand has softened,
  each with its reasons.
- **[Cycle watch](../specs/ideas/cycle-watch.md)**: what changed for the coming application cycle at every college
  (test policy, early rounds, deadlines, fees, aid forms), in the college's own words, plus an opt-in brief.
- **[Getting into the major](../specs/ideas/getting-into-the-major.md)**: whether a college admits to the major or
  to the university, which programs admit directly, what it takes to get in after the first year, and whether a
  student can change in later.

The section's [overview](../specs/ideas/README.md) holds the research behind them, nine smaller additions proposed
for existing plans (not yet applied), and a list of things considered and not added, with the reasons.

## Behind the scenes

- The roadmap registry gains an `ideas` group and an `idea` status; the roadmap page counts planned specs and ideas
  separately, and any group can now link to an overview page.
- The roadmap test treats ideas as listed specs and adds a check that an entry's status, its group, and the spec's
  own status line agree. It was confirmed to fail when one idea was marked planned.
