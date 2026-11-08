---
title: "Six more sources on the roadmap: safety, place, athletics, earnings by field"
pr: 216
date: 2026-11-05
kind: plans
summary: A new "Additional data" section of the roadmap lists six public sources we plan to bring in, starting with campus safety counts and a Place section with climate, walkability, and local rent, after a comparison with niche.com showed those are the questions the site can't answer yet.
---

## What's new

- **A new roadmap section, Additional data.** We compared what niche.com shows per college with what Quad shows. On
  the numbers that decide whether a college is reachable and affordable, Quad already has more, with a source and year
  on every value. Where Niche is ahead is the place itself and what students say about living there.
- **Six sources, in the order we'd build them:** campus crime and fire counts from the federal Clery Act data (shown
  as counts and rates with the year, never a grade); a Place section with climate normals, a walkability score, and
  off-campus rent, each with its own filter; athletics programs with rosters, athletic aid, and spending; graduates'
  earnings one, five, and ten years out by field, for every graduate rather than only the federally aided ones, where
  the Census has the data; research spending as a "Known for" mark; and what graduates are doing six months after
  graduation, from each college's own report.
- **What we won't add:** letter grades, composite scores, or anonymous student polls. The [roadmap](/roadmap) has the
  page with the full comparison and each source's caveats.

## Behind the scenes

The page is `specs/data-expansion/sources-beyond-federal.md`, wave 7 of the data expansion, with a new roadmap group
so it shows under its own heading. Each source becomes its own spec when built. The biggest caveat is coverage of the
Census earnings data, which depends on state partnerships and today leaves out California, Florida, and Washington.
