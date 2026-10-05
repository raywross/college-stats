# Mobile layout ("Pocket Quad")

How the site works on phones (< 640px, tested at 390×844). Redesigned 2026-09-28 after an audit found pages
scrolling sideways into empty space and running 11,000–16,700px tall.

## What was wrong
| Problem | Cause | Fix |
|---|---|---|
| Home, profile, and glossary were 770–857px wide on a 390px phone | ~50 grids had no base column template (`grid gap-4 lg:grid-cols-2`). With none, CSS makes one `auto` track, which grows to its widest unwrappable content (a `truncate`d school name, a chart) | Base rule in `globals.css`: `.grid { grid-template-columns: minmax(0, 1fr) }`. Any `grid-cols-*` utility still overrides it |
| Home stayed 644px wide after that fix | `.sr-only` spans (`position: absolute`) inside off-screen cards of a horizontal scroller escaped it, because their containing block was outside the scroller. Mobile Chrome widens the layout viewport to fit them, and charts then measure at that width, so it never recovers | Every `overflow-x-auto` element and the `rail` utility get `position: relative` |
| Hidden navigation | Hamburger menu; the compare pill floated over content | Bottom tab bar (below) |
| Very long pages | Desktop cards stacked one per row: Explore cards ~460px each, 6 lens cards, 3 leaderboards, 4 lingo cards | Compact result rows; swipe rails; tighter type and spacing |

`html, body { overflow-x: clip }` is a backstop, not the fix: Chrome still sizes the mobile layout viewport from
overflowing content, so root causes must be fixed. `clip` (unlike `hidden`) keeps `position: sticky` working.

