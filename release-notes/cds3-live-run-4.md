---
title: "College data agent: telling a report's table cells apart"
pr: 67
date: 2026-10-04
kind: fix
summary: "The agent now gets each Common Data Set cell's full description, such as in-state versus out-of-state or need-based versus merit aid, so it no longer confuses cells that share a question."
---

## What's new

Nothing changes on the site yet. On its fourth test run the agent read full Common Data Sets for six new colleges, but
it sometimes put a figure in the wrong cell of a table. One college's total applicants, for example, landed in the
in-state column. Nothing it flagged was published. It now gets each cell's full description, so the next run can
publish what passes.

## Behind the scenes

- **Cell descriptions:** the list of items given to the model now includes each cell's row and column (residency,
  gender, full- or part-time, need-based or not). Where those still match, it adds the template's section heading or
  tag. A test keeps every description unique.
- **Very long reports** go to a model with a larger context window instead of being rejected.
- **Aid year:** an aid year marked under a column heading is now read and verified correctly.
