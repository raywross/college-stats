# Part 5, Git, CI and tests: what leaves the repository and what the tests become

> Part of [the data platform](README.md). **Built 2026-11-01**: see [As built, phase 4](#as-built-phase-4-2026-11-01)
> below for the final numbers (38 colleges, not about 25; about 9 MB, not 1.5 MB) and what differed from this plan.

## What leaves git
Everything under `data/` except `data/reference/cip2020.json`-sized fixtures that tests need and that are also
layers (they move to `tests/fixtures/`), in phase 4 ([rollout.md](rollout.md)). The repository keeps: code, specs,
release notes, `lib/fields.ts` (the registry is code), `supabase/migrations/`, `tests/fixtures/**` (small), and
`tests/fixtures/snapshot-mini/` (below). `.data/` is git-ignored and holds the fetched snapshot for the build and local
development.

## The mini fixture
`tests/fixtures/snapshot-mini/` is a complete snapshot for about 25 colleges chosen for coverage (one with every
layer present: Vanderbilt; the UC's shared essay page; a college with a CDS record and a hand edit; an open-admission
college; a college with none of the later layers; the four the CDS academics tests pin), rendered by
`npm run build-mini-fixture` from the real snapshot and committed. It is about 1.5 MB. It also carries the **layers**
for those colleges (`layers/<collection>/<key>.json`) so the publisher can be tested end to end offline: compose the
mini layers → render → compare to the mini snapshot byte for byte.

## Tests that read committed data, and what each becomes
| Test (today) | Asserts | After |
|---|---|---|
| `merge-reported.test.mts` "re-merge changes nothing" | Committed `schools.json` equals a fresh merge | The publisher's render of the mini layers equals the mini snapshot; a second render equals the first (determinism) |
| `identity.test.mts` "re-applying identity changes no byte" | Same for identity | Same, in the publisher determinism test |
| `selectivity.test.mts` "the committed tiers are a fresh build" | Same for tiers | `buildSelectivity` on the mini snapshot with its own index changes nothing |
| `lineage.test.mts` "the committed dataset passes the lineage check" | `validateLineage` over all 1,893 | Over the mini snapshot in CI; over the full snapshot in the publisher, which fails the publish instead |
| `directories.test.mts` flagship matcher, `selectivity.test.mts` "the real dataset: Elite…", `selectivity-history` fixtures, `cds-academics` "four colleges", `residency-admissions` grid | Facts found in the real data | The same facts in the mini fixture (those colleges are in it) |
| `releases.test.mts` | The committed release calendar is well formed | The calendar in the mini fixture, plus `validateCalendar` in the publisher |
| `tracing.test.mts` | `outputFileTracingIncludes` matches what `lib/` reads under `data/` | The same check over `.data/snapshot/**` and the remaining literal reads; plus "nothing under `lib/`, `app/`, `components/` reads `data/`" once phase 4 lands |
| The ~100 tests that pick one real college as a fixture | Field-level logic on real values | Point at the mini fixture (`tests/helpers/snapshot.mts` exports `miniSchools()`, `miniSchool(id)`); where a test needs a college the mini lacks, add the college to the mini (keep it under 40 colleges) |
| `publish-changes.test.mts`, `changes.test.mts` | Diffing two commits | Diffing two mini snapshots |
| `admin-health*.test.mts` | `college-health.json` | The `health.colleges` document in the mini layers |
| `high-schools*.test.mts` | Shards under `data/high-schools` | The mini snapshot's high-school fallback shards (two states) |

The rule afterwards: **no test reads the live snapshot or the database.** CI needs no network and no keys for
`verify`; `next build` in CI uses the mini fixture through `fetch-snapshot --fixture`.

## CI and build
- `verify.yml`: unchanged in shape; `fetch-snapshot --fixture` runs first so `.data/snapshot/` exists.
- `next build` on Vercel: `prebuild` runs `fetch-snapshot` (reads `DATA_SNAPSHOT_URL`; about 60 MB over the CDN,
  20–40 s). A fetch failure fails the build loudly rather than building from a stale copy.
- The `release-note` job keeps requiring a note for code PRs; data no longer arrives by PR.
- New guards: `tests/data-platform-*.test.mts` cover the store adapter (file store), the publisher's compose and
  render determinism, the import's byte-equality on the mini fixture, the loader's swap (a fake fetch moving the
  pointer), the edits overlay and `quad-edit` lineage, the policies and functions (PGlite), and the console's actions
  (log before send, refusals readable).
- The citation guard (no date literals in app code) and the advisor-words sweep are unchanged.

## As built, phase 4 (2026-11-01)
Built as planned, plus one extra: `data/reports/usage-template.md` (not test-fixture data) moved to
`specs/product/usage-template.md` rather than leaving with the rest of `data/`.

**What left git**: everything under `data/` — `schools.json`, history and detail shards, `meta.json`, the release
calendar, aliases, reference files, overrides, and every pipeline's working state (the review queue, CDS records,
college sources and docs manifest, batches, failures, directories state, essay runs, high-school shards). **What
stayed, and where**: `lib/fields.ts` (the field registry, already code), `supabase/migrations/`, and
`tests/fixtures/**`. Besides `tests/fixtures/snapshot-mini/` (below), the units added small, real fixtures for tests
whose college or pipeline state the mini fixture's 38 colleges or its trimmed layers don't cover, each with a
`README.md` naming its source path and the date it was copied (2026-10-31, while `data/` still existed):
`tests/fixtures/admin-hidden/` (the real GPA model fit, too few colleges in the mini fixture to refit it),
`tests/fixtures/advisor/` (three sample-plan colleges the fixture lacks), `tests/fixtures/campus-pilot/` (four
round-1 colleges' pilot facts), `tests/fixtures/cds-records/` (the University of Florida's whole CDS record),
`tests/fixtures/chances-pool-rate/` (five colleges `guaranteed-admission.json` keys by unit id, which can't be
swapped), `tests/fixtures/college-reported-store/` (one college's pipeline state: sources, entries, review queue,
docs, CDS record), `tests/fixtures/data-platform-import/` and `tests/fixtures/data-platform-sources/` (a git-layout
`data/` slice for three colleges, for tests of the import itself, which must read the old layout), `tests/fixtures/
directories/` (a docs manifest slice for the four CDS academics colleges), `tests/fixtures/directories-store/` (a
full `data/`-shaped directory for the matcher's hard cases), `tests/fixtures/essay-prompts-confirmed/` (18 real
`college-reported-run-*` report file names), `tests/fixtures/github-app/` (42 real colleges for the directory
matcher's disambiguation rules).

**The mini fixture** (`tests/fixtures/snapshot-mini/`) grew from the 25-college sketch above to 38 colleges, the
ones the test suite pinned from the real data most often (`DEFAULT_UNITS` in `scripts/build-mini-fixture.mts`), plus
coverage colleges (an open-admission college, one with none of the later layers, the four CDS academics colleges).
It carries every reference document (not just the five named ones), two high-school states (`ct`, `sc`, with
`meta.json`, `medians.json`, `review-queue.json`), `source-files.json`, `edits.json`, and the layers those colleges
composed from, about 9 MB total. `tests/helpers/snapshot.mts` reads it through `miniSchools()`, `miniSchool(id)`,
`miniLayers()` (a `DataStore`), `miniMeta()`, `miniReleaseCalendar()`, `miniAliases()`, `miniDataset()`,
`miniHistory(unit)`, `miniTrend(name)`, `miniReference(name)`, `miniHighSchoolsDir()`, and more — tests never read
the fixture folder by hand. `tests/data-platform-fixture.test.mts` no longer compares the fixture to a build from
the real data (there is none to compare to); the drift test is self-consistency: `npm run build-mini-fixture --
--snapshot tests/fixtures/snapshot-mini/snapshot --store file:tests/fixtures/snapshot-mini/layers` reproduces the
fixture file for file and byte for byte, so a change to the builder or a hand edit to the fixture can't drift one
from the other.

**How the app gets its reference tables**: the publisher renders every `reference.files` document into the
snapshot (the five named objects as before, plus every other one as `reference/<name>.json`, or `.txt` for an
unnamed text document) and `source-files.json` at the snapshot root. The app's compiled-in JSON imports
(`lib/aid-policies.ts`, `lib/cds-template.ts`, `lib/chances/*`, …) point at `.data/snapshot/reference/<name>.json`;
files read at runtime (`lib/organizations.ts`, `lib/zip-centroids.ts`, `lib/essays/guidance.ts`) read the bundled
copy by literal path. A console edit to a reference document reaches the site on the deploy after the next publish
(the publish re-renders it into the snapshot; the next build's `fetch-snapshot` carries it, and production's
deploy-hook rebuild follows each publish within a few minutes) — there is no separate rebuild step for reference
documents.

**`fetch-snapshot --ensure`**: a no-op when `.data/snapshot/manifest.json` already exists; otherwise downloads when
`DATA_SNAPSHOT_URL` is set, else copies the mini fixture. `package.json`'s `postinstall` runs it, so a clean clone
has a bundled copy before anything else runs; `prebuild` stays `--if-configured` (refreshes the copy only when
`DATA_SNAPSHOT_URL` is set); `verify.yml` runs `fetch-snapshot -- --fixture` after `npm ci`, so CI's bundled copy is
always the mini fixture regardless of what's configured.

**The loader** (`lib/data.ts`, `lib/data-platform/loader.ts`) lost its `legacy` (`data/`) source: `snapshotSource()`
returns `storage` (when `DATA_SNAPSHOT_URL` is set) or `bundled` (a copy under `.data/snapshot/`); with neither,
`getData()` throws once: "No data snapshot: run `npm run fetch-snapshot -- --ensure`." `SnapshotId` is a plain
number, 0 for the mini fixture.

**Tracing**: `next.config.ts`'s `outputFileTracingIncludes["/*"]` is exactly `["./.data/snapshot/**"]` (the old
`"/admin/**"` entry is gone, since the admin health page now reads the store, not a bundled file).
`tests/tracing.test.mts` checks that, and adds the guard the brief asked for: **nothing under `lib/`, `app/`,
`components/` or `scripts/`** (except `scripts/build-mini-fixture.mts` and `scripts/import-data-from-files.mts`,
whose job is a data folder a caller names) **imports or reads a path under `data/`**, caught by a regex over each
source file's lines (`"data/`, `'data/`, `` `data/ ``, a `"data"` segment in `join(`/`resolve(`, `@/data/`, or a
relative `../data/`), with a planted-read test proving the guard bites.

