# Guide: Build Your List

> Status: **planned** 2026-10-15. After [../now.md](../now.md). Extends the shape and the rail
> ([../../next-steps/list-shape.md](../../next-steps/list-shape.md)) and the levels ([../../../chances/levels.md](../../../chances/levels.md)).
> Part 3 of [plan v3](../README.md). The owner: "explain what a good list looks like, and recommend similar schools to
> what they already have based on facts like school size, public/private, location, etc., just with differing
> selectivity. The design of this will be tricky; give this one a lot of thought."

## Goal
A student with five colleges, all Reaches, should leave this page understanding why a list has a shape, seeing where
theirs stands, and having added a Likely that feels like the colleges they already like, not a random college at the
right admit rate. The guide does three things in order: shows the shape, shows the list against it, and offers colleges
**like yours** at the level that's missing.

## What exists
- `LIST_SHAPE`, `shapeFor(season)`, `shapeGaps`, `countLine` ([list-shape.md](../../next-steps/list-shape.md)): the
  target counts per level by season and the ordered gaps.
- The rail (`lib/planner/rail-server.ts`): candidates from `similarSchools` (selectivity, scores, size, type) plus
  "fits my numbers", estimated with `estimateMany`, kept at the missing level. Its weakness for this guide: `similarSchools`
  matches on **selectivity and scores**, so a list of Reaches yields candidates that are mostly Reaches, and the rail
  often comes back thin.
- The college facts the owner named, on every `School`: `type` (public / private non-profit / for-profit),
  `undergrad_enrollment`, `setting` (NCES locale group: city, suburb, town, rural), `location` (state, region, lat/lng),
  `religion.affiliation`, `designations` (HBCU, tribal), the majors offered, and the student's distance from home.

## The page
```
← Back to your plan                                            Junior spring · Class of 2028
Build your list
Your list has 3 Reaches and 2 Targets and no Likely yet.

WHAT A GOOD LIST LOOKS LIKE                                        [Why this shape ⓘ]
 High reach   Reach       Target        Likely      Safe
 ▢▢           ▮▮▮         ▮▮▢▢▢▢▢▢      ▢▢▢         ▢▢▢
 0–2 · you 0  2–3 · you 3 5–8 · you 2   2–3 · you 0 2–3 · you 0        12–15 in all · you 5
 Senior shape; aim for it by August. Juniors keep a longer list to visit and cut.

ADD A LIKELY YOU'D BE HAPPY AT                                     ← the first gap, open
 Like the colleges you have, where your record is Likely for you.
 ┌────────────────────────────────┐ ┌────────────────────────────────┐
 │ [crest] Elon University · NC   │ │ [crest] Furman University · SC │
 │ Likely for you                 │ │ Likely for you                 │
 │ Like Wake Forest: also private,│ │ Like Davidson: also private,   │
 │ similar size, also Southeast   │ │ similar size, 140 mi from home │
 │                        [+ Add] │ │                        [+ Add] │
 └────────────────────────────────┘ └────────────────────────────────┘
 … up to 12, in a horizontal rail on phones and a grid from md
 Not seeing it?  [Search any college]   [Explore with your numbers]

ADD A SAFE YOU'D BE HAPPY AT                                       ← the next gap, folded
ADD A TARGET OR TWO                                                ← folded
```

