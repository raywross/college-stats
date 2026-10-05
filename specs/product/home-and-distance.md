# Home Address and Distance From Home

> Status: **built** 2026-10-05 on `feature/home-distance` ([below](#built-2026-10-05)): a home address on the
> account, Explore's "Distance from home" filter with a nearest-first sort, and the distance to every college on a
> saved list, for the student and for each guardian who opens it. The first slice of the
> [near-and-far](../ideas/near-and-far.md) idea; the map rings, nearest airports, visit trips, and the travel-cost
> line stay there. Part of [product](README.md).

## Goal
*How far is it?* is the first question most families ask about a college and the one the site couldn't answer.
A person enters their home address once. Explore can then find colleges within a chosen distance of home, and every
college on a saved list says how far away it is, with a rough drive time. When a student saves a list, each
guardian in the household who opens it sees the same colleges with distances from the guardian's own home.

Everything keeps working without an address: Explore's distance filter takes any ZIP code, signed in or not, and
lists simply omit the distance until a home is saved.

## Research (2026-10-05)
- **Geocoding.** The U.S. Census Bureau's public geocoder (`geocoding.geo.census.gov`, benchmark
  `Public_AR_Current`) matches a one-line U.S. address to coordinates with no key, no account, and no commercial
  terms; a request takes well under a second. Google, Mapbox, and HERE all need a billed key and their terms
  restrict storing results; Nominatim (OpenStreetMap) limits use to about one request a second and asks for
  attribution. For a family's home on a site with no other third-party calls, the federal service is the right
  fit. It geocodes street addresses only, not a bare ZIP or a city name.
- **ZIP centers.** The Census Bureau's Gazetteer file lists every ZIP Code Tabulation Area (its approximation of
  USPS ZIP codes, about 33,800 of them) with an internal point. It is public domain and about 1 MB zipped; kept as
  a checked-in reference table of three columns (`npm run build-zcta`), it answers a bare ZIP offline and gives
  Explore a center to measure from without any address leaving the browser.
- **Campus coordinates** already exist for every college (`location.lat`/`location.lng`, IPEDS HD, built for the
  map view in [campus-profile.md](../data-expansion/campus-profile.md)).
- **Distance and drive time.** Great-circle distance is exact for what it claims; a route is 15–30% longer on
  most trips. The site shows straight-line miles and labels the drive time an estimate (×1.25 at 55 mph), the
  same approach as the idea page. No routing service, nothing per visitor.
