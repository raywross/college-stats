---
title: "Distance from home: an address on your account, a filter on Explore, and miles on your list"
pr: 87
date: 2026-10-05
kind: feature
summary: Save your home address once and the site says how far each college is, filters Explore to colleges within a chosen number of miles of home, and shows a parent the distance from their own home on a student's list.
---

## What's new

**How far is it?** was the first question the site couldn't answer. Now it can.

**Your home** ([Your account](/account) → Home): enter your street address, or just a ZIP code, and we look it up
once. From then on, every distance on the site is measured from there. Only you can see your address; the other
people in your household see distances from their own homes.

**Explore within a distance** ([Explore](/explore) → "Distance from home", the first filter): type a ZIP code, or
tap **Use my home** when you're signed in, then pick 25, 50, 100, 200, 300, or 500 miles. The results sort
nearest-first, and every college shows its distance and a rough driving time, such as "120 mi · about 2½ hours by
car". This works without an account too: any ZIP code will do, and links you share carry only the ZIP code, never
an address.

**Your list, with distances** ([My list](/me/list)): each college on a saved list shows its miles from home and
the drive time. When a parent or guardian opens a student's list, the distances are from the parent's own home,
which is what matters when two parents live in different places. If you haven't saved a home yet, the list says
where to add one.

Distances are straight-line ("as the crow flies"), and the drive time is an estimate (roads add about a quarter,
at 55 mph on average), never a route. The glossary explains both under "Distance from home".

## Behind the scenes

- Addresses are matched with the U.S. Census Bureau's public geocoder, a federal service that needs no key and
  sets no commercial terms on the result. We keep the matched address and its coordinates rounded to about 100 m,
  not what you typed.
- The home lives in its own table with row-level security that allows only the owner's row; a test opens that
  rule on purpose and shows the leak the real rule prevents.
- Explore's filter measures from the center of the ZIP code, using a checked-in table of ZIP Code Tabulation Area
  centers from the Census Bureau's Gazetteer file (public domain, refreshed yearly with `npm run build-zcta`).
- Each college's campus coordinates come from the federal IPEDS directory, and the ⓘ beside a distance cites
  their source and year, like every other figure.
