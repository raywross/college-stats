# Review: "Modeling College Acceptance Likelihood Under Grade Inflation and Holistic Admissions"

> Review of the owner's input document ([ideas/grade-inflation-acceptance-model.md](ideas/grade-inflation-acceptance-model.md)),
> written 2026-10-10 against the site's data that day, the built and in-progress planner, and new research. Not a work
> item; what gets built is in [README.md](../README.md). Sources from the research pass are listed at the end. A few
> came from search summaries because the pages couldn't be opened that day; those are marked *(summary)* and must be
> re-read before any figure is quoted on the site.

## Verdict in short
The diagnosis is right and well supported: unweighted GPAs are crowded at the top, test-optional policies removed the
common yardstick, and colleges read course rigor against the high school. Three of its ideas are worth building
nearly as written: **rigor relative to what the school offers**, **reading C7 to know what each college weighs**, and
**a two-stage view (in the pool, then the pool's odds)**. The machinery around them should not be built as written:
the composite indices measure little on real data, the probability arithmetic doesn't produce probabilities, and the
training data it assumes doesn't exist in public. The site's rule (published rules, three groups, never a percentage;
[chances-and-fit.md](../../product/chances-and-fit.md#goal)) stays, and the proposal makes those rules much better.

| Proposal element | Decision | Where |
|---|---|---|
| Grade inflation as the core problem | **Adopt** | GPA crowding on the profile and in standing |
| Institutional Selectivity Index | **Reject**; keep its one new input (GPA crowding) | [how-colleges-read.md](../how-colleges-read.md) |
| Academic Evaluation Weight / Rigor Weight Ratio | **Adapt**: C7 decides which evidence counts and is shown as words | [how-colleges-read.md](../how-colleges-read.md), [standing.md](standing.md) |
| Student inputs (core GPA, course counts, AP scores, test flag, major, round) | **Mostly adopt**; core GPA dropped, AP scores optional and not scored | [rigor-in-context.md](../rigor-in-context.md) |
| High school context (offering, scale, rank policy, college-going) | **Adopt**, read from the built high school dataset | [rigor-in-context.md](../rigor-in-context.md) |
| Advanced Course Exhaustion Ratio | **Adopt with a reachable denominator** | [rigor-in-context.md](../rigor-in-context.md) |
| Course-Level Rigor Score | **Partly**: advanced courses listed with grades; no multipliers; full transcript deferred | [rigor-in-context.md](../rigor-in-context.md#grades-in-advanced-courses) |
| AP Performance Integrity Index | **Reject** | [rigor-in-context.md](../rigor-in-context.md#what-we-take-from-the-proposal-and-what-we-dont) |
| Two-tier architecture | **Adopt as rules** | [standing.md](standing.md) |
| Major and round multipliers | **Replace** with the matching published base rate; ED shown, never moving the group; where a unit says how it reads grades, a quoted subject position | [base-rates.md](../base-rates.md), [major-and-grades.md](../major-and-grades.md) |
| XGBoost + isotonic calibration | **Gate** behind collected outcomes and a beat-the-rules test | [calibration.md](outcomes.md) |
| Five probability bands | **Map** onto three groups with two labels; no percentages | [standing.md](standing.md#groups-and-labels) |

## The diagnosis holds
- **Grades rose while scores fell.** ACT's study of over 4.3 million students at 4,700 public high schools found the
  average high school GPA rose from about 3.2 in 2010 to about 3.4 in 2021, most of it after 2016, while ACT
  composites fell (ACT 2022; two published versions give 3.17→3.36 and 3.22→3.39), and inflation was steepest in
  math (ACT 2023). NCES's 2019 transcript study: average GPA 3.11 against 3.00 in 2009, with more credits, while NAEP
  math fell. College Board: the share of SAT takers with an A average rose from 39% (1998) to 47% (2016) as mean scores
  fell, most at affluent schools. ACT's July 2026 report finds grades well above test scores for about 28% of the
  2023–24 cohort, tied to school-level inflation and to lower first-year college grades *(summary)*.
- **Tests carry information grades no longer do, at the top.** At Ivy-Plus colleges, SAT/ACT scores predict
  first-year college GPA about four times as strongly as high school GPA; moving from a 3.2 to a 4.0 high school GPA
  predicts under a tenth of a point of college GPA, while 1200 to 1600 on the SAT predicts 0.43 (Friedman, Sacerdote,
  Staiger, Tine, 2025). This is why Dartmouth (Feb 2024), Yale, Brown, and others went back to requiring tests, with
  Princeton and Columbia requiring them from the 2027–28 cycle and Yale returning to SAT/ACT only for 2026–27.
- **Rigor is read against the school.** The Common App counselor report rates course selection from *most demanding*
  to *less than demanding* against the school's other college-prep students and asks how many AP, IB, and honors
  courses the school offers; EAB found every admissions officer it surveyed reads rigor school by school from the
  school profile *(summary)*.
- **The site's own data shows the crowding.** Of the 71 colleges whose CDS reports GPA bands for all first-years, the
  median has 46% at 3.75 or higher and 28 have half or more. It isn't only elite colleges: Delaware (admitting 71%) and
  Elon (63%) are at 70%.

## Institutional indices

### Institutional Selectivity Index
`ISI = w_a(1 − admit rate) + w_y · yield + w_t · SAT75/1600 + w_g · GPA saturation`
- **Yield isn't selectivity.** Across the 1,546 colleges with the counts, yield and admit rate correlate at only
  −0.23; the highest yields on the site belong to seminaries and online colleges admitting most applicants. Yield rises
  with early decision (which is why U.S. News dropped it in 2003), low price, religious mission, and regional loyalty
  (BYU's is near Stanford's). Economists who ranked colleges by revealed preference called admit rate and yield "easy to
  manipulate" (Avery, Glickman, Hoxby, Metrick, 2013). Evidence for "yield protection" is anecdotal.
- **The test term double-counts.** The student's score is already placed against the college's range; adding the
  college's 75th percentile again rewards the same fact twice. Scaled to 1600 it also compresses: the selective end of
  the scale sits between 0.85 and 1.0.
- **The weights would be ours.** Four hand-set weights and a hand-set sigmoid threshold produce an authoritative-looking
  number with no outcome to fit it to. The admit rate already is the selectivity measure families understand, and with
  [base rates](../base-rates.md) it becomes the rate for the student's own pool.
- **What's kept:** GPA saturation, renamed **GPA crowding**, as its own cited fact ("70% of first-years had a 3.75 or
  higher") that changes how the GPA position is read ([standing.md](standing.md#gpa-crowding)). One caution the
  data adds: colleges that report weighted GPAs (UNC, William & Mary, WashU, UGA) pile students into the top band, so
  their crowding share can't be read ([how-colleges-read.md](../how-colleges-read.md#the-block-readingtherecord)).

### Rigor Weight Ratio
`RWR = rigor ÷ (class rank + GPA + 1)` from C7's 0–3 scale. On the 147 colleges with a C7 grid:
- 113 rate rigor **and** GPA "very important"; the ratio takes only eleven values and 123 colleges sit on four of them
  (0.60, 0.75, 0.50, 0.43), separated mostly by how they weight class rank.
- C7 is ordinal and self-reported; dividing ordinal ratings gives a number with more precision than the filing has, and
  selective colleges commonly rate eight to ten factors "very important".
- **What's kept:** C7 decides *which* evidence counts at a college (a test position only where tests are weighed, a
  rank position only where rank is weighed, rigor only where it's at least important), and its ratings are shown as a
  sentence. The 1,586 colleges with IPEDS factors get the same treatment at IPEDS's coarser scale.

## Student inputs and high school context
- **Core-subject unweighted GPA.** Colleges publish overall GPA bands, not core-only ones, so there is nothing to compare
  a core GPA with; the built profile's unweighted GPA (and the planner's weighted-GPA bounds) stay.
- **Advanced course counts, completed and planned.** Adopted, split by kind; the senior schedule matters because
  colleges see it.
- **AP exam scores.** Optional on applications, self-reported, and the senior year's exams aren't scored until July
  (2026 scores reached students July 6), after decisions. Kept as an optional fact in the reasons, not in the group.
- **Test percentile and test flag.** Built in a better form: the score is placed against each college's own range, and
  the test-optional "withheld" rule decides whether it counts.
- **Major and round.** Kept, as base rates ([below](#round-and-major)).
- **High school context.** The site already has it: CRDC 2023–24 AP course counts for 13,191 of 35,390 high schools
  (median 9 courses offered), school-profile extractions (scale, rank policy, AP list) for the pilot schools, and
  college-going rates where states publish them ([high-school-data.md](../../product/high-school-data.md)). CRDC covers
  public schools only and counts AP courses, not honors or IB levels; that limit is stated wherever the comparison
  shows.

## Engineered features
- **ACER (taken ÷ offered).** The best idea in the document, and the denominator exists. As written it penalizes
  students at well-resourced schools (no one takes all of a 23-course AP catalog, and the CRDC's 90th percentile is
  23); capped at a reachable ten (five core subjects in 11th and 12th grade) it reads the way a counselor does, and is
  shown as a reading ("most of what your school offers"), not a ratio. A second measure asks the counselor's own
  question directly: was each core subject at the school's top level?
- **CRS (grade × difficulty per course).** The whole transcript is 24–30 courses and its multipliers (1.15, 1.35,
  1.50; 0.90, 0.80…) would be invented. The useful part is kept at a cost a student will pay: the advanced courses
  (5–15 rows) are listed with their grades, which shows whether a demanding schedule came with strong grades and lets
  the planner suggest next year's courses ([course-plan.md](../course-plan.md)). Colleges that recalculate publish their
  own method; a UC-style recalculation from a full course list is the later version worth building.
- **APII (4+ exams ÷ AP courses).** Treats an exam not taken (fees, school policy, senior year) as a failed one, is
  structurally lower for students who take more APs as seniors, and frames the student as suspect. Not built.

## The model
- **Two stages, adopted.** "Necessary but not sufficient" is the right shape for selective admission; the built rules
  already behave this way, and [standing.md](standing.md) makes the stages explicit and shows them as two lines.
- **The arithmetic doesn't yield a probability.** `P_final = P_academic × M_major × M_round × sigmoid(ISI)` multiplies
  a probability by factors that can exceed 1 (a 1.2 humanities multiplier, an uncapped ED ratio) and applies
  selectivity twice (once inside `P_academic`, which is already relative to the college, and again through ISI). The
  sound form is additive on the log-odds scale, starting from the base rate of the student's pool; and without
  outcomes to fit the coefficients, any form is a guess with decimals.
- **Training data.** No public applicant-level file with outcomes exists for current U.S. selective admissions.
  "Systemwide public university datasets" are aggregates (UC's admissions by source school and by discipline, which UC
  itself calls "a general guide… not a predictor"); the Texas Higher Education Opportunity Project has applicant
  records from roughly 1990–2002 under restricted access; the Harvard trial released expert reports, not microdata;
  scattergrams are per-school and proprietary. A tree model trained on aggregates is an ecological model and can't be
  calibrated per student. The nearest public calibration target may be **IPEDS's new Admissions and Consumer
  Transparency Supplement (ACTS)**: applicants, admits, and enrollees by GPA and test-score quintile per institution,
  collected for 2025–26 and back to 2019–20, with release held up by litigation *(summary; release status unverified)*.
  If it is published, it is the first national per-college admit-rate-by-band file, and [calibration.md](outcomes.md)
  uses it.
- **Accuracy to expect.** An admissions office's own model on 13,248 applications at one selective college reported
  AUCs in the 0.8s using readers' ratings the public never sees *(summary)*; a model from applicant-side features alone
  will do worse, and worst at colleges admitting under 15%, where essays, recommendations, and hooks decide. Recruited
  athletes are admitted at about 86% at Harvard and legacy status multiplies a 10% chance about fivefold (Arcidiacono,
  Kinsler, Ransom, 2022); no student-facing model can see those, which is why the site says "hooked applicants are inside
  the ranges" every time.
- **Commercial tools.** CollegeVine publishes a self-reported calibration table (predicted 15% → 12.3% admitted;
  50% → 48.1%) from its own users' outcomes, with no independent audit; reviews and CollegeData's own help page say
  chancing is least reliable at the most selective colleges. No independent audit of any chancing tool was found.
- **Harm to watch for.** Scattergrams shift where students apply and deter some from selective colleges they'd likely
  get into (Mulhern, 2021). A classification can do the same, which is one more reason the groups lead with encouraging
  wording and why calibration checks overrides and outcomes, not just accuracy.

## Round and major
- **Round.** The raw ED ÷ RD ratio overstates the advantage: recruited athletes and legacies cluster in early pools.
  The classic study (Avery, Fairbanks, Zeckhauser; 500,000+ decisions at 14 colleges) found applying early worth about
  100 SAT points on the old scale (70% against 48% admitted for applicants scoring 1400–1490); no rigorous causal
  estimate since 2023 was found. So the ED rate is shown with its caveat and never moves the group
  ([base-rates.md](../base-rates.md#round)).
- **Major.** Real and large where units admit separately (Illinois: computer science 7.4% against the university's
  ~38%; Washington's Allen School: 26–37% for residents, 2–5% for others; UC by discipline) *(secondary sources)*.
  Not published at many universities (Georgia Tech, Texas, Virginia Tech, Michigan had no official major-level rates).
  So: the published major rate as the base rate where one exists, words where it doesn't, never a multiplier
  ([base-rates.md](../base-rates.md#major)).
- **Residency matters as much.** Georgia Tech publishes 28% in-state against 9% out-of-state (2026); Purdue 71%
  against 39% (fall 2025). The site's residency grid already has these for 71 colleges, so residency becomes the most
  widely available base rate.

## Output bands
Five probability bands (Far Reach < 15% … Safety > 85%) require calibrated probabilities the data can't support, and
"Safety" invites the one mistake counselors warn about most. They map onto the built three groups with two labels:
"Reach for everyone" (the far reach) and "Guaranteed for you" (the only honest safety, from a published
automatic-admission rule) ([standing.md](standing.md#groups-and-labels)).

## Legal and policy notes
- **Race and other protected traits.** After *SFFA v. Harvard* colleges may not act on race, so a race-conditioned
  chance would be misleading as well as inappropriate; the features list in [calibration.md](outcomes.md) excludes
  race, ethnicity, sex, legacy, and high school identity.
- **Claims.** The FTC requires substantiation for accuracy and efficacy claims (its 2024 actions on AI claims show it
  acts on untested ones); a published method plus a published calibration report is the substantiation, and the site
  makes no accuracy claim it hasn't measured.
- **Minors.** The amended COPPA rule (compliance from April 22, 2026) applies to under-13s, whom the site already
  excludes; the snapshots in [calibration.md](outcomes.md) follow the product's shared rules for user data.

## Sources
- ACT, grade inflation 2010–2021: https://industryinsights.act.org/2022/05/grade-inflation-past-decade ; in math:
  https://industryinsights.act.org/2023/08/grade-inflation-math ; R2514 (July 2026):
  https://www.act.org/content/dam/act/unsecured/documents/r2514-high-school-grade-inflation-and-academically-discrepant-college-readiness-indicators-2026-07.pdf
- NCES HSTS 2019 coverage: https://edweek.org/teaching-learning/12th-graders-took-harder-courses-and-got-higher-gpas-but-test-scores-fell-what-gives/2022/03
- College Board (Hurwitz & Lee) coverage: https://fordhaminstitute.org/national/commentary/high-school-grades-rise-sat-scores-fall
- Friedman, Sacerdote, Staiger, Tine (2025), NBER w33570: https://nber.org/papers/w33570 ; https://opportunityinsights.org/paper/test-scores/
- Chetty, Deming, Friedman, "Diversifying Society's Leaders?": https://opportunityinsights.org/paper/collegeadmissions/
- Dartmouth: https://home.dartmouth.edu/news/sat-admissions-faqs ; MIT: https://news.mit.edu/2022/stuart-schmill-sat-act-requirement-0328 ;
  Yale (2026-05-27): https://news.yale.edu/2026/05/27/undergraduate-admissions-updates-testing-policy ; Princeton:
  https://admission.princeton.edu/apply/standardized-testing
- Common App school report: https://college.harvard.edu/sites/default/files/2025-08/25-26_FY_schoolreport.pdf ; EAB: https://eab.com/?p=12563
- UC Information Center: https://www.universityofcalifornia.edu/about-us/information-center/admissions-source-school ;
  https://www.universityofcalifornia.edu/about-us/information-center/freshman-admission-discipline
- THEOP: https://oprdata.princeton.edu/Archive/THEOP
- Arcidiacono, Kinsler, Ransom: https://www.nber.org/papers/w26316
- IPEDS ACTS: https://www.airweb.org/resources/resource-centers/acts
- Lee, Kizilcec, Joachims: https://arxiv.org/pdf/2302.03610
- Avery, Glickman, Hoxby, Metrick: https://www.nber.org/papers/w10803
- Avery, Fairbanks, Zeckhauser coverage: https://www.harvardmagazine.com/2003/05/entering-the-elite-html
- Mulhern (2021): https://www.rand.org/pubs/external_publications/EP68489.html
- CollegeVine calibration: https://blog.collegevine.com/is-collegevine-chancing-accurate/ ; CollegeData:
  https://www.collegedata.com/college-tools/college-chances/help
- Texas automatic admission (UT Austin, top 5% for 2026 and 2027):
  https://tea.texas.gov/sites/default/files/taa-2025-12-18-the-university-of-texas-at-austin-automatic-admission-policy.pdf
- Georgia Tech 2026 admitted profile: https://admission.gatech.edu/images/pdf/2026/2026-First-year-admitted-profile.pdf ;
  Purdue fall 2025: https://www.purdue.edu/newsroom/2025/Q3/demand-for-purdue-education-breaks-record-across-undergrad-master-and-doctoral-levels-most-selective-incoming-class-and-highest-graduation-rate
- Major rates (secondary): https://www.collegetransitions.com/blog/university-of-illinois-at-urbana-champaign-inside-the-numbers/ ;
  https://www.collegetransitions.com/blog/university-of-washington-inside-the-numbers/
- AP score release 2026: https://www.collegetransitions.com/blog/when-do-ap-scores-come-out/
- COPPA amendments: https://www.loeb.com/en/insights/publications/2025/05/childrens-online-privacy-in-2025-the-amended-coppa-rule
- Site measurements: `data/schools.json` and `data/high-schools/` on `main`, 2026-10-10.
