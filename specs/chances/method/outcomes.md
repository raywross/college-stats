# Method: Measuring and Tuning the Estimate

> Method (not a work item). Part of [Quad's estimate](../estimate.md): the rules behind the season summary in [calibration.md](../calibration.md). Kept here until launch;
> moves to a private repository then ([../README.md](../README.md#quads-estimate-is-proprietary)). Never shown on the
> site.

### Goal
The proposal ends with "train XGBoost on historical applicant decisions and calibrate with isotonic regression". The
method is sound; the data doesn't exist in public. There is no national, applicant-level file of GPAs, scores,
courses, and decisions: the public sources are aggregates (a college's admit rate, its ranges, a university system's
admits by high school), and the applicant-level sets (Naviance and Scoir scattergrams, the commercial chancing sites'
user data, the Harvard trial data) are private or sealed ([proposal-review.md](proposal-review.md#the-model)).
So the order is the reverse of the proposal's: **publish rules first, collect outcomes with consent, measure the
rules against them every season, and only let a model in when it beats the rules on outcomes it never saw.**

### Measuring the groups (`scripts/chances-calibration.mts`, run after each season and on demand)
For every cell of group × base-rate band (under 20%, 20–35%, 35–50%, 50–70%, 70%+), with at least 30 outcomes:
- **Admitted share** with a 90% Wilson interval.
- **Order:** Likely > Target > Reach within each band; a band where the order fails is flagged.
- **The 15% rule** from chances-and-fit: if Likely is wrong more than 15% of the time in a band, the thresholds that
  produce Likely there move up.
- **Discrimination:** the AUC of the ordered group (Reach < Target < Likely) against admitted, overall and per band;
  the [proposal](ideas/grade-inflation-acceptance-model.md#4-modeling--algorithmic-strategy) asked for ROC-AUC and
  that is the honest version for an ordinal output.
- **Calibration of the implied frequencies:** each group-and-band cell's observed admitted share becomes its implied
  frequency; the Brier score of those frequencies on the next season's outcomes measures whether the groups carry
  over from one year to the next.
- **Each new input separately**: residency base rates, crowding, rigor, rank: the same measures with the input
  switched off, so the season report says what each one bought. `RIGOR_CAN_LOWER` flips only when *some*-rigor
  students at crowded colleges are admitted measurably less often (non-overlapping intervals) than *most*-rigor
  students with the same other positions.
- **Student overrides**: groups the student changed are measured separately (were they right more often than the
  model?), which is the cheapest signal of where the rules are wrong.

#### Bias, said plainly
Students who use a planner and share outcomes are not all applicants: they skew toward selective lists and engaged
families. The report shows the sharers' mix (by base-rate band, state, test-optional share) beside the national
application mix (Common App's annual figures) and weights cells to the national mix as a sensitivity check. A
threshold changes only when the weighted and unweighted results agree.

### When a model may replace the rules
A trained model (gradient-boosted trees or a regularized logistic regression with monotone constraints) is considered
only when all of these hold:
1. **Volume:** at least 20,000 snapshots with outcomes across at least 200 colleges, and 100+ at each college it
   covers; colleges below that keep the rules.
2. **Held-out by season:** trained on earlier seasons, tested on the latest, never a random split (admissions change
   year to year, and a random split leaks a college's season into its own test).
3. **Beats the rules:** lower Brier score and log loss than the rules' implied frequencies on the held-out season, in
   every base-rate band, by a margin set before the test.
4. **Explainable:** monotone in score, GPA, and rigor; each output comes with the same kind of reason sentences
   (the top contributing inputs, worded and cited), so a family can still see why.
5. **Features:** only what the student entered and the college published. Never race, ethnicity, sex, legacy, or
   anything inferred about the family; no high school identity (a model that learns which high schools get in would
   bake in exactly the access gaps the site's data shows).
6. **A model card** on the Data page: training seasons, colleges covered, the held-out results, and what it can't see
   (essays, recommendations, hooks, institutional priorities).

Even then, the output stays **a group**: the model's calibrated score is mapped to Reach / Target / Likely by fixed
cutoffs, never printed as a percentage. Holistic admission decides on evidence no profile holds (essays,
recommendations, the college's needs that year), and at a college admitting 8% no model can be calibrated per
student closely enough for a percentage to be honest; the commercial tools that print one are known to overstate
chances at the most selective colleges ([chances-and-fit.md](../../product/chances-and-fit.md#goal)).

### "Students like you" cells
A cell is college × Stage 1 position × base-rate kind × the last three seasons ([standing.md](standing.md)).
