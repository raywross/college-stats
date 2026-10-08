# Stage 1, The List: Groups by the Numbers, a Dream, and Sorting

> Status: **built** 2026-10-08 on `feature/planner` ([below](#built-2026-10-08-unit-u2-on-featureplanner-list)); planned 2026-10-07. After [model.md](model.md). Better with [chances-and-fit.md](../product/chances-and-fit.md)
> (the site's suggested category with reasons); works without it from the admit rate alone. Extends the built list
> ([saved-lists.md](../product/saved-lists.md), [household-hub.md](../product/household-hub.md#one-list-per-person)).
> Part of the [planner](README.md).

## Goal
The first thing a family does is name the colleges they're looking at. The list exists; this stage makes it a
*sorted* list: every college in Reach / Target / Likely with the site's suggestion shown and the student's choice
kept, one **Dream** marked, the list orderable by what the family cares about, and a balance line that says in plain
words what the list is missing. It should take ten minutes, and it should be the thing a junior does in March.

## What's built already
Categories (`reach | target | likely | unsorted`), the balance line with counselor guidance ("counselors suggest
2–3 Likely"), move up/down, category headers, "Add to list" on every card, row, and profile, CSV import and export,
the share link, and distance from home on each row. No standing column (chances isn't built), no sort other than the
student's order, no Dream.

## Suggested category
Each row shows **Suggested: Target** beside the student's chip, with a one-line reason and a ⓘ, from the first rule
that applies:

| When | Suggestion | Reason shown |
|---|---|---|
| [chances-and-fit.md](../product/chances-and-fit.md) is built and the student has numbers | its standing | its reasons (scores vs the middle 50%, GPA band, admit rate), cited |
| Admit rate under 20% | Reach | "Admits fewer than 1 in 5 applicants (fall 2024)" |
| Open admission | Likely | "Admits everyone who applies" |
| Student has an SAT or ACT and the college reports a range | position in the range (`fitsScoreValues`, built): above the 75th → Likely if admit rate ≥ 50%, else Target; inside → Target; below → Reach | "Your SAT 1450 is above this college's middle 50% (1280–1450, fall 2024)" |
| Otherwise | none | "Add a score or GPA to see a suggestion" |

Rules: the suggestion never changes the student's category; a row whose category differs from the suggestion shows
both ("Likely · Suggested Target") with no color that reads as a warning. **Accept all suggestions** fills every
`unsorted` row at once and leaves categorized rows alone. Thresholds live with chances' constants so there is one
set of numbers. The caveats from chances show once at the top of the stage, not on every row.

## The Dream
One college per list can be marked **Dream**: the college the student would pick today over every other. It's a
star on the row and a crest at the top of the Plan tab. Why a flag and not a category: dreams are Reaches as often
as Targets, and the category must keep describing the numbers.

- Marking a second college moves the star (the trigger in [model.md](model.md#tables)); a confirmation names the
  college losing it.
- The Dream is what [early-rounds.md](early-rounds.md#the-proposal) looks at first, and the only college the
  planner ever singles out by name in the parent's summary ("Dream: Michigan").
- A Dream with a category of Reach gets the stage's one piece of advice-shaped data, repeated from chances: "Reach
  means your numbers are below most admitted students'. Dreams are allowed to be Reaches; the plan will make sure
  there are Likelies too."
- No Dream is fine. The strip's count says "Dream: none yet" without nagging.

## Sorting
A sort menu on the list and on the stage panel; the choice is per list and remembered (`lists.sort`), and the
student's own order is always one option. Sorts never hide a college, and a college missing the sort's field goes to
the end with "not reported" rather than being dropped.

| Sort | By | Needs |
|---|---|---|
| My order | `position` (move up/down today; drag and drop here, keyboard-accessible) | |
| Category | Reach → Target → Likely, then my order (today's default) | |
| Dream and priority | the Dream first, then `priority` ([early-rounds.md](early-rounds.md#ranking)), then my order | stage 2 |
| Next date | the next task's `due_on` ([timeline.md](timeline.md)) or the chosen round's deadline | |
| Admit rate | ascending (most selective first) | |
| Average cost | the all-student average the row shows | |
| Distance | miles from home ([home-and-distance.md](../product/home-and-distance.md)) | a home address |
| Where I stand | Likely → Target → Reach by the *suggestion* (not the student's category) | numbers |

"Where I stand" is a sort by the site's classification; it reads as "easiest first", never as a ranking of the
colleges, and the menu says "by your numbers, not by quality".

## The balance line, extended
Today: "3 Reach · 4 Target · 1 Likely: counselors suggest 2–3 Likely". The stage adds, each only when true and each
as a fact:
- "No Likely yet" / "No Target yet" / "Only Reaches".
- "2 colleges don't match your preferences" with a link to the Numbers tab, when fit exists ([chances-and-fit.md](../product/chances-and-fit.md#fit)).
- "Average cost above your family's limit at 3 colleges" when a max average cost is on the profile; when the
  guardian has shared an estimate ([net-price-estimator.md](../product/net-price-estimator.md)), the estimate instead.
- "12 colleges: Common App's average is 7 (2025–26)" above twelve, with no advice attached.
- The stress test from [worst-plausible-spring.md](../ideas/worst-plausible-spring.md) is the natural next panel
  here when that idea is planned; this stage leaves a slot for it.

## Finding colleges to add
The stage panel is also where a thin list gets thicker, without leaving the page:
- **Like this one**: for any college on the list, the profile's similar colleges (built, `lib/similar.ts`) as a
  rail, each with "Add".
- **Explore with my numbers**: the built "Fits my scores" and "Fits my preferences" chips, prefilled.
- **A parent's suggestion**: a guardian with edit access adds like anyone else; a view-only guardian gets a
  **Suggest** button that creates the row as `unsorted` with "Suggested by Mom" and a one-line note, which the
  student keeps or removes. Scoir's parent suggestion is the pattern; here it's a list row with attribution, not a
  separate inbox.

## Display
- **Stage panel**: the balance line, then the rows grouped by category (or by the chosen sort) with suggestion,
  Dream star, and the category chips; "Accept all suggestions" when any row is unsorted; the finding rail below.
- **List tab**: the same rows (it is the same component), the Dream star in the row, the sort menu in the list
  header's "⋯".
- **Phones**: one column; the sort menu is a bottom sheet; the star is a 44 px target.
- **Glossary**: `dream-school`, `suggested-category`, plus the existing `reach-school`, `target-school`,
  `likely-school`.

## Rules
- The stage never removes or re-categorizes a college on its own; "Accept all" is the student's click.
- A share link ([saved-lists.md](../product/saved-lists.md#display)) shows the Dream star (it's the student's choice)
  and never the suggestion (it's derived from their numbers).
- CSV gains `dream` and `priority` columns; import accepts them.
- Guardians' own lists get the Dream and the sorts; no suggestions (a guardian has no numbers).

## Files (planned)
`lib/planner/suggest.ts` (pure: the table above over `School` + profile), `components/planner/ListStage.tsx`,
`components/lists/SortMenu.tsx`, `DreamStar.tsx`, drag-and-drop in `ListBoard.tsx` (keyboard: move up/down stays),
`tests/planner-suggest.test.mts` (every rule row; chances present and absent; "not reported" ordering), glossary.

## Open questions
1. Allow two Dreams ("a dream public and a dream private")? Recommendation: one; stage 2 needs one answer to "where
   would you go if you could", and a second favorite is `priority = 2`.
2. Should "Accept all suggestions" also set the Dream's category? It does, like any row; the star stays.

## Built (2026-10-08, unit U2 on `feature/planner-list`)
What exists:
- **`lib/planner/suggest.ts`** (pure): `suggestCategory(school: PlanSchool, profile)` over the rule table (minus
  `chances-and-fit`, not built: README "Dependencies not built"), with `REACH_ADMIT_RATE_MAX` (0.2) and
  `LIKELY_ADMIT_RATE_MIN` (0.5) as exported constants. A reason's year always comes from the citation on the value
  it's about (`admitRateCite`, or `cites["derived.sat_total"]` / `cites["admissions.act_composite_25_75"]`), never a
  literal in this file. Also: `sortItems` (every row in "Sorting"'s table, missing fields sort last),
  `extendedBalanceLines` (the balance line's new facts), and `SORT_OPTIONS` (the sort menu's list, with each
  option's `needs` hint).
- **`components/planner/stages/ListStage.tsx`** (server component): the balance line extended, "Dream: none yet" or
  the Dream's name, "Accept all suggestions" while anything's unsorted, the rows grouped by category or the chosen
  sort (`ListStageRow.tsx`: facts, suggestion with its reason and source, the Dream star, a category picker), and
  the finding rail — colleges like the ones already on the list (`lib/insights.ts` `similarSchools`), the built
  Explore fit chips, and an Add (or Suggest, for a view-only guardian) button (`ListStageControls.tsx`).
- **`components/planner/row/list.tsx`**: the Dream star and, when it differs from the student's own category, the
  suggestion line, inside the list row's "More" (the brief's file map, not list-building.md's "Display" wording,
  which reads as the star sitting in the plain row; see "Deviations" below).
- **`components/lists/{DreamStar,SortMenu}.tsx`**: the Dream toggle (44px, confirms before taking the star from
  another college) and the sort picker (`SheetDialog`: a bottom sheet on phones, a centered dialog from `sm`,
  per `specs/mobile.md` "sheets for pickers"). Both wired into the List tab's header (`ListPage.tsx`) and the Stage
  1 panel.
- **Drag-and-drop in `ListBoard.tsx`**: pointer (HTML5 drag-and-drop, including touch-drag where the browser
  supports it) alongside the existing Move up/down buttons, which stay as the keyboard path. `ListBoard` also grew a
  `sort` prop: "Category" and "My order" keep the category headers; every other sort is one flat list (headers
  would otherwise describe a grouping that isn't what's shown).
- **Server**: `lib/planner/store-list.ts` (`"use server"`, `ready(capability)` copied from `lib/planner/store.ts`):
  `setSort`, `acceptAllSuggestions` (fills every unsorted row with its suggestion, skips rows with no suggestion,
  leaves categorized rows alone), `suggestCollege` (a view-only guardian's row, `unsorted`, note "Suggested by
  {name}"). `lib/lists.ts` gained `moveItem` (pointer drag's write: renumbers the whole list's `position`).
- **Migration** `supabase/migrations/20261008130000_planner_list.sql` (not in the brief's file map; told to the
  lead): `suggest_college(list, unit_id)`, security definer, checking `can_read_list` — not `can_edit_list` — since
  a view-only guardian is exactly who needs to call it; everyone else already has `addToList`.
- **CSV**: `dream` and `priority` columns after the tracking ones in `lib/list-rules.ts` (`CsvRow`, `toCsv`,
  `parseCsv`) and `lib/lists.ts` (`exportListCsv`, `importListCsv`); import accepts them, missing or malformed
  values default to off/unset.
- **Glossary**: `suggested-category`.
- **Tests**: `tests/planner-suggest.test.mts` — every rule row (including the ACT fallback and the threshold's own
  edge), a profile with no numbers at all (and a guardian's own list, no profile), "not reported" sorting last in
  every one of the eight sorts, the extended balance line's four new facts, and the CSV round-trip (including a
  plain Scoir export without the new columns, and a malformed priority cell).

Deviations and decisions:
- **`PlanSchool` grew two fields** (`satRange`, `actRange`), additive, in `lib/planner/types.ts` and filled in
  `lib/planner/context.ts`'s `planSchoolFor` — the file U1 built says to add fields to `PlanSchool` additively, so
  this unit did, rather than re-deriving the SAT/ACT range from the full `School` object a second time. The
  citations for those two fields live in `PlanSchool.cites` (`derived.sat_total`, `admissions.act_composite_25_75`)
  like every other cited value, not a second `...Cite` field.
- **Where the Dream star and suggestion line show.** The spec's "Display" section reads as the star sitting in the
  plain row on both the List tab and the Stage 1 panel; the brief's file map puts it in `row/list.tsx`, which only
  renders inside `ListBoard`'s "More". This build follows the brief: the List tab's row keeps the star and
  suggestion behind "More" (consistent with every other stage's row controls, and with the row's decluttered
  design), while the Stage 1 panel — which is its own component, not `ListBoard` — shows both directly, which is
  where a family actually sorts the list.
- **`ListStage` doesn't reuse `ListBoard`.** "The same rows (it is the same component)" is read as the Dream
  star, the sort menu, and the suggestion logic being shared, not the literal row markup: `ListBoard`'s row is
  built around "More"-first tracking and notes, which the Stage panel doesn't need, so it gets its own compact row
  (`ListStageRow.tsx`) instead of carrying unused tracking/notes UI into the stage view.
- **`lists.sort` needed a column in the List tab's own read** (`LIST_COLUMNS` in `lib/lists.ts`, `ListRecord` in
  `lib/list-rules.ts`), since it wasn't there before this unit and the List tab (not just the Plan tab) needs it for
  the sort menu.
- **Sorts gated by what's loadable**: "Distance" needs a home address; "Next date" and "Where I stand" need the
  planner's tasks and the student's numbers, which the List tab (`ListPage.tsx`) only loads when `planner` is true
  (the household hub). Outside the hub (`/me/lists`), those two options show disabled with their "needs" hint rather
  than silently vanishing.
- Not done here: `chances-and-fit.md`'s row in the suggestion table (not built yet — the admit-rate/score rules
  stand in, per the README); a private per-guardian suggestion inbox (Scoir's pattern, decided against in the
  model); photos or a richer finding rail beyond similar colleges and the fit chips.

### Owner feedback, first pass (2026-10-08)
- **Sorting must feel instant.** The category chips on the Stage 1 panel now flip the moment they're tapped
  (`ListStageRow` keeps the chosen category locally, writes it, and flips back only if the write is refused) and stay
  enabled while a write is in flight, so a family can sort a list as a run of taps. The balance line and the stage
  counts are server-rendered, so the row refreshes the page after the write lands; that refresh never blocks the next
  tap. Before this, the chip didn't change until something else re-rendered the page, which read as a wait of seconds.
