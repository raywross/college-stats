---
title: A plan for the Data Steward to repair and explain
pr: 246
date: 2026-11-10
kind: plans
summary: A plan for the next round of the Data Steward, the agent that keeps college-reported figures honest: it will explain on a college's page why a figure is held, with options and a recommendation, repair what it is sure of, and write the code fix when a rule is wrong.
---

## What's new

Nothing on the site yet. This is a plan.

## Behind the scenes

When a college's reported figures are held back, the owner today sees a badge and a cluster table. The plan gives the
Steward an Explain mode that answers "why is this failing?" in plain words on the college's page, with the options
and a recommendation; tools that read the checks' own rules so it can tell a rule defect from a document problem;
an order of work that starts from the colleges the owner is looking at and sweeps the small clusters that
largest-first never reaches; and repairs in three tiers: things it does on its own and lists afterwards, things it
asks about first, and rule fixes it writes as a pull request for the owner to merge.
