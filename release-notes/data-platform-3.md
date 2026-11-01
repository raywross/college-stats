---
title: "A new home for the college data, phase 3: edits by hand"
pr: 204
date: 2026-10-31
kind: feature
summary: Quad's editors can now correct any value on a college's page from the console, the fix shows on the site at once and is cited as "Edited by Quad", and the release calendar and other hand-kept documents are edited the same way.
---

## What's new

When a pipeline gets a number wrong or misses one, Quad's editors can now set it by hand. The value shows on the
college's page right away, and its ⓘ says so: "Edited by Quad on October 31, 2026", with a note when the editor left
one. A profile with any edited value lists "Some values edited by Quad" among its sources, and the Data API reports the
same lineage, so nothing on the site is uncited. Compare and the Data API's single-college routes show edits too.

## Behind the scenes

- **The Edit page.** Every registered field of a college, grouped by topic, with its current value and citation and an
  input shaped by the data (a number, a share, true/false/none, a date, a pick from the values other colleges use, or
  JSON for a list or table). Save, Release (let the pipelines' value show again), and a per-field History with Revert to
  this. When a pipeline later produces a newer value for an edited field, the row says so and offers Release.
- **Edits are a layer.** The publisher applies them last, so the next snapshot bakes them in; until then the site
  overlays the live edits on the pages that show one college, reading them once per request and falling back to the
  snapshot if the database is unreachable. Each snapshot records the edits it carries and the pipeline values they
  cover in a small `edits.json`.
- **The Reference screen.** The release calendar, aid policies, state laws, guaranteed- and major-admission tables,
  the application cycle, organizations, curated aliases and the essay guidance text are edited in the console with
  each document's own validator, with every version kept and Revert to version.
- **A limit worth knowing.** A stored derived value (an admit rate computed from counts) does not recompute when an
  input is edited; the Edit page says so under such a row and names the fields that read it, so an editor sets both.
