# Data Ingestion & Product Spec: Public High School Intelligence Pipeline

## 1. Objective
Build an automated ingestion, extraction, and standardization engine that aggregates public high school metrics (GPA distributions, AP/IB course rigor, college matriculation lists, and district-level outcome data) to create an enriched **High School Profile Feed**. This feed will power Quad’s localized scattergrams, feeder school analytics, and counselor workflows.

---

## 2. Public Data Sources & Ingestion Methods

| Data Source | Content Available | File Format / Structure | Access / Extraction Method | Refresh Frequency |
| :--- | :--- | :--- | :--- | :--- |
| **High School Profile PDFs** | GPA distribution deciles, AP/IB courses, SAT/ACT score ranges, top college destinations | Unstructured PDFs (hosted on school/district websites) | Automated web crawler + LLM/Document-parsing pipeline (e.g., Unstructured.io / Claude Vision API) | Annual (Sept – Nov) |
| **State Education Dept. Portals** *(e.g., NYSED, TEA, CDE)* | District graduation rates, AP test pass rates, demographic breakdowns, state test proficiency | CSV, XLSX, public API, or structured HTML report cards | Public API endpoints, automated bulk CSV downloads, or web scrapers | Annual |
| **National Center for Education Statistics (NCES / CCD)** | Unique school IDs (NCES ID), public vs. charter status, total enrollment, student-teacher ratios, Title I status | Structured CSV datasets & REST APIs | Direct API integration (`NCES CCD API`) | Annual |
| **National Student Clearinghouse (NSC) District Reports** | 2-year vs. 4-year college enrollment %, in-state vs. out-of-state %, top 10–20 matriculation institutions | Public PDF presentations from district school board filings | Scraped from public school board meeting minutes & PDF repositories | Bi-Annual |
| **User & Counselor Contributed Data (Naviance / Scoir Exports)** | Anonymized historical scattergram points (GPA, SAT, Acceptance outcomes per college) | Anonymized CSV exports uploaded by verified users/counselors | Self-serve upload portal with client-side PII scrubbing | Continuous / On-demand |

---

## 3. Data Extraction & Pipeline Architecture

```
[ Public Web / APIs / PDF Repos ] 
              │
              ▼
    ┌──────────────────┐
    │  Ingestion Engine │  ---> Crawls district websites, NCES APIs & PDF profiles
    └─────────┬────────┘
              │
              ▼
    ┌──────────────────┐
    │ Document Parser  │  ---> OCR & LLM extraction for unstructured School Profile PDFs
    └─────────┬────────┘
              │
              ▼
    ┌──────────────────┐
    │ Schema Normalizer│  ---> Converts weighted GPAs to 4.0 scale & maps NCES IDs
    └─────────┬────────┘
              │
              ▼
    ┌──────────────────┐
    │ High School DB   │  ---> Powers Quad Local Scattergrams & Counselor Dashboards
    └──────────────────┘
```

### Extraction Pipeline Steps

1. **NCES Mapping & Entity Resolution:** Every high school is assigned a canonical `nces_school_id` as the primary key to unify state-level and PDF-extracted metrics.
2. **PDF Parser Logic:**
   * Extract GPA distribution tables (normalize deciles/percentiles into standard `[3.75-4.0], [3.5-3.74], [3.25-3.49]` buckets).
   * Extract text lists of college matriculations using Named Entity Recognition (NER) mapped to official IPEDS `unit_id`s.
3. **Data Normalization Rules:**
   * **GPA Weighting:** Convert custom high school grading scales (e.g., 5.0, 6.0, 100-point numeric scales) into standardized 4.0 unweighted equivalents where applicable.
   * **PII Scrubbing:** Strip all individual student names, IDs, or timestamps from crowd-sourced scattergrams before storage.

---

## 4. Potential Product Use Cases for Quad

### Use Case A: Localized High School Scattergrams ("My School vs. Target College")
* **Concept:** Instead of showing national SAT/GPA averages, Quad overlays a student's stats against historical applicants **from their specific high school or school district**.
* **Value Proposition:** Answers the key question: *"Do kids from my high school actually get into Michigan with a 3.8 GPA?"*

### Use Case B: "Feeder School" & Yield Advantage Analytics
* **Concept:** Identify which colleges have strong historical feeder relationships with specific high schools or regions.
* **Value Proposition:** Shows students if a college routinely accepts multiple graduates from their high school each year, signaling established recruitment pathways.

### Use Case C: High School Rigor Contextualizer for Parents
* **Concept:** Compare a high school’s academic environment against state and national benchmarks (e.g., number of AP courses offered, AP exam pass rate %, percentage of class attending 4-year universities).
* **Value Proposition:** Helps families understand how admissions officers view their high school's course rigor and grading standards.

### Use Case D: "Quad for Counselors" B2B Portal
* **Concept:** Allow Independent Educational Consultants (IECs) and high school counseling departments to manage multi-student lists and generate custom co-branded PDF reports using local matriculation data.
* **Value Proposition:** Drives high-margin B2B SaaS revenue ($299–$599/year) while establishing direct distribution into high schools.
