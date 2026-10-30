# Part 5, The Essays Tab: Essays Beside Next Steps, Colleges, and Calendar

> Status: **built** 2026-10-30 (PR #194). Part 5 of [essays](README.md). Moves the workspace's list
> ([workspace.md](workspace.md) "Where it lives") onto the advisor page as its own tab and gives it the shape of
> the work: by college, earliest deadline first. Reads the same `essayProgress` as [moves.md](moves.md). Part of
> [product](../README.md).

## The owner's brief (2026-10-30)
"Essays should be a top level item as well along with Next steps, Colleges and Calendar. Please make it fit on one
row on the phone and desktop. Give some thought to how the essays screen should look."

## Question it answers
*What do I have to write, for whom, by when, and where am I on each one?*

## The tab strip
`PlanTab` gains **`essays`**, labelled **Essays**, icon `PenLine`, third in the strip:

```
Next steps · Colleges · Essays · Calendar            (· Offers, once a decision is recorded)
```
Essays sits between the list and the calendar because it is the work the list creates; a student reads left to
right from what to do, to where, to what to write, to when.

**One row, always.** Four or five tabs must fit on a 390 px phone (358 px inside the gutters) and on desktop.
- **Desktop and tablets (`sm:` up)**: the pills as built (icon, 14 px label, `px-4`), one line; five pills measure
  about 560 px, which the people line's row holds.
- **Phones (below `sm`)**: the strip becomes a **segmented control that fills the width**: `grid grid-flow-col
  auto-cols-fr`, each cell a 44 px-tall link with the label centered, 12 px semibold, no icon, `px-1`, `gap-1`,
  `whitespace-nowrap`. "Next steps" is the widest label (about 62 px at 12 px); five cells of 70 px hold it. The
  active cell keeps the ink fill and the rounded ends; the rail has the card ring. Nothing wraps and nothing scrolls
  sideways; a guard test renders five labels in a 358 px container at 12 px and asserts no overflow (and the
  Playwright pass measures `scrollWidth ≤ clientWidth` at 390).
- The loading skeleton draws the same strip. `BottomNav` (the site's phone tab bar) is unchanged: it points at the
  advisor, not at a tab.

`?tab=essays` opens it; `planHref({ tab: "essays", college })` adds `#college-<unit_id>` so a move or a card lands
on one college. `/advisor/essays` (the list page) **redirects** to the tab (`308`, keeping `?for=` and turning
`?college=` into the anchor); the editor (`/advisor/essays/[id]`) and the package (`/advisor/essays/package/[unit]`)
stay where they are, and their "All essays" link returns to the tab. The prompt picker, the per-row statuses, and
the guardian's read-only rule come with the list.

## The screen
```
Your essays                                   14 of 23 ready · next: Duke, Nov 1
Write the personal essay once; each college's own prompts below, earliest deadline first.
[ Write a new one ▾ ]                                                 (student only)

┌ Personal essay · Common App ──────────────────────────────────────────┐
│ ● Ready · 648 of 650 words · used by 9 colleges                        │ → the editor
└────────────────────────────────────────────────────────────────────────┘

┌ Duke · ED · by Nov 1 ──────────────────────── 2 of 3 ready · Package ┐
│ ● Why Duke? (250 words)                                   Ready       │
│ ◐ Choose 1 of 5 · "Tell us about…"                        Draft · 180 of 250 │
│ ○ Optional · "Is there anything…"                         Start       │
├ Michigan · EA · by Nov 1 ───────────────────── 0 of 2 ready · Package ┤
│ ○ Why Michigan? (550 words)                               Start       │
│ ○ Community (300 words)                                   Start       │
├ Georgia Tech · EA · by Oct 15 ─────────────── 2 of 2 ready ✓ · Package┤
├ Yale · RD · by Jan 2 ────────────────────────── prompts not on file ──┤
│ We haven't read Yale's essay page yet. Yale's own site has it.        │
│ [ Add what Yale asks ]                              (opens the picker, Yale picked)
├ Elon · rolling ───────────────────────────────── no essays beyond the Common App's ┤
└────────────────────────────────────────────────────────────────────────┘

Coalition prompts (if any college takes it) ▸        Not for a college yet (2) ▸
```
- **Header line**: the progress in words from `essayProgress` ("14 of 23 ready · next: Duke, Nov 1"); with nothing
  on file yet: "Your colleges' prompts arrive by August; the personal essay is the summer's work." With everything
  ready: "All 23 ready. Paste each college's package into its form when you apply."
- **The personal essay card** first when any college takes the Common App: status, count against 650, how many
  colleges use it; tapping opens the editor (or creates it, the one-per-student rule as built).
- **One card per college** on the list, in the plan's deadline order (the move's order), each with the college's
  name, round, and deadline from the plan, the ready count, and a **Package** link once anything is started. Inside,
  one row per prompt: a state glyph (○ not started, ◐ draft, ● ready), the prompt's title (its kind and limit; the
  first words of the text when the kind alone is vague, as the picker shows them), and on the right the status with
  the count, or **Start** (creates the draft for that prompt and opens the editor). Required prompts first, then a
  choose set with its "Choose 1 of 5" heading, then optional ones. A draft that serves several prompts shows "also
  used for {College}" under its row (links as built).
