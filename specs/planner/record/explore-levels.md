# Part 6, Explore by Your Level, and "Show Me More" From the List

> Status: **built** 2026-10-16 (R7, branch feature/record-explore-levels). Extends Explore ([../../search-and-filtering.md](../../search-and-filtering.md)) and
> the Build your list guide ([../v3/guides/list-size.md](../v3/guides/list-size.md)). Part 6 of [Your record](README.md).
> The owner: "When you go to search and you're a logged-in user, you should be able to search by selectivity tailored
> to you: show me reach or high reach or safety, based on the student's rating and the school rating we've calculated.
> On the 'add a few target schools' page there should be quick buttons to show schools that fit their preferences,
> filtered to the selectivity they should add… right in the table: a 'Show me more' button. Then we could get rid of the
> 'your list has the shape…' card."

## Explore: "For you" levels
- **The filter**: a new group in Explore's filter panel (desktop and the phone sheet), **For you**, shown only to a
  signed-in student or a guardian viewing a student (the plan's person: the guardian's last-viewed child, the
  `plan_child` cookie, else the first): five chips, High reach · Reach · Target · Likely · Safe, any combination, in the
  level colors (`GROUP_CLASS`). A signed-out visitor sees the group's title and one line, "Sign in and add your grades
  to filter by your level", linking `/login`; a signed-in user with no grades or test sees "Add your grades and a test
  choice to filter by your level" linking the record (`recordHref`).
- **The URL**: `forMe=reach,high_reach` (level keys, comma-separated). Parsed in `lib/params.ts` with the other
  filters; unknown keys dropped. A shared link carries the param; for a viewer who isn't a student it does nothing and the
  group shows its sign-in line.
- **Applied on the server**, after the other filters (so the estimate runs only on what survives them): the page
  resolves the viewer's student and profile (only when `forMe` is set, so every other Explore request stays exactly as
  fast as today), runs `estimateMany` with the plan's hooks over the filtered unit ids, and keeps those whose level is in
  the set. The count, pagination, cards, table, chart, and map all read the reduced list. A cap protects the request:
  when more than `FOR_ME_CAP` (600) colleges survive the other filters, estimate the 600 nearest the student's numbers
  first (sort by `|SAT midpoint − the student's score|`, then admit rate) and say "Showing levels for the 600 colleges
  closest to your numbers; narrow the filters to see more" above the results. Measure the cost; if `estimateMany` over
  1,900 runs under 150 ms, drop the cap.
- **On each card and row**, when `forMe` is active: the level chip ("Reach for you") beside the name. Nothing else from
  the estimate.
- **Active-filter chips** at the top show "For you: Reach, High reach" with ✕, like every other filter.
- Telemetry: `explore_for_me { levels: number }` (how many levels picked, never which colleges), once per change.

## Build your list: "Show me more" in the shape table
- Each row of the shape table (`components/planner/guides/ShapeRow.tsx`) gains a **Show me more** link at its right end
  (on phones under the boxes, 44 px tall): `/explore?forMe=<level>&<the record's preferences as Explore params>`
  (`preferencesToExploreParams`, lib/explore-fit.ts: sizes, setting, states, types, maxCost), opened in the same tab.
  The link is emphasized (primary color, filled) on the levels whose count is below the shape's minimum, and quiet on the
  rest; a level with no range in this season's shape (the junior long list) shows it quiet.
- With no preferences in the record, the link carries only `forMe`, and the table's footer gains one line: "Add where
  you'd go to your record and these show colleges that fit it too", linking the record's Where you'd go step.
- **Removed**: the "Your list has the shape for this season." card, and with it the "Not seeing it?" row's place moves
  under the table (Search any college stays; "Explore with your numbers" is replaced by the per-level links).
- The gap sections with their "like your list" cards stay below, unchanged.
- Telemetry: `plan_show_more { level, emphasized: boolean }`.

## Rules
- Inputs and outputs only: the level word is the only thing from the estimate that shows. No percentage, no closeness.
- A guardian sees the same filter for the child the plan shows; nothing about one child leaks into another's view.
- Explore stays server-rendered and fast for everyone not using `forMe`.