## Research
- **Bottom tab bars beat hamburger menus** for 3–5 primary destinations: hidden menus cut feature discovery by
  30–50% ([NN/g](https://www.nngroup.com/articles/mobile-navigation-patterns/),
  [onething](https://www.onething.design/post/hamburger-menu-vs-tab-bar)). Native college apps (Niche, BigFuture)
  use tab bars.
- **List rows for results** (Redfin, Zillow, Apple Stocks): one headline number per row, details on tap.
- **Swipeable carousels with a peeking next card** (App Store, Airbnb categories) turn tall stacks into one row
  and show there's more to swipe.
- **Mobile charts:** design for the small screen rather than shrinking desktop; bigger type, fewer labels, tap not
  hover ([Keen](https://keen.io/blog/designing-data-visualizations-for-mobile-best-practices/)).
- **Filters in a bottom sheet** with a "Show N results" button (Airbnb): already in place (`MobileFilterSheet`).

## Shell
- **`BottomNav`** (`components/layout/BottomNav.tsx`, below `md`): Home · Explore · Search · Compare · More.
  - Search opens a full-screen sheet with `SchoolSearch` autofocused.
  - Compare shows a lime count badge of picked schools. It replaces the floating `CompareTray` on phones (the
    tray still shows from `md`).
  - More is a sheet with Glossary, Data, Roadmap, Release notes, and the Light/Dark/System control.
- **Header** on phones is the logo with the account control opposite it ("Sign in", or the avatar menu when signed in), 56px tall (`--header-h: 3.5rem`, 4rem from `md`). Navigation, search,
  and theme moved to the tab bar.
- **Footer** drops its link column on phones and pads for the tab bar (`--tabbar-h`).
  On phones it is the top of the page and scrolls away with it, not sticky (decided 2026-10-05 after trying
  hide-on-scroll: a floating bar on a phone covered content and behaved unpredictably); the tab bar keeps
  navigation in reach and More has Sign in. From `md` it stays pinned.
- **No `viewport-fit=cover`** (removed 2026-10-05): with it, Chrome on iOS draws the page under its own top toolbar,
  and the re-expanding toolbar covered the header on scroll up. `env(safe-area-inset-*)` uses keep their `0px`
  fallbacks. The footer shows the deployment's short commit ("Build abc1234") so phone reports match a build.
- **Sticky sub-navs** (the profile topic pages' `CompactHeader` with its pill row, `CompareHeader` with its chips
  row and topic-pills row, glossary search bar) sit at `calc(env(safe-area-inset-top, 0px) + var(--header-offset))`:
  `--header-offset` is 0 on phones and `--header-h` from `md`. Desktop-only sticky elements may use `--header-h`.
  Never hard-code the header height.

## Patterns
| Pattern | How | Used on |
|---|---|---|
| Swipe rail | `grid … max-sm:rail` (a Tailwind `@utility` in `globals.css`). Snaps, bleeds to the screen edge, next card peeks. Width per item: `max-sm:[--rail-item:72%]` (default 82%). Becomes the grid from `sm` | Home lenses, value leaderboards, What's changed, Who stands out, lingo; profile similar schools; compare suggestions |
| Result row | `SchoolRow`: crest, name, city · type, three colored facts (SAT, undergrads, avg cost), admit rate on the right, compare button. ~90px vs. ~460px for a card | Explore (cards from `sm`) |
| Chip row | `max-sm:overflow-x-auto max-sm:-mx-4 max-sm:px-4` + `shrink-0` children | Home "Try:" schools, profile "Known for" |
| Pill bar | `CompareHeader`'s second row becomes one swipeable row of topic pills (Overview + seven), under a school-chips row that swipes the same way | Compare |
| Sticky first column | `sticky left-0 bg-card` on the label cell; the header row of college names sticks too, from `lg`, under the compare band | Compare's full table (`/compare/table`) |

## Profile on phones
The profile is an overview plus six topic pages ([school-profile.md](school-profile.md)). A topic page's sticky band
(`CompactHeader`) has the crest, name, Compare, and a swipeable row of topic pills with the active one scrolled into
view; "On this page" is a collapsible row above the content (a sticky side column from `lg`), and tapping an entry
for a folded block scrolls to its "Show …" button.

Every page keeps its headline answer visible (takeaway, key numbers, one chart). Deep dives fold behind
`ShowMore` (`components/ui/show-more.tsx`): a dashed "Show …" button with a one-line hint, below `sm` by default
(`until="lg"` folds tablets, 640–1023px, too: the admissions page's waffle and admissions map, the cost page's
borrowing and repayment and who gets aid, and the outcomes page's cost vs. earnings map; "Who they are" on the
students page folds only on phones because it is short). Content
stays in the server HTML and is hidden with CSS (not unmounted), so nothing shifts on load, citations stay in the
page, and wider screens are unchanged.

| Page | Visible | Folded |
|---|---|---|
| Overview | Topic cards stacked, each under one screen; chip rows swipe; the whole card is a tap to its page | Sources for this overview (`<details>`) |
| Admissions | Funnel, yield (+ strip), acceptance-rate strip, what they look at, test scores | 100-square waffle (repeats the funnel), moved after it; admissions map |
| Students | Race and ethnicity, economic access, campus size, residence, transfers, campus life | "Who they are" (men/women, part-time, 25 and older; [student-body.md](data-expansion/student-body.md)) |
| Cost | What students pay, price by income, debt/payback | "Borrowing and repayment" (loan rate, debt by background, repayment status); "Who actually gets aid" (generosity card + breakdown; the overview has the generosity tile) |
| Outcomes | Earnings, retention/graduation, 8-year outcomes, graduation by group | Cost vs. earnings map |
| Over time | Takeaway, controls, the group pills, and the one selected group (Cost by default) | Nothing folds: the other groups aren't rendered ([trends-design.md](trends-design.md#profile-over-time-page-schoolsidhistory)) |

Harvard (2026-10-02, as built, content height to the end of `<main>`): overview 4,252px on a phone (2,475 desktop,
2,899 tablet); topic pages 2,564–4,981px on a phone and 1,755–3,847px on desktop, where the single page was
19,061px / 23,285px. `npm run measure-profile` prints the table.
Charts inside folded content keep their last real width (`useWidth` ignores 0) and re-measure when shown.

## Compare on phones
Compare is an overview plus seven topic pages too ([comparison.md](comparison.md)), so `CompareHeader` carries two
swipeable rows instead of the profile's one: the slot-colored school chips, then the topic pills once two or more
colleges are picked (hidden below two, since every topic would just redirect back to the overview). No compare
page needed `ShowMore` folding — every page measured inside its phone budget as built, unlike the profile's Over
time and Outcomes pages.

Two blocks hold a fixed per-college width and scroll sideways *inside their own card* rather than shrinking, so four
colleges stay readable: the SAT/ACT range bars (`ScoreCompare`, and the Getting-in card's score row) and the race &
ethnicity bars (`RaceCompare`). This is deliberate, not the sideways-scroll-into-empty-space bug this file opened
with — the card's outer width still matches the viewport; only its internal row scrolls.

The full table (`/compare/table`) uses the same sticky-first-column pattern as other Compare tables below `lg`
(1024px) — which includes the 810px tablet width this file measures at, so a tablet gets the same sideways-scrolling
box as a phone. Only from `lg` does the box stop scrolling sideways, with the header row of college names sticking
under the compare band instead. The **Differences only** switch works identically at every width.

## Type and spacing on phones
- Page h1 `text-3xl` (home hero `text-[2.75rem]`), section h2 `text-2xl`; eyebrows hidden on page headers.
- Section gaps `space-y-14` (was 20), card padding `p-4` (was 5), takeaways `text-base`.
- Descriptive intros that repeat what the UI shows are hidden below `sm` (Explore, Glossary counters).

## Checking a change
`tests/mobile-layout.test.mts` (`npm test`) guards the CSS rules above and the `--header-h` offsets. For visual QA,
run `PLAYWRIGHT_DIR=<a scratchpad with Playwright installed> npm run measure-profile` against a dev server: it loads
the overview and every topic page at 1440, 810, and 390 (`isMobile: true`) and fails on sideways scroll, a widened
viewport, a broken pill or previous/next link, or a page over its height budget (`scripts/measure-profile.mts`,
helpers in `scripts/lib/profile-measure.mts`). For other routes, install Playwright in the session scratchpad and
load each at 390×844 with `isMobile: true`. Check that
`window.innerWidth === 390` at DOMContentLoaded (server HTML) as well as after hydration, since mobile Chrome locks
in a widened viewport at load.
