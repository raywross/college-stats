---
title: "Newer figures from colleges: the whole Common Data Set, read once"
pr: 60
date: 2026-10-03
kind: feature
summary: "Colleges' own Common Data Sets now feed GPA, early decision, wait lists, test policy, class sizes, transfer admissions, aid rules, next year's price, and a year-newer enrollment and graduation picture, starting with four colleges, with the pipeline that will read every college's document once."
---

## What's new

For colleges that publish a Common Data Set, their profiles now show things no federal file has:

- **Getting in:** the average high school GPA and GPA bands (with a checker for your own GPA), how much each part
  of an application counts, early decision and early action numbers and dates, wait-list odds, class rank, admit
  rates and yields for in-state, out-of-state, and international applicants, the test policy for the coming
  application cycle with true SAT total ranges and score bands, application deadlines, when decisions come out, the
  reply date and housing deposit, whether a gap year is allowed, the high school courses expected, and transfer
  admissions with what transfers need.
- **Academics:** how big classes are (the share of sections under 20 and over 50 students), the college's own
  student-faculty ratio, honors and other programs, and core requirements.
- **Cost & aid:** next year's price beside the federal one, whether the CSS Profile and other forms are required,
  aid deadlines, how much of first-years' need is met, how much scholarship money is merit, aid for international
  students, and what graduates owed counting private loans.
- **Students and outcomes:** enrollment, race and ethnicity, retention, and graduation by Pell status a year newer
  than federal data, with 4- and 5-year completion.

Four colleges have these today: Vanderbilt, Cornell, William & Mary, and Illinois. Every new figure carries the
usual ⓘ with the document, its edition, the year it describes, the exact quote, and the link. As before, the newest
figure a college has published is the one shown everywhere, with the federal figure one hover away.

Explore gains chips for colleges that publish GPA, admit rates by residency, an honors program, transfer
admissions, gap-year deferral, no CSS Profile, aid for international students, and the coming cycle's test policy.
Compare gains the matching rows.

## Behind the scenes

This is round 3 of the college-reported data pipeline (specs/college-reported-round-3.md): every document a
college publishes is archived once and read for everything we will ever want from it, keyed by the Common Data
Set template's own 1,105 item codes. The 2025–26 Excel template and fillable PDF forms are read by code with no
model; flattened PDFs get layout-aware text, two code-keyed model calls through the Message Batches API, and quotes
cited by line. Discovery climbs a ladder of free probes before any model call, blocked hosts and the owner's manual
links are tracked, and every item has its own checks, review-queue entry, and escalation rule. The nine display
specs read the committed records in `data/cds-records/`.

Not in this release: the first full run over all 1,893 colleges (the owner triggers the two pilot runs first),
history series from prior editions, and the private archive repository.
