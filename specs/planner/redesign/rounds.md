# Rounds: Started from the Dream, Changed with One Tap

> Status: **built** 2026-10-10 on feature/plan-redesign ([build plan](build-plan.md)). Part 4 of the [planner redesign](README.md). Replaces stage 2's ranking, proposal
> table, binding checklist, and "Use this plan" ([../early-rounds.md](../early-rounds.md)). The rules are drafted in
> `lib/planner/auto-rounds.ts` (tested in `tests/planner-standing.test.mts`); `lib/planner/rounds.ts` keeps the
> facts it already computes (which rounds a college offers, their dates and editions).

## Goal
Every college on the list has a round from the moment it's added, chosen by a short set of rules that start from the
Dream. The student confirms by doing nothing, or changes a round with one tap. The only things the plan says about
rounds are the ones the student must act on: a conflict, a binding round's cost check, and an optional second early
try.

## Starting rounds
`autoRounds(items, schools)`, in order:

1. **The Dream** starts in **ED** if the college offers it; else **REA** if that's its early round; else **EA**; else
   **Rolling** if it admits on a rolling basis; else **RD**.
2. **Every other college** starts in **EA** where offered ("early action is free to use: an earlier answer and no
   commitment"), except at a private college when the Dream is in REA (REA usually rules out other private early
   rounds; public colleges stay in EA). Else **Rolling** where that's how it admits. Else **RD**.
3. **No Dream, no binding round.** Without a Dream nothing starts in ED; a hint under the list says "Mark a Dream if
   one college is your clear first choice; if it has early decision, your plan starts it there."
4. **Applied and decided colleges** keep whatever round they have.
5. **ED II is never started automatically** ([below](#ed-ii)).

Each starting round carries one plain sentence, shown only in the row's drawer, e.g. "Your Dream offers early
decision, so it starts there. ED is binding: check the cost with a parent before you apply."

## Suggested until changed
New column `list_items.round_source: 'auto' | 'student'` (default `'auto'`). While `auto`, `list_items.round` follows
the rules above: recomputed when the Dream moves, a college is added, or a college's rounds change at a publish. The
chip shows ✦. Picking a round from the chip's menu sets `student`; **Use the starting round** in the drawer puts it
back. Tasks and the calendar follow `round` whatever its source, so a starting round already produces its deadline
task and reminder; nothing waits for a "use this plan" click.

Migration: rows with a round become `student`; rows without one become `auto` and get their starting round on the next
plan open. `lists.rounds_plan_accepted_at` is no longer read (left in place, dropped later).

## The round chip
A small menu on each row with the rounds the college offers, plus any it hasn't ruled out when its record is
incomplete (`roundsOffered().pickable`, built). Each option shows its short name and date ("EA · Nov 1"). Rounds the
college says it doesn't offer aren't listed. A college that has published nothing about its rounds offers RD and
Rolling and says "the college hasn't published its rounds" in the drawer.

## Problems
`roundProblems()` returns one plain sentence per conflict, shown in an amber box above the list only while it's true:
- Two EDs: "Early decision is binding, so it can go to only one college. Pick one of A and B."
- Two ED IIs, two REAs: the same shape.
- ED with REA: "Restrictive early action at A can't be combined with early decision at B."
- A round the college doesn't offer (after a data publish): "A doesn't offer that round. Pick another."

The built `conflicts()` stays for the amber cases it also catches (REA with a private college's EA, ED II before the
ED I decision); those become the same kind of sentence. No severity colors, no icons beyond the box.

## ED II
`edTwoSuggestion()`: when the Dream starts in ED or REA, no college is in ED II yet, and another college on the list
offers ED II, one line under the list offers it: "A second early shot, if you want one: Vassar has an ED II round
(due Jan 1), after your Dream answers. It's binding too. **Use ED II there**." The button sets that row's round to
ED II (as the student's choice). In mid-December, if the student records a deferral or denial from the Dream, the
same line comes back in the Next-up card's place for a week ("Wake Forest said no. ED II at Vassar is due Jan 1").

## Money
ED and ED II are binding and the only release is aid that makes attending impossible, so before either:
- A **parent task**, "Check the cost of Wake Forest together before applying ED", due 21 days before the deadline,
  assigned to `guardian`, generated whenever a row is in ED or ED II (a new generator kind, `cost_check`, keyed by
  item and round so moving the round moves or removes the task). It links the college's net price calculator
  (`links.price_calculator`, built) and, once [net-price-estimator.md](../../product/net-price-estimator.md) exists, the family's
  own estimate.
- On the calendar it's a money marker in the parent's lane ([calendar.md](calendar.md#lanes)).
- The student's row says nothing about money beyond the drawer's one sentence; the old three-question checklist and
  the money column are gone.

## What's removed
`PriorityList`, `proposeRounds()` and its six rules as UI, `RoundsTable`, `bindingChecklist()` and its questions,
`acceptRoundsPlan`, the early-advantage multiple, "share of the class filled early", the interest column, the
standing column, and the money column. The advantage and class-filled-early measures stay on the college's profile
([early-decision-strategy.md](../../product/early-decision-strategy.md)) and are linked from the drawer as "How early
rounds work at Wake Forest".

## Rules
- The site never starts a college in a binding round except the Dream, and never ED II.
- No sentence recommends applying early anywhere; the reasons describe the round ("an earlier answer and no
  commitment"), not the college's odds.
- Dates follow the student's cycle; a date from an earlier cycle's edition says so (built `lastCycleNote`).
- Telemetry: `plan_round_changed {from_auto, round}`, `plan_ed2_offer_used`, `plan_round_problem_shown {kind}`.

## Files (planned)
`lib/planner/auto-rounds.ts` (drafted), its tests; the `cost_check` generator in `lib/planner/generators/rounds.ts`;
`round_source` in the redesign migration; the round chip in `components/planner/PlanRow.tsx`; delete the stage 2
components listed in [list.md](list.md#files-planned) and the proposal/checklist exports from `rounds.ts` once
nothing imports them.
