# Housing and Policies (IPEDS COST1)

> Status: **planned**. Wave 1. `COST1_{Y}` is already downloaded for prices (history, and sync-data's fallback).
> Research 2026-09-28. Part of [data-expansion](README.md).

## Question it answers
*Can I live on campus? Do first-years have to? How much is the application fee? Is tuition locked in?*

## Source
`COST1_2024` (2024–25 institutional characteristics; verified for Vanderbilt). Before 2023–24 these were in `IC{Y}`.

| Column | What | Vanderbilt |
|---|---|---|
| `ROOM` | Offers institutionally controlled housing | 1 (yes) |
| `ROOMCAP` | Housing capacity (beds) | 6,289 |
| `ALLONCAM` | First-time full-time students must live on campus | 1 (yes) |
| `BOARD`, `MEALSWK` | Meal plan offered; meals per week | yes, 21 |
| `ROOMAMT`, `BOARDAMT` | Typical housing and food charges | $14,124, $7,930 |
| `APPLFEEU` | Undergraduate application fee | $50 |
| `TUITPL1`–`4` | Tuition guarantee, prepaid, payment plan, other | payment plan |
| `PRMPGM` | Participates in a Promise program | 2 (no) |

`ROOMAMT`/`BOARDAMT` overlap with the room & board already in `cost.breakdown`; don't duplicate, cite the same file.

**Derived:** beds per undergraduate = `ROOMCAP ÷ undergrad_enrollment`. Capacity includes graduate housing at some
colleges, so label it "housing capacity for every 100 undergrads" and cap the display at "room for all".

CDS **F1** adds "percent who live in college housing" (first-years and all undergrads): Vanderbilt 100% / 84%. That's
occupancy, better than capacity. Add it when the college-reported agent reads section F (the same pass as
[greek-life.md](../greek-life.md)).

## Ingest
`sync-data` reads these columns from the price table it already loads (`IC{Y}_AY`/`COST1`); check where each column
lives in each era (IC vs COST1) the same way `priceSuffix()` handles prices, and assert the columns exist.

## Store
```ts
campus.housing: { offered: boolean, capacity: number | null, first_years_required: boolean | null,
                  meal_plan: boolean | null, meals_per_week: number | null } | null
admissions.application_fee: number | null
cost.tuition_plans: ("guarantee" | "prepaid" | "payment_plan" | "other")[]
cost.promise_program: boolean | null
```
New topic `campus` in `Topic`. Source `ipeds-ic` (the COST1 file is cited as the IC price component today).

## Display
- **Profile:** a new **Campus life** section (shared with [campus-services.md](campus-services.md), religious and Greek
  life later): housing capacity bar ("Beds for 87 of every 100 undergrads"), "First-years live on campus", meals.
- **Admissions:** application fee next to the funnel ("$50 to apply; fee waivers" when CDS C13 says so).
- **Cost:** "Tuition guarantee" badge; Promise program note linking to the state program glossary entry.
- **Explore filters:** "Guaranteed housing for first-years", "No application fee", "Tuition guarantee".

## Keep history?
- **Housing capacity per undergrad: series** (IC files have it back to at least 2000 *unverified*; COST1 from 2023–24).
  Cheap once the price eras are mapped.
- **Application fee: series** (nominal, adjust with CPI like prices). Interesting in "Over time" → Cost.
- Live-on requirement, tuition plans, Promise: **events**.

## Top-level trend?
- **No hero, no Home fact.** Changes are small and don't answer a decision question over 10 years.
- **"Over time" → Cost:** application fee after inflation, as a small line.
- **"Known for":** "Room for every undergrad" when capacity ≥ undergrads (large residential colleges).

## Open questions
1. Capacity includes grad housing: check against CDS F1 at the pilot colleges before showing a per-undergrad ratio.