**The check scripts** (`npm run check:*`, part of `npm run verify`) read the bundled copy
(`scripts/lib/data-platform/bundled.mts`: `readBundledColleges()`, `readBundledMeta()`, `readBundledReference(name)`,
`readBundledManifest()`, each throwing the `--ensure` sentence when there is no bundled copy), so they check the
mini fixture in CI and the real snapshot locally after a fetch. `check:lineage` dropped the CDS-record and
docs-manifest checks (the publisher's compose runs those at publish time instead) and now checks the colleges and
history over `.data/snapshot/`. `check:selectivity` gained a small-snapshot mode: under `FULL_SNAPSHOT` (200)
colleges — the mini fixture's 38 — the hysteresis and tier-count checks that only mean something over the whole
nation are skipped, and a consistency check runs instead (a college has a tier exactly when its figures give it an
index, every tier is a known one, only an Ultra-selective college sits in the top band).

**The publisher's gates** (`scripts/lib/data-platform/gates.mts`), run before a publish uploads anything: the
reference gate (`referenceGate`) runs every reference document through its validator in
`lib/reference-validators.ts` (the same dispatch the console's reference editor refuses a save with;
`lib/admin/reference-view.ts` re-exports it), the CDS-records gate checks every passed value against the docs
manifest, and the overrides gate checks every legacy override cites a source. A problem in any of them fails the
publish — nothing is uploaded — rather than failing a pull request the way the committed-file checks used to.

**`import-data-from-files.mts`** (renamed from `import-data-from-git.mts`) takes a required `--from <dir>`: a
folder in the old `data/` layout (what the repository held until today, or an export in that shape). This is how a
store is re-seeded from an export; the key rules are unchanged from phase 1.

**Retired scripts** (one-offs whose only job was the committed file layout, deleted with their `package.json`
entries, their tests, and `git rm`): `backfill-open-admission.mts`, `backfill-selectivity-history.mts`,
`build-selectivity.mts`, `college-reported-rerun-ids.mts`, `fix-fraction-rates.mts` (and its test,
`tests/fix-fraction-rates.test.mts`), `merge-coalition.mts`, `merge-common-app.mts`, `merge-directories.mts`,
`merge-essay-prompts.mts`, `merge-identity.mts`, `merge-reported.mts`, `merge-state-laws.mts`,
`publish-high-schools.mts`, `rebuild-selectivity-history.mts`. The pure library modules those scripts called into
(the merge functions themselves, used by the publisher's compose) were kept — only the file-reading, file-writing
wrapper scripts went.

**The workflows that fetch the snapshot**, because their scripts read colleges or reference documents from the
bundled copy rather than `data/`: `campus-pilot.yml`, `hs-profile-pilot.yml`, `college-reported.yml`,
`identity-refresh.yml`, `visit-events.yml`, and `eval-reviewer.yml` each run `npm run fetch-snapshot` before their
script (`npm ci`'s `postinstall` already leaves a fixture or a fetched copy in place as a fallback, so a missing
`DATA_SNAPSHOT_URL` locally still works against the mini fixture).

**Tests deleted because they asserted a fact about the whole real dataset**, which means nothing over 38 colleges
(the publisher's gates and `tests/data-platform-publish.test.mts` cover the real data at publish time instead):
`tests/trends-where-students-go.test.mts` ("its builder can't run on 38 colleges" — the study needs enough colleges
in each enrollment band that the mini fixture can't supply) and `tests/fix-fraction-rates.test.mts` (deleted with
its script, whose only job was patching the committed file). A few more tests kept their assertion but dropped a
real-data-only check: `tests/chances-foundation.test.mts` dropped the "every name in `GUARANTEED`/`MAJOR_ADMISSION`
is a known unit id" check reading `miniReference()` ("a whole-dataset fact the mini fixture's 38 colleges can't
cover"), and `tests/check-selectivity`'s own hysteresis assertions moved behind the `FULL_SNAPSHOT` guard above
rather than being deleted.

**High-school JSON fallback**: the live snapshot carries no high-school objects (the high-school layers were never
imported into the store; production reads the `high_schools*` tables, `HIGH_SCHOOLS_SOURCE=supabase`). The JSON
fallback (`HIGH_SCHOOLS_SOURCE=json`, used in CI and a keyless Preview) now reads `.data/snapshot/high-schools/`,
which after a real fetch has nothing and after the mini fixture has only Connecticut and South Carolina. Accepted
for now (the owner stays on the free plan; the full high-school layers would add about 48 MB to the database).

**The rule that held throughout**: no test reads the live snapshot or the database; everything reads the mini
fixture, a small real fixture under `tests/fixtures/`, or a fake. `mv data /tmp/data && npm run verify` passes.

## Documentation to update when built
`serving-architecture.md` (a status note pointing here; the in-memory verdict stands, the source changes),
`supabase.md` ("Design: git is the source" → the snapshot design; the publishing section; environments),
`database-architecture.md` ("Serving the public dataset" decided again), `data-sync.md`, `data-lineage.md` (the
`quad-edit` source and `edited` method), `college-reported-setup.md` (no auto-merge, no PR), `product/admin.md` (the
Data section), `product/essays/sources.md` (the nightly export retired), `launch-database.md` (the data project
question), `CLAUDE.md` (the data flow paragraph and the "data PR" references), `specs/README.md`.
