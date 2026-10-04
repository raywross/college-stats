# Worst Plausible Spring: A Stress Test for the List, Not a Grade

> Status: **idea** (2026-10-03). After [saved-lists.md](../product/saved-lists.md); better with
> [chances-and-fit.md](../product/chances-and-fit.md) and [net-price-estimator.md](../product/net-price-estimator.md).
> Part of [ideas](README.md).

## Question it answers
*If every Reach says no, what are we left with, and can we afford it?* It is the question families lie awake over in
December. Counselors answer it by hand ("do you have two Likelies you'd be happy at and can pay for?"). College
Kickstart answers it with a letter grade for the list, which its own customers say disagrees with their outcomes.

## Why it's fresh
A stress test, the way a planner tests a retirement plan against a bad year: show what would be true in spring under a
pessimistic case rather than scoring the list. Nothing is graded. The panel lists what each scenario leaves the family
with and what is missing, as facts with their figures. The scenarios use the student's own categories, which the
[saved list](../product/saved-lists.md) keeps as the student's choice with the site's suggestion beside it.

## Scenarios
From the list's rows: category, standing when the profile has numbers, deadlines, the cost figures, the family's price
range when a guardian has run the estimator, the intended major's program size from majors, and distance once
[near-and-far.md](near-and-far.md) exists.

| Scenario | Colleges counted | Reads as |
|---|---|---|
| Only the Likelies | category Likely (the site's standing when the student hasn't chosen one) | "If nothing else comes through" |
| Likelies and Targets | plus Target | "A normal spring" |
| Everything | all | "The best case" |

For each scenario the panel states, with the figures cited:
- how many colleges, and whether at least two are Likely (the usual counselor floor);
- the **cheapest estimated price** among them (the family's range when available, else average paid for the family's
  income band, else average paid), and whether any is under the family's "can pay" line;
- whether any offers the intended major with a meaningful program (25 or more graduates a year);
- the nearest one, when distances exist;
- the earliest deadline among them, and whether the Likelies' deadlines fall **before** early-round results arrive
  (a student with early good news could then skip them);
- the gaps, as sentences: "No Likely under $25,000 a year." "No Likely with nursing." "Both Likelies are more than
  eight hours away."

Each gap links to the Explore query or [guide](guides.md) that would fill it ("Likelies under $25K with nursing within
six hours"), and to [would-compete-for-you.md](would-compete-for-you.md) when the student has numbers. The panel never
names a college to add.

## Display
- `/me/list`: a "Stress test" panel under the balance line; three columns on desktop, a segmented control on phones.
- The family dossier (Pro): the same table on one page.
- The counselor view ([counselor-portal.md](../product/counselor-portal.md)): the caseload alert "3 students have no
  Likely under budget" comes from the same function.

## Rules
- No score, no grade, no color that reads as a verdict. Gaps are sentences with numbers.
- The student's category wins in the scenarios; the panel says when the site's standing differs ("You've marked Emory
  as Target; the site's standing says Reach because its admit rate is 11%").
- Price figures carry the same confidence words and sources as the estimator.
- Nothing here is stored; the panel is computed from the list on view.

## Tier
Free with the list when it uses the student's own categories and public figures. The family price range appears when
the guardian has run the estimator (the whole list with Pro).

## Complexity
Small: one pure function over the list's rows (`lib/stress-test.ts`, tested with a fixture list) and a panel.

## Open questions
1. Count all Targets in "a normal spring", or half? All, and label it; a fourth scenario would be false precision.
2. In spring, entered outcomes (denied, waitlisted) move a college out of every scenario; the panel then reads as
   "what you have", which is the same function with real data.
