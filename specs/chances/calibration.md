# Outcomes and Accuracy: What Students Share, and How Well the Estimate Did

> Status: **built** 2026-10-11 on `feature/chances` (see "As built"; planned 2026-10-10). Part 5 of [admission chances](README.md). After [estimate.md](estimate.md); uses the
> planner's opt-in outcome share (built in [../planner/offers.md](../planner/offers.md), consent on `lists`) and
> [scattergrams.md](../product/scattergrams.md) (planned); replaces the pilot section of
> [chances-and-fit.md](../product/chances-and-fit.md#pilot). How outcomes are used to improve the estimate is part of
> the method: [method/outcomes.md](method/outcomes.md).
> Built 2026-10-11 (unit U4 of the chances build, `feature/chances-outcomes`): [As built](#as-built). Migrations
> written, not applied.

## Goal
Quad's estimate gets better with outcomes: what happened to students with given inputs at given colleges. There is
no public, national, applicant-level file of grades, scores, courses, and decisions, so the site collects its own,
with consent, and in return publishes each season how well the estimate did, the way Zillow publishes the
Zestimate's error rates.

## Collecting outcomes

### 1. The planner's outcome share (built consent, new snapshot)
The offers stage already asks, once and revocably, whether the student will share the outcome set (college, round,
outcome, enrolled, standing bucket, state) into the pooled self-reported outcomes. For outcomes to be useful, the
inputs must be the ones **at the time of applying**, not after a retake or a changed GPA.
- New `application_snapshots` row written when a list item becomes *applied* (the built status transition): the
  student's estimate inputs as of that day, binned (GPA to 0.05, scores to 10 SAT / 1 ACT, course counts and grades
  in advanced courses to 0.1), the estimate and its label, whether the student changed the group, and `modelVersion`.
- No name, no high school id, no free text; the state is kept, the high school only as a band of what it offers.
- Snapshots are taken for every student and kept private to the student until they consent; without consent they are
  deleted at the season's end. Consent given later uses the snapshot already taken.
- Revoking consent removes the student's rows from every future use; published summaries already computed stay (they
  hold no row-level data).

### 2. Scattergrams
Counselor uploads ([scattergrams.md](../product/scattergrams.md)) give GPA, score, round, and outcome per applicant
from one high school, binned and thresholded.