### 1. The shape
The five levels as a row of slots: the target range as outlined boxes, the student's colleges as filled ones (a Dream
filled in the Dream color), the range and the count under each, the total at the right. The season's sentence under it
(`shapeFor`: the senior shape and "by August" for juniors from spring; the long list for junior fall and winter:
"15–20 to visit and cut, with at least three Likely or Safe"; no shape for freshmen and sophomores, who see "A long list
of places that interest you; sorting comes in junior year" and the recommendations by **what they like** instead,
below). **Why this shape** opens a sheet with the advisor consensus in plain words, cited ([next-steps README's research](../../next-steps/README.md#research-2026-10-13)):
why two Likelies you'd attend, why one or two High reaches is plenty, why 12–15 and not 25, and what each level means
(the level meanings from [levels.md](../../../chances/levels.md#the-levels)). Never a percentage.

Over a maximum reads differently: the slot row shows the overflow filled past the outline in a muted tint, and the
section says "Three High reaches crowd out colleges you'd get into; which would you drop?" with the three named and a
link to each profile. Nothing is removed by the site.

### 2. The gaps, in order
One section per gap from `shapeGaps`, in its priority order (Likely/Safe minimum, Target minimum, Reach minimum,
over-maximum, total), the first open and the rest folded with their counts. Unsorted rows get their own section at the
end ("2 colleges aren't sorted yet: add your numbers" → the intake). The affordability gap stays hidden while financial
moves are hidden ([../../next-steps/README.md](../../next-steps/README.md); owner, 2026-10-15), and returns with them.

### 3. Colleges like yours
The heart of the guide. For a gap at level L:

**Anchors.** Every open college on the list (withdrawn ones out), the Dream first.

**Likeness** (`likeness(anchor, candidate)` in `lib/planner/list-guide.ts`, pure): the facts the owner named, each a
yes/no with its sentence, scored one point each:
| Fact | Match when | Sentence |
|---|---|---|
| Control | Same `type` (public with public; either private with private) | "also public" / "also private" |
| Size | Same size band: under 2,000 · 2,000–5,000 · 5,000–15,000 · 15,000–30,000 · over 30,000 undergraduates | "similar size" |
| Setting | Same NCES locale group | "also in a city" / "also a college town" / "also suburban" / "also rural" |
| Place | Same region, or within 150 miles of the anchor | "also Southeast" / "near Wake Forest" |
| Character | Same religious affiliation when the anchor has one; both HBCU; both women's colleges | "also Catholic" / "also an HBCU" |
| Major | Offers the student's first intended major family when set | "has {major}" |

Selectivity is deliberately **not** a fact: the point is the same kind of college at a different level. Two colleges are
"alike" at **three or more** points (two when the anchor has fewer than four facts known); the sentence names up to
three matching facts, the most specific first (character, place, setting, size, control, major).

**Candidates.** Every college in the dataset that is alike to any anchor and not on the list, capped at `GUIDE_CANDIDATE_CAP`
(200) by best likeness score; then `estimateMany` with the plan's own hooks (the rail's call), keeping those whose
level is L. Ordered by likeness score (ties: closeness to the level above, so a Likely nearly a Target leads; then
distance from home). At most twelve shown; "Show more" adds twelve.

**Card.** Crest, name and state (linked to the profile, which opens in a new tab so the guide isn't lost), the level chip
("Likely for you"), the likeness sentence ("Like Wake Forest: also private, similar size, also Southeast"), distance when
home is known, and **Add**. Adding writes the row through the built `addToList` (it arrives sorted with its starting
round), ticks the gap move when the gap closes, updates the shape row at the top, and advances the open section to the
next gap when this one is filled. A view-only guardian **Suggests** (built `suggest_college`).

**Nothing alike found at L**: "Quad didn't find a {level} much like your list. These are {level} for you near home:" and
the plain rail (the built candidates ordered by distance), then the two links. **No anchors** (an empty list): the
freshman view below.

**Freshmen, sophomores, and empty lists.** No shape and no level sections. One section, "Places that might interest
you": the student's preferences from the profile (size, setting, states or regions, type) as toggle chips at the top,
pre-set from `preferences`, and cards for colleges that fit all of them ("fits my preferences", built), ordered by
distance, with Add. The sentence is the preferences matched ("Mid-sized, suburban, Northeast"). Nothing about levels.

### 4. The links
**Search any college** opens the add-college search inline (the built box). **Explore with your numbers** is the built
"Fits my scores" chip's navigation.

## Rules
- The shape never removes or re-sorts a college; the guide asks, the student acts (built rule).
- No ranking by quality: candidates are ordered by how alike they are and how close to the next level, and the card
  says "like {anchor}", never "better" or "best".
- The count line and every sentence name levels and facts, never the estimate's numbers; the likeness sentence names
  only public facts about the two colleges.
- A guardian's view is the same page; Add needs edit access.
- Telemetry: `plan_guide_opened {slug: "list"}`, `plan_shape_gap_shown {gap, season}` (built), `plan_guide_added
  {level, likeness: n}` (the score, never the college), `plan_guide_shape_explained`.

## Files (planned)
`lib/planner/list-guide.ts` (pure: `SIZE_BANDS`, `likeness`, `alike`, `rankAlike`, `preferenceCards`),
`lib/planner/list-guide-server.ts` (candidates over the dataset, the estimate call, the cards; server-only like the
rail), `app/api/plan/list-guide/route.ts` (the "Show more" page), `components/planner/guides/ListGuide.tsx`,
`ShapeRow.tsx`, `AlikeCard.tsx`, `ShapeExplainer.tsx`; `lib/planner/guides.ts` entry. The rail (`CollegeRail`,
`ShapeCard`'s "Show some") is replaced by a link to this guide. Tests: `tests/planner-list-guide.test.mts` (every
likeness fact with its sentence; the three-point rule and the few-facts exception; selectivity never a fact; ordering;
the cap; the freshman view; no number from the estimate in any string; the shape row's counts for each season).

## Open questions
1. **How alike is alike?** Three points of six is the proposal; two reads loose (any two private Southeastern colleges),
   four reads so strict the sections empty for small lists. Recommendation: three, measured in the first month by how
   often a gap section comes back with fewer than four cards.
2. **Distance in the likeness** uses 150 miles from the anchor; the family's own radius (the visit-alerts setting,
   default 30) is about driving, not about where a student would go to college. Recommendation: 150, fixed.
3. Should a candidate's card say which level the **anchor** is ("Like Wake Forest, a Reach for you")? Recommendation:
   no; one level per card keeps it calm.
