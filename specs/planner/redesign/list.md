# The List Is the Plan: One Row per College

> Status: **planned** 2026-10-09. Part 3 of the [planner redesign](README.md). Replaces the Colleges side of stage 1
> ([../list-building.md](../list-building.md)) and the Rounds stage's table ([../early-rounds.md](../early-rounds.md))
> with one list. After [standing.md](standing.md); rounds come from [rounds.md](rounds.md).

## Goal
A student looks at one list and knows where they stand and what they're doing at each college: is it the Dream, is
it a Reach, Target, or Likely, which round, and when it's due. Nothing else is on the row. It should read in five
seconds and never stress anyone out.

## The row
```
 ♥  [crest] Wake Forest University      [✦ Reach]  [● ED I ✦ ▾]   Nov 15 ⓘ   (i)
    Dream
```
| Part | What it is | Tap |
|---|---|---|
| Heart | The Dream (one per list, built) | Mark or unmark; moving it re-starts rounds ([rounds.md](rounds.md)) |
| College | Crest and name, linked to the profile | Profile |
| Group chip | Reach / Target / Likely, ✦ while it's the suggestion | Cycles the group; becomes the student's ([standing.md](standing.md#suggested-until-changed)) |
| Round chip | The round's color dot, its short name (ED I, ED II, EA, REA, RD, Rolling), ✦ while it's the starting round | A menu of the rounds the college offers (or hasn't ruled out) |
| Deadline | The chosen round's closing date with ⓘ citing its edition; struck through once past; "no date on record" otherwise | The citation |
| (i) | Opens the row's drawer | |

**Group colors** are calm and never alarming: Reach violet, Target sky, Likely emerald (tinted backgrounds, dark
text), so a Reach doesn't look like a warning. **Round colors** match the calendar ([calendar.md](calendar.md#colors)).

Once the season starts (the first deadline is within 30 days, or any college is past "considering"), a **status
chip** joins the row: Not started → Working on it → Submitted → Decision (built `status`/`outcome` values,
relabeled), replacing the Apply stage.

## The drawer
Opened by (i), inline under the row (no modal), each line only when it has content:
1. **Group**: the reasons from the model, or "You picked this group" with **Use the suggestion**.
2. **Round**: the one-line reason for the starting round ([rounds.md](rounds.md#starting-rounds)), or "You picked
   this round" with **Use the starting round**; the expected decision date.
3. **Score**: "A 1420 would make this a Target" when [scores.md](scores.md) has a move for it; "Optional here:
   consider not sending" where that applies.
4. **Show interest** (was the Actions stage): follow, request information, log a visit, each with the built
   one-tap behavior; shown only where the college considers interest (CDS C7), with that sentence, and collapsed
   behind "Show interest (optional)" otherwise.
5. **Requirements** (was the Apply stage): fee and waiver, test policy, aid forms, platform; once the season starts.
6. **Notes** (built).

## Around the list
- **Header line**: "8 colleges · 2 Reach · 4 Target · 2 Likely", and "✦ = sorted for you; tap to change" while
  anything is still a suggestion.
- **Order**: Dream first, then Reach, Target, Likely, then the student's own order within each group. The sort menu
  from stage 1 (distance, cost, deadline) stays behind a small "Sort" control; ranking is gone.
- **Balance line**, only when it's off, one sentence under the list: "Counselors suggest at least two Likely colleges
  you'd be happy to attend." (fewer than 2 Likely), "Most students apply to 6 to 12" (outside that), "A Target or two
  would balance the Reaches" (Reach is more than half). Never red; never more than one line.
- **Conflict box**, only when there's a conflict ([rounds.md](rounds.md#problems)): amber, one sentence each, above
  the list.
- **ED II line**, only when [rounds.md](rounds.md#ed-ii) offers one: "A second early shot, if you want one: Vassar
  has an ED II round (due Jan 1), after your Dream answers. It's binding too. **Use ED II there**."
- **Retake card**, only when [scores.md](scores.md) has a suggestion: "30 more SAT points would move Wake Forest up to
  Target. See which ones and the next test dates →" (opens the Scores tab).
- **Add a college**: the search box at the bottom; a new college arrives with its group and round already filled.

At most three of these appear at once, in that order; the rest wait until the earlier ones are handled.

## Phones
Each row is two lines: heart, crest, name on the first; group chip, round chip, deadline, (i) on the second. Touch
targets are 44px (the chips' hit areas extend past their visible 32px height). The drawer opens below the row.

## What's removed
- `PriorityList` (the ranking) and its section on the Rounds stage; `setPriority`; the "Ordered by your Dream, then
  category, until you rank the list" note. `list_items.priority` is left in place and unused, then dropped once no
  release reads it.
- "Suggested: Target" as a second chip beside the student's chip.
- Admit rate, cost, and distance on the row (cost and distance stay as sort options and on the profile).

## Rules
- Guardians see the same list and, with edit access, the same taps; the hub's guardian banner stays.
- The list row and the calendar read the same round and deadline; there is no second copy.
- Telemetry: `plan_dream_set`, `plan_group_changed {from_auto}`, `plan_round_changed {from_auto, round}`,
  `plan_drawer_opened`.

## Files (planned)
`components/planner/PlanList.tsx`, `PlanRow.tsx`, `RowDrawer.tsx` (absorbs `row/*` and the Actions and Apply stage
panels' controls); delete `stages/PriorityList.tsx`, `stages/RoundsTable.tsx`, `stages/RoundsStage.tsx`,
`stages/ListStage*.tsx` after the move; `lib/planner/suggest.ts` keeps sorting and the balance lines, loses
`suggestCategory` (replaced by `standingFor`); tests for the order and the "at most three notices" rule.
