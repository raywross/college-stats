---
title: Demonstrated interest, named and explained
pr: 96
date: 2026-10-07
kind: improvement
summary: The admissions factor colleges call "level of applicant's interest" now shows as demonstrated interest, with a glossary entry explaining what counts as interest and what to do about it.
---

## What's new

Some colleges weigh whether an applicant seems to really want to attend: campus visits, info sessions, opened emails,
an interview, an early application. Their Common Data Set calls this the "level of applicant's interest"; students
and counselors call it **demonstrated interest**, and that is now the name you'll see in a profile's "What they look
at" grid and in Compare's "All the numbers".

The ⓘ beside it opens a new glossary entry: what colleges count as interest, why some weigh it (they want to admit
students who will enroll), why most large and selective colleges mark it not considered, and what that means for
you. If a college marks it important, show up. If it's not considered, spend the time on the application itself.

Today the row appears for the colleges whose own Common Data Set we've imported. Among those, William & Mary and
Michigan State consider it; the rest don't. The federal survey never asks about it.

## Behind the scenes

Each row of the four-level C7 grid can now carry its own glossary term, used on the profile and on its Compare row;
rows without one keep the shared "How much each factor counts" term. Compare's factors card tells CDS-only rows apart
by their data field instead of their glossary term, so the relabeled row stays in the full table where it was. The
admissions specs describe the row, and a test pins its label, term, Compare row, and one college's real value.
