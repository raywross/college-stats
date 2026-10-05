---
title: "Plans: national trends, top-10 lists, conferences, and states"
pr: 55
date: 2026-10-03
kind: plans
summary: Eight new plans grow the national-trends idea into a family, with the first numbers for each, from test-optional's spread to the Pell graduation gap, plus pages by athletic conference and by state.
---

## What's planned

The site can already show how one college changed. These plans are about how **college** changed, across the
country, and they come with a first look at the numbers, computed from the history already on the site:

- **[Test-optional went mainstream](/trends/test-optional)**: two thirds of colleges required the SAT or ACT in
  fall 2019; one in twenty do now. Where tests became optional, the published SAT ranges rose about 30 points, because
  fewer students submit.
- **[Shrinking colleges](/trends/shrinking-colleges)**: half of four-year colleges have at least a tenth fewer
  undergraduates than ten years ago. Large research universities and the most selective colleges grew instead.
- **[The price gap](/trends/price-gap)**: what students actually pay fell 11% after inflation at the typical
  college, while full prices held. At the most selective colleges, it didn't fall at all.
- **[Students from other states](/trends/out-of-state)**: public colleges enroll more first-years from out of
  state than ten years ago, led by public research universities.
- **[The Pell graduation gap](/trends/pell-gap)**: Pell Grant recipients graduate about 11 points less often
  than classmates with neither a Pell Grant nor a subsidized loan, and the gap has widened.
- **[Top-10 lists](/trends/movers)**: the colleges that changed most on each measure, with the rules
  that keep online programs and campus closures from crowding the lists.
- **[By athletic conference](/trends/conferences)**: a page for every conference, its members compared, how
  it changed, and who joined or left. SEC members' applications doubled in ten years.
- **[By state](/trends/states)**: a page for every state, with its colleges' trends, publics against
  privates, and where its students come from.

The [national trends plan](/trends) now ties these together: the shared method, the groups every
study can be split by, where the pages live, and a list of further ideas.

## Behind the scenes

- Specs live in `specs/trends/`, one per study or page, and follow the hub's template: question, data, panel, first
  look, what readers see, computation, tests, open questions.
- Every number will be computed by the history build and committed, with a test that recomputes it, so pages stay
  static and each figure traces to its source and years.
- The first-look numbers were produced on 2026-10-03 from the committed history shards; the specs record the panel
  rules used so they can be checked when built.
