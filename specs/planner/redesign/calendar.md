# The Family Calendar: Every Child's Year on One Color-Coded Timeline

> Status: **planned** 2026-10-09. Part 6 of the [planner redesign](README.md). After [rounds.md](rounds.md) and
> [page.md](page.md). Replaces the timeline stage's month and college views ([../timeline.md](../timeline.md#display));
> the generated tasks, the cycle file, the calendar feed, reminders, and texts all stay.

## Goal
A parent opens Plan and sees the school year at a glance: every child's applications as colored bars ending in their
deadlines, the decisions after them, test dates, and the money dates that are the parent's part, with today as a
line. One tap switches between children or shows everyone together. It should be the thing a parent screenshots and
sends to the family group chat.

## The view
```
              Aug   Sep   Oct │ Nov   Dec   Jan   Feb   Mar   Apr   May   Jun   Jul
● Maya · class of 2027        │
  SAT dates                   ▲ │   ▲     ▲
  Essays & recs   [supplements ]│[portal checks ················]
  Money                $  $    │       $                              $
  Univ. of Georgia   [EA ▬▬▬▬◆┄┄○
  Wake Forest (Dream)     [ED I ▬▬▬◆
  Vassar                        │      [RD ▬▬▬◆┄┄┄┄┄┄┄┄┄┄○
● Theo · class of 2028        │
  ACT dates                     │ ▲     ▲          ▲     ▲          ▲   ▲
  Essays & recs                 │                        [ask recs ]  [essay draft
  Applications                  │ 8 colleges; deadlines start next school year
```
- **Range**: the school year, August 1 to July 31 (applications open August 1), with month gridlines and a "today"
  line. Arrows step to the previous or next year; a junior's view shows next year's deadlines one step ahead.
- **Who**: the child switcher ([page.md](page.md#the-child-switcher-parents)). **Everyone** stacks each child's lanes
  under a header row with their color dot; one child shows only theirs. A student sees only their own.
- **Color by**: with Everyone, a toggle **Color by child** (default: every mark in that child's color, so the family's
  weeks read at a glance) or **Color by round**. With one child, colors are always by round.

## Lanes
Per child, top to bottom, each only when it has something in range:
1. **Tests**: the student's own test dates (▲), only while they're still testing (before their application year) or
   when the retake suggestion is live ([scores.md](scores.md#test-dates)); a senior's lane shows only dates whose
   scores could still reach a deadline. Tooltip: "SAT Nov 7 · register by Oct 23". Past dates fade.
2. **Essays & recs**: the cycle file's windows for that child (ask recommenders, draft the personal essay, write
   supplements, check portals, thank recommenders) as light gray bars, stacked when they overlap so no two labels
   collide.
3. **Money** (labeled "your part" for a parent, "with a parent" for a student): FAFSA and CSS Profile opening dates
   and the colleges' aid priority dates, the cost check before each binding round ([rounds.md](rounds.md#money)),
   deposits, and the reply date, as green "$" markers. Only for a child in their application year.
4. **One lane per college with a deadline in range**, ordered by deadline: a bar for the six weeks before the
   deadline (the work window) in the round's color with the round's short name on it, a ◆ at the deadline, then a
   dashed line to a ○ at the expected decision. The Dream's lane says "Dream" under the name.
5. **Applications** for a child whose deadlines are all next year: one quiet line ("8 colleges on the list; their
   deadlines start next school year"). For a child with colleges that have no date on record: "No date on record:
   Rhodes, Elon; add the date from the college's site", with an add-date field in the row drawer.

Every mark is a focusable button with a tooltip on hover and focus and an `aria-label` with the same words.

## Colors
From the dataviz reference palette, validated with its checker (2026-10-09):
- **Rounds** take the first three categorical slots, the only three that stay distinguishable for every reader in
  both themes when they all appear together (all-pairs check): **RD and Rolling blue** (#2a78d6 / dark #3987e5),
  **ED orange** (#eb6834 / #d95926), **EA aqua** (#1baf7a / #199e70). **ED II** is ED's orange striped and **REA** is
  EA's aqua striped, so the binding-or-restrictive variant reads as "the same family, with strings attached". Every
  bar also carries its round's short name, so color is never the only cue (aqua's contrast on white is under 3:1;
  the labels and the Coming-up list are the relief the palette rules require).
- **Tests** violet (#4a3aa7 / #9085e9) as triangles and **money** green (#008300) as "$" discs. Both live in their own
  labeled lanes with their own shapes; a five-hue set fails the all-pairs color-blindness check, so position, shape,
  and label carry the difference, not hue alone.
- **Children**: the same three slots in the order the children were added (blue, orange, aqua), used only in "color by
  child", where round colors aren't shown.
- The list's round chips use the same round colors ([list.md](list.md#the-row)); the group chips (Reach / Target /
  Likely) deliberately don't, so a group never looks like a round.

## Coming up
Below the timeline, the same events as a list (and the first thing a phone shows): the next 12 from today, each with
the date, the mark's shape in its color, the child's name chip (Everyone), the text ("University of Georgia EA due",
"Cost check with a parent before Wake Forest ED I", "SAT test date (register by Oct 23)"), and days to go. This is
the accessible table view of the chart, and it's what "This week" used to be.

## Phones
Coming up leads; the timeline sits below it in a horizontally scrolling card (it needs about 760px) that opens
scrolled to today. The child switcher and color toggle wrap. No page-level horizontal scroll.

## Feed, print, share
- **Add to my calendar**: the built per-list `webcal://` feed ([../timeline.md](../timeline.md)), now one feed per
  viewer that includes every child they can see (a parent's feed carries each child's events with the child's name
  first: "Maya: Wake Forest ED I due"). Titles only, no personal numbers (built rule).
- **Print**: `/plan/print`, the Coming-up list for the whole year grouped by month, one page per child or all
  together, in round colors with shapes (prints legibly in grayscale).
- **Share image** (later): a PNG of the current view for a family chat, generated server-side from the same data.

## Rules
- The calendar reads the same rounds, deadlines, and tasks as the list; nothing is entered here.
- Every date's ⓘ (in the tooltip's "Source" link and in Coming up) cites its edition, as everywhere on the plan.
- A parent sees each child's calendar only under the household grants (built); a student never sees a sibling's.
- Telemetry: `plan_calendar_opened {everyone, color_by}`, `plan_calendar_feed_added`, `plan_calendar_printed`.

## Files (planned)
`lib/planner/calendar.ts` (pure: lanes and marks from a child's rows, tasks, and the cycle file; the range; window
packing; the Coming-up events; tested), `components/planner/FamilyCalendar.tsx`, `CalendarLane.tsx`,
`ComingUp.tsx`; the feed route gains the per-viewer variant; delete `MonthView`, `CollegeView`, `TimelineViews`,
`WindowBar`, `ThisWeek` once nothing renders them. The preview's `components/plan-preview/CalendarView.tsx` is the
reference for the layout.

## Open questions
1. Should "color by child" be the default for Everyone? Recommendation: yes; a parent's first question is "whose
   week is busy", and round colors are one tap away.
2. Six weeks is a placeholder for the work window. Should the bar instead start when the student marks "Working on
   it"? Recommendation: six weeks until the status changes, then from that date.
