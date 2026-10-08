---
title: "The planner: from the first list to the deposit"
pr: 103
date: 2026-10-08
kind: feature
summary: Every student's page gets a Plan tab that walks the family through six stages, from sorting the first list to reading aid offers and choosing, with dated tasks, a calendar feed, and a parent's view that helps without nagging.
---

## What's new

**A Plan tab for each student.** Open a student from your household and the new Plan tab shows the stage they're in
("Applying · 3 of 8 in"), what's due this week, and the step that matters next. The plan reads the list the student
already has; there is nothing to set up.

**Stage 1, the list.** Beside each college the site shows its own Reach, Target, or Likely suggestion with the
reason, next to the student's choice. Mark one college as the Dream, sort by what matters (deadline, cost, distance,
standing), drag colleges into order, and read a balance line that says what the list is missing.

**Stage 2, who gets the early application.** Each college's rounds and dates sit side by side with last year's
early-round numbers and their caveats. The site proposes a plan, points out conflicts between binding rounds, and
asks the money question before a binding choice. The student edits and accepts; the dates flow into the timeline.

**Stage 3, actions.** Follow a college's admissions office where a network allows it, open its request-information
page, and log visits with notes written for April, each with a calendar file. Colleges that count interest say so.

**Stage 4, the timeline.** Every dated task, from the college's published dates and the cycle's own, with an owner,
by month or by college. Subscribe to it as a calendar feed, get a Sunday "Your week" email, and, for students who
turn them on, a text the evening before a deadline.

**Stage 5, applying.** One checklist per college: the fee and whether a waiver applies, the test policy in plain words,
aid forms, recommendations and supplements, the portal link. Mark what's submitted and complete as you go. A deferral
or a wait list adds the follow-ups it creates.

**Stage 6, decisions and offers.** Record each decision in a tap. Enter every aid offer in one standard layout, see
four-year totals next to the college's cost history and outcomes, compare the admits, and choose. The choice adds the
deposit, withdrawal, and summer tasks. Share a letter with Quad if you like; the question is asked once and you can
take it back. A print view gathers the whole plan for the family.

**For parents.** A one-line summary under each student's name says where they are and what's next, never a score. Any
open task can take a nudge, limited so it can't become nagging. Your own tasks sit in one place on your page, quiet
signals say when a plan is stuck, and an optional weekly email keeps you up to date. Students can see exactly what
their parents see.

## Behind the scenes

The eight specs under [the planner overview](../specs/planner/README.md) describe each stage; each ends with a
"Built" section. The plan's tasks are generated from the college-reported dates and a versioned application-cycle
file, so a date change or a new cycle regenerates them without losing what's been ticked. Loan rates and limits for
the four-year math live in a reference file with a source for every figure. Texts wait for a messaging provider to be
configured, and tiers are not enforced yet.
