# Design System: "Quad"

Professional-but-fun data explorer. Visuals first, jargon explained inline.
Direction chosen from [design-research.md](design-research.md): collegiate "Varsity" base plus
"Scoreboard Pop" energy (colored metric bars, glowing accents) and editorial takeaways.

## Brand
- **Name:** Quad (`SITE_NAME` in `lib/brand.ts`). Tagline: "College data, decoded."
- **Logo:** four rounded quadrants (`components/layout/Logo.tsx`), one per brand color. Rotates on hover.
- **School crests:** generated monogram tiles (`components/school/Crest.tsx`). Gradient hue is a stable
  hash of `unit_id` (`lib/brand.ts → crestGradient`). Monograms are hand-picked for known schools, else derived.
  Crests are decoration, never data.

## Typography
| Role | Font | Notes |
|---|---|---|
| Display / headings | Bricolage Grotesque (`--font-display`, `font-display`) | Extrabold, tight tracking |
| UI / body | Geist Sans | |
| Tabular columns | Geist Sans + `tabular-nums` | Only where numbers align vertically |

Big standalone numbers (stat tiles, hero figures) use proportional figures.

## Color tokens (`app/globals.css`)
Light = warm paper + ink + electric violet. Dark = deep indigo night with glowing accents.

| Token | Use |
|---|---|
| `--primary` | Electric violet. Buttons, links, active states |
| `--pop` / `--pop-foreground` | Lime highlighter. Key-word highlights (`.highlight`), active filter chips, "Comparing" state, flags |
| `--coral` | Small notification dots |
| `--surface-2` | Table headers, secondary panels |
| `--grid`, `--axis` | Chart gridlines (hairline) and baselines |

### Data domains (identity colors)
Each metric family has one color, used on bars, dots, and section markers (never on text):

| Domain | Token | Light / Dark |
|---|---|---|
| Admissions | `--d-admissions` | `#6d4df2` / `#8f7bff` |
| Size | `--d-size` | `#eb6834` / `#d95926` |
| Test scores | `--d-scores` | `#2a78d6` / `#3987e5` |
| Access (Pell, first-gen) | `--d-access` | `#1baf7a` / `#199e70` |
| Diversity | `--d-diversity` | `#c2378f` / `#e05ab0` |
| Cost & outcomes | `--d-value` | `#eda100` / `#c98500` |

This order was validated as an adjacent set in both modes (violet↔blue failed, so they're never neighbors).
Anywhere domain colors sit side by side, follow this order: card meters are Selectivity, Size, SAT, Pell, Net
price, and table columns follow the same order. A separate outcomes green was rejected (green↔amber falls in the
6–8 ΔE warn band in dark mode), so cost and outcomes share one amber.

### Chart palettes (validated with the dataviz palette validator)
- **Compare slots** `--s1..--s4` (blue, orange, aqua, pink): pass **all-pairs** in both modes, so they're safe
  for overlapping radar polygons. Exposed as `SLOT_COLORS` in `lib/brand.ts`.
- **Demographics** `--demo-1..7`: fixed stack order (White, Asian, Hispanic, Black, Two+, Intl, Other) so each
  category keeps its color and neighbors.
- **Sequential** `--seq-1..5` (violet): state tile map.
- **Status** `--good`, `--warning`, `--critical`: reserved; always shipped with an icon + label.

Re-run the validator whenever a chart color changes (see [charts.md](charts.md)).

## Shape & motion
- Radius base `0.875rem`; cards use `rounded-3xl`, chips `rounded-full`.
- Cards lift on hover (`-translate-y-1`, violet-tinted shadow) with a crest-colored corner glow.
- Keyframes: `animate-grow-x/y` (bars grow from baseline), `animate-rise` (fade-up), `animate-pop-in`.
- `prefers-reduced-motion` disables all animation.
- Hero bands: drifting blurred glow blobs (`--hero-glow-*`) over a masked dot grid (`.bg-dots`).

## Responsive
| Width | Behavior |
|---|---|
| < 640 | Single column, bottom tab bar (below `md`), swipe rails instead of stacked cards, compact result rows, bottom-sheet filters. See [mobile.md](mobile.md) |
| 640–1024 | 2-col grids, nav links visible from `md` (tab bar below `md`) |
| 1024+ | Filter sidebar, header search, spotlight cards in hero |

Safe-area insets are respected on the header, sticky sub-navs, bottom sheets, the tab bar, and the compare tray.
Sticky sub-navs offset by `--header-h`; content clears the tab bar with `--tabbar-h`.

## Dark mode
`next-themes`, class strategy, `system` default. Header has a quick toggle; the mobile menu and footer
offer Light / Dark / System (`ThemeSegmented`). Dark values are chosen steps, not auto-inverted.

## Component patterns
- **Filter chips**: ink-filled when active, show result counts, disabled at 0.
- **Active filter chips**: lime pills with an ×, removable one by one.
- **Segmented controls**: view toggle, theme, SAT/ACT switch.
- **Sticky sub-navs**: the profile topic pages' compact header with its topic pills, and the compare header, pinned under the site header.
- **Empty states**: pop-colored icon tile, playful headline with `.highlight`, one clear action.
