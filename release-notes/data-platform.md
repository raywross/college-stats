---
title: "A new home for the college data, phase 1"
pr: 201
date: 2026-10-31
kind: infra
summary: The college dataset gains a database home with history and revert, a publisher that renders it into a snapshot the site can load without a deploy, and the start of an admin section for it; nothing changes on the site yet.
---

## What's new

Nothing visible yet. This release lays the foundation for a change in how Quad's college data is kept and
published, so that later releases can update the site without a code deploy, keep a history of every change with a
way to undo it, and let Quad's editors correct a value directly.

## Behind the scenes

- **The database as the source of truth.** Five new tables hold the data pipelines' outputs as versioned documents
  grouped into change sets, plus admin edits and a record of every published snapshot. Nobody writes the tables
  directly: pipelines and the console go through functions that keep the history and log every action.
- **An import from the repository** reads today's committed files once and writes every layer, stripping each
  composed college back to its base so the layers can be composed again.
- **A publisher** composes the layers with the same merge code the site has always used, checks lineage, renders a
  snapshot (gzipped objects in a public Storage bucket plus a pointer to the newest), and records what changed. Its
  output for the imported layers equals today's `data/schools.json` byte for byte, and every history and detail shard
  matches its file.
- **The site can load a snapshot.** With one environment variable set, each server instance loads the newest snapshot
  at cold start, re-reads the pointer at most once a minute, and swaps to a newer snapshot atomically, with a copy
  bundled at build time as the fallback. Every page names the snapshot it was served from. Nothing is configured yet,
  so the site keeps reading the files in the deploy exactly as before.
- **A mini fixture** of twelve colleges, layers and snapshot, for tests that no longer need the whole dataset.
- **The console's Data section**, read-only for now: which snapshot each environment serves, the change sets since the
  last publish, holds, and the list of snapshots with "Point back here".
- Four migrations, applied to the development project; the free plan's database is already near its size limit, so
  the full import waits on the Pro plan or on pruning old visit events.
