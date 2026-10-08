---
title: A plan for the planner
pr: 97
date: 2026-10-07
kind: plans
summary: A plan for a Plan tab on every student's page that walks a family from the first list of colleges to the deposit, with a parent's view the whole way.
---

## What's planned

Today the site tells you about any college. The planner is for the eighteen months of work between "we should start
looking" and "the deposit is paid". It will live as a **Plan** tab beside a student's list and numbers and walk six
stages:

1. **The list.** Beside each college, the site's suggested Reach, Target, or Likely with the reason shown, and your
   own choice kept. One college can be your **Dream**. Sort by your order, the next date, cost, distance, or where
   your numbers stand.
2. **Priorities and early rounds.** Rank the list, then see which early rounds each college offers and when, what
   applying early did for last year's applicants (with the caveats), where two choices conflict, and what a binding
   offer would cost your family. The site proposes a plan; you edit it. It never says "apply early here".
3. **Actions.** Follow a college's admissions office in one click where the network allows it (X, YouTube) and one
   tap elsewhere, request information, and keep a visit log with prompts so your notes are useful in April. Each
   college's panel says whether it counts your interest, from its own Common Data Set.
4. **The timeline.** Every dated task, generated from the college's published dates and the cycle's shared dates
   (the FAFSA opens October 1, early rounds close in November, the reply date is May 1), with an owner: students get
   the essays, parents get the FAFSA and the deposits. By month or by college, in your calendar, in a Sunday email,
   and by text if you turn texts on.
5. **Applications.** What each college requires (fee and waiver, test policy, aid forms), what's submitted and
   complete, the portal link, and the follow-ups a deferral or a wait list creates.
6. **Decisions and offers.** Record each decision in a tap, enter aid offers in the federal College Financing Plan
   layout with four-year totals beside your family's estimate and the college's outcomes, compare the colleges that
   said yes, choose, and get the deposit and withdrawal tasks that choice creates, then the summer list.

**Parents** see a one-line summary per student, the same plan read-only, their own tasks in one place, and a weekly
email; they can nudge the student about one task at a time, and the nudge is rate-limited by design so it can't
turn into nagging. Parents never see private notes, and nothing anywhere is a grade.

Decisions from the owner's review: no commercial model in the plan yet (that comes once it's built), text messages
are in, no photos on visits, and aid offers start as a form that asks families whether they'd share the letter so a
reader can be built later.

## Behind the scenes

The specs are in `specs/planner/` and on the roadmap under a new first group, [The planner](/roadmap/planner): the
shared model (tables around the existing list, stages computed from the list's own facts, tasks with keys so a data
publish moves a date without losing a tick, a citation on every date), then one spec per stage and one for parents.
Two earlier specs moved in: the application plan of 2026-10-06 became the timeline, and the award-letter analyzer
became the decisions-and-offers stage. The "Accounts and households" group is gone from the roadmap, its last spec
having moved here.
