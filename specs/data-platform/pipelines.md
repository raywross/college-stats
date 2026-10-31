# Part 4, Pipelines: from files to layers

> Part of [the data platform](README.md). Code: `scripts/lib/data-platform/store.mts` (the `DataStore` adapter and the
> file-backed one for tests), each producer's small change to use it, each workflow's shrunken tail.

## The adapter
```ts
export interface DataStore {
  /** The current documents of a collection, as a Map by key. */
  read<T>(collection: string, keyPrefix?: string): Promise<Map<string, T>>;
  readOne<T>(collection: string, key: string): Promise<T | null>;
  /** Opens a change set; `write` and `remove` go into it; `close` ends it. */
  open(kind: "pipeline" | "import", source: string, runRef: string, summary?: object): Promise<ChangeSetHandle>;
}
export interface ChangeSetHandle {
  write(collection: string, docs: { key: string; body: unknown; expectVersion?: number }[]): Promise<void>;
  remove(collection: string, keys: string[]): Promise<void>;
  close(status: "applied" | "held", heldReason?: string, summary?: object): Promise<void>;
}
export function supabaseStore(url: string, secretKey: string): DataStore;   // the real one
export function fileStore(root: string): DataStore;                         // tests and dry runs: documents as files under a folder
```
A producer's existing "read the state file, change entries, write the state file" becomes "read the collection,
change entries, write the changed documents". The file-backed store keeps every producer testable offline; the tests
that exercise a pipeline on fixtures switch to it and change little else.

## Each producer
| Producer | Today | After | Workflow after |
|---|---|---|---|
| `sync-data` (IPEDS, Scorecard, release calendar) | Rebuilds `schools.json`, `meta.json`, detail, aliases, calendar in place; applies every later layer itself | Writes `base.*` only (the state after its IPEDS stages, before Common App); the later layers are composed by the publisher. Flag `--release-only` writes just the calendar | A new `sync-data.yml`: `workflow_dispatch`, and the release-calendar check weekly; ends with `repository_dispatch` |
| college-reported | Writes seven state files and `data/cds-records/`, then runs the five merge/build scripts, commits, opens a PR | Writes `reported.*` through the store (entries, CDS records, sources, docs, batches, review queue, failures, reports); the merge scripts are gone from its tail | Same triggers; the tail is `data_close_change_set` + the dispatch. The `collect` job writes to the same open change set (the batch's `run_ref`) |
| identity-refresh | Five files, a PR | `identity.*` documents per college (the due check reads the probe layer) | Same |
| campus-pilot, sync-directories | `data/directories/**`, `campus-pages.json`, a PR | `directories.*`, `campus.pages` | Same |
| common-app, coalition | Files, by hand | `common_app.*`, `coalition.members` | New `workflow_dispatch` workflows so they can run from the console |
| essay-prompts | records/held/pages files, a PR never auto-merged | `essays.*`; held records are holds in the console; the run closes `held` only when its own breaker (>50% held) trips | Same triggers; no PR |
| essay-confirmed (nightly export) | Mirrors `essay_prompt_overrides` into files and opens a PR | **Retired**: the publisher reads the table directly | Deleted |
| sync-history, build-trends | Files | `history.*`; trends are derived at publish | `sync-history.yml` monthly and on dispatch |
| high schools (sync, states, profiles) | Shards and files, then `publish-high-schools` to tables | `high_schools.*` documents; the publisher loads the tables when the layer changed and renders the JSON fallback | Same; `publish-high-schools` becomes a publisher step |
| visit-events | Writes its tables directly | Unchanged | Unchanged |
| publish-changes, publish-selectivity-history | On every production deploy, diffing git commits | Publisher steps ([publish.md](publish.md)) | `publish-changes.yml` retired |
| college-failures, college-health | Derived files | Derived by the publisher: `college_data_failures` upsert; `health.colleges` document (the console reads it from the store, not from a traced file) | Steps of the publisher |
| hold-misread | Edits `cds-records` and the review queue files | Writes the same documents through the store | A console action later; the CLI stays |
| The console's Accept/Reject/Re-run | GitHub App branch + commit + PR | Field edit / resolve / dispatch ([change-sets.md](change-sets.md)) | The GitHub App keeps only "Start a run" and "Approvals" for code PRs |

## Rules for every producer
- **Idempotent writes.** Writing a document whose body equals the current version writes nothing (the store compares
  `JSON.stringify` after `recordJson`-style key ordering), so a re-run with no news creates an empty change set that
  the publisher skips.
- **Key order inside documents** is the producer's as today (one college per line formats become irrelevant; the
  publisher renders).
