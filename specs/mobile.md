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
  - More is a sheet with Glossary, Data, and the Light/Dark/System control.
- **Header** on phones is just the logo, 56px tall (`--header-h: 3.5rem`, 4rem from `md`). Navigation, search,
  and theme moved to the tab bar.
- **Footer** drops its link column on phones and pads for the tab bar (`--tabbar-h`).
- **Sticky sub-navs** (profile `SectionNav`, `CompareHeader`, glossary search bar) sit at
  `calc(env(safe-area-inset-top, 0px) + var(--header-h))`. Never hard-code the header height.

## Patterns
| Pattern | How | Used on |
|---|---|---|
| Swipe rail | `grid … max-sm:rail` (a Tailwind `@utility` in `globals.css`). Snaps, bleeds to the screen edge, next card peeks. Width per item: `max-sm:[--rail-item:72%]` (default 82%). Becomes the grid from `sm` | Home lenses, value leaderboards, What's changed, Who stands out, lingo; profile similar schools; compare suggestions |
| Result row | `SchoolRow`: crest, name, city · type, three colored facts (SAT, undergrads, avg cost), admit rate on the right, compare button. ~90px vs. ~460px for a card | Explore (cards from `sm`) |
| Chip row | `max-sm:overflow-x-auto max-sm:-mx-4 max-sm:px-4` + `shrink-0` children | Home "Try:" schools, profile "Known for" |
| Pill bar | `CompareHeader` becomes one swipeable row of slim pills (~56px) instead of a 2×2 card grid | Compare |
| Sticky first column | `sticky left-0 bg-card` on the label cell | Compare tables |

## Type and spacing on phones
- Page h1 `text-3xl` (home hero `text-[2.75rem]`), section h2 `text-2xl`; eyebrows hidden on page headers.
- Section gaps `space-y-14` (was 20), card padding `p-4` (was 5), takeaways `text-base`.
- Descriptive intros that repeat what the UI shows are hidden below `sm` (Explore, Glossary counters).

## Checking a change
`tests/mobile-layout.test.mts` (`npm test`) guards the CSS rules above and the `--header-h` offsets. For visual QA,
install Playwright in the session scratchpad and load each route at 390×844 with `isMobile: true`. Check that
`window.innerWidth === 390` at DOMContentLoaded (server HTML) as well as after hydration, since mobile Chrome locks
in a widened viewport at load.
