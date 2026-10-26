# Worst Plausible Spring: A Stress Test for the List, Not a Grade

> Status: **idea** (2026-10-03; **rewritten** 2026-10-26 after the roadmap review). The counting half of the first
> draft is built: the plan's **list shape** states the season's target and the gap in one line ("Your list has 3 Reaches,
> 2 Targets, and no Likely yet") and offers colleges at the missing level
> ([../planner/next-steps/list-shape.md](../planner/next-steps/list-shape.md), 2026-10-14;
> [../planner/v3/guides/list-size.md](../planner/v3/guides/list-size.md), 2026-10-16). Levels are five
> ([../chances/levels.md](../chances/levels.md)), the plan sorts the list by Quad's estimate (the student no longer
> picks a category), and the family's cost limit is a record field. What remains is the **scenario** view: what spring
> looks like if the top of the list says no. After the family's price ([../product/net-price-estimator.md](../product/net-price-estimator.md))
> for its cost lines. Part of [ideas](README.md).

## Question it answers
*If every Reach says no, what are we left with, and can we afford it?* The shape says what's missing; this says what
would be true in April. Counselors ask it by hand ("do you have two colleges you'd be happy at and can pay for?").
College Kickstart answers it with a letter grade for the list, which its own customers say disagrees with their
outcomes.

## Why it's fresh
A stress test, the way a planner tests a retirement plan against a bad year: show what each scenario leaves the family
with, as facts with their figures, rather than scoring the list. Nothing is graded. It is the plan's shape read the
other way round: the shape counts what's missing; the stress test names what's left.

## Scenarios
From the plan's rows: Quad's level per college, the cost figures, the family's cost limit or price range when one
exists, the intended major's program size, the distance from home, and the deadlines.

| Scenario | Colleges counted | Reads as |
|---|---|---|
| Only the Safes | level Safe | "If nothing else comes through" |
| Safes and Likelies | plus Likely | "A cautious spring" |
| Through the Targets | plus Target | "A normal spring" |
| Everything | all, Reaches and High reaches too | "The best case" |

For each scenario the panel states, with the figures cited:
- how many colleges, and whether at least two are Likely or Safe (the shape's own floor);
- the **cheapest estimated price** among them (the family's range when available, else the college's curve at the
  household's income ([../product/cost-by-income.md](../product/cost-by-income.md)), else average paid), and whether
  any is under the family's limit;
- whether any offers the intended major with a meaningful program (25 or more graduates a year), and whether any admits
  to that major directly ([getting-into-the-major.md](getting-into-the-major.md));
- the nearest one, with its drive time (built);
- the earliest deadline among them, and whether the Likelies' deadlines fall **before** early-round results arrive, so a
  student with early good news could skip them;
- the gaps, as sentences: "No Safe under $25,000 a year." "No Likely with nursing." "Both Safes are more than eight
  hours away."

Each gap links to the Build your list guide at the missing level with the matching Explore filters ("Likelies under
$25K with nursing within six hours"), the guide's built rail does the rest. The panel never names a college to add.

## Display
- The plan's Colleges tab: a **Stress test** fold under the balance notice (the notice stays one sentence; the fold is
  the four scenarios, a segmented control on phones).
- The parent's plan: the same fold.
- The counselor view ([../product/counselor-portal.md](../product/counselor-portal.md)): the caseload alert "3 students
  have no Safe under budget" from the same function.
- Senior spring: entered outcomes (denied, waitlisted) move a college out of every scenario, so the panel reads as
  "what you have", the same function with real data.

## Rules
- No score, no grade, no color that reads as a verdict. Gaps are sentences with numbers.
- Price figures carry the same words and sources as the cost curve and the family's price (estimate, families like
  yours, never "you will pay").
- Nothing is stored; the panel is computed from the plan on view, with the same `estimateMany` call the list uses.
- Levels come from the estimate's output only; the panel never explains how a level was reached beyond the built
  "what went into it" panel.

## Tier
With the planner, whatever tier the planner takes; the price lines appear when the family's price exists.

## Complexity
Small: one pure function over the plan's rows (`lib/planner/stress-test.ts`, tested with a fixture list) and a fold.

## Open questions
1. Four scenarios or three? Four, because Safe and Likely are different promises now; a fifth would be false precision.
2. Should the fold open by default in senior fall? Measure with the Colleges tab's telemetry after it ships.
