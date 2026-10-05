# Home Address and Distance From Home

> Status: **built** 2026-10-05 on `feature/home-distance` ([below](#built-2026-10-05)): a home address for the
> household, Explore's "Distance from home" filter with a nearest-first sort, and the distance to every college on a
> saved list, the same for the student and for each guardian who opens it. The first slice of the
> [near-and-far](../ideas/near-and-far.md) idea; the map rings, nearest airports, visit trips, and the travel-cost
> line stay there. The same build settled households at one per account with six seats
> ([accounts.md](accounts.md#built-one-household-six-seats-2026-10-05)). Part of [product](README.md).

## Goal
*How far is it?* is the first question most families ask about a college and the one the site couldn't answer.
Someone in the household enters the home address once. Explore can then find colleges within a chosen distance of
home, and every college on a saved list says how far away it is, with a rough drive time. When a student saves a
list, each guardian who opens it sees the same colleges at the same distances, because a household has one home.

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
- **Whose home?** Two-household children are a real minority: shared physical custody rose from 13% of divorces
  before 1985 to 34% in 2010–2014 (Demographic Research 46:38), and a recent national survey puts it at 29% of
  divorced custodial parents (Current Population Survey, Child Support Supplement). But a high-schooler attends one
  school, so when a child does split time, both homes are in the same area; against radii of 25 to 500 miles the
  difference is noise. The one real "two cities" case, a noncustodial parent far away, is a finances question the
  aid rules already treat separately (the FAFSA now picks the parent who provides more support regardless of
  residence; the CSS Profile has the noncustodial parent file privately), not a reason for two homes. Hence **one
  home per household**; a far-away parent can still type their own ZIP into Explore.
- **How many households, how big?** Apple Family Sharing and Google family groups allow one group at a time and
  six members (switching limited to once a year); Amazon Household allows two adults, four teens, and four
  children with a 180-day lockout after leaving; Spotify Premium Family requires six people at one verified
  address; Netflix defines a household by one primary location. Scoir and Naviance link parents to students by
  invitation with no household object or size limit. The site's households are richer than either kind; **one
  household per account and six seats in any mix** brings them in line with the pattern families already know.
  The switching lockouts exist to stop paid-plan sharing and can wait for a paid plan.
- **Privacy.** A home is the most sensitive thing an account holds after finances. Decisions: the address is
  looked up once and only the geocoder's match is stored (coordinates to three decimals, about 100 m); it is
  readable by the household's active members only, so a former member loses it the moment they leave; Explore's
  filter and every shareable link carry a ZIP code, never the address or exact coordinates; and nothing about it
  goes to analytics ([telemetry.md](telemetry.md#privacy)).

## Model
```
household_homes (household_id pk → households, lat, lng, label, place, zip, set_by, set_by_name, updated_at)
```
- **One home per household.** Any active member (guardian or student) sets, changes, or removes it; the row keeps
  who set it and their name at the time ("Set by Mom on Oct 5"), the way list edits are attributed. Every member
  sees the same distances. A guardian viewing a managed student (no account yet) sees the household's home, the
  only one there is.
- **A home needs a household.** Someone with none starts one first (a name and a role, on the household page) and
  sets the home inside it. When they later accept an invitation to join the family's, that one-person household is
  dissolved and its home carried over if the new household has none
  ([accounts.md](accounts.md#built-one-household-six-seats-2026-10-05)).
- `label` is the matched address, tidied ("1600 Pennsylvania Ave NW, Washington, DC 20500"); `place` is "City, ST"
  (or "ZIP 02139" for a ZIP-only home), what distance lines name; `zip` is what Explore's filter uses.
- A bare ZIP code is a valid home: its center from the reference table, labeled as such.
- Deleting the household (the scheduled purge, after everyone has gone) removes the home with it; the export
  includes it (`home`).

## Display
- **`/account/household` → Home address**, inside the household's card, under its members (owner, 2026-10-05: the
  address is set where the household is managed, not in a section of its own). One field ("Street address, city,
  state, and ZIP, or just a ZIP code") → "Save home" looks it up and shows the match back with who set it; then
  "Colleges within 100 miles" (Explore, nearest first), "Change", and "Remove". The form says anyone in the
  household can change it, what is kept, and that nobody outside the household can see it. `/account`'s household
  summary shows the saved home (or "No home address yet") and links to the household page.
- **Explore → "Distance from home"** (first section of the filter panel): a ZIP field, "Apply", "Use my home"
  (signed in: fills the ZIP from the household's home; signed out: a sign-in prompt), and radius chips 25 / 50 /
  100 / 200 / 300 / 500 miles. Applying from the default sort switches to **Distance from home (nearest)**, a sort
  offered only while the filter is set. The active chip reads "Within 100 mi of 02139". Cards show "120 mi · about
  2½ hours by car" under the location; phone rows add "120 mi away"; the table leads with a sortable "From home"
  column. Colleges without reported coordinates are hidden while the filter is set, and an unknown ZIP is
  explained rather than ignored.
- **Saved lists** (`/me/lists/[id]`): each row adds "410 mi · about 7½ hours by car" with the ⓘ citing the campus
  coordinates' source and year; a line under the board says the distances are from the household's home in
  {place}, with a link to Explore within 100 miles, or, without a home, a link to add one.
- **Glossary:** `home-address`, `distance-from-home` (the method and its two assumptions); `household` says one
  per account, six seats, one home.

## Rules
- Distance is a straight line and says so; the drive time is "about" and never claims a route or minutes of
  precision. A college with no reported coordinates shows no distance and never matches the filter.
- The address itself never leaves the account page: Explore links, chips, and the sort carry a ZIP code only.
- A home is visible to the household's active members and nobody else, and never appears in the access log
  (it is household data, not a student's).

## Files
| File | Role |
|---|---|
| `lib/home.ts` (pure) | `HomeLocation`, `NearHome`, `milesBetween`, `distanceFromHome`, `isWithinHome`, `formatMiles`, `formatDriveTime`, `distanceLine`, `WITHIN_OPTIONS`/`DEFAULT_WITHIN`, `parseZip`, `zipIn`, `exploreNearHref`, `parseCensusGeocode`, `titleCaseAddress`, `zipHome`, `parseCentroidCsv` |
| `lib/zip-centroids.ts` (server) | `zipCentroid(zip)` over `data/reference/zcta-centroids.csv`; `resolveNear(filters)` fills `SearchFilters.near` from `nearZip`/`withinMiles` |
| `lib/geocode.ts` (server) | `geocodeAddress(text)`: the Census geocoder with an 8-second timeout, a bare ZIP or an unmatched address with a ZIP falling back to the ZIP's center |
| `lib/home-store.ts` (`"use server"`) | `myHome()` (the household's home, via `my_household()`), `saveHomeAddress(householdId, text)`, `clearHome(householdId)` (the policies refuse a household the caller isn't in) |
| `scripts/build-zcta.mts` | `npm run build-zcta`: downloads the Gazetteer ZCTA file and writes the reference CSV (needs `unzip`) |
| `supabase/migrations/20261005170000_household_limits_and_home.sql` | `household_homes` and its member-only policies, with the household limits (accounts.md) |
| `components/account/HomeForm.tsx` (inside `HouseholdCard.tsx`), `app/account/household/page.tsx`; `HouseholdSummary.tsx` on `/account` | The Home address block of the household card; the summary line |
| `components/explore/FilterPanel.tsx` (`DistanceSection`), `components/explore/Toolbar.tsx` | The filter, its chip, the sort option |
| `lib/params.ts`, `lib/types.ts`, `lib/dataset.ts` | `near`/`within` → `nearZip`/`withinMiles`; `SearchFilters.near`; the filter and `sortBy=distance` inside `getSchools()` |
| `app/explore/page.tsx`, `components/school/SchoolCard.tsx`, `components/school/SchoolRow.tsx`, `components/explore/SchoolTable.tsx` | Resolving the ZIP, the unknown-ZIP note, distance on every result view |
| `app/me/lists/[id]/page.tsx`, `components/lists/ListBoard.tsx` | Distance per list row and the footer line |
| `lib/account-export.ts` | The `home` exporter |
| `tests/home.test.mts`, `tests/home-policies.test.mts` | The pure rules, params, the filter predicate and source guards, the reference table's sanity; row-level security against real Postgres (members read and set, outsiders and leavers don't, cascade) with a guard that opens the policy and shows the leak |

## Built (2026-10-05)

### Decisions made while building
- **Household home, not per user.** A first draft kept one home per user (each person seeing distances from where
  they live). The owner's question "shouldn't the address belong to the household?" led to the research above:
  the kids live in one place for this purpose, and a parent in another city is the finances case, not the
  distance case. Household it is; it also means a guardian and a student never see different numbers for the same
  college.
- **Any member sets it.** The home is household data, so a view-only guardian may set it (edit access concerns
  the student's own data). Attribution (`set_by`, `set_by_name`) keeps it honest; `set_by_name` is a snapshot
  because `profiles` is own-row only.
- **Set inside household management** (owner, 2026-10-05, after seeing the first version): the form sits in the
  household card on `/account/household`, and `/account` only shows the saved home in its household summary. The
  first version had a Home section of its own on `/account` and made a one-person household on the fly when
  someone with none saved a home; with the form inside a household's card there is always a household, so that
  path went away.
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
  the campus coordinates stay visible; the home side of the calculation is the household's own input.
- **Not built:** distance on the college profile hero and in Compare, the map's home marker and drive-time rings,
  nearest airports, visit trips, and the travel-cost line ([near-and-far.md](../ideas/near-and-far.md)); a second
  home for a household; sorting a saved list by distance (rows keep the student's order).

### Setup (owner)
1. **Apply the migration** to the dev project: SQL Editor → paste
   `supabase/migrations/20261005170000_household_limits_and_home.sql` → Run (after the accounts, households, and
   invitation-links migrations; prod at the formal release). It also drops the per-user `home_locations` table if the first draft of
   this migration was ever applied. Until then the Home section says "Home addresses aren't set up on this site yet"
   when saving, and lists and Explore simply show no distances.
2. Nothing else: no new environment variables, and the geocoder needs no key. Vercel's functions can reach
   `geocoding.geo.census.gov`; if the Bureau's service is down, saving says so and a ZIP code still works offline.
3. **Refresh the ZIP table yearly** (optional): `npm run build-zcta` after the Census Bureau posts the next
   Gazetteer vintage (update `VINTAGE` in the script), then commit the CSV.
