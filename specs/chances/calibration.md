# Outcomes and Accuracy: What Students Share, and How Well the Estimate Did

> Status: **planned** 2026-10-10. Part 5 of [admission chances](README.md). After [estimate.md](estimate.md); uses the
> planner's opt-in outcome share (built in [../planner/offers.md](../planner/offers.md), consent on `lists`) and
> [scattergrams.md](../product/scattergrams.md) (planned); replaces the pilot section of
> [chances-and-fit.md](../product/chances-and-fit.md#pilot). How outcomes are used to improve the estimate is part of
> the confidential method and is specified in the private model repository.

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
  sub-count (the scattergram threshold). How "numbers like yours" is defined is part of the confidential method.
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
- Row-level data never leaves Supabase except to the private model repository's training job, which reads it with a
  dedicated role and writes back only model versions and aggregates.
- Snapshot tables have row-level security mirroring `list_items`; a student can export and delete their snapshots.

## Files (planned)
Public: migration `…_application_snapshots.sql` (table, policies, the season-end cleanup of unconsented rows),
`lib/chances/snapshot.ts` (pure: the binned snapshot from the estimate's input and result), the snapshot write in the
built applied transition, the Data page section reading a published summary table, the "students like you" query
with its suppression, `tests/chances-snapshot.test.mts` (binning, no name or high school id, consent and cleanup,
suppression thresholds).
Private (`raywross/quad-model`): how outcomes are used, the season measurements behind the summary, and release checks.

## Open questions
1. Should snapshots be taken for students who haven't consented (kept private, deleted at season's end) so a later
   consent is complete? Recommendation: yes, as above; it is the student's own data in their own account.
2. Are "students like you" counts a paid feature? Recommendation: free on the profile (one college at a time); across
   the list in the planner, with the planner's tier ([../planner/README.md](../planner/README.md)).
3. Should the accuracy summary be public from the first season, even if thin? Recommendation: yes, with the counts;
   publishing the misses is what makes the estimate believable.
