# Trends by Athletic Conference

> Status: **built** 2026-10-04 (PR pending, branch `feature/national-trends`). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md)). Conference membership and its history come from the campus-services build
> ([campus-services.md](../data-expansion/campus-services.md)); first-look figures were computed 2026-10-03.

## Why
Conferences are the grouping most Americans already know. "How do SEC schools compare?" is a question readers ask in
those words, and realignment (the Pac-12's collapse in 2024–25, the Big Ten and SEC at 16–18 members) is a story they
follow. The site stores each college's conference today and every year since 2014–15, so it can show a conference as a
group of colleges: how its members compare on admissions, cost, size, and where students come from, how that has
changed, and who joined or left.

The first look says the Power 4 conferences moved very differently from the country: while the median four-year
college lost a tenth of its undergraduates since fall 2014, SEC members grew 18% and Big 12 members 17% at the median,
and SEC applications doubled.

## What readers see
### `/trends/conferences`: the index
- **Power 4 side by side** at the top (SEC, Big Ten, ACC, Big 12): a small-multiples row of four cards, each with the
  conference's member count, median acceptance rate, median average total cost, median undergraduates, and the
  ten-year change in applications. Same scale across the four cards.
- **All conferences** below, grouped by level (D-I FBS, D-I FCS, D-I, D-II, D-III, NAIA) as `lib/conferences.ts`
  classifies them, each row: name, members on the site, median acceptance rate, median average cost, and a ten-year
  applications-change arrow. Sortable. Conferences with fewer than 8 members on the site are listed but have no
  medians ("too few members to summarize").
- **Realignment this year**: a short list of moves in the newest year from the events already derived in
  `lib/events.ts` ("Oregon: Pac-12 → Big Ten").

### `/trends/conferences/{slug}`: one conference
Slug from the conference name (`southeastern-conference`), looked up to its IPEDS code. Sections:
1. **Header**: name, level, member count, "members as of {academic year}" from lineage, and a link to Explore filtered
   to the conference (`/explore?conference={code}`, which exists).
2. **Members**: a grid of crests and names, each linking to its profile, with the join year when it joined after
   2014–15 ("joined 2024–25").
3. **At a glance**: medians for the conference vs all four-year colleges, as a dot-and-range strip per measure
   (conference median as the dot, member range as the bar, national median as a tick): acceptance rate, applicants,
   undergraduates, average total cost, out-of-state first-years, 6-year graduation rate, Pell share.
4. **Over time**: the conference's median line for one measure at a time (segmented control: applicants ·
   acceptance rate · undergraduates · average cost after inflation · out-of-state share), with the national median as
   the context line, 10 years. Membership rule below.
5. **Members compared**: one small bar chart per measure, members sorted, so the reader sees that the Big 12's
   out-of-state share runs from 14% to 60%, not just its median.
6. **Realignment timeline**: the conference's joins and departures by year since 2014–15 from the `conference`
   history series: "2024–25: Oregon, UCLA, USC, Washington joined from the Pac-12".
7. **Method note** and sources.

## Rules
1. **Today's members, by default.** "SEC median" means the current 16 members at every point in the line, so the line
   describes the same colleges throughout (hub rule 1). A toggle, *Members at the time*, recomputes each year's median
   over whoever was a member that year, for readers who want the conference-as-it-was; the chart labels which rule is
   on. The difference is itself informative: the Big 12's median out-of-state share jumps in 2023–24 under the
   members-at-the-time rule because of who joined.
