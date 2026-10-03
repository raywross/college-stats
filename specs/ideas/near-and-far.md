# Near and Far: The Map, Distance From Home, and the Cost of Getting There (IPEDS HD + Census)

> Status: **idea** (2026-10-03). After [student-profile.md](../product/student-profile.md) (a home ZIP) and
> [school-identity/links.md](../school-identity/links.md) (the campus-visit link); the travel-cost line waits for
> [net-price-estimator.md](../product/net-price-estimator.md). Part of [ideas](README.md).

## Question it answers
*How far is it? What does getting home for Thanksgiving cost? Which of these could we see in one trip?* Distance is
the first filter most families apply and the one the site doesn't have. CollegeIQ answers "what is the place like"
(coastline, parks, sunny days); this answers "where is it relative to us".

## Why it's fresh
Real-estate and travel sites are map-first (Zillow, Redfin, Airbnb); college sites are list-first. Wanderlog turns a
list of places into a route with drive times; Edmunds counts fuel in the cost of a car. Quad already has coordinates
for all 1,893 colleges ([campus-profile.md](../data-expansion/campus-profile.md), which named a map view as a
possibility) and will have a visit-booking link per college. No routing service, no third-party calls, no cost per
visitor.

## Data
| Need | Source | Notes |
|---|---|---|
| Campus coordinates | `location.lat` / `location.lng` (IPEDS HD) | Built, all 1,893 colleges |
| Home | The student profile gains an optional **home ZIP**; ZIP → centroid from the Census Gazetteer ZCTA file (public domain, about 33,000 rows, a reference file in the repo) | Treated like every profile value: never sent to analytics, deleted with the account |
| Distance and drive time | Great-circle distance; drive time = distance × 1.25 ÷ 55 mph, shown as "about 7½ hours" and rounded to the half hour | A road factor, not a route |
| Nearest commercial airport | Airports with scheduled passenger service from BTS T-100 data, with coordinates | A small reference table: "nearest airport SAV, 70 miles" |
| Cost of a trip home | Driving: miles × the IRS standard mileage rate for the year (cited, versioned). Flying: the BTS Consumer Airfare Report's average fare for the airport pair (quarterly, public) when both ends have a commercial airport within 90 miles; otherwise driving | Trips a year is a family input (default three round trips) |

## Display
- **Explore map view** (`?view=map`): a dot per college from lat/lng, colored by the current measure (admit rate,
  average paid, or a ten-year direction), with the same filters as the other views. Signed in with a ZIP: rings at 2,
  4, and 8 hours' drive and a filter "within N hours' drive" or "one flight".
- **Profile hero** (signed in): "410 miles from home · about 7½ hours' drive · nearest airport SAV". Signed out:
  nothing.
- **Saved list**: distance per row; sort by distance. **Visit trips**: the list clustered into drivable groups
  (greedy: colleges within two hours of one another), each with total driving distance, suggested days (one college
  per half day), and every college's visit-booking link from [links.md](../school-identity/links.md); the trip goes to
  the calendar feed proposed for lists and to a map link.
- **Net price estimator** (guardian): a "Getting home" line, trips × cost, added to the four-year projection with
  its sources; the student sees the line, never the inputs.
- **Compare**: a distance row when signed in.
- **Glossary**: `drive-time-estimate`.

## Rules
- Distance is a straight line with a road factor; the page says so and never claims minutes.
- The map centers on the ZIP centroid, never a street; a college's exact coordinates are public, a home is not.
- "Within one flight" uses nonstop airport pairs from the same BTS data.

## Map implementation (open)
Two options, decided when built. An **SVG map of the United States** with projected dots: no tiles, no third party,
works in both themes and offline, and the state pages in [trends/states.md](../trends/states.md) already draw a tile
map. Or **MapLibre** with a self-hosted or free vector tile source: street-level detail around a campus, at the cost of
a dependency and a tile host. Recommendation: SVG first; the visit link already serves "what's around the campus".

## Tier
Map view and distance free (public coordinates and a ZIP the visitor typed). Visit trips with Plus (a list tool). The
travel-cost line with Pro, as part of the whole-list projection.

## Complexity
Large: a new kind of view (the map), a new profile field with a reference file, and lines in lists, Compare, and the
estimator.

## Open questions
1. ZIP centroids and the airport table add about a megabyte; publish them as a separate reference file, not in
   `schools.json`.
2. International students have no ZIP; a country picker with the nearest U.S. gateway airport is a later addition.
3. Should the map replace the grid as the default view on wide screens? Measure with telemetry after it ships.
