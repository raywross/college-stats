---
title: "A junior's deadlines land in the right year"
pr: 186
date: 2026-10-29
kind: fix
summary: A junior's plan showed this fall's application deadlines, the current seniors' dates, as their own next steps; the Common App dates now land in the student's own cycle, and no application step shows before senior fall.
---

## What's new

A junior opening Next steps this week saw three "Apply" cards, due in a few days. Those were the current seniors'
deadlines: the Common App's Requirements Grid publishes dates for one cycle (ED on November 1, 2026), and the plan used
them as printed for every student, whatever year they apply. Three fixes:

- **The dates land in the student's own cycle.** A junior reading this year's grid gets November 1, 2027; a sophomore,
  2028. The college's own published dates already worked this way, so the two sources now agree. The date still says
  "last cycle; confirm on the college's page" when the grid is older than the student's cycle.
- **No application step shows before senior fall.** Applying, the fee, transcripts, and the rest belong to senior year.
  A junior's Next steps never lists one, even if a date were wrong again.
- **The list's Deadline column agrees with the plan.** When the plan knows the student's cycle, the list shows the same
  dates the plan's apply step carries.

A plan's dates refresh the next time it opens, so an affected junior's cards correct themselves on their next visit.

## Behind the scenes

`gridDateInCycle` (lib/list-rules.ts) moves a grid date forward by the gap between the grid's cycle and the student's,
keeping the month and day; the three grid readers (`deadlineFor`, `roundDates`, and the college generator's
`applyDate`) all go through it. `eligibleNow` (lib/planner/moves.ts) now refuses any piece of an application before
senior fall, the same rule `beforeApplications` already applied to undated pieces. The list board passes the plan's
`cycleStartYear` to `deadlineFor` when it has one. Tests cover the year shift (including a February 29), each reader,
and the gate for a junior, a senior, and the summer before senior year.