2. **Medians, not totals**, for everything except applications and undergraduates, where a total ("SEC members
   received 1.2 million applications") is also shown, labeled.
3. **8 members minimum** for medians (107 conferences qualify). A member whose series lacks a year is left out of that
   year's median, and the chart drops the year when fewer than 80% report.
4. **Football conference when it differs** (Notre Dame, the FCS members of otherwise non-football conferences) is
   shown on the member row, not used for grouping; the primary conference is `campus.athletics.conference`.
5. **Independents and "other"** codes (D-I independents, ECAC, "Other") are not conferences: listed under "No
   conference" on the index and excluded from medians.
6. **Realignment events** are the ones `lib/events.ts` already derives, including its reporting-fix rules (an
   independent's code switch is not a move). The index's "moves per year" uses the same events: about 26–54 a year
   since 2015, peaking at 54 in 2024–25.
7. **No rankings of conferences by prestige.** The index sorts by name within level by default; the reader chooses
   another sort.

## First look (2026-10-03; today's members; medians of member colleges)
| Conference (members) | Applications, fall 2014 → 2024 | Acceptance rate | Undergraduates | Out-of-state first-years | Full price after inflation, 2013–14 → 2023–24 | Joined since 2014–15 |
|---|---|---|---|---|---|---|
| Southeastern (16) | +106% | 71% → 67% | +18% | 37% → 42% | +6% | 2 |
| Big Ten (18) | +87% | 56% → 54% | +10% | 29% → 34% | +2% | 4 |
| Atlantic Coast (18) | +70% | 36% → 20% | +13% | 38% → 38% | +7% | 3 |
| Big 12 (16) | +70% | 75% → 80% | +17% | 32% → 40% | +1% | 8 |
| American Athletic (13) | +83% | 64% → 72% | −2% | 12% → 17% | −1% | 7 |
| Mountain West (12) | +60% | 68% → 88% | +5% | 26% → 25% | +1% | 1 |
| Mid-American (13) | +38% | 69% → 81% | −16% | 13% → 13% | +1% | 1 |
| Sun Belt (14) | +76% | 70% → 88% | −6% | 10% → 14% | +2% | 5 |
| New England Women's & Men's, D-III (12) | +48% | 47% → 38% | +3% | 62% → 65% | +7% | 1 |
| Minnesota Intercollegiate, D-III (13) | +4% | 67% → 88% | −22% | 21% → 17% | +5% | 2 |
| Great Lakes Valley, D-II (15) | +56% | 71% → 70% | −27% | 22% → 25% | +4% | 3 |

What stands out, to confirm before publishing:
- **Power 4 members grew while most colleges shrank**, and their out-of-state shares rose: the Big 12's from 32% to
  40% (its eight new members since 2014–15 are part of why, which the members-at-the-time toggle will show).
- **Acceptance rates diverged**: the ACC's median fell from 36% to 20% while the Mountain West's rose from 68% to 88%
  and the Sun Belt's from 70% to 88%, even as their applications rose 60–76%. Larger classes and open-door growth at
  some members, not fewer applicants.
- **D-II and D-III conferences shrank with their regions**: Great Lakes Valley −27%, Minnesota Intercollegiate −22%.
  These pages will read as regional stories, which the Study 3 link should say.

## Computation and storage
- `data/history/conferences.json`, built by `npm run sync-history`: per conference code, the member ids today, join
  years, and per-measure yearly medians under both membership rules, plus the national median lines. ~130 conferences ×
  5 measures × 11 years × 2 rules: small.
- Names, levels, and slugs from `lib/conferences.ts` (add `slug` there; test that slugs are unique and stable).
- Member counts come from the snapshot (`campus.athletics.conference.code`); the realignment timeline from the
  `conference` series via `lib/events.ts`.
- Lineage: each measure cites its series through `citeField`, and the page's year labels come from `history/meta.json`
  through lineage helpers, never typed.

## Build order
1. `buildConferences()` in the history build with both membership rules; test recomputes one conference (the SEC, 16
   ids fixed in the test) from committed shards.
2. Index page with the Power 4 strip and the level-grouped table.
3. Conference page: members grid, at-a-glance strip (new small component, `DotRange`, per [charts.md](../charts.md)
   rules), over-time chart (reuses `TrendLine` with a context line), members-compared bars, realignment timeline.
4. Links in: the profile's Athletics card ("How the {conference} compares"), Explore's conference filter chip, and the
   Trends index.

## Open questions
1. Should the index also offer **by division** pages (`/trends/divisions/fbs`)? Divisions are already an
   additional grouping in studies; a page per division may be redundant. Recommendation: not at first.
2. **Football-only conferences** (Pioneer, Missouri Valley Football): show as conferences, since IPEDS codes them, but
   their members' primary conference differs. Recommendation: list them with "football only" and no medians.
3. Pac-12 in 2026–27 (reconstituted with new members): the data will show it as a conference again when the IC file
   does; the realignment timeline handles it with no special case. Confirm when the file lands.
