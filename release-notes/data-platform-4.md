---
title: "A new home for the college data, phase 4: the repository is code again"
pr: 205
date: 2026-11-01
kind: infra
summary: The college data no longer lives in the code repository at all; the site, its pipelines and its tests read the published snapshot or a small fixture, which makes the project lighter to work on and keeps every value's history in one place.
---

## What's new

Nothing changes on the site. This is the last step of moving Quad's college data out of the code repository and
into the database that already serves the site: the 210 MB of data files that used to ride along with every copy of
the code are gone. The hand-kept reference tables (aid policies, state laws, course catalogs and the like) now reach
the site the same way everything else does, through a published snapshot, so a correction made in the console shows
on the site after the next publish and deploy.

## Behind the scenes

- **The app reads the bundled copy.** Its compiled-in reference tables import from the snapshot fetched at build, and
  the loader has no file mode left; a checkout with nothing configured gets a small fixture at install so it still
  typechecks and builds.
- **The publisher renders every reference document** and gains gates: each document's own validator, the Common Data
  Set records against their manifest, and the legacy overrides. A problem fails the publish with nothing uploaded.
- **The tests read a fixture**: 38 real colleges, every reference document and two high-school states, about 9 MB,
  rebuilt from a snapshot and the store and checked against itself. About 150 test files were pointed at it, and a
  guard fails any code or script that reads the old folder.
- **Scripts without a home were retired**: the merge scripts that wrote the old file layout, several one-off backfills,
  and the file fallbacks in the pipelines. The check scripts the build runs read the bundled copy, and the workflows
  whose scripts need every college fetch the current snapshot first.
- **Still outside the snapshot**: the high-school layers, which production serves from the database tables.
