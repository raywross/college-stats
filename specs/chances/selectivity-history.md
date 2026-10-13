# Quad's Selectivity History: Every Score and Tier Change, per Pool, for the Admin Console

> Status: **planned** 2026-10-13, spec only. Owner request after UT Austin's fall 2025 Common Data Set moved it up
> (data PR #145): "We really should track the scores that our algorithm is spitting out… we need to track for both in
> and out of state… it wouldn't need to be on the main site, but I'd want to see it in the admin screens." Extends
> [selectivity-index.md](selectivity-index.md); read by the [admin console](../product/admin.md), which is being built
> in a separate session, so this spec fixes the table and the reader that console imports.

## Goal
Today `data/selectivity-index.json` holds only the current score and rank, and `school.selectivity` only the current
tier. When a data run changes a college's figures, the old values are gone except in git. The owner wants to see, per
college and per pool (all applicants, in-state, out-of-state):
- what the score, rank, and tier were after each production deploy, and when they changed;
- **why** they changed: new figures from the college (UT's admit rate went from fall 2024 federal to fall 2025 CDS),
  or a change to the method;
- across all colleges: who moved up or down a tier, who entered or left Ultra selective, and the biggest score moves.

None of this is shown on the public site. The score is a hidden value under the trade-secret rule
([README.md](README.md)), so the history is too.

## The UT Austin case (what should have been visible)
| Pool | Before (fall 2024 federal) | After (fall 2025 CDS, 2026-10-13) |
|---|---|---|
| All applicants | Highly selective | Highly selective, score 72.45, rank 58 |
| In-state | none (no residency rates) | Highly selective, score 68.15 |
| Out-of-state | none | **Ultra selective**, score 80.49 |

The Ultra selective count went from 29 to 30 for some pool. The PR diff showed that only as one changed line in
`data/schools.json` among 605 changed lines in the index. Most of those were other colleges' scores moving by 0.01,
because one college's new inputs shift the scales every college is standardized against.

## Decisions
1. **Store it in Supabase, admin-only, written after each production deploy.** New tables `selectivity_publishes`
   and `selectivity_history`, written by the "Publish changes" workflow right after `publish-changes`, from the same
   two commits it diffs. Admins read them through an `is_admin()` select policy. Only the service role writes them.
   - Not `dataset_changes`: that table feeds followers' update emails and the public "What changed" list, and the
     score must never reach either. The public `selectivity.*` tier fields aren't notify fields in `lib/fields.ts`
     either, so today not even a tier change is recorded anywhere. Whether followers should hear about a tier change
     is a separate product question (open question 4).
   - Not a committed JSON file: the deploy would carry a growing file, and the repository goes private only at launch.
     Git still holds every past `selectivity-index.json`, which is the backfill source.
2. **Record a row when something meaningful changed, not every publish.** A row is written for a college and pool
   when, compared with that pool's **last recorded** row:
   - the tier, the tier's admissions year, or the top-of-Ultra band changed; or
   - the score moved by at least `SCORE_MOVE_MIN` (0.25 points); or
   - the pool is new (UT's in-state and out-of-state pools on 2026-10-13); or
   - the method changed (Decision 4).
   Comparing against the last recorded row lets small drifts add up until they cross the threshold, so no move is
   lost. Rank-only moves are not recorded: they come from other colleges, and the rank is stored on every row that is.
3. **Keep the inputs on each row** so the console can say why. `inputs` holds the raw values the score read for
   that pool, with each one's year and source kind: admit rate, SAT 75th percentile (and whether it was imputed),
   yield, retention, graduation rate, and the trend adjustment. Weights, percentiles, and cutoffs are not stored.
   They come from the current method, which the console already shows on the college page.
4. **Version the method.** `lib/selectivity.ts` gains `SELECTIVITY_METHOD`, a dated string such as `2026-10-12.3`.
   It is written into `data/selectivity-index.json` as `method`. Any change to inputs, weights, scales, cutoffs, the
   hysteresis band, or the Elite rule must bump it. A publish whose method differs from the previous one is recorded
   with `cause = 'method'` and one row for **every** rated college and pool, so method changes never look like real
   moves. Any other recorded row has `cause = 'data'`. Guard: `check:selectivity` fails when `--fresh` would produce
   different tiers from the committed ones while the method string is unchanged and no admissions input changed.
5. **Backfill from git once.** `npm run backfill-selectivity-history` walks every commit that changed
   `data/selectivity-index.json` (four as of 2026-10-13: 1bbc2596, 491ecb37, a118cc13, and #145's rebuild e782ed78),
   reads that commit's index and `data/schools.json`, and records them as if each had been a publish, with
   `cause = 'backfill'`. Inputs are rebuilt from that commit's `schools.json`. The first version (1bbc2596, five
   tiers, many colleges tied at 100) is recorded as method `2026-10-12.1` so its jumps read as method changes.

## Model
```sql
create table public.selectivity_publishes (
  id bigint generated always as identity primary key,
  publish_id bigint references public.dataset_publishes (id),  -- null for backfill rows
  git_commit text not null unique,
  published_at timestamptz not null,
  method text not null,
  elite_index numeric(5,2) not null,
  counts jsonb not null,        -- {"elite":29,...} for all applicants
  elite_any_pool integer not null, -- 30 after #145
  rated integer not null,
  rows_recorded integer not null,
  cause text not null check (cause in ('data', 'method', 'backfill'))
);

create table public.selectivity_history (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.selectivity_publishes (id) on delete cascade,
  published_at timestamptz not null,
  unit_id text not null,
  pool text not null check (pool in ('all', 'in_state', 'out_of_state')),
  score numeric(5,2),           -- null when the college stopped being rated (row records the drop)
  rank integer,                 -- the all-applicants rank on every row, for context
  tier text,                    -- 'elite' (shown as Ultra selective), 'highly_selective', …, 'open'; null if unrated
  tier_year text,               -- school.selectivity.year, e.g. 'Fall 2025'
  band text,                    -- the top-of-Ultra band, when set
  held boolean not null default false,  -- hysteresis kept the previous tier although the score crossed a cutoff
  cause text not null check (cause in ('data', 'method', 'backfill', 'new_pool', 'unrated')),
  inputs jsonb not null,        -- {"admit_rate":{"v":0.2222,"year":"Fall 2025","source":"cds"}, "sat_p75":{...}, …}
  unique (run_id, unit_id, pool)
);
create index on public.selectivity_history (unit_id, pool, published_at desc);
create index on public.selectivity_history (published_at desc) where cause <> 'backfill';
```
RLS on, `select` for `is_admin()` ([admin.md](../product/admin.md#model)), all writes to `service_role` only. One
migration: `supabase/migrations/<ts>_selectivity_history.sql`.

## Writing it
- `scripts/lib/selectivity-history.mts` (pure): `historyRows(prev: Recorded, next: { index, schools, method },
  opts)` returns the rows Decision 2 asks for. `prev` is the last recorded row per college and pool, read from the
  table. Unit-tested without a database.
- `scripts/publish-selectivity-history.mts`: reads the deployed commit's `data/selectivity-index.json` and
  `data/schools.json` (`git show`, as `publish-changes` does), reads the last recorded rows, and inserts one
  `selectivity_publishes` row plus its history rows in one transaction (an RPC like `publish_changes`). Re-running for
  the same commit writes nothing. Without the Supabase secrets it prints what it would write and exits 0.
- `.github/workflows/publish-changes.yml`: a `selectivity-history` step after `changes`, same trigger and secrets.
- `npm run backfill-selectivity-history` (Decision 5), run once by the owner after the migration.

## Fix that comes with it: data runs must rebuild selectivity
Data PR #145 failed verify because the college-reported workflow merges new figures without running
`build-selectivity`, so the committed tiers were stale. The workflow gains `npm run build-selectivity` after
`merge-reported` and before `build-trends`, like `merge-directories`. Otherwise this history would only see
selectivity changes when someone rebuilt by hand.

## The admin screens
For the console being built in the other session. Server-rendered behind `requireAdmin()`, read through
`lib/admin/selectivity-history.ts`.

**On a college (`/admin/colleges/[unit]`, the Selectivity panel):**
- Per pool, a small line of score over time with tier bands shaded and each tier change marked. Method changes are a
  dashed vertical line, so a jump at a method change isn't read as the college moving.
- A table under it, newest first: date, pool, score with change, rank, tier (and "held" when hysteresis kept it),
  tier year, cause, and the inputs that changed since the previous row, in words: "admit rate 31.0% → 22.2% (fall
  2024 federal → fall 2025 CDS)". Each row links to its commit and to the data PR that brought the figures.

**Across colleges (`/admin/selectivity`):**
- **Latest publish**: tier changes up and down, by pool, and colleges entering or leaving Ultra selective, with the
  count before and after (29 → 30).
- **Movers**: the biggest score moves over 7, 30, or 90 days, filterable by pool, tier, and cause, excluding method
  changes by default.
- **Tier counts over time**: how many colleges each tier holds after each publish, per pool, against the Ultra
  selective target band (`ELITE_COUNT_RANGE`).
- **Method log**: each method version, when it shipped, and how many colleges changed tier because of it.

The [health overview](../product/admin.md#the-overview-adminhealth) gains one line: "Selectivity: N tier changes in
the last publish" linking here.

## Reader contract (`lib/admin/selectivity-history.ts`)
```ts
type Pool = "all" | "in_state" | "out_of_state";
interface SelectivityPoint { publishedAt: string; pool: Pool; score: number | null; rank: number | null;
  tier: SelectivityTier | null; tierYear: string | null; band: string | null; held: boolean;
  cause: "data" | "method" | "backfill" | "new_pool" | "unrated"; method: string; gitCommit: string;
  inputs: Record<string, { v: number | null; year: string | null; source: string | null; imputed?: boolean }>; }
collegeHistory(unitId: string): Promise<SelectivityPoint[]>;            // every pool, oldest first
latestChanges(): Promise<{ run: SelectivityRun; tierMoves: TierMove[]; eliteIn: string[]; eliteOut: string[] }>;
movers(o: { days: 7 | 30 | 90; pool?: Pool; includeMethod?: boolean; limit?: number }): Promise<Mover[]>;
tierCounts(pool: Pool): Promise<{ publishedAt: string; method: string; counts: Record<SelectivityTier, number> }[]>;
```
Every function runs on the server with the admin's session. Nothing here is imported by a public page, and a test
checks that.

## Tests
- `historyRows`: UT's #145 change gives three rows (all: score move; in-state and out-of-state: `new_pool`); a 0.01
  drift gives none; drifts of 0.1 per publish give a row on the third publish; a method change gives a row for every
  college and pool; a college that loses its rating gives an `unrated` row; re-running the same commit gives none.
- Inputs: a row's `inputs` match what the score read, including an imputed SAT.
- Backfill over a fixture repo with three index commits records three runs, the first with `cause = 'backfill'`.
- Policies: an admin can select, a signed-in non-admin and anon get nothing, and only the service role can insert.
- `check:selectivity` fails when tiers change under an unchanged `SELECTIVITY_METHOD` with unchanged inputs.
- No public route, API response, or client bundle imports `lib/admin/selectivity-history.ts` or the tables.

## Build order
1. `SELECTIVITY_METHOD` in `lib/selectivity.ts`, written to the index file, and the guard.
2. `build-selectivity` in the college-reported workflow.
3. Migration, `historyRows`, the publish script and workflow step, the backfill.
4. The reader, then the console panels (other session).

## Owner steps
1. Apply `<ts>_selectivity_history.sql` on dev, then on production at launch.
2. Run `npm run backfill-selectivity-history` once against each project.

## Open questions
1. Is `SCORE_MOVE_MIN` = 0.25 right? It records UT's real move and drops the 0.01 drifts. 0.5 would be quieter.
2. Should a tier change also post to the owner (an email, or a Discord alert like the pipeline's), or is the console
   enough?
3. Keep history forever, or thin method-change snapshots older than a year to monthly?
4. Should the public tier (not the score) become a notify field, so followers get "UT Austin is now Ultra selective
   for out-of-state applicants"? That changes the public site and the update emails, so it isn't part of this spec.
