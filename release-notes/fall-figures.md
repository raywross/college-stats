---
title: A college's newest numbers, months before its Common Data Set
pr: 247
date: 2026-11-11
kind: plans
summary: A plan to carry the figures colleges post about their newest class in spring, summer and fall, each cited to the college's own page, instead of waiting for the Common Data Set.
---

## What's new
Colleges announce their newest class long before they file the Common Data Set: a March release with how many
applied and were admitted, a September release with how many enrolled, a fact sheet, a counselor newsletter. Today
Quad shows most colleges' previous class until the Common Data Set arrives, and only 23 colleges show the class that
just started. This plan reads those early announcements too, so a college's page can say "applications up 9% this
year" when the college says so, with the college's own words and a link beside the number.

Rounded figures stay rounded ("82,000+ applied"), a class goal is never shown as the enrolled count, and student
newspapers and third-party sites are never sources.

## Behind the scenes
The spec (`specs/college-reported-fall-figures.md`) was sized against the data store: which colleges have a
class-profile source, how many of those pages yielded anything, and how many are frozen on last year's article. A
check of 32 selective colleges found the Fall 2026 counts on 20 official pages, arriving by season. The design turns
each announcement into a dated notice, combines the pieces into one funnel per entering term, adds three discovery
seasons for the most selective colleges, and keeps the college's news index as a recipe source so later years cost
nothing to find. Owner decisions on scope and display are listed at the end of the spec; nothing is built yet.
