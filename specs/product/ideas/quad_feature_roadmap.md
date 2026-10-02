# Quad Feature Roadmap & Technical Improvements

## Executive Summary
This document outlines feature enhancement recommendations for **Quad** (`college-stats-nine.vercel.app`). By expanding beyond macro federal datasets (IPEDS & College Scorecard) into granular, user-focused workflows, Quad can transform from a visual dataset explorer into an end-to-end college planning engine.

---

## 1. High-Priority Feature Recommendations

### A. Predictive "Real Cost" & Financial Aid Estimator
* **The Problem:** Published "average net price" numbers reflect overall institutional averages across all income tiers, making them misleading for individual families.
* **The Feature:** Allow families to input basic financial parameters (e.g., AGI, household size, assets, state of residence) to model projected out-of-pocket costs and merit aid eligibility across their saved college list.
* **Data Strategy:** Integrate Net Price Calculator (NPC) rules and historical Common Data Set (CDS) financial aid distribution data (Section H).

### B. Localized High School Context (Scattergrams)
* **The Problem:** National middle-50% SAT/GPA ranges do not reflect how specific high schools or school districts feed into selective universities.
* **The Feature:** Allow users or high school counselors to overlay high school scattergrams (GPA vs. SAT/ACT with historical acceptance outcomes) directly onto Quad's national plots.
* **Data Strategy:** Enable self-serve CSV imports (from Naviance or Scoir exports) with automatic client-side PII scrubbing.

### C. Side-by-Side Financial Aid Offer Evaluator
* **The Problem:** High school seniors receive confusing, non-standardized financial aid award letters that disguise loans and work-study as "grants."
* **The Feature:** An interactive award letter analyzer where users upload or input competing financial aid offers. Quad standardizes out-of-pocket costs, projects 10-year loan debt burdens, and overlays that specific college's median post-grad earnings.

### D. Major-Level ROI & Outcome Drilldowns
* **The Problem:** Overall university median earnings blend computer science majors with fine arts majors, obscuring true program-level return on investment.
* **The Feature:** Display earnings, debt burden, and graduation rates broken down by specific major/CIP code using program-level College Scorecard data.

### E. Early Decision (ED) / Early Action (EA) Strategy Engine
* **The Problem:** Families struggle to evaluate whether applying ED provides a statistical advantage or merely reflects legacy/recruiter bias.
* **The Feature:** Parse Section C2 of Common Data Sets across multiple years to isolate ED/EA acceptance rates vs. Regular Decision (RD) acceptance rates, highlighting the true "ED advantage" adjusted for yield and applicant pool size.
