# The List Is the Plan: One Row per College

> Status: **built** 2026-10-11 on feature/plan-intake-redesign-list (U3 of the [intake + simplified-plan
> redesign](README.md), after [the first list build](build-plan.md)). Groups are Quad's only now (owner,
> 2026-10-11): no group chip, no "Use the suggestion", no sort menu. Rounds come from [rounds.md](rounds.md).

## Goal
A student looks at the list and knows, at a glance, which group each college is in, which round, and when it's due.
Grouped sections replace the per-row group chip; nothing else is on the row. It should read in five seconds and
never stress anyone out.

## Grouped by Reach / Target / Likely
> **Planned change** ([../../chances/levels.md](../../chances/levels.md), 2026-10-11): five sections, **High reach**,
> **Reach**, **Target**, **Likely**, **Safe**, then Not sorted yet; within a section the Dream first, then closest
> first; the balance line below reworded; the drawer gains an "About you and {College}" line
> ([../../chances/inputs-beyond-academics.md](../../chances/inputs-beyond-academics.md)) and opens with the level's
> meaning and the "applicants like you" lines ([../../chances/pool-explainer.md](../../chances/pool-explainer.md)).

The list is split into sections, in this order, empty ones left out: **Reach**, **Target**, **Likely**, then **Not
sorted yet** (`unsorted` — no GPA or score yet, or the college isn't in the dataset). Each section starts with a
pill heading, calm and never alarming (Reach violet, Target sky, Likely emerald, tinted backgrounds with dark text;
"Not sorted yet" muted), with the section's count: "Reach · 3". The Dream, if it has one, is already first within
its own section (`plan-view.ts`'s row order puts it first overall, and a group section keeps that order). There is
no group chip on the row, no cycling it, and no "✦ = sorted for you" line — the group is always Quad's own, so
there's nothing to mark as a suggestion.

## Simpler planner (owner, 2026-10-12)
The owner's review simplified the list; this section is what's built now, and it replaces "The row" columns and "The
drawer" below where they differ:
- **The row** is the Dream heart, the crest and name, and an expand control (2026-10-12, owner: "It's not really
  'info', it's more of an expand/contract"): "Details" with a chevron (the chevron alone on phones), `aria-expanded`,
  opening the capture panel inline under the row. Inline rather than a sheet: the panel is a handful of one-tap chips
  that belong to that row, the list stays in view around it on a phone and on a desktop, and a second college opens
  without closing the first. When there's something left to capture (`rowToDo`, lib/planner/capture.ts: no visit or
  information request yet; social accounts on record and none followed), the control takes the accent color and a
  small count (1 or 2). Legacy, sibling, and recruiting are answers either way, never a to-do. Round, Deadline, and Status left the row and the
  header ("there for seniors; remove for now, I'll want to tie this into the recommendations in a future PR"); the
  stored round and dates are unchanged and the Calendar (and Offers) still read them. Phones and desktop show the same
  one-line row. The level stays the section heading above the row.
- **The header** shows on every width: "8 colleges" and one link, **How Quad reads your list**
  (`components/planner/ListExplainer.tsx`, a bottom sheet on phones and a centered card from `sm`). Its text has one
  home, `listExplainer()` in `lib/chances/notes.ts`: the five levels and what each means, the order within a level,
  the six selectivity tiers with Ultra selective's stricter bar and the very top colleges' standout, the kinds of
  inputs (grades, weighted GPA, class standing, courses and AP results, tests with a junior's target, activities and
  depth, legacy, recruiting, visits and following), that missing inputs lower confidence, who the student is compared
  with, and never a percentage. Kinds of inputs only; `tests/planner-list-explainer.test.mts` fails on a number, a
  weight, a cutoff, a multiplier, or the odds. Its headings link the glossary's `levels`, `selectivity-tier`, and
  `applicants-like-you`.
- **The capture panel** (the row's (i), `components/planner/RowDrawer.tsx`) replaces the drawer: "information
  overload and the text is out of date… what we're really looking for here is to capture some more information."
  In the intake's chip style (`components/activities/chips.tsx`), 44px targets, 16px inputs on phones:
  1. **Connections** (`AboutYouAndCollege`; owner, 2026-10-12: "not take up a ton of space"): one line of one-tap
     chips, [Parent or grandparent went here] [Sibling went here] [Recruited ▾]. Recruited opens its four picks
     (No · Coach contact · Pre-read · Likely letter) only when tapped, and reads "Recruited · Pre-read" once picked.
     The state-ban sentence shows under it where one applies to a marked legacy or sibling. Sibling stores to
     `list_items.legacy_sibling` (`setItemSibling`); until 20261012130000 is applied it reads as unmarked and its
     write fails with "That didn't work".
  2. (Recruited is the third chip on the Connections line.)
  3. **Visited**: "We visited" logs a campus visit dated today (`plan_visits`, which sets `list_items.visited_on`);
     the date is editable (no later than today); **Visit notes** opens the visit's form (`VisitForm`) in a sheet.
     Tapping it again removes that visit (asking first when it has notes); with more than one past visit logged it
     can't be undone from here. A planned visit shows as "Visit planned for Nov 3".
  4. **Requested info** (back on 2026-10-12, owner): "We requested info" records `list_items.info_requested_on` as
     today, the date editable (no later than today, `markInfoRequested(itemId, on, date)`); tapping again clears it.
  5. **Following on social**: one toggle per account the college has (`school.social`), recording
     `followed_networks`/`follows_social` (`recordFollow`), each beside a link that opens the account to follow it
     (X's follow intent, YouTube's subscribe prompt, else the profile). A follow is the student's own account, so a
     guardian sees each network's state without acting on it (owner: "see that it is followed but not act"): a
     filled "Following" chip or a dashed-outline "Not following" one, not a greyed-out control, plus the link.
  6. **Quick links**: the college's campus visit page, else its virtual tour, else its admissions page
     (`lib/planner/capture.ts` `visitPageLink`).
  7. **Remove from the list** (editors), unchanged.
  Each saved change refreshes the page, so the level reads it: visits, information requests, and follows count as
  demonstrated interest (`lib/planner/hooks.ts`; follows joined on 2026-10-12). The estimate's meaning line, stage
  lines, compared-with panel, reasons, and "What went into this estimate" left the plan (the college profile's
  standing card and Compare still show them), and so did the round line, score line, Show interest, Requirements,
  and Notes; their data stays.
- **Scores tab**: dropped ([page.md](page.md)); see [scores.md](scores.md).

## The row
> Superseded on 2026-10-12 by "Simpler planner" above: the round chip, deadline, and status are off the row.

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
> Replaced on 2026-10-12 by the capture panel ("Simpler planner" above). Kept for the record.

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
  Target or two would balance the Reaches" (Reach is more than half). With the five levels
  ([../../chances/levels.md](../../chances/levels.md#where-the-levels-show)): "at least two colleges that are Likely
  or Safe for you" (fewer than 2 of either), "One or two High reaches is fine; three or more crowd out colleges you'd
  get into" (3+ High reach), "A Target or two would balance the Reaches" (Reach + High reach more than half); one
  notice at a time, in that order of priority after a conflict.
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

Simpler planner (2026-10-12): `RowDrawer.tsx` is the capture panel, with `AboutYouAndCollege.tsx`;
`ListExplainer.tsx` and `listExplainer()` in `lib/chances/notes.ts`; `lib/planner/capture.ts` (`visitPageLink`,
`visitedState`, `followTargets`); `lib/planner/hooks.ts` (`hooksFromPlan`, interest now including follows). Tests:
`tests/planner-capture.test.mts`, `tests/planner-list-explainer.test.mts`, `tests/planner-hooks.test.mts`.
