---
title: "Campus life: religious life, Greek life, and LGBTQ+ life"
pr: 72
date: 2026-10-03
kind: data
summary: Campus life now shows each college's religious affiliation, fraternity and sorority participation where the college reports it, and federal gender-identity counts with what they do and don't mean.
---

## What's new

- **Profile → Campus life → Religious life**: whether a college has a religious affiliation (685 do), named the way
  the federal government records it ("Roman Catholic", "Southern Baptist"). Where the college's Common Data Set says
  so, how much religious commitment counts in admissions, whether it offers scholarships for religious affiliation,
  and whether it has campus ministries.
- **Profile → Campus life → Greek life**: the share of men in fraternities and women in sororities, for first-years
  and all undergrads, against other colleges that report it, and whether there's fraternity or sorority housing. Shown
  for colleges whose Common Data Set we've read; more will appear as we read more.
- **Profile → Campus life → LGBTQ+ life**: how many undergrads the college counts as another gender, and what the
  number means. Many colleges don't collect it, some leave it blank for privacy, and a 0 can mean the college
  doesn't record it, so the profile says which. Small counts show as "fewer than 10". These counts are never ranked or
  compared. At Texas public colleges, a line explains the state law (SB 17) that closed identity-based offices.
- **Profile → Students**: an "Another gender" line beside the men/women balance, with a note on why men and women add
  up to 100%.
- **Explore**: filter by religious affiliation (Catholic, Baptist, Jewish, no affiliation, and more), and by
  fraternity or sorority participation of at least 10, 20, or 30%.
- **Compare**: rows for religious affiliation, fraternity and sorority participation, and Greek housing.
- **Glossary**: religious affiliation, Greek life, another gender, gender unknown, and state laws on public colleges.

## Behind the scenes

- The federal sync now reads religious affiliation (with NCES's own labels) and the another-gender columns from files
  it already downloads. The federal government stopped asking colleges about another gender from 2025–26, so fall 2024
  is the last year; the site keeps showing it, labeled with its year.
- Fraternity, sorority, and religion answers come from the Common Data Set records the college-reported pipeline
  already stores. A blank answer stays blank, never 0.
- State laws live in a checked table (`data/state-laws.json`), each citing its statute.
- Next for this group: pilots that read college offices' own pages, national directories of faith communities and
  chapters, and other states' laws. See the [roadmap](/roadmap).
