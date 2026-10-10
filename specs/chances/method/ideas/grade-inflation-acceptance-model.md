# Modeling College Acceptance Likelihood Under Grade Inflation and Holistic Admissions

> Input idea document, submitted by the owner 2026-10-10 and kept as written (tables restored to markdown). The
> review is [../proposal-review.md](../proposal-review.md); what the site will build from it is
> [../../README.md](../../README.md).

## 1. Executive Summary & Objective

The objective of this specification is to define a data schema, feature engineering pipeline, institutional scoring
methodology, and algorithmic strategy to predict college acceptance probabilities.

In elite higher education admissions, unweighted High School GPA suffers from extreme top-end saturation
($3.9\text{--}4.0$), while test-optional policies complicate traditional standardized testing metrics. This framework
addresses these challenges by moving beyond raw GPA/acceptance rates to model relative course rigor within high school
context, multi-dimensional institutional selectivity, and non-linear applicant-school fit.

## 2. Institutional Selectivity & Institutional Characterization Score ($ICS$)

Traditional selectivity metrics rely primarily on overall acceptance rate and middle-50% test scores. To refine this
concept, we introduce a composite Institutional Selectivity Index ($ISI$) and an Academic Evaluation Weight ($AEW$)
based on public data sources.

### 2.1 Public Institutional Data Sources

**Common Data Set (CDS):**
- Section C1–C2: Total applicants, admitted, matriculated (Overall Acceptance Rate).
- Section C7: Relative importance of 19 academic and non-academic factors (Rated: Very Important = 3, Important = 2,
  Considered = 1, Not Considered = 0).
- Section C9–C12: SAT/ACT percentiles, submission rates, high school GPA distributions, class rank percentages.
- Section C21–C22: Early Decision (ED) / Early Action (EA) applicant and admission counts.

**IPEDS (Integrated Postsecondary Education Data System):**
- Yield rate, yield volatility, yield-protection proxies, state-by-state residency breakdowns, institutional
  expenditures per student.

**University System Open Data Portals (e.g., UC Systemwide, UT Austin, UMich):**
- Major-level acceptance rates, average AP count by admitted cohort, residency differential acceptance rates.

### 2.2 Refined Institutional Selectivity Index ($ISI$)

Rather than relying strictly on $Acceptance Rate = \frac{Admitted}{Applicants}$, we incorporate yield strength,
academic density, and applicant pool self-selection.

$$ISI = w_a \cdot (1 - \text{AcceptanceRate}) + w_y \cdot \text{YieldRate} + w_t \cdot \text{StandardizedTestIndex} + w_g \cdot \text{GPASaturationIndex}$$

Where:
- $\text{StandardizedTestIndex}$: Normalized $0\text{--}1$ score derived from the CDS C9 75th percentile SAT/ACT score
  relative to the national ceiling ($1600 / 36$).
- $\text{GPASaturationIndex}$: Proportion of enrolled students in CDS C11 with a GPA $\ge 3.75$.
- $\text{YieldRate}$: Enrolled students divided by admitted students ($\frac{Matriculated}{Admitted}$). A high yield
  rate indicates lower vulnerability to yield protection and higher genuine applicant demand.

### 2.3 College Academic Evaluation Weight ($AEW$)

Extracted directly from CDS Section C7, the $AEW$ quantifies how much a specific college values academic markers
relative to holistic/non-academic markers.

$$\text{Rigor Weight Ratio } (RWR) = \frac{\text{Weight}(\text{Rigor of Secondary School Record})}{\text{Weight}(\text{Class Rank}) + \text{Weight}(\text{GPA}) + 1.0}$$

This metric allows the prediction model to dynamically prioritize Rigor over GPA for institutions that explicitly
state that course difficulty supersedes nominal grade point average.

## 3. Student Data Schema & Contextual Feature Engineering

To combat grade inflation, student data must be normalized against the offerings and characteristics of their
specific high school profile.

### 3.1 Primary Student Inputs

