# Quad Commercialization Strategy & Business Model

## Executive Summary
This document outlines the commercialization strategy for **Quad**, an open-data college decision engine. By combining free, high-tier macro data exploration with a low-friction subscription model and high-intent premium tools, Quad maximizes top-of-funnel conversion while building a sustainable revenue lifecycle tailored to the 12–18 month college application journey.

---

## 1. Product Tiering Architecture

```
[ Tier 1: Free ]  --->  [ Tier 2: Plus ($1.99/mo or $15.99/yr) ]  --->  [ Tier 3: Pro ($49–$99/yr) ]
  Unrestricted Search       High School Applicants                      Parents & IEC Counselors
```

### Tier 1: Quad Free
* **Target Audience:** Top-of-funnel visitors, high school underclassmen, and casual searchers.
* **Core Philosophy:** Preserve SEO organic discovery and maintain Quad’s open-data reputation.
* **Features Included:**
  * Unlimited macro college search & basic filtering (size, type, location).
  * High-level admissions & ROI scatter plots (Cost vs. 10-Year Earnings, SAT vs. Admit Rate).
  * Basic side-by-side school comparison (up to 3 schools).
  * Public IPEDS and College Scorecard metrics.

### Tier 2: Quad Plus ($1.99 / month OR $15.99 / year)
* **Target Audience:** High school juniors and seniors actively building lists and submitting applications.
* **Positioning:** Low-friction, "impulse-buy" subscription designed to fit a student's allowance or debit card limit.
* **Features Included:**
  * **Saved Lists & Organization:** Save up to 20 target schools with custom categorizations (*Reach / Target / Safety*).
  * **Expanded Comparison Engine:** Deep side-by-side comparison table (up to 10 schools simultaneously).
  * **Common Data Set (CDS) Intelligence:** Direct access to parsed Section C data (GPA distributions, SAT percentile breakdowns, ED/EA acceptance advantages).
  * **Granular Filters:** Filter by specific majors/CIP codes, academic program offerings, and class size dynamics.
  * **Ad-Free & Instant Export:** Clean workspace with quick CSV/PDF list exports.

### Tier 3: Quad Pro ($49 one-time OR $9.99 / month during decision season)
* **Target Audience:** Parents, family decision-makers, and Independent Educational Consultants (IECs) navigating senior-year financial choices.
* **Positioning:** High-value decision support for high-stakes financial planning.
* **Features Included:**
  * **Personalized Net Price & Merit Aid Predictor:** Models actual family out-of-pocket costs based on income, assets, and institutional aid rules.
  * **Financial Aid Award Letter Analyzer:** Side-by-side evaluation of real award letters, standardizing net price, loan debt burdens, and 10-year repayment projections.
  * **Major-Level ROI Deep Dives:** Program-specific earnings and debt data from College Scorecard.
  * **Counselor & Family Sharing:** Generate custom, co-branded PDF dossiers for family meetings or counseling sessions.

---

## 2. Pricing & Discount Strategy

### Option Selection: $1.99 / month vs. $15.99 / year

Quad adopts the **$1.99/mo or $15.99/yr** pricing structure over a $1.00/mo model for three strategic reasons:

1. **Payment Gateway Economics:** Fixed processing fees (e.g., Stripe $0.30 + 2.9%) severely erode $1.00 charges (taking ~33% of revenue). At $1.99, transaction overhead drops to ~18%, preserving **$1.58 net per transaction**.
2. **High-Converting Discount Framing:**
   * Annual Plan ($15.99/yr) breaks down to **$1.33 / month**.
   * Displayed as **"SAVE 33%"** or **"GET 4 MONTHS FREE!"**.
   * Strongly encourages upfront cash flow while locking in users for the full 12-month application cycle.
3. **Anchor Value:** $1.99/month remains an impulse purchase for students while making the $15.99 annual rate feel like an exceptional bargain.

---

## 3. UI/UX Pricing Page Layout

```
+-----------------------------------------------------------------------------------+
|                                                                                   |
|                           Choose the Plan for Your Journey                        |
|                                                                                   |
|                       [ Monthly ]   (o) [ Annual (Save 33%) ]                     |
|                                                                                   |
|    +-----------------------+   +---------------------------------------------+    |
|    |      QUAD PLUS        |   |                 QUAD PLUS                   |    |
|    |      (Monthly)        |   |                  (Annual)                   |    |
|    |                       |   |               * MOST POPULAR *              |    |
|    |    $1.99 / month      |   |             $1.33 / month                   |    |
|    |   Billed monthly      |   |             Billed as $15.99 / year          |    |
|    |                       |   |             Includes 4 months free!         |    |
|    |   [ Select Monthly ]  |   |             [ Start 12-Month Access ]       |    |
|    +-----------------------+   +---------------------------------------------+    |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## 4. B2B Expansion Opportunities

Beyond consumer B2C subscriptions, Quad can monetise via B2B channels:

* **Quad for Counselors / High Schools ($299–$599 / year):** Multi-student tracking dashboards, co-branded PDF export reports, and client list management tools for Independent Educational Consultants (IECs) and private school counseling departments.
* **Higher Ed Data API ($1,200+ / year):** Clean, aggregated API access for educational researchers, edtech startups, and journalists seeking standardized IPEDS and CDS datasets.

---

## 5. Integrating High School Data (e.g., Niche High School Rankings)

### How Niche Operates
* **Data Sources:** Niche combines Department of Education data (test scores, graduation rates, school demographics) with user-generated survey reviews and proprietary algorithms to assign A+ to F grades and rank high schools locally and nationally.
* **Commercial Model:** Niche monetizes heavily through **higher education lead generation** (colleges pay Niche to promote their institution to high schoolers browsing school profiles) and targeted display advertising.

### Strategic Fit for Quad
Integrating high school context (such as feeder school statistics, local high school performance, or Niche ranking indicators) creates a **high-value anchor for local high school counselors and parents**:

1. **High School Feeder & Scattergram Analysis (Quad Pro / Counselor Tier):**
   * High school families care less about national averages and more about **how students from *their specific high school* perform in college admissions**.
   * Quad can allow users to benchmark college acceptance rates against their local high school district or state performance tier.
2. **Local Context Integration without Lead-Gen Bias:**
   * Unlike Niche—which heavily promotes sponsored college links—Quad can maintain an **unbiased, ad-free environment** where high school data is paired purely with ROI, merit aid likelihood, and Common Data Set distributions.
3. **Counselor & IEC Partnership Vehicle:**
   * Offering high school profile integrations gives Independent Educational Consultants (IECs) and school counselors a reason to adopt **Quad for Counselors ($299–$599/yr)**, bridging the gap between high school counseling tools (like Naviance/Scoir) and higher-ed ROI planning.