### 3. A hand-collected panel
About 300 published outcomes, as planned in [chances-and-fit.md](../product/chances-and-fit.md#pilot), are the first
check before the planner has a season of data.

### 4. Public aggregates
- **IPEDS Admissions and Consumer Transparency Supplement (ACTS)**, if and when it is published: applicants, admits,
  and enrollees per institution by GPA quintile and by test-score quintile, for 2025–26 and back to 2019–20
  (collected in 2026; release held up by litigation at the time of writing). When it ships it becomes a sync source
  like any IPEDS file ([data-sync.md](../data-sync.md)), and its admit rates by band appear on the profile as facts in
  their own right.
- University systems that publish admits by high school and GPA range, or by major and residency (UC's Information
  Center, which calls its own figures "a general guide… not a predictor"), added as reference sources with their own
  lineage when the research for a system confirms the file and its terms.

## The accuracy summary (published each season)
A section on the Data page ([data-page.md](../data-page.md)), "How well Quad's estimate did":
- For each group (Reach, Target, Likely) and each band of the college's overall admit rate: how many shared outcomes
  there were and the share admitted, with an interval.
- How often students' own group changes turned out right compared with the estimate.
- The sharers' mix (by admit-rate band, state, test-optional share) beside the national application mix, because
  students who share outcomes are not all applicants.
- The model version(s) in use that season and the date of the next summary.
A cell with too few outcomes says "not enough outcomes yet". The summary describes results, not the method.

## "Students like you" counts
Once a college has enough shared outcomes, the profile and the planner can say what happened to students in a
similar position, without any model:
> "Of 63 students on Quad with numbers like yours who applied to Purdue from Indiana in the last three seasons, 47
> were admitted."

- Shown only when a cell has at least **50 outcomes** in the last three seasons, and suppressed below 10 in any
  sub-count (the scattergram threshold). How "numbers like yours" is defined is part of the method.
- A count, worded as what happened, never "your chance"; the estimate stays the headline.
- On the profile standing card under the "what went into it" panel, and in the planner row's ⓘ.

## Commitments (public)
- Outcomes are used only to improve and report on the estimate and to show the counts above; never sold, shared, or
  used for advertising ([product README](../product/README.md#shared-rules-for-user-data)).
- The estimate never uses race, ethnicity, sex, legacy, anything inferred about the family, or the identity of the
  student's high school, whatever the model.
- The output stays a group, never a percentage, however the method changes.

## Privacy
- Minors: snapshots are academic facts the student entered; consent is the student's own (or the guardian's for a
  student without an account, as the built consent rule allows).
- Row-level data never leaves Supabase; the season measurements read it with a dedicated role and write back only
  aggregates and model versions.
- Snapshot tables have row-level security mirroring `list_items`; a student can export and delete their snapshots.

## Files (planned)
Public: migration `…_application_snapshots.sql` (table, policies, the season-end cleanup of unconsented rows),
`lib/chances/snapshot.ts` (pure: the binned snapshot from the estimate's input and result), the snapshot write in the
built applied transition, the Data page section reading a published summary table, the "students like you" query
with its suppression, `tests/chances-snapshot.test.mts` (binning, no name or high school id, consent and cleanup,
suppression thresholds).
The season measurements (`scripts/chances-calibration.mts`, per [method/outcomes.md](method/outcomes.md)) write the
summary table the Data page reads.

## Open questions
1. Should snapshots be taken for students who haven't consented (kept private, deleted at season's end) so a later
   consent is complete? Recommendation: yes, as above; it is the student's own data in their own account.
2. Are "students like you" counts a paid feature? Recommendation: free on the profile (one college at a time); across
   the list in the planner, with the planner's tier ([../planner/README.md](../planner/README.md)).
3. Should the accuracy summary be public from the first season, even if thin? Recommendation: yes, with the counts;
   publishing the misses is what makes the estimate believable.

## As built
Built 2026-10-11 (unit U4). Every open-question recommendation above is adopted: snapshots are taken for every
student and kept private until consent; "students like you" is a server query that returns nothing until a cell
clears the thresholds; the summary is public from the first season, with counts.

### Files
| File | What |
|---|---|
| `supabase/migrations/20261011100000_application_snapshots.sql` | `application_snapshots` (one row per list item; typed, checked columns only: no name, no high school id, no free text; the high school as `hs_ap_band`), RLS (read: `can_read_list`, as `list_items`; delete: `can_consent_outcome_share`, the student or the managing guardian; no insert/update grant), `record_application_snapshot()` (the only write: editor, applied item, a student's list; the database sets identity, `applied_on`, season, consent), triggers keeping `consented` and `student_id` in step with the list, `delete_unconsented_snapshots(p_season)` (service role; finished seasons only), `chances_outcome_rows()` (service role; consented, live students, no ids), `chances_like_you()` (anyone; no row below 50 decisions or under 10 admitted / not admitted), `application_season()`, `last_finished_season()` |
| `supabase/migrations/20261011110000_chances_summary.sql` | `chances_summary`: per season × model version a `scope 'all'` total with the sharers' mix, and group × admit-rate band cells by the estimate's group (`'estimate'`) and by the student's changed group (`'student'`); public read, service-role write |
| `lib/chances/snapshot.ts` | Pure: `buildSnapshot()` (GPA to 0.05, SAT to 10, ACT to 1, grade averages to 0.1, admit rates to 0.01, course counts), `estimateInputFromProfile()`, `apBand()`, `snapshotSeason()`, `lastFinishedSeason()`, the `AppliedEstimate` / `SnapshotDetail` types |
| `lib/chances/snapshot-write.ts` | `snapshotOnApplied(itemId, deps)`: best-effort, never throws, "unavailable" when the migration isn't applied; `cleanupUnconsentedSnapshots(client)` |
| `lib/chances/snapshot-deps.ts` | Server only: `snapshotDeps(supabase, estimate?)` (admit rate from the dataset, offering from the high school data) |
| `lib/planner/store-apply.ts` | `markApplied` schedules `snapshotOnApplied` with `after()` |
| `lib/chances/calibration.ts` | Pure measurements: Wilson 90%, `RATE_BANDS`, cells, order check, Likely-miss flag (15%), ordinal AUC, implied frequencies and Brier, `heldOutBySeason`, `ablations`, `rigorLowerEvidence`, `overrideComparison`, `sharersMix`, `summaryRows`, `seasonReport`, `planCalibration`, `summaryView`, like-you thresholds |
| `scripts/chances-calibration.mts` | `npm run chances-calibration [-- --dry-run] [--season YYYY] [--next YYYY-MM-DD]`: reads `chances_outcome_rows()` with the secret key, prints the internal report, replaces the season's `chances_summary` rows |
| `lib/chances/summary.ts`, `components/data/ChancesAccuracy.tsx` | The Data page section "How well Quad's estimate did" (`/data#estimate-accuracy`): band cards, the student-change comparison, the sharers' mix; "Not enough outcomes yet" when empty or thin |
| `lib/chances/like-you.ts` | `likeYouCount({ unitId, position, baseRateKind, state })` → `{ n, admitted, seasons }` or null |
| `lib/account-export.ts` | `application_snapshots` in "Download my data" (inputs, the estimate's group and label, the student's group, consent; not the measurement-only columns) |
| `lib/planner/store-offers.ts`, `components/planner/OfferControls.tsx` | `deleteApplicationSnapshots(listId)` and "Delete the numbers saved when you applied" under the outcome-share consent, whose text now says the snapshots are shared with it |
| `app/api/cron/weekly/route.ts` | Runs the cleanup each week when the secret key is set (a no-op until a season finishes) |
| Tests | `tests/chances-snapshot.test.mts` (binning, no identity, the write's tolerance, the migrations' text with guards), `tests/chances-calibration.test.mts` (measures on synthetic outcomes, held-out split, suppression), `tests/chances-snapshot-policies.test.mts` (PGlite: writes, reads, deletes, consent sync, cleanup, like-you thresholds, the summary's grants, with guards) |

### Decisions the build made
- **Season** = the fall the student would enter (applied July or later counts toward the next year); a season is
  finished September 1 of that year (decisions, wait lists, summer melt). The cleanup and the like-you window
  ("the last three finished seasons") use the same rule in SQL and TypeScript.
- **Outcome**: admitted counts as admitted; denied and wait-listed as not; deferred and undecided rows are left out.
  The outcome is read from `list_items` at measurement time (not copied), so a later wait-list admit counts.
- **Bands** are the college's overall admit rate (`admissions.acceptance_rate`) as the site showed it on the day,
  stored on the snapshot; the base rate the estimate used is stored separately (`base_rate`, `base_rate_kind`) for
  the method's own cells.
- **A cell reports a share at 30 outcomes** (method/outcomes.md); below that the public row keeps only `n`.
- **"Changed the group"**: the student picked the group (`category_source = 'student'`) and it differs from the
  estimate's; `student_group` is recorded either way so overrides can be measured.
- **Inputs without an estimate**: until the estimate is wired, snapshots record the binned inputs and leave the
  estimate's columns empty; the measurements count only rows with a group and a model version.
- **Method columns** (`position`, `base_rate_kind`, `base_rate`, `crowded`, `rigor_reading`, `without_*`) are
  recorded for the measurements, readable by the list's readers through RLS like the rest of the row, but never
  exported, displayed, or returned by the app.
- **Thresholds in functions, not views** (database-architecture.md asks for views): the like-you cell takes
  parameters, so it is a security-definer function with the thresholds in its `having`, the same effect.
- **The national application mix** (Common App's figures) beside the sharers' mix, and the weighted sensitivity check,
  wait for a curated reference file with its source; the page shows the sharers' mix alone and says who shares.

### For the estimate unit (U5)
Pass an `AppliedEstimator` to `snapshotDeps(supabase, estimate)` in `markApplied` (or make it the default in
`lib/chances/snapshot-deps.ts`): `(input: EstimateInput) => { result: EstimateResult; detail?: SnapshotDetail }`,
where `detail` carries the Stage 1 position, the base-rate kind and rate, crowding, the rigor reading, and the group
with each of residency, crowding, rigor, and rank switched off. `estimateInputFromProfile()` builds the input from the
saved profile; reuse it so the snapshot bins exactly what the estimate read.
