# Colleges That Would Compete for You

> Status: **idea** (2026-10-03). After [student-profile.md](../product/student-profile.md),
> [chances-and-fit.md](../product/chances-and-fit.md), and [cds-financial-aid.md](../data-expansion/cds-financial-aid.md)
> (merit awards to students without need). Part of [ideas](README.md).

## Question it answers
*Which colleges would be glad to have me, and show it in money?* Every search site promises a hidden gem (CollegeIQ:
"there's a perfect-for-you college you don't know about"; the buyers-and-sellers list it now hosts behind a sign-up).
In the data, that college is one where the student sits above the admitted range, merit awards to students without
need are routine, and demand has softened. Quad can compute that for one student from cited figures.

## Why it's fresh
Reverse search. Levels.fyi tells an engineer where an offer sits in a company's pay band; Redfin's Compete Score tells
a buyer how hard a market is. This turns the standing rules around: not "where do I stand at this college" but "at
which colleges am I the one being recruited". Not a probability, not a rating of the college, and no composite score;
a list with its reasons.

## Signals
All cited, from fields the site has or has planned.

| Signal | Source | Rule |
|---|---|---|
| Above the range | The standing rules in [chances-and-fit.md](../product/chances-and-fit.md): SAT or ACT position `above`, or GPA `above` where CDS bands exist | Required |
| Merit is routine | CDS H2A: the share of no-need first-years with a non-need award and its average ([cds-financial-aid.md](../data-expansion/cds-financial-aid.md)) | Share ≥ 30%; the average shown as a share of full price |
| Demand softened | History: applicants or undergraduates down 10% or more over ten years (`trends`), or yield under 20% | At least one, shown as the figure |
| Affordable | Average paid for the family's income band, or the estimator's range when a guardian has run it, at or under the profile's maximum | When the profile has a maximum |
| Finishes its students | Six-year graduation ≥ 55% | A floor; the figure is shown, not hidden |
| Fit | Preferences from [chances-and-fit.md](../product/chances-and-fit.md#fit): size, setting, region, a major with 25 or more graduates a year | Matches and mismatches listed |

Order by merit share × the student's margin above the 75th percentile, both visible on the row; ties by applicants.
Thresholds live in one constants object and are tuned in the pilot.

## Display
- `/me/compete`: up to 25 colleges, each a `SchoolRow` with three reason lines, for example "Your SAT 1380 is above its
  75th percentile (1310, fall 2024)" · "54% of first-years without need got a merit award, averaging $14,200
  (2024–25)" · "Applications down 18% since 2015"; add to list; the estimated price when the guardian has run the
  estimator.
- **Explore**: a chip "Would compete for you" (`fit=compete`), resolved server-side from the profile like the other
  fit filters.
- **Profile**: a line in the admissions card when the college qualifies for the signed-in student.
- **Caveats on the page**: merit is never promised; colleges change their discounting from year to year (the history
  chart is one tap away); "above the range" describes enrolled students, who are a subset of admitted ones; recruited
  athletes and other hooked applicants are inside the ranges.

## Pilot
Before shipping, for 20 profiles across the score and GPA range, hand-check the top ten colleges each against the
colleges' own merit pages (many publish automatic-scholarship tables by GPA and score). Record how often the
college's published table would give that student an award. Publish the check on the Data page, as the estimator's
pilot will be.

## Tier
Free: the three strongest matches. Plus: the full list and the Explore chip (standing across Explore is a Plus feature
in [commercialization.md](../product/commercialization.md#feature-map)).

## Complexity
Medium: a query over fields three other specs provide, one page, one Explore chip, and a hand-checked pilot.

## Open questions
1. The name. "Would compete for you" says what the data shows; "colleges that want you" promises too much.
2. The automatic-scholarship tables colleges publish (GPA × score → award) could be captured by the agent and would
   turn "merit is routine" into "you would likely get $X, by the college's own table". A later idea with its own page.
