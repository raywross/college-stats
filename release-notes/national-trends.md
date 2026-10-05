---
title: "National trends: how college is changing across the country"
pr: 80
date: 2026-10-04
kind: feature
summary: A new Trends page with six studies of how four-year colleges changed, top-10 lists of the colleges that changed most, and a page for every athletic conference and every state.
---

## What's new

Every page on the site so far answers a question about one college. The new [Trends](/trends) page answers questions
about all of them, using twenty years of federal data for about 1,900 four-year colleges.

**Six studies**, each with the national picture and the same picture split by region, public or private, size, and
selectivity, so you can see *where* a change happened:
- [Men and women in admissions](/trends/men-and-women): fewer colleges admit men at a notably higher rate than 20
  years ago, and the Northeast drives the change.
- [Test-optional went mainstream](/trends/test-optional): two thirds of colleges required the SAT or ACT in fall
  2019; one in twenty does now, and the score ranges colleges publish rose where tests became optional.
- [Shrinking colleges](/trends/shrinking-colleges): half of four-year colleges have at least a tenth fewer
  undergraduates than ten years ago, while large research universities grew.
- [The price gap](/trends/price-gap): what students actually pay fell after inflation at most colleges, but not at the
  most selective.
- [Students from other states](/trends/out-of-state): public colleges, especially research universities, enroll more
  first-years from out of state.
- [The Pell graduation gap](/trends/pell-gap): students with Pell Grants graduate less often than classmates with
  neither a Pell Grant nor a subsidized loan, and the gap widened.

**[Biggest movers](/trends/movers)**: ten lists of the colleges that changed most over ten or five years, from
applications to what students pay. Each list says which colleges it leaves out and why (mostly-online programs,
campuses that closed or merged, reporting errors), so the lists show real change.

**[By athletic conference](/trends/conferences)** and **[by state](/trends/states)**: a page for every conference
(the Power 4 side by side, members compared, who joined and left) and every state (a map colored by the measure you
pick, how the state's colleges changed, where their students come from).

Each study says which colleges it compares and whether a figure counts colleges or students, and every number cites its
source and years. You'll find Trends in the footer, in the phone's More menu, and under "What's changed" on Home.

## Behind the scenes

`npm run build-trends` computes every study, list, and group page from the history already committed, and runs at the
end of each history update, so the pages stay current with each federal release. Tests recompute each study from the
raw college histories and check that the Home facts and the matching studies agree to the number.
