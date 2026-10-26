# Near and Far: Drive-Time Rings, Airports, Visit Trips, and the Cost of Getting Home

> Status: **idea** (2026-10-03; **rewritten** 2026-10-26 after the roadmap review). Most of the 2026-10-03 idea is built:
> the home address, Explore's "Distance from home" filter with a nearest-first sort, and distance with a drive time on
> the plan's list ([../product/home-and-distance.md](../product/home-and-distance.md), 2026-10-05); Explore's **map
> view** (`?view=map`, every match as a dot); each college's visit link ([../school-identity/links.md](../school-identity/links.md));
> and the college's own events with confirmed visits on the plan's Calendar tab
> ([../product/visit-events.md](../product/visit-events.md), 2026-10-13). What remains is below: rings on the map,
> airports, trips, and the travel-cost line. Part of [ideas](README.md).

## Question it answers
*Which of these could we see in one trip? What does getting home for Thanksgiving cost? Is there a flight?* Distance is
built; this idea is about what a family does with it: planning visits and counting travel in the price.

## Why it's fresh
Wanderlog turns a list of places into a route with drive times; Edmunds counts fuel in the cost of a car. Quad has the
coordinates of every college, the family's home, the student's list, and each college's own tour and session calendar.
No routing service, no third-party calls, no cost per visitor: a straight line with a road factor, two public reference
tables, and the events the site already reads.

## Data
| Need | Source | State |
|---|---|---|
| Campus coordinates | `location.lat` / `location.lng` (IPEDS HD) | Built, all 1,893 colleges |
| Home | The household's address, geocoded server-side ([home-and-distance.md](../product/home-and-distance.md)) | Built |
| Distance and drive time | Great-circle distance × a road factor at 55 mph, rounded to the half hour (`lib/home.ts`) | Built |
| Nearest commercial airport | Airports with scheduled passenger service (BTS T-100), with coordinates: a small reference file in the repo | New, about 400 rows |
| Cost of a trip home | Driving: miles × the IRS standard mileage rate for the year (cited, versioned). Flying: the BTS Consumer Airfare Report's average fare for the airport pair (quarterly, public) when both ends have a commercial airport within 90 miles; otherwise driving. Trips a year is a family input, default three round trips | New, two reference files |
| Visit events | `visit_events` for the college: tours and sessions with dates ([visit-events.md](../product/visit-events.md)) | Built for Slate colleges |

## Display
- **Explore map view, signed in with a home**: rings at 2, 4, and 8 hours' drive around the home, and the existing
  distance filter's chips ("within 4 hours", "one flight") beside it. The map centers on the home's ZIP centroid,
  never the street.
- **Profile hero, signed in**: "410 miles from home · about 7½ hours' drive · nearest airport SAV, 70 miles". Signed
  out: nothing (built: the distance and drive time already show on the plan's rows; this adds the airport).
- **Visit trips**, on the plan's Calendar tab beside the visit lane: the list grouped into drivable clusters (greedy:
  colleges within two hours of one another), each with total driving distance, suggested days (one college per half
  day), the next tour or session each college offers from its own calendar, and the visit link. A trip becomes
  calendar entries through the built feed once the family picks dates; nothing is booked by Quad.
- **A "Getting home" line** in the family's price ([../product/net-price-estimator.md](../product/net-price-estimator.md)):
  trips × cost, with its sources, added to the four-year total; the student sees the line, never the inputs.
- **Compare**: an airport row when signed in, beside the built distance.
- **Glossary**: `drive-time-estimate`.

## Rules
- Distance is a straight line with a road factor; the page says so and never claims minutes.
- A home is never drawn or sent to analytics; the ZIP centroid is the map's center.
- "One flight" uses nonstop airport pairs from the same BTS data.

## Tier
Rings and the airport line free (public coordinates). Visit trips with the planner's tier. The travel-cost line with
the family's price, whatever tier that takes ([../product/commercialization.md](../product/commercialization.md#feature-map)).

## Complexity
Medium: two reference files, rings on the built map, a clustering function over the list, and a line in the price. The
Large of the first draft was the map view, which exists.

## Open questions
1. The airport and airfare tables add under a megabyte; publish them as reference files, not in `schools.json`.
2. International students have no home ZIP; a country picker with the nearest U.S. gateway airport is a later addition.
3. Do families plan visits by trip or by college? Telemetry from the Calendar tab's visit lane (built) answers it before
   this is built: if confirmed visits cluster by weekend, trips are the right unit.
