---
title: "College data agent: fixes from reading its first real documents"
pr: 65
date: 2026-10-04
kind: fix
summary: "The agent read four colleges' Common Data Sets end to end for the first time; its own checks then caught how it misread small percentages and a few other details, which are now fixed before anything was published."
---

## What's new

Nothing changes on the site yet. The agent read full Common Data Sets for four new colleges (Florida, UNC Chapel Hill,
Michigan State, and Houston) for about six cents a college. Its checks flagged hundreds of figures, and nearly all of
the trouble was the agent's, not the colleges'. Nothing it flagged was published. Those mistakes are fixed now, so the
next run can publish what passes.

## Behind the scenes

- **Small percentages:** a printed "0.5" (meaning 0.5%) was read as 50%, so score-band columns added up to as much
  as 199%. Printed percents are now always read as points.
- **Aid year:** an aid year written without "final" or "estimated" ("2025-26") is now accepted. Before, it failed
  every aid figure.
- **Split digits:** figures the PDF printer split ("1,2 74") are found on their cited line, and a footnoted check mark
  ("X*") counts.
- **Finding documents:** when the cheapest search step finds only an admissions page, the agent keeps looking for a
  Common Data Set before settling.
- **The data pull request** stays under GitHub's size limit even when many figures are flagged.