## Files (planned)
`lib/params.ts` (`forMe`), `lib/explore-for-me.ts` (server-only: `forMeFilter(schools, viewer)` resolving the student,
the profile, the hooks, the cap, and returning `{ schools, levels: Record<unitId, StandingLevel>, capped }`),
`app/explore/page.tsx`, `components/explore/{FilterPanel,MobileFilterSheet,SchoolTable,Toolbar}.tsx` and the card
component (the chip), the active-filter chips, `components/planner/guides/{ShapeRow,ListGuide}.tsx`,
`lib/planner/list-guide.ts` (the link builder, pure: `showMoreHref(level, preferences, emphasized)`), `lib/analytics.ts`.
Tests: `tests/explore-for-me.test.mts` (parsing; the filter keeps only the picked levels; a non-student viewer gets the
unfiltered list and the sign-in line; the cap and its message; no estimate number in the page's markup),
`tests/planner-list-guide.test.mts` (the link carries the level and the preferences; emphasis below the minimum; the
shape card is gone).

## As built by R7
- **The cap is off.** `estimateMany` over all 1,893 colleges, a fresh context per run as a request makes, measured
  73–87 ms for a student with a GPA and an SAT and 123–144 ms with eight AP courses on the record; the first run in a
  fresh process (before the JIT warms) took 162–187 ms. Under 150 ms in steady state, so `FOR_ME_CAP` is `null`
  (lib/explore-for-me.ts). The capped path stays and is tested (`forMeFilter(…, { cap })`, `closestFirst`,
  `forMeCappedLine`), so turning it on is one line (`SPEC_CAP` is 600). A nearest-first cap would also hide most Safe
  and High reach colleges (they sit far from the student's numbers by definition), another reason to leave it off.
- `lib/params.ts` `parseForMe` (level keys in the URL's order, unknown dropped) sits beside `parseFilters` but outside
  `SearchFilters`: the dataset never sees `forMe`. It counts as one active filter (`FILTER_KEYS`).
- `lib/explore-for-me.ts` (server-only): `resolveForMeViewer()` (signed out / no student / no numbers / ready; the
  plan's person: the student, or a guardian's `plan_child` child, else the first, via `resolveSelectedChild`) and
  `forMeFilter(schools, levels, viewer)` returning `{ schools, levels, capped, cap, status, recordHref }`. The hooks are
  the list's (`hooksFromPlan` over the plan bundle's items and visits) plus a record connection on a college not on
  the list (a parent's college you haven't added still reads as legacy). `app/explore/page.tsx` calls both only inside
  `if (forMe)`; a source guard in the test proves every other request does exactly the work it did.
- The filter group: `FilterPanel`'s first section, "For you" with the `levels` glossary tip, five 44 px chips tinted in
  `GROUP_CLASS` when picked. Without `forMe` in the URL the server hasn't looked at the viewer, so the panel goes by
  the header's sign-in state (`useMe`): signed out shows the sign-in line, signed in shows the chips; a student with
  no grades or test sees "Add your grades and a test choice…" once a level is picked (the server's answer then wins).
  A signed-in viewer with no student gets that same line, linking `/plan?record=1`.
- The chip on cards, rows, and the table: `components/explore/ForYouChip.tsx`, "Reach for you", from a `levels` map of
  level keys the page passes down (all three are server components).
- Active-filter chip: "For you: Reach, High reach" in the URL's order, ✕ clears `forMe`.
- List guide: `showMoreHref(level, preferences)` and `showMoreLinks(row, preferences)` (lib/planner/list-guide.ts)
  instead of the planned `showMoreHref(level, preferences, emphasized)`: the emphasis is computed from the row, so it
  lives in `showMoreLinks`. The table's footer: the no-preferences line (a link for an editor, plain text for a
  guardian who can't edit), then "Not seeing it?" with Search any college. The level sections keep their own search;
  "Explore with your numbers" remains only on the freshman view, which has no shape table to replace it.
- Telemetry: `explore_for_me { levels }` on each chip change; `plan_show_more { level, emphasized }` on each link.
