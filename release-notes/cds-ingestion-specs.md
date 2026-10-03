---
title: "Plans: reading every Common Data Set once, and nine features built from it"
pr: 57
date: 2026-10-03
kind: plans
summary: Plans for reading each college's Common Data Set in full on a single visit, and for the nine features that data makes possible, from in-state admit rates to CSS Profile requirements.
---

## What's planned

Colleges publish a yearly **Common Data Set** with far more than the admissions funnel the site reads from it today.
We read 19 real 2025–26 files item by item and planned how to collect everything useful in one pass:

- **[Round 3 of the college-reported pipeline](../specs/college-reported-round-3.md)**: every document is kept and
  read once for all of its sections, so later features come from stored records, not another visit to the college's
  site. Excel files and fillable PDF forms are read without a model at all; the rest cost a few cents each. The one
  run over all 1,893 colleges is estimated at about $80.
- **Nine features from that data**, each with its own plan: first-years' [high school GPA, admission factors, early
  rounds and wait lists](../specs/data-expansion/cds-admissions.md); [admit rates for in-state, out-of-state and
  international applicants](../specs/data-expansion/cds-residency-admissions.md); [whether next year's applicants
  need test scores, and score bands](../specs/data-expansion/cds-test-scores-and-policy.md); [deadlines, reply dates,
  deposits and gap years](../specs/data-expansion/cds-application-logistics.md); [CSS Profile requirements, aid
  deadlines, aid for international students and need vs merit](../specs/data-expansion/cds-financial-aid.md);
  [enrollment, retention and graduation a year newer than federal data](../specs/data-expansion/cds-student-body-and-outcomes.md);
  [class sizes and programs](../specs/data-expansion/cds-academics.md); [transfer admissions](../specs/data-expansion/cds-transfer.md);
  and [next year's price and graduates' total debt](../specs/data-expansion/cds-cost-and-debt.md).

All are listed on the [roadmap](/roadmap) under "Newer figures from colleges".

## Behind the scenes

- The inventory found that one college's PDF held every answer in form fields (the earlier pilot read nothing from
  it), that the 2025–26 template numbers all 1,105 items the same way at every college, and that grid checkboxes lose
  their column in plain text but not in position-aware text. Round 3 is designed around those facts.
- Costs are estimates until the pilot the plan calls for; it says which numbers to read before the full run.
- Small corrections landed in the campus-life, admission-factors and early-decision plans.
