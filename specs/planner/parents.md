# Parents: Visibility and a Way to Help Without Nagging

> Status: **planned** 2026-10-07. After [model.md](model.md) and [timeline.md](timeline.md); the summary line ships
> with the model. Builds on the household's grants ([accounts.md](../product/accounts.md#privacy-model),
> [household-hub.md](../product/household-hub.md)). Part of the [planner](README.md).

## Goal
The owner's brief: *all along the way, give parents visibility and tools to see how the kids are tracking and help
push them along.* Parents are a quarter of the people stressed about applications (Princeton Review 2025) and the
ones paying, filing the FAFSA, and driving to visits. What a parent needs is not another dashboard but three things:
to see where things stand without asking, a way to help that doesn't turn into nagging, and their own part of the
work in one place. Everything here is a view over the stages with the household's existing rules; nothing is a
second copy of the plan.

## What a parent sees
Under the built grants a guardian reads a student's list, numbers, and now the plan; edits when `can_edit`; every
read of a student's data is logged and visible to the student ([accounts.md](../product/accounts.md#privacy-model)).
The planner adds nothing to those grants and keeps the lines:

| A parent sees | A parent never sees |
|---|---|
| The list, Dream, categories and suggestions, the rounds plan, tasks and ticks, visits and their notes, applications' statuses, decisions, offers | Private list notes; the student's hooks; another guardian's finances or unshared estimate; the content of a nudge another guardian sent |
| The summary line and the weekly summary email | Anything about another household's student |
| Their own tasks and the nudges they sent | A grade, score, or "behind" label the site would have made up |

## The summary line
On the household page, under each student's chip and at the top of their page, one line, computed by
`summaryLine()` (pure, tested):
> **Alex** · Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I) · Dream: Michigan

Stage, the stage's count, the next dated task, and the Dream if set. Never a score, a standing, or a count of
overdue tasks presented as a failing ("2 overdue" appears only inside the plan, in the same style as for the
student). For a junior: "Building the list · 6 colleges · 1 visit planned".

## The same plan
The Plan tab on the student's page, as the guardian's own session renders it: the guardian banner ("Viewing as a
guardian"), read-only without `can_edit`, with the additions a guardian gets anywhere:
- A **nudge** button on any open task (below).
- **"Your part"** chips on the tasks assigned to a guardian, with a link to their own page.
- **Suggest a college** on the list stage ([list-building.md](list-building.md#finding-colleges-to-add)).
- **Log a visit** on the actions stage (a parent usually books and drives).
- The **money column** in the rounds stage shows that guardian's own estimate and whether it's shared with the
  student, with "Share" right there ([net-price-estimator.md](../product/net-price-estimator.md)).

Two guardians in a household see the same plan; their own tasks and nudges are theirs.

## Nudges
A nudge is the parent's "hey" delivered by the site instead of across the kitchen table, so the student gets it
when they open the plan or their email, attached to the task it's about.
- One line, optional ("Dad: the Michigan essay is the one I'd do first"), on one task. Sent by email to the
  student's account address, by text when the student has texts on ([timeline.md](timeline.md#texts)), and shown
  on the task in the student's plan as "Nudged by Dad, Tue".
- **Rate-limited by design**: one nudge per task per three days, and at most three a week per student from one
  guardian; the button says "Nudged Tuesday" and greys out. The limit is the feature: a parent can't flood, and the
  student knows a nudge means something.
- The student can **answer** with a tick (which the parent sees as done), a snooze with a date ("Saturday"), or a
  one-line reply shown to the parent on the task. No thread; a reply closes the nudge.
- Nudges are logged (`plan_nudges`) and exportable with the account; they never carry a personal number, and a
  managed student without an account ([household-hub.md](../product/household-hub.md)) can't be nudged (there's
  nobody to deliver to; the button says so).

The research the limit rests on: Castleman and Page's texts worked because they were few, concrete, and dated, and
adding parents as a second channel for the same messages added nothing measurable
([README.md](README.md#research-2026-10-07)). The site reminds; the parent nudges; they are different things and
the student can tell them apart.

## The parent's tasks
A guardian's own page gains a **Your part** section (above their own list): every task assigned `guardian` or
`either` across the students they can see, grouped by student, with the same ticks, dates, and ⓘ: the FAFSA and CSS
Profile and their college priority dates, fees they've said they'll pay, the enrollment and housing deposits once a
choice is made, visits they're booking, and anything the family added with a parent assignee. The weekly summary
email leads with these. A guardian can reassign a task to the student or to "either", and the student can reassign
back; the change is attributed.

## Stuck signals
Shown to the guardian inside the plan (and to the student, in the same words), each a fact with a link, never a
judgment, and each only when true:
- A task overdue by 7+ days ("Michigan's supplement was due Nov 1").
- No activity on the plan for 14 days during the season (August to May).
- No Likely on the list as of September of senior year.
- An ED choice with no estimate shared ("ED is binding; share an estimate or run the calculator").
- A wait list with no deposit elsewhere by April 20.
- A decision expected date that has passed with no outcome recorded.
Signals stay off for juniors except the Likely one in spring.

## The weekly summary
One email on Sunday evening to each guardian who turns it on (off by default; suggested once when the season
starts), per student they can see: the summary line, Your part (at most five), the stuck signals, and what the
student ticked this week (titles only), with one link to the plan. No notes, no numbers, no other household member's
content. Renders with the digest's components; one-click unsubscribe; sent by the same daily job as the digest. A
guardian with texts on ([timeline.md](timeline.md#texts)) can also get the week's Your part as one text.

## Several students, and the dossier
Everything here covers every student the guardian can see, in one view: the household page lists each student's
summary line, Your part merges across them, and the weekly email covers all. The family dossier
([offers.md](offers.md#display)) is the printed version for a family meeting or a counselor.

## Display
- **Household page**: the summary line under each student's chip; **Your part** on the guardian's own page.
- **Student's Plan tab, as a guardian**: the banner, nudge buttons, Your part chips, stuck signals in a quiet panel
  above This week.
- **Student's view**: nudges appear on tasks with the sender's first name; a "Dad nudged you" line in This week.
- **Phones**: the nudge composer is a bottom sheet with the task's title and one field; Your part is a list.
- **Glossary**: `nudge`, `your-part`.

## Rules
- A guardian's visibility is exactly the household grant; the planner never widens it.
- No comparison between students in a household ("Jordan is ahead of Alex") anywhere, including the email.
- Nudges are between one guardian and one student; another guardian sees that a nudge was sent, not its text.
- A student can turn off nudges by email (not in-app ones) on the account page; the guardian sees "Alex reads nudges
  in the plan" on the button.
- Everything here is readable by the student about themselves: the nudges they got, the signals, the email their
  parent receives (a "What your parents see" link on their Plan tab renders it).

## Files (planned)
`lib/planner/summary.ts` (pure: `summaryLine`, `stuckSignals`, `yourPart`), `components/planner/NudgeButton.tsx`,
`YourPart.tsx`, `StuckSignals.tsx`, `WhatParentsSee.tsx`, `emails/parent-summary.tsx`, the nudge Server Actions with
the rate limit in SQL (a check against `plan_nudges`), `tests/planner-parents.test.mts` (the summary line per
stage; each signal on and off; the rate limit; the email has titles only; a managed student can't be nudged).

## Open questions
1. Should a student be able to hide the Dream from parents? The list is visible under the grant and the Dream is a
   list field; recommendation: no special case; the student can simply not set it.
2. Should nudges exist for counselors ([counselor-portal.md](../product/counselor-portal.md))? Same mechanism, the
   portal's grant; recommendation: yes when the portal is built, with the same limits.