| Variable | Type | Description |
|---|---|---|
| gpa_unweighted_core | Float ($0.0\text{--}4.0$) | Core academic subjects only (Math, English, Science, Social Studies, Foreign Language). |
| ap_ib_honors_count | Integer | Total number of advanced courses completed/planned by senior year. |
| ap_scores_avg | Float ($1.0\text{--}5.0$) | Average score on AP exams taken (or IB equivalent scale). |
| ap_scores_4_or_5_count | Integer | Total count of AP exams passed with a high score ($\ge 4$). |
| sat_act_percentile | Float ($0\text{--}100$) | Percentile converted from highest composite score (if submitting). |
| is_test_submitting | Boolean | Flag indicating whether standardized test scores will be submitted. |
| intended_major_category | Categorical | e.g., CS/Engineering, Business, Humanities, Natural Sciences, Fine Arts. |
| application_round | Categorical | Early Decision (ED), Early Action (EA), Regular Decision (RD). |

### 3.2 High School Contextual Variables (High School Profile Data)

| Variable | Type | Description |
|---|---|---|
| hs_ap_ib_offered | Integer | Total advanced courses offered at student's high school. |
| hs_grading_scale | Categorical | Weighted ($5.0/6.0$), Unweighted ($4.0$), 100-Point Scale. |
| hs_rank_policy | Categorical | Exact Rank, Decile/Percentile Only, No Ranking. |
| hs_college_bound_pct | Float ($0\text{--}100$) | Percentage of graduating class attending 4-year colleges. |

### 3.3 Engineered Relative Rigor Features

**A. Advanced Course Exhaustion Ratio ($ACER$).** Measures the extent to which the student took advantage of the
advanced curriculum available at their school.

$$ACER = \frac{\text{Student Advanced Courses Taken}}{\max(\text{High School Advanced Courses Offered}, 1)}$$

**B. Course-Level Rigor Score ($CRS$).** Calculates a weighted average across all courses, penalizing unweighted
course loads:

$$CRS = \frac{\sum_{i=1}^{N_{courses}} \left( \text{GradeMultiplier}_i \times \text{CourseDifficultyMultiplier}_i \right)}{N_{courses}}$$

Where:
- $\text{CourseDifficultyMultiplier}_i$: Standard / On-Level = $1.00$; Honors / Accelerated = $1.15$; AP / IB HL /
  Dual Enrollment = $1.35$; Post-AP / Advanced College Math = $1.50$.
- $\text{GradeMultiplier}_i$: $A / A+ = 1.00$, $A- = 0.90$, $B+ = 0.80$, $B = 0.70$, $< B = 0.40$.

**C. AP Performance Integrity Index ($APII$).** Measures whether classroom grades in advanced classes align with
standardized exam outcomes (guarding against high school grade inflation):

$$APII = \frac{\text{Count}(\text{AP Exams } \ge 4)}{\max(\text{Count}(\text{AP Courses Taken}), 1)}$$

## 4. Modeling & Algorithmic Strategy

Top-tier college admissions exhibits non-linear threshold dynamics: high academic metrics are necessary conditions,
but beyond a critical threshold, academic delta yields diminishing returns.

```
+-----------------------------------------------------------------------+
|                           INPUT FEATURES                              |
|  [Student Profile] + [HS Context] + [Target College CDS & IPEDS Data] |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                       FEATURE TRANSFORMATIONS                         |
|   1. Calculate Course-Level Rigor Score (CRS)                         |
|   2. Compute Advanced Course Exhaustion Ratio (ACER)                  |
|   3. Compute AP Performance Integrity Index (APII)                    |
|   4. Compute Target College Institutional Selectivity Index (ISI)     |
|   5. Compute Target College Academic Evaluation Weight (AEW)          |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                        STAGE 1: ACADEMIC FIT                          |
|         Evaluates if candidate meets core academic threshold          |
|    Output: Academic Fit Probability Score (P_academic: 0.0 - 1.0)     |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                      STAGE 2: CONTEXT & MAJOR                         |
|     Adjusts for Major Selectivity Multiplier & Application Round      |
|    Output: Adjusted Baseline Probability Score (P_adjusted)           |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                    STAGE 3: CALIBRATION & OUTPUT                      |
|  Isotonic Regression / Sigmoidal Non-Linear Probability Transformation|
|     Output: Final Likelihood Category (Reach, Target, Likely/Safety)  |
+-----------------------------------------------------------------------+
```

