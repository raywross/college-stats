---
title: "Student body: men and women, part-time, and students 25+"
pr: 23
date: 2026-09-29
kind: data
summary: Profiles, Explore, and Compare now show each college's balance of men and women, its share of part-time students, and its share of students 25 and older.
---

## What's new

- **Profile → Students**: a "Who they are" card compares men (with the women's share), part-time students, and
  students 25 and older against the median college. It adds a one-line study-load note and a "Many adult students"
  chip for colleges above the 75th percentile.
- **Profile → Over time**: men's share and part-time share from fall 1996, with national bands.
- **Explore**: a "Student body" filter (Mostly women 702, Balanced 954, Mostly men 237, Mostly full-time 1,100), a Men
  column, sorts, and a 10-year change column for men's share.
- **Compare**: rows for men and women, part-time, and 25+, plus bars with no "Highest" flags, since these describe a
  college rather than rank it.
- **Glossary**: gender balance, part-time student, adult students, and degree-seeking.

## Behind the scenes

- Four new fields from the College Scorecard, covering nearly every college. No existing value changed.
- Age is only collected in odd-numbered years, so it's cited with its own year and has its own row on the Data tab.
- Average age at entry was left out: its newest year is 2015.
- No Home fact: men's share fell 1.3 points over 10 years, under the spec's 2-point bar.

First of the five wave 1 specs: [student-body.md](../specs/data-expansion/student-body.md).
