# Part 4, The Shape of a Good List: Gaps, and Colleges to Fill Them

> Status: **planned** 2026-10-14. After [seasons.md](seasons.md); extends the balance line
> ([../redesign/list.md](../redesign/list.md#around-the-list), `balanceLineFor` in `lib/planner/plan-view.ts`) and the
> levels ([../../chances/levels.md](../../chances/levels.md)). Part 4 of [next steps](README.md).

## Goal
The plan has a shape in mind for a good list, says what's missing in one line, and offers colleges at the missing
level with one tap each. The shape widens for juniors, who should have more to visit and cut, and settles for seniors.

## The shape
Owner's decision (2026-10-14) for the **senior list**, as `LIST_SHAPE` in `lib/planner/list-shape.ts`:

| Level | Min | Max |
|---|---|---|
| High reach | 0 | 2 |
| Reach | 2 | 3 |
| Target | 5 | 8 |
| Likely | 2 | 3 |
| Safe | 2 | 3 |
| **Total** | **12** | **15** |

Plus one check that isn't a count: **at least one Likely or Safe the family can afford**, read as average cost within
the profile's limit (`preferences.maxAverageCost`) or, once the estimator exists
([../../product/net-price-estimator.md](../../product/net-price-estimator.md)), a shared estimate inside the family's
line. Without a limit or estimate the check is "unknown" and produces a parent move, not a student one.

**By season** (`shapeFor(season)`):
| Season | Shape |
|---|---|
| Freshman–sophomore | No shape. "A long list of places that interest you" with no counts; the balance line is silent |
| Junior fall – junior winter | The **long list**: 15–20 colleges with at least 3 Likely or Safe among them; no maxima on the upper levels (visiting and cutting is the point) |
| Junior spring – summer | The senior shape as the target to reach **by August**, with the gap moves gentle ("by summer's end") |
| Senior fall onward | The senior shape; the gap moves dated to the earliest open deadline minus 30 days |

`unsorted` rows (no numbers, or not in the dataset) don't count toward any level and produce their own move ("Add your
numbers so Quad can sort 2 colleges" → the intake).

## Gap moves
`shapeGaps(counts, season, affordability)` returns the gaps in priority order; the generator emits **one** gap move at
a time (the first), so the tab never shows "add five colleges":
1. **Below the Likely/Safe minimum** ("Add a Likely you'd be happy at"; the long list's "at least 3").
2. **No affordable Likely or Safe** (parent move: "Check the cost of a Likely or Safe together"; student move when the
   limit is set and none fits: "Add a Likely within your family's limit").
3. **Below the Target minimum** ("Add a Target or two").
4. **Below the Reach minimum** (seniors only; "Room for a Reach").
5. **Over a maximum** (High reach > 2; total > 15): informational, "Three High reaches crowd out colleges you'd get
   into; which would you drop?" with **Review the list**; no automatic removal, ever.
6. **Over 15 / under 12 total** without a level gap: the fact line ("Common App's average is 7") and nothing else.

Each gap move's why is the count line: "Your list has 3 Reaches, 2 Targets, and no Likely yet." The balance notice on
the Colleges tab (`PlanNotice`) reads the same `shapeGaps` and keeps its one-sentence form, so the two never disagree;
`BALANCE_LINES` and `LIST_SIZE` are replaced by the shape.

## The rail
The gap move's button, **Show some**, opens a rail of colleges at the missing level for this student:
- **Candidates**: the similar colleges of every college on the list (`similarSchools`, built), plus Explore's "fits my
  numbers" set (built chips), minus the list, minus anything over the family's cost limit when the gap is affordability.
- **Level**: `estimateMany()` over the candidates (server; the same call the list uses), keeping those at the missing
  level; at most twelve, ordered by closeness to the level above (so a Likely that is nearly a Target comes first),
  then by distance from home when known.
- **Card**: crest, name, state, the level chip ("Likely for you"), average cost when a limit is set, distance when
  known, and **Add**. A new row arrives sorted, with its starting round, as today.
- **Nothing found**: "Quad didn't find a {level} near your list; try Explore with your numbers" and the chip.
- A guardian with edit access adds; a view-only guardian **Suggests** (built `suggest_college`).

## Rules
- The shape never removes or re-sorts a college; moves ask, the student acts.
- No ranking of colleges by quality anywhere in the rail: it is "colleges at this level for you", ordered by closeness
  and distance, and the card says so.
- The count line names levels, never percentages or the estimate's numbers.
- Telemetry: `plan_shape_gap_shown {gap, season}`, `plan_rail_opened {level}`, `plan_rail_added {level}`; never the college.

## Files (planned)
`lib/planner/list-shape.ts` (`LIST_SHAPE`, `shapeFor`, `shapeGaps`, `countLine`), `lib/planner/rail-server.ts`
(candidates and levels), `components/planner/ShapeCard.tsx`, `CollegeRail.tsx`; kinds `shape_gap`, `shape_cost`;
`balanceLineFor` rewritten over `shapeGaps`. Tests: `tests/planner-list-shape.test.mts` (every gap in order, each
season's shape, the affordability states, unsorted rows excluded, one move at a time, the notice and the move agree).

## Open questions
1. Should the junior long list have an upper bound at all? Recommendation: a soft "20 is plenty to visit" line, no move.
2. Count a Dream at High reach toward the High-reach maximum? Recommendation: yes; the line says "including your Dream".
