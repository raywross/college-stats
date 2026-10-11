# Cost by Income: Running the Accuracy Pilot

How to check the cost curve's estimates against the colleges' own net price calculators, and turn estimates on in
production when they pass. The model and the bar are in [cost-by-income.md](cost-by-income.md#the-accuracy-pilot);
this page is the how-to.

## Why it matters
Above $110K the curve is an estimate (`lib/cost-curve.ts`). Until the pilot passes, production shows only the
published part, merit, and promises, with "Published data end at $110K; use the college's calculator" in place of the
break point and the dashed estimate. Preview and development deployments always show the estimates, so they can be
checked before the pilot runs (`estimatesShown()`).

## Steps
1. Open `data/reference/cost-curve-pilot.json`. It lists the 25 colleges (10 need-only privates, 8 merit-offering
   privates, 7 publics), each with its calculator link (`npc_url`), and the incomes to try: $125K, $150K, $200K,
   $250K, $300K, $350K, $400K.
2. For each college, run its calculator once per income for the **reference family**: two parents (married), two
   children, one starting college next fall, typical assets (about $50K in savings and investments, no business,
   home equity left at the calculator's default or blank), in-state at publics. Record the yearly price the
   calculator shows (the full cost minus grants and scholarships; leave loans and work out). At merit-offering
   colleges, record the need-based price: skip or zero any merit questions, since the bar scores need aid only.
3. Fill in the college's `results`:
   ```json
   "results": {
     "checked": "2027-03-14",
     "prices": { "125000": 18400, "150000": 26100, "200000": 47900, "250000": 71300, "300000": 89000, "350000": 89000, "400000": 89000 },
     "zero_aid_income": 290000,
     "notes": "Asked for home equity; left blank"
   }
   ```
   `zero_aid_income` is optional: the lowest income where the calculator shows no need-based grant, if you narrowed
   it down by trying more incomes. Without it the script uses the first income where the price reaches the full price.
   A calculator that won't give a figure: leave that income `null` and say why in `notes`.
4. Score it:
   ```
   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/score-cost-pilot.mts
   ```
   It prints each college's estimated break point beside the calculator's, the prices within ±$6K, and pass or fail
   against the bar (break point within ±$30K at 80% of colleges; price within ±$6K at 80% of points). It exits 0 on
   a pass, 1 on a fail, 2 when nothing is recorded. It isn't part of `npm run verify`.
5. **If it passes** with all 25 recorded, set `"passed": true` in the pilot file and merge it in a data PR: production
   then shows estimates. **If it fails**, the spec allows one round of tuning: the reference distribution
   (`data/reference/income-above-110k.json`; its notes say what to try first) and the bounds on r (`R_MIN`, `R_MAX`
   in `lib/cost-curve.ts`). Re-score; if it still fails, leave `passed` false.
6. Put the scored table in the PR description, and re-run the pilot each year when the federal net price data refresh.

## What to watch for
- **Promise-anchored colleges.** The script scores the model as the site shows it, with each college's curated policy
  (`data/aid-policies.json`). Where a college publishes a free-tuition line above $110K, the curve above that line
  uses the sector default r (`PROMISE_R`, 0.40; range 0.30–0.50), not the college's own figures: the pilot is what
  tells whether 0.40 is right, so compare those colleges' $250K–$400K prices closely and tune `PROMISE_R` if they
  miss together. A promise whose curve sits far above the published $110K+ figure is flagged
  (`promises[].disagrees`); note those colleges in the PR.
- **Publics with state merit programs** (for example, scholarships for in-state students at any income) have low
  $110K+ prices that reflect merit rather than need. A calibration pinned at the lower bound gives no estimate
  (Florida), but one just above it still does (Arizona State, r about 0.20): compare those colleges' calculator
  results closely.
