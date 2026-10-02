# Housing and Policies (IPEDS IC / COST1)

> Status: **built** 2026-09-29. Wave 1. Research 2026-09-28; files and codes probed 2026-09-29 against the COST1_2024
> data dictionary. Part of [data-expansion](README.md).

## Question it answers
*Can I live on campus? Do first-years have to? How much is the application fee? Is tuition locked in?*

## Source
IPEDS Institutional Characteristics. The columns sit in `IC{Y}` (academic year Y–Y+1) through **IC2023**; from 2024–25
NCES moved them into `COST1_{Y+1}` (`COST1_2024` has them; `IC2024` is a one-row stub).

| Column | What | Codes (COST1_2024 dictionary) | Vanderbilt 2023–24 | Years |
|---|---|---|---|---|
| `ROOM` | Offers college-controlled housing | 1 yes, 2 no | yes | IC2001 on |
| `ROOMCAP` | Housing capacity (beds; can include graduate housing) | count | 6,009 | IC2001 on |
| `ALLONCAM` | *All* full-time first-time students must live on campus | 1 yes, 2 no, −2 no housing | yes | ~IC2005 on |
| `BOARD`, `MEALSWK` | Meal plan; meals a week in the largest plan | 1 yes (count given), 2 yes (varies), 3 no | yes, 21 | IC2001 on |
| `APPLFEEU` | Undergraduate application fee | dollars; 0 = no fee | $50 | IC2001 on |
| `TUITPL`, `TUITPL1`–`4` | Any alternative tuition plan; guarantee, prepaid, payment plan, other | 1 yes, 2 no; then 1 yes, 0 implied no | payment plan (2024–25) | ~IC2013 on |
| `PRMPGM` | Takes part in a Promise program | 1 yes, 2 no | no | IC2022 on |

`ROOMAMT`/`BOARDAMT` repeat the room and board already in `cost.components` (from the price file), so they aren't stored.

**Which year:** the same academic year as the site's prices (IC2023 = 2023–24), cited as the IPEDS IC release like the
prices. 2024–25 exists in COST1_2024; it arrives with the backlog's "2024–25 sticker prices" item, when prices move.

What the 2026-09-29 sync found (1,893 colleges): 1,889 reporting; 1,562 offer housing (median college: 59 beds per 100
undergrads; 246 have more beds than undergrads, often because of graduate housing); only **55** say every first-year
must live on campus (the question is strict: most residency rules have exceptions); 804 charge no application fee
(median $25, highest $500); 146 offer a tuition guarantee; 359 take part in a Promise program. `MEALSWK` is 99 at 58
colleges, which the dictionary doesn't define, so meals a week are shown only from 1 to 28.

## Ingest
`sync-data` loads the characteristics file for the price year (`IC{start}`, else `COST1_{end}`, taking the first that
actually has the columns) and reads it with `housingFrom`, `applicationFeeFrom`, `tuitionPlansFrom`, and
`promiseProgramFrom` in `lib/derive.ts`, which the history build shares.

## Store
```ts
campus.housing: { offered: boolean, capacity: number | null, first_years_required: boolean | null,
                  meal_plan: boolean | null, meals_per_week: number | null } | null
admissions.application_fee: number | null          // 0 = no fee
cost.tuition_plans: ("guarantee" | "prepaid" | "payment_plan" | "other")[] | null   // [] = none
cost.promise_program: boolean | null
```
New topic `campus` ("Housing & campus life"). All cite `ipeds-ic` with the prices' year.

## Display
- **Profile, Campus life** (the second half of the students page, `/schools/{id}/students#campus`; religious life, Greek life, and campus services join it later):
  beds, "about N for every 100 undergrads" against the median college (with "can include graduate housing"), whether
  first-years must live on campus, and meal plans. One-line headline via `campusTakeaway()`.
- **Admissions:** "$50 to apply" or "No application fee" under the funnel.
- **Cost:** "Tuition guarantee" and "Part of a Promise program" badges after "What students pay", with glossary tips.
- **Explore:** a "Housing & policies" filter: "First-years live on campus" (55), "No application fee" (804), "Tuition
  guarantee" (146); `lib/housing.ts` holds the rules.
- **Compare:** application fee, beds, live-on rule, tuition guarantee, Promise program.
- **Glossary:** `housing-capacity`, `live-on-requirement`, `application-fee`, `tuition-guarantee`, `promise-program`.

**Changed from the plan:** the filter is "First-years live on campus", not "Guaranteed housing" (the data says
required, not guaranteed). The "Room for every undergrad" chip is left out: capacity includes graduate housing, and the
spec's own open question was to check that against CDS F1 first.

## Keep history?
- **Series `housing_capacity`** (beds) and **`application_fee`** (charted after inflation, like other money), 2001–02 on,
  from a new history family `characteristics` (`IC{Y}` through 2023, then `COST1_{Y+1}`). Charted in Over time →
  Students (beds) and → Admissions (fee). The build checks both end on the snapshot's values.
- **Live-on requirement, tuition plans, Promise program: events** (series `live_on`, `tuition_guarantee`, `promise`), shown by the events log that
  [admission-factors.md](admission-factors.md) builds.

## Top-level trend?
- **No hero, no Home fact.** Changes are small and don't answer a decision question over 10 years. (The median
  application fee fell about 24% after inflation over 10 years, mostly because fees stayed flat while prices rose.)

## Open questions
1. Capacity includes graduate housing: check beds per undergrad against CDS F1 ("percent living in college housing") at
   the pilot colleges before any per-undergrad claim stronger than "about N for every 100".
