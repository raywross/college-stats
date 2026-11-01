# The data platform: Supabase as the source of truth, a published snapshot as the serving copy

> Overview of the data platform specs (not a work item itself; the roadmap item is [rollout.md](rollout.md)). Written
> 2026-10-31 from the owner's brief and answers (below); the build starts the same day in phases. This reverses one half of
> [serving-architecture.md](../serving-architecture.md) (2026-10-07), which made **git the source and the deploy the
> serving copy**, and keeps the other half: the app still holds the whole college dataset in memory and queries it
> there. What moves is where the data lives between runs, how a change becomes live, and who may change it.

## The owner's brief (2026-10-31)
"I really think we should move to a model where everything is stored in the database. I'm not liking the whole PR
pipeline thing where we go fetch data and then commit it to the repo then publish the site. I think it would work
better if we just had a more robust database and then our data pipelines would make updates into the database where
we had some history for each of the tables so we can track and potentially revert changes. That would also allow an
admin to make changes directly in the admin tool."

Decisions from the owner's answers the same day:
| Question | Decision |
|---|---|
| Hosting | Build and test on the free dev project; upgrade to **Supabase Pro** before production serving switches to live snapshots |
| How live | The app fetches the newest snapshot at cold start and hot-swaps when a newer one appears; a bundled copy from build time is the fallback. No deploy per data change |
| Review | Mature pipelines publish automatically behind their circuit breakers; the admin reviews only what was held, with a one-click revert |
| Scope | Everything at once: every collection under `data/` and every pipeline, in phases that never leave the site worse |
| Git's role | Code, specs, the field registry, small test fixtures. Published snapshots are versioned objects in Storage, not commits |
| Environments | Public data has one store, read by the dev site and production alike; people's data stays per environment |
| Admin edits | Any registered value, **no source or quote required**: "our source quoting can weaken over time… I want the admin to be able to improve the data quality through manual changes." Edits are versioned per field with revert |
| Ownership | One session builds it; the other essays session is wrapped up; backlog specs may be edited to match |

## What exists today, in one table
| Store | Holds | Notes |
|---|---|---|
| Git, shipped in the deploy | `data/schools.json` (34 MB, 1,893 colleges), history and detail shards (1,893 each), national trends, meta, release calendar, aliases, directories, reference files | Read from disk once per server instance ([lib/data.ts](../../lib/data.ts)); 209 MB folder, about 100 MB traced into every function |
| Git, not shipped | Pipeline working state: review queue (11 MB), college sources, docs manifest, batches, failures, health, site probe, reports | Rewritten by every run; a merge roughly weekly |
| Supabase | People's data; high schools (35,000 rows, the one dataset already in tables, `HIGH_SCHOOLS_SOURCE`); visit events (never in git); the change log and tier history (both computed by diffing two git commits); `app_settings`; `essay_prompt_overrides` (PR #199, database-first with a nightly export to git) | |
| The GitHub App | The console's "Accept the value", "Reject", "Re-run discovery" each make a branch, a commit, a PR and auto-merge | A PR per click |

Three models already run side by side. This spec keeps one.

## The design in one paragraph
Every pipeline writes the **layer** it owns (the IPEDS and Scorecard base, identity, college-reported, directories,
Common App, Coalition, essays, history, high schools, hand-kept reference files) as versioned documents in Supabase,
inside a **change set** that names the run. A **publisher** composes the layers into the same documents the app reads
today, using the merge functions that exist now and in the same order `sync-data` runs them, checks lineage, and
writes a **snapshot**: gzipped objects in a public Storage bucket plus a pointer to the newest. The app loads the
snapshot once per instance and swaps to a newer one when the pointer moves. **Admin edits** are a layer applied last,
shown live before the next snapshot bakes them in. Change sets, document versions and snapshots are the history;
reverting a change set or pointing back at an older snapshot is the revert. Git stops holding data.

```
IPEDS/Scorecard ─► sync-data ─┐
college sites ──► reported ───┤                                  ┌─► Storage: snapshots/<id>/colleges.json.gz, shards, pointer
Wikidata/sites ─► identity ───┼─► layers (versioned documents, ──► publisher ─┤   data_snapshots, dataset_changes, selectivity history
directories ────► campus ─────┤    one change set per run)                    └─► the app: load once, swap when the pointer moves
admin console ──► edits ──────┘         ▲
                                   history & revert
```

## The parts
| Part | File | What it settles |
|---|---|---|
| 1 | [storage.md](storage.md) | The tables: layers as versioned documents, change sets, field edits, snapshots; row-level security; the `admin_*` functions |
| 2 | [publish.md](publish.md) | The publisher: composing layers with today's merge code, lineage, rendering, uploading, the pointer; the change log and tier history from snapshots; the runtime loader and its fallback |
| 3 | [change-sets.md](change-sets.md) | Runs, breakers, holds, review, publish and revert; admin edits and their live overlay; what history means for each |
| 4 | [pipelines.md](pipelines.md) | Each producer's move from files to layers, in a table; the `DataStore` adapter; what each workflow becomes |
| 5 | [git-ci-tests.md](git-ci-tests.md) | What leaves git; the tests that read committed data and what each becomes; tracing; the build's snapshot fetch; the mini fixture |
| 6 | [rollout.md](rollout.md) | Phases that never leave the site worse; owner steps; the free plan and pausing; egress; risks |

## Principles
- **Compose, don't store, the merged document.** Pipelines own layers; the published `School` is a pure function of
  the layers (plus edits), rendered by the publisher. "Re-merge changes nothing" becomes "publishing the same layer
  versions twice gives the same bytes", which is both the determinism test and the revert guarantee.
- **The app's query layer doesn't change.** `createDataset` still receives `{schools, meta, releaseCalendar,
  aliases}`; history, detail and trend documents keep their shapes; the Data API, the MCP server and the search index
  read through `getData()` as before. Only `lib/data.ts`'s source changes.
- **Lineage stays per value and stays enforced**, by the publisher instead of CI. An admin edit cites itself
  ("Edited by Quad on {date}", method `edited`, source `quad-edit`), so the citation popover is honest without asking
  the admin for a source.
- **Every write is a change set; every change set is revertible.** Pipelines, imports, admin edits, reverts: all the
  same shape, all in `admin_log` or the run log.
- **Public pages never depend on the database being awake.** The snapshot is a static object on a CDN; a bundled copy
  from build time stands in when Storage is unreachable; the pointer check fails soft.
- **One store for public data.** The dev site and production read the same snapshots; only people's data is per
  environment ([supabase.md](../supabase.md) still governs that).

## What the owner sees afterwards
- A pipeline run finishes and the site shows its results within about two minutes, with no PR.
- `/admin/data`: the change sets since the last snapshot, what each touched, holds to look at, Publish and Revert;
  the list of snapshots with Point back here; a college page where any value can be edited, with the field's history.
- `/release-notes` and the digest still say what changed and when, computed from snapshots.
- The repository is code and specs again: a clone is a few megabytes; CI needs no 34 MB file (done 2026-11-01, phase 4;
  [rollout.md](rollout.md) "As built, phase 4").

## Out of scope
Supabase Storage as the document archive for fetched pages (today a private GitHub release; `archive.mts` is written
for a third backend), typed SQL tables for querying the college dataset (the in-memory layer stays), moving people's
data, the prod project's region move ([launch-database.md](../launch-database.md), unchanged).
