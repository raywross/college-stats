# Part 5, Git, CI and tests: what leaves the repository and what the tests become

> Part of [the data platform](README.md).

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

## Documentation to update when built
`serving-architecture.md` (a status note pointing here; the in-memory verdict stands, the source changes),
`supabase.md` ("Design: git is the source" → the snapshot design; the publishing section; environments),
`database-architecture.md` ("Serving the public dataset" decided again), `data-sync.md`, `data-lineage.md` (the
`quad-edit` source and `edited` method), `college-reported-setup.md` (no auto-merge, no PR), `product/admin.md` (the
Data section), `product/essays/sources.md` (the nightly export retired), `launch-database.md` (the data project
question), `CLAUDE.md` (the data flow paragraph and the "data PR" references), `specs/README.md`.
