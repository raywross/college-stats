---
title: "Distance from home: an address for your household, a filter on Explore, and miles on your list"
pr: 87
date: 2026-10-05
kind: feature
summary: Save your household's home address once and the site says how far each college is, filters Explore to colleges within a chosen number of miles of home, and shows the same distances to the student and the parents who see their list. Households now hold up to six people, and an account is in one household at a time.
---

## What's new

**How far is it?** was the first question the site couldn't answer. Now it can.

**Your household's home** ([Your account](/account) → Household → Home address): start typing a street address and
pick it from the suggestions, or enter just a ZIP code, and we look it up once. Everyone in your household sees distances from that one home, whoever set it: a
parent and a student looking at the same list see the same miles. On your own? Start a household first (it just
needs a name); your home comes along when you later join your family's.

**Explore within a distance** ([Explore](/explore) → "Distance from home", the first filter): type a ZIP code, or
tap **Use my home** when you're signed in, then pick 25, 50, 100, 200, 300, or 500 miles. The results sort
nearest-first, and every college shows its distance and a rough driving time, such as "120 mi · about 2½ hours by
car". This works without an account too: any ZIP code will do, and links you share carry only the ZIP code, never
an address.

**Your list, with distances** ([My list](/me/list)): each college on a saved list shows its miles from home and
the drive time. If your household hasn't saved a home yet, the list says where to add one.

**Households: one each, up to six people.** An account now belongs to one household at a time, and a household
holds up to six people in any mix of parents and students, counting invitations that are waiting for an answer.
Someone alone in a household of one can accept an invitation to join yours; their one-person household closes
behind them.

Distances are straight-line ("as the crow flies"), and the drive time is an estimate (roads add about a quarter,
at 55 mph on average), never a route. The glossary explains both under "Distance from home".

## Behind the scenes

- Suggestions as you type come from Google's address service, asked from our server so your browser never talks
  to Google. The address you save is matched with the U.S. Census Bureau's public geocoder, a federal service that
  needs no key and sets no commercial terms on the result. We keep that match and its coordinates rounded to about
  100 m, and the name of whoever set it, not what was typed.
- The home lives in its own table with row-level security that allows only the household's active members; a test
  opens that rule on purpose and shows the leak the real rule prevents.
- The one-household rule and the six seats are enforced in the database functions that create households, add
  students, and send and accept invitations, with a trigger as the backstop for everything else; tests prove each
  check and show what fails without it.
- Explore's filter measures from the center of the ZIP code, using a checked-in table of ZIP Code Tabulation Area
  centers from the Census Bureau's Gazetteer file (public domain, refreshed yearly with `npm run build-zcta`).
- Each college's campus coordinates come from the federal IPEDS directory, and the ⓘ beside a distance cites
  their source and year, like every other figure.
