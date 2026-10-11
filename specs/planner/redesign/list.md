# The List Is the Plan: One Row per College

> Status: **built** 2026-10-11 on feature/plan-intake-redesign-list (U3 of the [intake + simplified-plan
> redesign](README.md), after [the first list build](build-plan.md)). Groups are Quad's only now (owner,
> 2026-10-11): no group chip, no "Use the suggestion", no sort menu. Rounds come from [rounds.md](rounds.md).

## Goal
A student looks at the list and knows, at a glance, which group each college is in, which round, and when it's due.
Grouped sections replace the per-row group chip; nothing else is on the row. It should read in five seconds and
never stress anyone out.

## Grouped by Reach / Target / Likely
The list is split into sections, in this order, empty ones left out: **Reach**, **Target**, **Likely**, then **Not
sorted yet** (`unsorted` — no GPA or score yet, or the college isn't in the dataset). Each section starts with a
pill heading, calm and never alarming (Reach violet, Target sky, Likely emerald, tinted backgrounds with dark text;
"Not sorted yet" muted), with the section's count: "Reach · 3". The Dream, if it has one, is already first within
its own section (`plan-view.ts`'s row order puts it first overall, and a group section keeps that order). There is
no group chip on the row, no cycling it, and no "✦ = sorted for you" line — the group is always Quad's own, so
there's nothing to mark as a suggestion.

## The row
```
 ♥  [crest] Wake Forest University      [● ED I ✦ ▾]   Nov 15 ⓘ   Working on it   (i)
    Dream
```
| Part | What it is | Tap |
|---|---|---|
| Heart | The Dream (one per list) | Mark or unmark; moving it re-starts rounds ([rounds.md](rounds.md)) |
| College | Crest and name, linked to the profile | Profile |
| Round chip | The round's color dot, its short name (ED I, ED II, EA, REA, RD, Rolling), ✦ while it's the starting round | A menu of the rounds the college offers (or hasn't ruled out) |
| Deadline | The chosen round's closing date with ⓘ citing its edition; bold within 7 days, struck through once past, "no date on record" otherwise | The citation |
| Status (desktop only) | Not started / Working on it / Submitted / Decision, once the season starts | |
| (i) | Opens the row's drawer | |

**Round colors** match the calendar ([calendar.md](calendar.md#colors)).

Once the season starts (the first deadline is within 30 days, or any college is past "considering"), the **Status**
column fills in (desktop; `lib/planner/list-row.ts` `SEASON_STATUS_LABEL`), replacing the Apply stage.

### Underclassmen (decision 12)
A student who hasn't reached senior year (`ctx.grade`; `lib/planner/list-row.ts` `roundsPicked`) hasn't picked
rounds yet, so the round chip, deadline, and status are replaced by one line: **"Round picked senior year."** The
group section and its heading still show — the model sorts a college into Reach/Target/Likely as soon as it has
enough to go on, independent of the student's grade.

## The drawer
Opened by (i), inline under the row (no modal), each line only when it has content:
1. **Group**: the model's reasons (there's no "You picked this group" anymore — groups are never student-picked).
2. **Round**: the one-line reason for the starting round ([rounds.md](rounds.md#starting-rounds)), or "You picked
   this round" with **Use the starting round**; the expected decision date.
3. **Score**: "A 1420 would make this a Target" when [scores.md](scores.md) has a move for it; "Optional here:
   consider not sending" where that applies.
4. **Show interest** (was the Actions stage): follow, request information, log a visit, each with the built
   one-tap behavior; shown only where the college considers interest (CDS C7), with that sentence, and collapsed
   behind "Show interest (optional)" otherwise.
5. **Requirements** (was the Apply stage): fee and waiver, test policy, aid forms, platform; once the season starts.
6. **Notes** (built).
7. **Remove from the list** (moved here from the row's ×, 2026-10-11): asks first, because the college's notes,
   visits, tasks, and offer are deleted with it. Telemetry `plan_college_removed {dream}`.

## Around the list
- **PlanNotice**: at most one notice at a time (`view.notices[0]` — a conflict, the ED II offer, the balance line,
  or the retake card; `components/planner/PlanNotice.tsx`, wrapping `ListNotices`' content and actions for just
  that one kind). The list shows it at the top, phones only (`lg:hidden`); the desktop plan puts it in the right
  column instead (U5's aside composition), so it never shows twice.
- **Header line** (desktop only): "8 colleges", plus "✦ suggested round" (`anySuggestedRound`) while any row's
  round is still the starting one, and the column labels Round / Deadline / Status. Phones have no header row —
  straight into the first group's heading.
- **A child who hasn't joined**: a guardian opening an empty list for a student record no account has claimed (the
  child was added from Household and hasn't accepted the invitation) is told why it's empty: colleges the child
  saves on their own account stay on that account's list until they accept, and the invitation is sent from
  Household.
- **Order**: within each group section, the Dream first, then the student's own order. No sort menu (dropped with
  the group chip; distance and cost stay as profile facts, not a list control).
- **Balance line**, only when it's off, one sentence under the header: "Counselors suggest at least two Likely
  colleges you'd be happy to attend." (fewer than 2 Likely), "Most students apply to 6 to 12" (outside that), "A
  Target or two would balance the Reaches" (Reach is more than half).
- **Add a college**: a collapsed "+ Add a college" pill (guardian viewing a child: "+ Add a college for {First}")
  below the list, `id="add-college"` so the intake's Done screen and the numbers line's edit link can jump straight
  to it; tapping it expands into the existing search box. A new college arrives with its group and round already
  filled.

## Phones
Each row is two lines: heart, crest, name on the first; round chip, deadline, (i) on the second (or "Round picked
senior year" in place of the chip and deadline, decision 12). Touch targets are 44px. The drawer opens below the
row.

## What's removed
- The group chip (`GroupChip.tsx`, deleted) and its cycle (`nextGroup`, removed from `list-row.ts`); "Use the
  suggestion"; "✦ = sorted for you" (groups are never a suggestion to override).
- The sort menu (`sortRows`, `ROW_SORT_OPTIONS`, `RowSort`, removed from `list-row.ts`) — nothing in the redesign
  shows it, so it's gone rather than hidden.
- The row's own × (moved into the drawer as "Remove from the list").
- `PriorityList` (the ranking) and its section on the Rounds stage; `setPriority`; the "Ordered by your Dream, then
  category, until you rank the list" note. `list_items.priority` is left in place and unused, then dropped once no
  release reads it.
- Admit rate, cost, and distance on the row (they stay on the profile).

## Rules
- Guardians see the same list and, with edit access, the same taps; the hub's guardian banner stays.
- The list row and the calendar read the same round and deadline; there is no second copy.
- Telemetry: `plan_dream_set`, `plan_round_changed {from_auto, round}`, `plan_drawer_opened`,
  `plan_college_removed {dream}`.

## Files
`components/planner/PlanList.tsx`, `PlanRow.tsx`, `RowDrawer.tsx` (absorbs `row/*` and the Actions and Apply stage
panels' controls), `ListNotices.tsx` (one notice's content, used by `PlanNotice.tsx`); `lib/planner/list-row.ts`
(`groupedRows`, `GROUP_HEADING`, `headerCountsLine`, `anySuggestedRound`, `roundsPicked`, the round/deadline label
and urgency helpers, `scoreDrawerLine`); `lib/planner/colors.ts` `GROUP_CLASS`. Tests:
`tests/planner-list-view.test.mts`.