- **A college not on file**: one line and **Add what {College} asks**, which opens the prompt picker with the college
  chosen and the free prompt (the student types the college's prompt as its title). A college whose page says it has
  no supplement says so in one line. A college whose page refers to the form says "{College} asks its questions inside
  the application; add them here as you meet them."
- **Folds**: the Coalition's prompts (when a listed college takes it) and drafts not tied to a college, as the list
  groups them today.
- **Empty list**: "Add colleges first; their prompts show up here." with the link to the Colleges tab; the personal
  essay card still shows for a student whose class year is senior or rising senior.
- **A parent** sees the same screen read-only, with open-comment counts on the rows and the lead line "Only {first}
  edits a draft; you can read and comment." Start and Write a new one are hidden.
- **Phone**: the cards stack; a prompt row is one line with the status under the title when the width needs it;
  every row is a 44 px target; no sideways scroll ([../../mobile.md](../../mobile.md)).
- **Desktop**: the same column inside the advisor's left column; the right aside keeps Next up and the coming-up
  list as on every tab.

## Where it is reached from
- The strip, on every plan.
- The essays move's **Write it** ([moves.md](moves.md)), anchored to the named college.
- The Submit move's "Essays for {College}" and "The essay package" (the package stays its own page).
- The Colleges tab's count line "Your list asks for 14 essays…" becomes a link to the tab.
- The story guide's "start from your story" line links to the personal essay.

## Rules
- The tab is the workspace's list; the editor and the package are unchanged by this part.
- No essay text on the tab: titles, counts, and statuses only (titles are the student's own or the prompt's kind).
- Order is the plan's deadline order, never alphabetical, so the screen reads like the move.
- The strip never wraps or scrolls on any width this site supports (390 px up).

## Telemetry
`plan_tab_opened {tab: "essays"}` as every tab (the existing event); `essay_started_from {where: "tab" | "move" |
"picker"}` when a draft is created from a prompt row.

## Files (planned)
- `lib/planner/plan-tabs.ts`: `PlanTab`, `PLAN_TABS` order, `TAB_LABELS`, `planHref` `college` anchor; tests
  `tests/planner-plan-tabs.test.mts`.
- `components/planner/PlanTabs.tsx`: the phone segmented strip and the desktop pills; the `essays` branch renders
  `EssaysTab`; `app/advisor/loading.tsx` skeleton.
- `components/planner/EssaysTab.tsx` (new, server component wrapped like the other tabs' data needs: the tab's data
  is read in `app/advisor/page.tsx` next to the plan read, `readEssays` by the plan's student) and
  `components/essays/CollegeEssayCard.tsx` (new): the card and its rows; `EssayList.tsx` keeps the folds.
- `app/advisor/essays/page.tsx` → redirect; `app/advisor/essays/[id]/page.tsx` and `package/[unit]/page.tsx`: the
  back link.
- `components/planner/moves/SubmitCard.tsx`, `components/planner/PlanFrame.tsx` and `PlanList.tsx` (the count line
  link), `components/planner/guides/StoryGuide.tsx` (the link).
- Tests: strip width guard (`tests/planner-tab-strip.test.mts`), tab routing in `planner-page.test.mts`, the screen's
  structure (`tests/essays-tab.test.mts`), the redirect.

## Complexity
Medium: a tab, a strip rule, and one new screen composed from the built list's parts.

## Open questions
1. Should the Essays tab show for freshmen and sophomores? Recommendation: yes, the strip is the same for everyone
   (the tab reads "Your colleges' prompts arrive the August before you apply"); hiding tabs by season would move the
   strip under a student's feet.
2. Should Offers push the strip to five on phones or replace Calendar in the segmented row? Recommendation: five
   cells; the guard proves they fit.

## As built (2026-10-30)
Both open questions were built as recommended: the tab is on every plan's strip, including freshmen and sophomores
(`tabsFor`, `lib/planner/plan-tabs.ts`), and Offers pushes the phone strip to five cells rather than replacing
Calendar.

- `lib/planner/plan-tabs.ts` (`PlanTab`, `PLAN_TABS`, `TAB_LABELS`, `planHref`'s `college` anchor, `collegeAnchor`);
  `components/planner/PlanTabs.tsx` (`PlanTabPills`, the `STRIP_RAIL`/`STRIP_CELL` classes, the `essays` branch);
  `app/advisor/page.tsx` and `app/advisor/loading.tsx`; `components/planner/EssaysTab.tsx` (new) and
  `components/essays/CollegeEssayCard.tsx` (new, also `MainEssayCard`, `PromptRow`, `StartButton`); `lib/essays/tab-view.ts`
  and `lib/essays/tab-data.ts` (new, the tab's words and its read); `app/advisor/essays/page.tsx` (the 308 redirect);
  `app/advisor/essays/[id]/page.tsx` and `package/[unit]/page.tsx` (the back link); `components/planner/moves/SubmitCard.tsx`,
  `PlanFrame.tsx`, `PlanList.tsx` (the count line link); `components/planner/guides/StoryGuide.tsx`.
- **Phone strip measurements differ from the spec's arithmetic**: the spec's `px-1` and "5×70 px + gaps" don't fit
  358 px (366 px, over by 8). The build uses `px-0` (`STRIP_CELL` in `PlanTabs.tsx`): five cells measure 68.4 px
  each, "Next steps" needs 62.3 px, so it fits with no padding, not the 1 px side padding the spec described.
  `tests/planner-tab-strip.test.mts` proves `px-1` fails at this width. Measured at 390×844: four tabs, strip 358 px,
  cells 86.5 px, no sideways scroll; five tabs, strip 358 px, cells 68.4 px, no sideways scroll; every cell 44 px
  tall. At 1440: pills one line, 487 px (four) / 593 px (five).
- **Header line** (`progressLine`, `lib/essays/progress.ts`): with nothing on file and nothing added yet it reads the
  summer line exactly as specified; with only unread colleges (no prompts on file anywhere and nothing added) it
  reads "0 of 1 ready · next: {College}…", not the summer line — the spec's two header states didn't cover a list
  whose only colleges haven't had their pages read yet.
- `essaysHref` (`lib/essays/rows.ts`) points every existing link (Submit card, the editor's "All essays" back link)
  at the tab with the college anchor; the Submit card and the Colleges tab's apply card needed no changes beyond
  that helper. The redirect (`essaysListRedirect`) keeps `?for=` only when it's a UUID and turns `?college=` into the
  anchor only when it's a unit id.
- A college's card shows the college name alone (no round or deadline) before senior year, matching how the Colleges
  tab reads a college before rounds are chosen; open-comment counts show on a student's own view of their rows too,
  not just a parent's; the personal essay card shows on an empty list from the summer before senior year through
  senior spring, not only once a college is added; card headings use their own round words ("ED", "rolling"), not
  `lib/essays/progress.ts`'s `roundWord`; the fold "Colleges no longer on your list" keeps a removed college's
  drafts reachable; the story guide's "start from your story" link opens the main essay's editor directly when
  reading from inside the Essays tab's own data, else it opens the tab; a guardian's read of a draft from the tab
  is still written to the household read log, as any other draft view is.

## Changed (owner review, 2026-10-30, later): the row unfolds the whole prompt
UT Austin's first prompt read "Essay (650 words) · “Share an essay on any…”" and the owner asked whether the text was
stored cut off. It is stored in full (148 characters); the row shortens it to five words by design. Decision: leave the
short title, "but clicking will expand and show everything". A prompt row whose text is on file is now a `<details>`:
the summary is the glyph and the short title (a 44 px target, keyboard-reachable, a chevron that turns), and the fold
beneath holds the college's full prompt. The status on the right ("Draft · 180 of 250 words") is the link to the draft,
where before the whole row was; Start stays where it was. A row with no text on file (an own ref) keeps a plain title.
`components/essays/CollegeEssayCard.tsx` `PromptRow`; `tests/essays-tab.test.mts`.

## Not built
- Nothing from this part is deferred; both open questions were decided and built.