### 4.1 Two-Tier Predictive Architecture

**Tier 1: Academic Threshold Probability ($P_{academic}$).** Evaluates whether the student's academic profile places
them in the competitive pool for the target college.

$$P_{academic} = \sigma \left( \beta_0 + \beta_1 (CRS - CRS_{target}) + \beta_2 (ACER) + \beta_3 (APII) + \beta_4 (\Delta_{SAT/ACT}) \right)$$

Where:
- $\Delta_{SAT/ACT}$: Difference between applicant's score percentile and the target college's CDS C9 50th percentile
  score (set to $0$ or imputed via regression if test-optional).
- $\sigma(x)$: Sigmoid activation function $\frac{1}{1 + e^{-x}}$.

**Tier 2: Institutional & Contextual Adjustment ($P_{final}$).** Modifies $P_{academic}$ based on application round
advantage, major-specific competitiveness, and overall institutional selectivity ($ISI$).

$$P_{final} = P_{academic} \times \mathbf{M}_{major} \times \mathbf{M}_{round} \times \left( \frac{1}{1 + e^{k \cdot (ISI - ISI_{threshold})}} \right)$$

Where:
- $\mathbf{M}_{major}$: Major difficulty multiplier (e.g., Computer Science = $0.3\text{--}0.6$ at top engineering
  institutions; Humanities = $1.0\text{--}1.2$).
- $\mathbf{M}_{round}$: Early Decision boost factor derived from CDS C21 data
  ($\frac{\text{ED Acceptance Rate}}{\text{RD Acceptance Rate}}$), capped to prevent over-crediting legacy/athletic ED
  bias.

### 4.2 Recommended ML Algorithms

**Gradient Boosted Decision Trees (XGBoost / LightGBM):**
- Handles non-linear feature interactions well (e.g., interaction between high $ACER$ and low test scores).
- Naturally handles missing values in optional test submission fields.

**Isotonic Regression / Platt Scaling Calibration:**
- Raw model confidence scores from classification tree algorithms must be calibrated into true probabilistic outputs
  ($0.0\text{--}1.0$) representing real-world acceptance likelihood.

## 5. Output Categorization Framework

Rather than displaying a precise probability (which can create a false sense of certainty in holistic admissions),
convert calibrated probabilities into risk bands:

| Probability Range ($P_{final}$) | Band Category | Description |
|---|---|---|
| $< 15\%$ | Far Reach | Unpredictable; high selectivity threshold regardless of student credentials. |
| $15\% \text{--} 35\%$ | Reach | Student meets baseline criteria, but acceptance remains statistically competitive. |
| $36\% \text{--} 65\%$ | Target | Academic profile matches institutional median; competitive candidate. |
| $66\% \text{--} 85\%$ | Likely | Student profile significantly exceeds institutional median metrics. |
| $> 85\%$ | Safety | High probability of admission based on historical open data profiles. |

## 6. Implementation Roadmap for Data Researchers

1. **Ingest & Parse CDS Data:** Extract C1, C7, C9, C11, C12, and C21 into structured tabular format.
2. **High School Data Augmentation:** Normalize high school profiles to populate hs_ap_ib_offered and grading scales.
3. **Compute Composite Variables:** Run feature pipelines to produce $CRS$, $ACER$, $APII$, and $ISI$.
4. **Train & Validate:** Train XGBoost binary classifier on aggregated historical applicant decision outcomes (e.g.,
   systemwide public university datasets). Evaluate model performance using ROC-AUC and Brier Score for probability
   calibration.
