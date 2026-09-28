# Home Page

Route: `/` (static). The top of the drill-down: the whole dataset at a glance, with doors into Explore,
profiles, Compare, and the glossary.

## Sections (top to bottom)
1. **Hero**: glowing gradient band, "College data, decoded." headline, big typeahead `SchoolSearch`
   (jumps straight to a profile, or Enter → `/explore?q=`), "Try:" quick links. On desktop, three
   tilted spotlight cards show "1 in N admitted" with a ring gauge.
2. **Stat strip**: schools, applications, pooled admit rate, undergrads.
3. **Start with a question**: six lens cards, each a preset Explore URL (most selective, within reach, big
   publics, small & close-knit, economic diversity, most diverse), showing match count and crests.
4. **Admissions landscape**: `ScatterPlot` (admit rate vs. SAT) of the 400 most-applied-to colleges with a plain-English reading guide.
5. **Is it worth it?**: cost-vs-earnings `ScatterPlot` (400 most-applied-to), with "Highest earnings" and
   "Lowest net price" leaderboards. See [cost-outcomes.md](cost-outcomes.md).
6. **Leaderboards**: hardest to get into (1 in N), biggest campuses, highest Pell share.
7. **Schools by state**: `StateTileMap` (tiles filter Explore) plus a **head-to-head** CTA with preset matchups.
8. **Learn the lingo**: four glossary cards and a link to the full glossary.

Lens presets and matchups are constants at the top of `app/page.tsx`.
