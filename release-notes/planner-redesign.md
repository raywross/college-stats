---
title: "The planner, redesigned: a plan"
pr: 104
date: 2026-10-09
kind: plans
summary: A plan to make the planner simpler and easier to find, with Plan in the main menu, your colleges sorted from your numbers, a coach that says when another test would help, and a color-coded calendar for parents.
---

## What's new

**A plan for a simpler planner.** Students who tried the planner told us it showed too much. One said the
early-rounds step was "stressing me out." The plan for the next version asks for less and does more of the work
for you:

- **Plan moves into the main menu**, next to Explore, and works the same way for students and parents.
- **Your numbers come first.** Enter your GPA and the one test you're taking, and every college on your list is
  sorted into Reach, Target, or Likely for you. Tap a group to change it, and the site keeps your choice.
- **One row per college.** Each row shows your Dream, the group, the round, and the deadline. The reasons are one
  tap away. Ranking your list is gone.
- **Rounds start from your Dream.** If your Dream offers early decision, it starts there. Other colleges use early
  action wherever it's free. You change any round with one tap, and conflicts show up as a single sentence.
- **A scores coach.** It shows where your score stands at each college and whether to send it. It suggests another
  test only when a typical gain would move a college up a group, along with the test dates whose scores arrive in
  time.
- **A family calendar.** Parents get a color-coded timeline of the school year for each child or for everyone:
  deadlines, decisions, test dates, and the money dates that are their part.

The full plan is on the [roadmap](../specs/planner/redesign/README.md).

## Behind the scenes

The rules that sort colleges and start rounds are already written and tested. Both run in the browser, so the list
re-sorts as you type a score. Colleges that report only the other test's range are compared through the official
ACT/SAT concordance. A preview with a made-up family and real college data runs on review copies of the site, not
the live one.