- **Costs and breakers** are the producer's as today; the breaker's sentence is the hold reason.
- **No producer writes a composed college.** Only the publisher composes.
- **Archive**: fetched documents and pages stay in the GitHub-release archive (`archive.mts`); a Storage backend is
  a later step.
- **Local runs**: `--store file:<dir>` writes to a folder (the file store) for a dry run; `--store supabase` (the
  default when `DATA_SUPABASE_URL` is set) writes to the data project.

## The import
`scripts/import-data-from-git.mts` (phase 1) reads today's `data/` files once and writes every layer with a change set
of kind `import` ("imported from git at <commit>"). The base layer is produced by running `sync-data`'s stages up to
the Common App merge against the committed inputs it needs; where an input isn't in git (the IPEDS downloads), the
import takes the committed `schools.json` and **strips the later layers** with the existing strip functions
(`stripReported`, `stripEssays`, Coalition's and Common App's removal, `placeSelectivity(undefined)`, identity's
appliers re-run) to recover the base. The proof that the import is faithful: the publisher composed from the imported
layers renders `colleges.json` **byte for byte equal** to the committed `schools.json` (`tests/data-platform-import.test.mts`,
on the real data in phase 1, on the mini fixture after).

## As built, phase 2 (2026-10-31)
Every producer in the table above writes its layer through the store (`--store supabase|file:<dir>`), one change set
per run, keyed as `scripts/import-data-from-git.mts` keys documents (tests show an import and a run agree). Details
that differ from the plan:
- **A shared change-set CLI**, `scripts/data-change-set.mts` (`open --source … --run-ref …` prints the id; `--reuse`
  continues an open set; `close --id … --status applied|held --reason …`), lets a workflow open one set around
  several scripts, each given `--change-set <id>`. Library: `scripts/lib/data-platform/change-set.mts` and
  `producer.mts` (`openProducerRun`, `writeChanged`, `datasetColleges`). The store gained `attach(id)` and
  `findOpen(source, runRef)`.
- **College-reported** keeps its state in `scripts/lib/college-reported/state.mts`, writes only changed documents
  after every college, derives `reported.failures` and `health.colleges` into its own set before closing, closes
  `held` on exit 1, 2 or 3, and stays `open` while Message Batches are open (the `collect` job continues it). The
  console's health page reads `health.colleges` with the file as fallback. `hold-misread` writes a `hold-misread` set.
- **Identity refresh** runs `sync-wikidata`, `probe-sites`, `sync-brand --colors` and `college-health` in one set; a
  failed step closes it `held` with the step's name. Brand marks (`public/brand/*.webp`) are code assets and stay a
  local refresh plus a code PR. **Directories** has no workflow (run by hand). **The campus pilot** closes `held` by
  default (a person publishes it) unless the `publish` input is set.
- **Essays** opens its set at the end of the run (its writes are batched until shared pages are reconciled); a run
  closes `held` only when more than half of the colleges read were held. **Common App**'s grid PDF goes to the
  archive. **History** writes `history.schools` and `history.shared`; the publisher derives trends from them
  (`deriveTrends`, `scripts/lib/overrides.mts`), carrying a college's trends forward only when it has no history
  document. **High schools** run on a scratch copy of their layers laid out as the old folder, then write back only
  what changed. **`sync-data`** writes `base.*` only and refuses `--links` (the probe belongs to identity refresh);
  `--out <dir>` renders the old file layout through the publisher's compose, so no merge logic is duplicated.
- **Retired**: `publish-changes.yml` and its three CLIs (library code kept for the publisher), `essay-confirmed.yml`
  and `export-essay-confirmed.mts`, `college-reported-pr-body.mts`'s CLI (its summary feeds the change set),
  `identity-refresh.mts`'s PR subcommands, the GitHub-App file-commit path (`WRITABLE_PATHS`, `commitFileAndOpenPull`).
- **Not moved**: `fetchRunCost` (the "Run all colleges" form's cost) still reads run reports from GitHub and should
  read `reported.reports`; `scripts/lib/college-reported/college-failures` and `college-health` treat only
  `rejected` items as dismissed, not `accepted` ones.