- **Privacy.** A home is the most sensitive thing an account holds after finances. Decisions: the address is
  looked up once and only the geocoder's match is stored (coordinates to three decimals, about 100 m); it is
  own-row only in the database, so no one in the household can read it; Explore's filter and every shareable link
  carry a ZIP code, never the address or exact coordinates; and nothing about it goes to analytics
  ([telemetry.md](telemetry.md#privacy)).

## Model
```
home_locations (user_id pk → auth.users, lat, lng, label, place, zip, updated_at)
```
- **One home per user, not per student or household.** Each person sees distances from where they live. Two
  parents in two homes each get the figures that matter to them, and a student's view is from the student's own
  address. A guardian viewing a managed student (no account yet) sees distances from the guardian's home, the only
  one there is. The cost is that a family living together types the address twice.
- `label` is the matched address, tidied ("1600 Pennsylvania Ave NW, Washington, DC 20500"); `place` is "City, ST"
  (or "ZIP 02139" for a ZIP-only home), what distance lines name; `zip` is what Explore's filter uses.
- A bare ZIP code is a valid home: its center from the reference table, labeled as such.
- Soft-deleting an account leaves the row (restore brings the home back); the scheduled purge removes it with
  the auth user. The export includes it (`home`).

## Display
- **`/account` → Home.** One field ("Street address, city, state, and ZIP, or just a ZIP code") → "Save home" looks
  it up and shows the match back; then "Colleges within 100 miles" (Explore, nearest first), "Change", and
  "Remove". The section says what is kept and that household members see distances from their own homes.
- **Explore → "Distance from home"** (first section of the filter panel): a ZIP field, "Apply", "Use my home"
  (signed in: fills the ZIP from the saved home; signed out: a sign-in prompt), and radius chips 25 / 50 / 100 /
  200 / 300 / 500 miles. Applying from the default sort switches to **Distance from home (nearest)**, a sort
  offered only while the filter is set. The active chip reads "Within 100 mi of 02139". Cards show "120 mi · about
  2½ hours by car" under the location; phone rows add "120 mi away"; the table leads with a sortable "From home"
  column. Colleges without reported coordinates are hidden while the filter is set, and an unknown ZIP is
  explained rather than ignored.
- **Saved lists** (`/me/lists/[id]`): each row adds "410 mi · about 7½ hours by car" with the ⓘ citing the campus
  coordinates' source and year; a line under the board says whose home the distances are from, with a link to
  Explore within 100 miles, or, without a home, a link to add one. A guardian sees the same page from their own
  home; the view is logged like any other guardian read of the list.
- **Glossary:** `home-address`, `distance-from-home` (the method and its two assumptions).

## Rules
- Distance is a straight line and says so; the drive time is "about" and never claims a route or minutes of
  precision. A college with no reported coordinates shows no distance and never matches the filter.
- The address itself never leaves the account page: Explore links, chips, and the sort carry a ZIP code only.
- A home is never shown to anyone but its owner, in any household role, and never appears in the access log
  (there is nothing of the student's to view).

## Files
| File | Role |
|---|---|
| `lib/home.ts` (pure) | `HomeLocation`, `NearHome`, `milesBetween`, `distanceFromHome`, `formatMiles`, `formatDriveTime`, `distanceLine`, `WITHIN_OPTIONS`/`DEFAULT_WITHIN`, `parseZip`, `zipIn`, `exploreNearHref`, `parseCensusGeocode`, `titleCaseAddress`, `zipHome`, `parseCentroidCsv` |
| `lib/zip-centroids.ts` (server) | `zipCentroid(zip)` over `data/reference/zcta-centroids.csv`; `resolveNear(filters)` fills `SearchFilters.near` from `nearZip`/`withinMiles` |
| `lib/geocode.ts` (server) | `geocodeAddress(text)`: the Census geocoder with an 8-second timeout, a bare ZIP or an unmatched address with a ZIP falling back to the ZIP's center |
| `lib/home-store.ts` (`"use server"`) | `myHome()`, `saveHomeAddress(text)`, `clearHome()`, through the signed-in user's own session |
| `scripts/build-zcta.mts` | `npm run build-zcta`: downloads the Gazetteer ZCTA file and writes the reference CSV (needs `unzip`) |
| `supabase/migrations/20261005160000_home_locations.sql` | The table and its own-row policies |
| `components/account/HomeForm.tsx`, `app/account/page.tsx` | The Home section |
| `components/explore/FilterPanel.tsx` (`DistanceSection`), `components/explore/Toolbar.tsx` | The filter, its chip, the sort option |
| `lib/params.ts`, `lib/types.ts`, `lib/dataset.ts` | `near`/`within` → `nearZip`/`withinMiles`; `SearchFilters.near`; the filter and `sortBy=distance` inside `getSchools()` |
| `app/explore/page.tsx`, `components/school/SchoolCard.tsx`, `components/school/SchoolRow.tsx`, `components/explore/SchoolTable.tsx` | Resolving the ZIP, the unknown-ZIP note, distance on every result view |
| `app/me/lists/[id]/page.tsx`, `components/lists/ListBoard.tsx` | Distance per list row and the footer line |
| `lib/account-export.ts` | The `home` exporter |
| `tests/home.test.mts`, `tests/home-policies.test.mts` | The pure rules, params, filter and sort on a small dataset, the reference table's sanity, source guards; row-level security against real Postgres with a guard that opens the policy and shows the leak |

## Built (2026-10-05)

### Decisions made while building
- **Per-user home** (the model above) rather than a field on the student profile: it keeps the privacy rule
  trivial (own row only, no household read path to reason about) and handles two homes. "Copy my home to my
  student" is an easy later addition if families ask for it.
- **Explore measures from a ZIP center, lists from the address.** The filter radii start at 25 miles, so the
  ZIP's center (typically within a mile or two of the address) changes nothing a family would notice, and it
  means a shared Explore link never carries a home. The two figures for the same college can differ by a mile or
  two; both say what they are.
- **Applying the filter switches to nearest-first only from the default sort.** A sort the visitor chose stays.
  Removing the chip, or "Reset", drops a distance sort along with the ZIP, since it has nothing to measure from.
- **The Census geocoder is called from a Server Action** (`saveHomeAddress`), never from the browser, so the
  request comes from the site and the visitor's IP and browser aren't sent to the Bureau. The input is capped at
  200 characters and the call at 8 seconds; failures say whether to retry or to try a ZIP code.
- **Reference table in git** (`data/reference/zcta-centroids.csv`, about 740 KB, three decimals): read with `fs`
  on first use and traced into the deployment like the other data files (`next.config.ts`). It is not part of the
  dataset publish and has no lineage registration: it describes ZIP codes, not colleges, and no displayed college
  value comes from it.
- **The distance shown on a list cites `location.lat`** (IPEDS HD) through the usual ⓘ, so the source and year of
  the campus coordinates stay visible; the home side of the calculation is the user's own input.
- **Not built:** distance on the college profile hero and in Compare, the map's home marker and drive-time rings,
  nearest airports, visit trips, and the travel-cost line ([near-and-far.md](../ideas/near-and-far.md)); a
  per-household shared home; sorting a saved list by distance (rows keep the student's order).

### Setup (owner)
1. **Apply the migration** to the dev project: SQL Editor → paste
   `supabase/migrations/20261005160000_home_locations.sql` → Run (after the accounts migration; prod at the formal
   release). Until then the Home section says "Home addresses aren't set up on this site yet" when saving, and lists
   and Explore simply show no distances.
2. Nothing else: no new environment variables, and the geocoder needs no key. Vercel's functions can reach
   `geocoding.geo.census.gov`; if the Bureau's service is down, saving says so and a ZIP code still works offline.
3. **Refresh the ZIP table yearly** (optional): `npm run build-zcta` after the Census Bureau posts the next
   Gazetteer vintage (update `VINTAGE` in the script), then commit the CSV.
