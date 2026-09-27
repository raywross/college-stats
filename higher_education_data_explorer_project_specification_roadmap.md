# Higher Education Data Explorer: Open Data Visualization Tool

## Project Vision
An open-source, interactive web application designed to help students, counselors, researchers, and policymakers visualize and explore higher education admissions, demographic, and financial data across U.S. institutions. 

By aggregating public disclosures—such as the **Common Data Set (CDS)** and **IPEDS/College Scorecard** APIs—this tool translates complex, multi-year PDF disclosures and tabular datasets into actionable visual insights.

---

## Key Data Sources & Integration Strategy

| Data Source | Type | Access Method | Key Metrics Included |
| :--- | :--- | :--- | :--- |
| **U.S. Dept. of Education College Scorecard** | Official Federal API | REST API (`/v1/schools`) | Acceptance rates, SAT/ACT ranges, median earnings, net price by income tier, 6-year graduation rates by Pell Grant status. |
| **IPEDS Data Center** | Public Federal Database | Bulk CSV / API Queries | Detailed enrollment demographics (race/ethnicity, sex, age), historical completion trends, institutional finances, faculty ratios. |
| **Common Data Set (CDS)** | Structured PDF/CSV Repo | Community Scraping / Parsing | Section B (Demographics/Pell), Section C (Admissions, test score distributions, waitlist stats, relative importance of factors like essays vs. GPA). |

---

## Primary Feature Sets

### 1. Interactive Explorer & Filtering
* **Multi-Parameter Search:** Filter colleges by target acceptance rate, middle-50% test score ranges (SAT/ACT), geographic region, undergrad enrollment size, and major offerings.
* **Side-by-Side Comparison Matrix:** Compare up to 4 universities simultaneously across admissions rigor, socioeconomic diversity (Pell Grant %), and post-graduation ROI.

### 2. Admissions Insights Engine
* **Middle-50% Range Visualizer:** Interactive box plots showing 25th, 50th, and 75th percentile SAT/ACT scores.
* **Test-Optional Nuance Indicator:** Visual flags highlighting test submission percentages to help users evaluate how representative reported test score ranges actually are.
* **Admissions Factor Hierarchy:** Charting Section C7 of the CDS to show which qualitative elements (Essays, Extracurriculars, Recommendations, GPA, Standardized Tests) a university considers "Very Important," "Important," "Considered," or "Not Considered."

### 3. Socioeconomic & Demographic Dashboards
* **Pell Grant vs. Graduation Rate Scatter:** Plotting low-income student representation against 6-year graduation outcomes.
* **Demographic Breakdown Charts:** Visual representation of race, ethnicity, gender, and in-state vs. out-of-state composition over multi-year trends.

---

## Technical Stack Recommendation

### Frontend & Data Visualization
* **Framework:** Next.js (React) or SvelteKit (for fast page loading and SEO-friendly static rendering).
* **Visualization Libraries:** 
  * `Recharts` or `Visx` for responsive bar charts, scatterplots, and middle-50% range bars.
  * `D3.js` for custom map-based geographical exploration.
* **Styling:** Tailwind CSS + `shadcn/ui` for high-accessibility design components.

### Backend & Data Pipeline
* **Data Processing Pipeline:** Python (`pandas`, `PyPDF2` / `pdfplumber` for harvesting CDS PDFs).
* **Database:** PostgreSQL or Supabase (for caching processed IPEDS and CDS records) or DuckDB / Parquet files for serverless analytical queries.
* **API Wrapper:** Node.js/Python microservice to query and normalize the College Scorecard API.

---

## Suggested Data Schema Example (JSON)

Below is an example JSON schema representing a unified institution record extracted from Scorecard and CDS sources:

```json
{
  "unit_id": "166027",
  "name": "Harvard University",
  "location": {
    "city": "Cambridge",
    "state": "MA",
    "zip": "02138"
  },
  "admissions": {
    "year": 2024,
    "applicants": 56937,
    "admitted": 1942,
    "acceptance_rate": 0.0341,
    "sat_reading_25_75": [740, 780],
    "sat_math_25_75": [760, 800],
    "act_composite_25_75": [34, 36],
    "test_submission_rate_sat": 0.52,
    "test_submission_rate_act": 0.28
  },
  "demographics": {
    "undergrad_enrollment": 7240,
    "pell_grant_percent": 0.19,
    "first_gen_percent": 0.16,
    "racial_diversity": {
      "asian": 0.27,
      "black": 0.14,
      "hispanic": 0.11,
      "white": 0.37,
      "two_or_more": 0.05,
      "international": 0.06
    }
  }
}
```

---

## Implementation Roadmap

### Phase 1: MVP (Minimum Viable Product)
- [ ] Connect to the **College Scorecard API** to populate base school data (1,000+ colleges).
- [ ] Implement search, basic filtering (Acceptance Rate, SAT/ACT, Region), and single-school profile cards.
- [ ] Build basic UI components for displaying middle-50% test score ranges.

### Phase 2: CDS & Demographic Deep Dive
- [ ] Ingest CDS Section B (Enrollment & Pell) and Section C (Admissions factors & Test details).
- [ ] Add side-by-side comparison tables and interactive scatter plots (e.g., Pell % vs. Graduation Rate).
- [ ] Build visual warnings regarding test-optional submission ratios.

### Phase 3: Historical Trends & Community Features
- [ ] Integrate 5-year historical trendlines (changes in acceptance rates, median debt, test scores over time).
- [ ] Add PDF report generation for counseling offices and students.
- [ ] Open-source data conversion scripts for community contributions.

---

## Immediate Next Steps
1. Request a free API Key from the **[U.S. Department of Education Developer Portal](https://api.data.gov/signup/)**.
2. Prototype core scatterplot and boxplot visualizations using sample JSON datasets.
3. Establish data normalization rules for handling missing or test-optional values.