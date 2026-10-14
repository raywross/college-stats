---
title: "Plans: the plan will drive the work, season by season"
pr: 159
date: 2026-10-14
kind: plans
summary: Seven planned specs for a Next steps tab that tells a family what to do this season by graduation year, flags good early-decision opportunities and where showing interest counts, keeps the list in shape, and brings people back with a brief when the season turns.
---

## What's new

Nothing on the site changes yet; these are plans. They describe how the plan will stop waiting to be read and start
leading:

- **Next steps, first.** The plan will open to this season's three to six things to do, each with the reason and one
  button, for the student and separately for a parent. A sophomore sees "try things, plan next year's courses"; a
  junior in March sees "ask two teachers before summer, visit over spring break, get the list to shape"; a senior in
  December sees "record what Michigan said". What shows comes from the student's graduation year, not the day they
  signed up, so nobody starts with a backlog.
- **Good ED opportunities.** On at most three colleges on the list, a flag where applying in a binding early round
  would move the college up a level for that student, by the college's own published numbers: the Dream first, then
  the colleges nearest the line between Reach and Target. Tapping it shows the facts, the caveats (early pools include
  recruited athletes and legacies), the cost question, and a button that sets the round. The plan never says "apply".
- **Visits and interest where they count.** A visit suggested at every ED candidate, and one act of interest at the
  colleges that say interest matters, in the order that matters: a visit, then contact or an information session,
  then a follow.
- **A list with a shape.** For seniors, 12 to 15 colleges with at least two Likelies and two Safes, one of them
  affordable; for juniors, a longer list to visit and cut. One gap at a time, with colleges at the missing level one tap
  from the list.
- **Applying, decision by decision.** Mark each college applied, record each answer, act on a deferral, compare the
  offers, decide by May 1, and tell Quad where you landed.
- **Briefs that bring you back.** One email when the season turns, the week's moves in the Sunday email and the
  parent's summary, a text the day before a hard date, and a dot on Plan when something new is waiting.
- **Your story.** Three short private prompts in junior year that start the narrative before anyone writes an essay.

## Behind the scenes

The specs sit in `specs/planner/next-steps/` and on the roadmap as the group "Next steps". They came from research into
how college advisors run the process grade by grade (College Board, NACAC, the Common App's own season reports, IECA's
standards, a dozen counseling firms' timelines) and into the evidence on early decision and demonstrated interest. The
design adds no new engine: the planner's task generator, reminders and parent summary all exist and run today, and the
estimate already returns the early-decision verdict and the ordering the pills need. What's new is the surface, a
season rule, and three rule sets. The early-decision flag will show only where a college has published its early-round
counts, which is a minority of colleges today and grows with each data release.
