---
title: The source and year of every number
pr: 5
date: 2026-09-28
kind: feature
summary: Every value now traces to its source, release year, and method, and automatic checks fail when it doesn't.
---

## What's new

- **Pop-ups show where a number comes from.** Each metric's ⓘ now shows the value's source, year, and when it was
  retrieved. Calculated values also show the formula and each input's source.
- **Tags for values that differ.** A value from a different source or year than the rest of its section gets a tag
  such as `CDS 2024-25`, and the section explains what the tag means. Calculated values inherit the tag from their
  inputs.
- **Years on every footnote.** Section footnotes show years, profiles end with a numbered source list, and the Compare
  table tags individual cells.

## What was wrong before

Sources were tracked per *topic*. When a college's Common Data Set supplied enrollment, the whole demographics topic
was credited to it, including figures that still came from the College Scorecard. Sources are now tracked field by
field.

## Behind the scenes

- `lib/fields.ts` registers every stored and derived field with its default source, release year, and formula;
  `lib/lineage.ts` resolves and validates lineage for the site, the data sync, and the tests.
- Guards: typed citations, a lineage validator in the sync and in `npm run check:lineage`, a test that bans
  hard-coded data years in app code, and a new **Verify** workflow that runs all of it plus a production build on
  every pull request.
- Re-syncing all 1,893 colleges changed no values; only lineage was added.

Details: [data-lineage.md](../specs/data-lineage.md).
