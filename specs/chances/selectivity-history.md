# Quad's Selectivity History: Every Score and Tier Change, per Pool, for the Admin Console

> Status: **built** 2026-10-13 (PR #140, with the admin console; see "As built" at the end); **changed** 2026-10-20 to
> one row per college with the three pools side by side, recorded only when something changed (see "As changed"). Planned 2026-10-13. Owner request after UT Austin's fall 2025 Common Data Set moved it up
> (data PR #145): "We really should track the scores that our algorithm is spitting out… we need to track for both in
> and out of state… it wouldn't need to be on the main site, but I'd want to see it in the admin screens." Extends
> [selectivity-index.md](selectivity-index.md); read by the [admin console](../product/admin.md), which is being built
> in a separate session, so this spec fixes the table and the reader that console imports. The owner answered the open
> questions the same day ([Owner decisions](#owner-decisions-2026-10-13)): record every change, no owner alert, keep it
> forever, and tell followers when a college's public tier changes.

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
     score and rank must never reach either. The public **tier** does go there, as its own change (Decision 7).
   - Not a committed JSON file: the deploy would carry a growing file, and the repository goes private only at launch.
     Git still holds every past `selectivity-index.json`, which is the backfill source.
2. **Record every change (owner, 2026-10-13: "we should track everything").** On each publish whose
   `data/selectivity-index.json` differs from the last recorded one, a row is written for every college and pool
   where anything differs from that pool's last recorded row: the score (any change at its two stored decimals), the
   rank, the tier, the tier's admissions year, the top-of-Ultra band, the hysteresis hold, or any input. A new pool
   (UT's in-state and out-of-state on 2026-10-13), a college that loses its rating, and a method change (Decision 4)
   are rows too. There is no threshold.
   - Volume is small because the underlying figures change rarely: a publish that touches no admissions figure
     leaves the index unchanged and writes no rows. A data run like #145 moved about 600 colleges' scores by 0.01 and
     shifted ranks around them, so a run writes roughly 600–1,500 rows. At a few data publishes a week, that is well
     under a million rows a year.
   - The console still separates signal from drift: Movers and the college table hide changes under 0.25 points by
     default, with a "show every change" toggle. That is a display filter, not a recording rule.
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
6. **Keep it forever, and no owner alert.** Rows are never deleted or thinned. Tier changes reach the owner only
   through the console (`/admin/selectivity` and the health line), with no email or Discord message.
7. **Tell followers when a public tier changes.** The tier is public (the "Quad's selectivity" chip), so a change to
   `selectivity.tier`, `selectivity.in_state`, or `selectivity.out_of_state` becomes a `dataset_changes` row and goes
   out in the follower update email like any other figure. The score and rank stay hidden: the owner said "rank",
   and what followers can see is the tier, so the email names only the tier.
   - **Sentence**, from the tier labels in `lib/chances/levels.ts`, with the pool where the college has two:
     "Quad's selectivity is now Ultra selective for out-of-state applicants (was Highly selective)." A new pool reads
     "Quad's selectivity for out-of-state applicants: Ultra selective." The email links to the profile's selectivity
     panel, which lists the kinds of inputs, never the weights.
   - **Registry:** the three fields gain `notify: { unit: "text", phrase: … }` in `lib/fields.ts`, with the value
     formatted through the tier labels. `selectivity.band` and `selectivity.year` stay silent: the band is never
     shown, and the year changes with the admit rate, which already has its own change.
   - **The derived-input rule needs an exception.** `lib/changes.ts` reports a derived value only when its own inputs
     changed (`inputsChanged`). A tier can also move because other colleges' figures shifted the scales, and that
     move is just as real to a follower. So the three tier fields get a new `NotifyDef` option, `ownInputsOnly: false`,
     which reports any change to the stored tier. Hysteresis already keeps a tier from flapping on small drifts.
   - **Method changes don't email.** When the deployed index's `method` differs from the previous publish's, tier
     changes are still recorded in the history (`cause = 'method'`) but are not staged into `dataset_changes`. A new
     method can move a hundred colleges at once, and that is our change, not the college's. `diffSchools` gains a
     `suppress` option, which `publish-changes` sets to the three tier fields when the two commits' methods differ.
     The owner can announce a method change separately in the release notes.
   - **The first email after launch.** The backfill writes only the history, never `dataset_changes`, so followers
     don't get a burst of old tier changes.

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

-- One row per college per publish, the three pools side by side (as changed 2026-10-20; see the end).
create table public.selectivity_history (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.selectivity_publishes (id) on delete cascade,
  published_at timestamptz not null,
  unit_id text not null,
  rank integer,                 -- the all-applicants rank, for context
  tier_year text,               -- school.selectivity.year, e.g. 'Fall 2025'
  band text,                    -- the top-of-Ultra band, when set
  score_all numeric(5,2), tier_all text, held_all boolean not null default false,
  score_in_state numeric(5,2), tier_in_state text, held_in_state boolean not null default false,
  score_out_of_state numeric(5,2), tier_out_of_state text, held_out_of_state boolean not null default false,
                                -- a pool's score and tier are null together: not rated in that pool
  cause text not null check (cause in ('data', 'method', 'backfill', 'new', 'unrated')),
  inputs jsonb not null,        -- {"admit_rate":{…}, "admit_rate_in_state":{…}, "admit_rate_out_of_state":{…}, "sat_p75":{…}, …}
  unique (run_id, unit_id)
);
create index on public.selectivity_history (unit_id, published_at desc);
create index on public.selectivity_history (published_at desc) where cause <> 'backfill';
```
The first version (2026-10-13) had one row per pool; see [As changed](#as-changed-2026-10-20-one-row-per-college-and-only-real-changes).
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
- Follower alert (Decision 7): `notify` on the three tier fields and the `ownInputsOnly: false` option in
  `lib/fields.ts`; the `suppress` option in `diffSchools` (`lib/changes.ts`); `publish-changes` reads both commits'
  `data/selectivity-index.json` `method` and passes `suppress` when they differ; the tier label formatter in the
  update email's sentence builder.
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
  changes and moves under 0.25 points by default ("show every change" lifts both).
- **Follower emails**: which tier changes went to followers in each publish, and how many followers each reached,
  read from `dataset_changes` for the three tier fields.
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
  drift gives a row; a rank-only move gives a row; an unchanged index gives none; a method change gives a row for
  every college and pool; a college that loses its rating gives an `unrated` row; re-running the same commit gives
  none.
- Follower alert: UT's #145 change stages one `dataset_changes` row for `selectivity.out_of_state` and one for
  `selectivity.in_state`, both as new pools, with the sentences above; a tier moved only by other colleges' figures is
  staged; a tier moved by a method change is recorded in the history and not staged; no row ever carries a score or
  rank; the backfill stages nothing.
- Inputs: a row's `inputs` match what the score read, including an imputed SAT.
- Backfill over a fixture repo with three index commits records three runs, the first with `cause = 'backfill'`.
- Policies: an admin can select, a signed-in non-admin and anon get nothing, and only the service role can insert.
- `check:selectivity` fails when tiers change under an unchanged `SELECTIVITY_METHOD` with unchanged inputs.
- No public route, API response, or client bundle imports `lib/admin/selectivity-history.ts` or the tables.

## Build order
1. `SELECTIVITY_METHOD` in `lib/selectivity.ts`, written to the index file, and the guard.
2. `build-selectivity` in the college-reported workflow.
3. Migration, `historyRows`, the publish script and workflow step, the backfill.
4. The follower alert (Decision 7). It needs step 1's `method` to tell method changes apart, and nothing else here.
5. The reader, then the console panels (other session).

## Owner steps
1. Apply `<ts>_selectivity_history.sql` on dev, then on production at launch.
2. Run `npm run backfill-selectivity-history` once against each project.

## Owner decisions (2026-10-13)
The first draft's four open questions, answered by the owner:
1. **A threshold for recording?** No: "we should track everything, the underlying data isn't changing frequently."
   Every change is recorded (Decision 2). The 0.25-point filter survives only as a console default.
2. **An alert to the owner on a tier change?** "No need for an alert." The console is enough (Decision 6).
3. **Keep history forever?** Yes (Decision 6).
4. **Tell followers when the public tier changes?** Yes: "it would be good to have an alert that will tell followers
   that a public selectivity rank has changed." Built as the tier, the public value; the rank and score stay hidden
   (Decision 7). Method changes don't email followers. That part is this spec's call, not the owner's, and it is
   easy to reverse.

## Open questions
None.

## As built (2026-10-13)
- **Method strings use dots** (`2026.10.12.3`, `SELECTIVITY_METHOD`): the dash form `2026-10-12.3` reads as a data year
  to the citation guard ("no hard-coded data years in app code"). The backfill maps 1bbc2596 → `2026.10.12.1`,
  491ecb37 → `.2`, a118cc13 → `.3`, and #145's commit on `main`, 3c5b4280 (not e782ed78, its branch commit), → `.3`.
- **Method guard.** `check:selectivity` re-scores a frozen sample of colleges' raw figures
  (`data/reference/selectivity-method.json`, about 100 colleges including UT Austin and Harvard;
  `scripts/lib/selectivity-method.mts`). Data runs can't move it, so a moved score or tier under an unchanged
  `SELECTIVITY_METHOD` means the method changed: bump it, run `npm run selectivity-method-sample`, then
  `npm run build-selectivity`.
- **Every change is a row** (Decision 2): score at two decimals, rank, tier, year, band, held, or any input, compared
  with the pool's last recorded row (`selectivity_latest_rows()` returns all of them). `held` is recorded only for rows
  built with today's method (it's read with today's cutoffs); backfilled rows from older methods store false.
- **Reads.** The tables' "Admins read" policies use `admin_reads()` (is_admin() at aal2 plus the console header), like
  the other console tables; `admin_selectivity_run_changes`, `_movers` (with `p_min`, `p_tier`, `p_cause`), and
  `_tier_counts` aggregate.
- **Screens.** The college page's "Selectivity history" panel (a chart per pool over today's tier bands, the rows with
  input changes in words, same-tier moves under 0.25 hidden unless "Show every change") and `/admin/selectivity`
  (latest publish, movers with day, pool, tier, cause, and "Show every change" filters, follower emails, tier counts
  per pool, the method log). Health links it: "Selectivity: N tier changes in the last publish".
- **Follower alert** (Decision 7): `NotifyDef.ownInputsOnly: false` and `tierPool` on the three tier fields
  (`lib/fields.ts`), their sentences and labels in `lib/changes.ts`, `DiffOptions.suppress`, and
  `publish-changes` passing the tier fields to `suppress` when the two commits' methods differ. One addition: the
  tier fields are also suppressed when the earlier commit had no `data/selectivity-index.json` at all, so a first
  publish can't announce every college's tier as new. A method unknown on one side (an index from before the `method`
  field) counts as unchanged.

## As changed (2026-10-20): one row per college, and only real changes
Owner, 2026-10-20, looking at UT Austin's history: "I'm seeing multiple changes per day, but the data isn't
changing. I don't think we should store history records when the data doesn't change." And: "we should store those
all in one row with 3 columns instead of 3 rows. Then display it the same way."

- **The bug.** The writer read the last recorded rows (`selectivity_latest_rows()`) in one request, and PostgREST
  answers at most 1,000 rows. There were about 2,300 (one per college and pool), so every college past the 1,000th
  looked new on every publish and was re-recorded as `new_pool`: about 660 rows a publish, 18,812 rows in all by
  2026-10-17, 63 of them UT Austin's. The comparison itself was right; it never ran for those colleges. The writer
  now reads every page (`readAllPages`, tested past 2,000 rows), and so do the console's reads that can pass 1,000
  (a run's changes).
- **One row per college per publish** (`20261020120000_selectivity_history_one_row.sql`): `score_*`, `tier_*`, and
  `held_*` for `all`, `in_state`, and `out_of_state`, with the rank, tier year, band, and inputs once. The inputs carry
  each pool's admit rate (`admit_rate`, `admit_rate_in_state`, `admit_rate_out_of_state`) and the inputs the pools
  share. A pool that appears or goes away is a `data` row with that pool's columns filled or null. Causes: `data`,
  `method` (every rated college), `backfill`, `new` (the college's first row), `unrated` (no longer rated in any
  pool; every pool null).
- **Nothing changed, nothing recorded.** A college gets a row only when a pool's score, tier, or hold, the rank, year,
  band, or an input differs from its last row. A publish that changes no college records nothing, not even its run:
  `record_selectivity_run()` returns null for empty rows, and the publish script doesn't call it.
- **Rebuilt from git.** The migration replaced the table; `npm run rebuild-selectivity-history` replayed every
  recorded publish from its commit with the new rules, keeping each publish's date, method, and cause. On dev
  (2026-10-20): 24 publishes and 18,812 rows became 6 publishes and 6,154 rows; UT Austin has 5 rows (three backfilled
  method versions, #145's fall 2025 CDS, and the next data run's 0.01 drift).
- **Display.** The college page keeps a chart per pool and shows one table row per recorded publish with All
  applicants, In-state, and Out-of-state side by side (score, change, tier, "held"), then rank, cause, and what
  changed. The default "hide small moves" filter hides a row only when every pool kept its tier and moved under 0.25.
  `/admin/selectivity` is unchanged on screen: the reads unpivot the pools for movers, tier counts, and the latest
  publish.
- **Owner steps.** Apply the migration on production after `20261013150000_selectivity_history.sql` (at launch), then
  run `npm run rebuild-selectivity-history` (nothing to replay on a new project) and `npm run
  backfill-selectivity-history`.
