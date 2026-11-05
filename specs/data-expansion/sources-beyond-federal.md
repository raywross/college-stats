# Sources Beyond the Federal College Files: Safety, Place, Athletics, Earnings, Research, First Destinations

> Status: **planned** 2026-11-05, from the owner's question about niche.com ("what does it offer compared to us in
> terms of data, and are there additional sources we should bring in"). Wave 7 of [data-expansion](README.md). One
> page for six sources; each becomes its own spec, in this file's order, when it is built. Part of
> [data-expansion](README.md).

## Question it answers
*Is it safe? What is the place like? Does it have my sport, and is the program funded? What do graduates of this
program earn, and where do they work? Is it a research place? What happens in the six months after graduation?*
Six questions families ask that the site cannot answer today, each with a public source that can be cited with a
year, the way everything else on the site is.

## Where this came from: Niche compared with Quad (2026-11-05)
"nice.com" is NICE Ltd., a contact-center software company; the comparison is with **niche.com**, the college reviews
and rankings site. Niche refuses automated readers (its pages answer 403), so its side was read from its own pages as
search engines index them: the data page, the rankings methodology, the 2027 release note, the Safest Campuses
methodology, the help-center "Where does your data come from" articles, and a sample profile's admissions,
campus-life, and careers pages.

**What Niche is.** A free site over 4,000+ colleges (and K-12 schools, graduate programs, neighborhoods), paid by
colleges: enrollment-marketing partnerships, "Direct Admissions" (partner colleges admit Niche users from their Niche
profile), sponsored placement, and a scholarship marketplace that collects student profiles. It presents letter
grades (A+ to D-) per theme, an overall grade, rankings, and poll lines ("59% of students say overall dorm quality is
great, based on 275 responses"). Years are rarely shown next to values.

**Its data, in its own words.** "Dozens of public data sources including the Department of Education, U.S. Census,
and FBI" (its college pages also cite the National Science Foundation and, per a 2023 Martin Center review, the
Center for Measuring University Performance for faculty awards), "data provided directly by verified representatives
of schools and colleges" through partner accounts (profiles, not rankings), and millions of student and alumni survey
responses collected on Niche itself. The 2027 cycle added an Institutional Success Score (colleges compared within ten
mission groups) and two pilot grades, Student Wellness (counseling access) and Future Readiness (career preparation,
internships, AI literacy), both from data colleges send Niche.

**Its other verticals, since the owner asked.** K-12: U.S. Department of Education graduation rates and state test
scores, the NCES Private School Universe Survey (private schools) and School Attendance Boundary Survey (school
boundaries), school-submitted data through partner accounts, and its parent, student, and alumni surveys; the Civil
Rights Data Collection is named only in third-party reporting about district rankings. Places to live: the Census
American Community Survey, FBI, CDC, and its surveys. Graduate schools: Niche publishes no graduate-school methodology
page that search engines index; its program pages carry IPEDS-derived figures (enrollment, degrees, tuition) and
survey-based grades, so the sources are the same federal files plus its surveys.

**Side by side, the data on a college page.**

| Theme | Niche | Quad | Verdict |
|---|---|---|---|
| Admissions | Acceptance rate, SAT/ACT ranges, deadline and fee, Common App flag, a sign-in-gated chances widget | Applicants, admits, yield with 20+ years of history; rates by sex and residency; ED/EA and wait list, GPA bands, the factor grid (CDS); test ranges, submission rates, next cycle's policy; deadlines; the admit rate for your class | Quad deeper on every figure |
| Cost and aid | Net price overall and by income, average aid, sticker, a cost calculator | Sticker by residency, net price by income with the aid curve, aided net price, grant and loan shares, merit share and methodology, forms, next year's price (CDS), debt by source, repayment | Quad deeper |
| Outcomes | Graduation rate, "employed 2 years after", median earnings at 6 years, loan default | 4/6/8-year graduation for every entering group, Pell gap, retention, transfers out, earnings at 6 and 10 years, earnings and debt by major, payback years | Quad deeper; the "employed 2 years after" share is Scorecard's working-not-enrolled field, cheap to add if absent |
| Students | Enrollment, race/ethnicity, gender, international and out-of-state shares, diversity polls | The same plus part-time, age, online share, home states, transfers in, Pell share, the CDS's newer figures | Even; Quad has years |
| Academics | Student-faculty ratio, popular majors, polls on professors and workload, a Professors grade (salary, awards, surveys) | Ratio, class sizes, faculty salary and full-time share, every degree field with growth, programs with earnings, honors, core requirements | Even on facts; Niche adds opinion and research signals |
| Campus and place | Grades and polls: Campus, Dorms, Campus Food, Party Scene, Student Life, Athletics (championships, revenue, surveys), Safety (campus crime, local crime, surveys), Location (Census and FBI area data, cost of living, weather) | Setting, Carnegie class, housing capacity and live-on rule, meal plan, division and conference, ROTC, study abroad, research, religious affiliation, the Greek, religious, and LGBTQ+ life directories, visit events, distance from home | **Niche's edge**: place and lived experience. Quad has nothing on crime, weather, walkability, local cost, dorm or food quality, nightlife, or student opinion |

**Bottom line.** On the numbers a family uses to decide whether a college is reachable and affordable, Quad already
has more than Niche, with provenance Niche lacks. Niche wins on *what it is like there* (student voice at scale, a moat
not worth copying with scraped opinion) and *where it is* (safety, cost of living, weather, walkability), which is
public data this spec brings in. The refusals hold: no grades, no composite, no leads.

## The six sources, in build order

### 1. Campus crime and fire: the Clery Act data
- **Source:** U.S. Department of Education, Office of Postsecondary Education, Campus Safety and Security data
  (`ope.ed.gov/campussafety`, the Data Analysis Cutting Tool's yearly data files). Free, no key, Excel/CSV, back to the
  2000s; each October release carries three calendar years. Rows are campuses: the IPEDS unit id with a branch suffix,
  the OPE id, and that campus's enrollment.
- **What:** criminal offenses (murder, manslaughter, rape, fondling, incest, statutory rape, robbery, aggravated
  assault, burglary, motor vehicle theft, arson), VAWA offenses (domestic violence, dating violence, stalking), arrests
  and disciplinary referrals (weapons, drugs, liquor), hate crimes by bias, residence-hall fires, and, from the October
  2026 reports, hazing ([greek-life.md](../greek-life.md) already notes it). Each count by location: on campus, on-campus
  student housing, noncampus, public property.
- **Shows:** a Safety block on the profile (counts and per-1,000-student rates for the latest year, the three-year
  average, the location split, the year), an Explore column and sort, and a plain note that counts are self-reported
  and that more reports can mean a better reporting culture. Never a grade.
- **Keep history?** Series: the yearly counts per category (the 2020 dip marked).
- **Cost:** Small to medium. One fetcher, branch aggregation (sum branches or show the main campus; medical-center
  campuses inflate "noncampus"), registry fields, the block, the column.

### 2. Place: climate, walkability, local rent
- **Sources:** NOAA 1991–2020 U.S. Climate Normals (monthly temperature, precipitation, snowfall; nearest station to the
  campus coordinates the site stores); the EPA National Walkability Index and Smart Location Database (block-group
  scores; Walk Score is licensed and skipped); HUD Fair Market Rents (by ZIP or metro, yearly) and the Census ACS
  five-year median gross rent for the county or place. All public domain.
- **Shows:** a Place section on the profile (the climate line with the station and its distance, the walkability
  band, an off-campus rent figure beside room and board) and three Explore filters (climate, walkability, rent). This
  is the factual half of Niche's Location and Local Area grades, and the lifestyle filters
  [ideas/README.md](../ideas/README.md) noted CollegeIQ has.
- **Local crime** waits: the FBI Crime Data Explorer is agency-level, the campus-to-agency match is error-prone, and
  coverage has gaps since the NIBRS transition. Start with source 1.
- **Keep history?** None (normals and indexes are editions; rent is a snapshot with its year).
- **Cost:** Small each; one spec for the section.

### 3. Athletics programs: Equity in Athletics (EADA)
- **Source:** `ope.ed.gov/athletics`, yearly files back to 2003, keyed by IPEDS unit id, free.
- **What:** participants by sport and sex, revenues and expenses by sport and in total, athletically related student
  aid by sex, head and assistant coaching headcounts and average salaries, recruiting spend.
- **Shows:** the athletics line (division and conference, built) becomes a section: the sports offered with roster
  sizes, athletic aid in total and per athlete, program spending; a "has my sport" filter; a recruiting angle for the
  planner's Connections step.
- **Keep history?** Series for total athletic aid and participants.
- **Cost:** Medium (a per-college detail table, [majors.md](majors.md)'s pattern).

### 4. Earnings and where graduates work: Census PSEO
- **Source:** Census Bureau Post-Secondary Employment Outcomes (`lehd.ces.census.gov/data/pseo`), CSV with a published
  schema (`y1_p25_earnings` … `y10_p75_earnings`, `y*_grads_earn`, `y*_ipeds_count`; institutions carry their IPEDS id
  in the state institution files). Earnings at 1, 5, and 10 years after graduation (25th, 50th, 75th percentiles, 2023
  dollars) by institution × degree level × field (2- and 4-digit CIP), plus Employment Flows (industry and state of
  work). Built from transcripts matched to jobs records, so it covers **all** graduates, not only the federally aided
  ones Scorecard's field-of-study data covers.
- **Coverage, the main caveat:** by state partnership. Over 1,100 institutions after the August 2026 additions; strong
  in Texas (77% of the state's graduates), Virginia (87%), Indiana, Maryland, Ohio, Minnesota, Montana; thin in
  Pennsylvania (16%) and Michigan (10%); **no California, Florida, or Washington partner**, and many private colleges
  absent. An "available for this college" layer shown beside the Scorecard figure with both years, never a replacement.
- **Shows:** on the outcomes section and Compare's "your major": the three percentiles at 1, 5, and 10 years for the
  field, and the top industries and states graduates work in.
- **Keep history?** None (each release re-tabulates).
- **Cost:** Medium: a source key, a detail table (field × horizon), suppression flags honored, careful labels ("all
  graduates, 2023 dollars" against Scorecard's "federally aided graduates").

### 5. Research standing: NSF HERD
- **Source:** the NSF Higher Education Research and Development survey (research expenditures by institution and
  field, yearly, public; a crosswalk to IPEDS ids exists).
- **Shows:** a "Known for" chip (top 5% in research spending per undergraduate) and an Explore filter for families who
  want undergraduate research; a line on the profile with the year.
- **Later:** the NSF Survey of Earned Doctorates' baccalaureate origins (which colleges' graduates go on to PhDs, by
  field), published in NCSES tables and harder to automate.
- **Cost:** Small.

### 6. First destinations: the colleges' own reports (a college-reported round)
- **Source:** each college's NACE-style first-destination report, six months after graduation: knowledge rate, share
  employed / in graduate school / seeking, median starting salary, top employers, often by major. The public
  counterpart of Niche's Future Readiness pilot, which relies on data colleges send Niche.
- **Why:** families ask what happens right after graduation, and Scorecard's earliest figure is six years out. The
  college-reported agent ([college-reported-data.md](../college-reported-data.md)) already reads college pages; this
  is the same motion with a new template.
- **Cost:** Medium to large: unstandardized PDFs, and the knowledge rate decides whether a figure is worth showing.
  First unit: a scoping pass on 20 colleges before committing.

## Not recommended
- **Student opinion at scale** (Niche's surveys, Reddit, Rate My Professors): scraping is against those sites' terms,
  and a Quad-run survey would start empty. If Quad ever carries opinion, it is the pooled, verified family reports
  discussed for award letters, not anonymous polls.
- **Letter grades and composite scores:** Niche's product; the site's standing rule is to show the ingredients.
- **College-supplied wellness and career data:** not public; the analogue is source 6 and, for counseling, the
  college-reported agent reading counseling-center pages later (staffing, wait times), which is costly to keep current.
- **Cohort default rates:** already left out ([README.md](README.md#considered-and-left-out)).
- **Scholarship marketplaces and Direct Admissions:** lead generation by another name.

## Shared rules
Every value registered in `lib/fields.ts` with a source key and a vintage, cited with the year; `null` for missing;
glossary entries for Clery, VAWA, fair market rent, PSEO; the per-college detail file for the tables (athletics,
PSEO); no number typed into a page. Build order as numbered; sources 1 and 2 first because they are small and answer
the two questions the site is silent on today.

## Open questions
1. Clery: show the main campus only, or sum every branch? (Branch campuses report separately; a medical center can be
   a "campus".) Recommendation: the main campus, with a note when branches exist.
2. PSEO: show it only where the state's coverage is above some share, or wherever the college appears? Recommendation:
   wherever the college appears, with the coverage share of its state in the citation.
3. First destinations: is a knowledge rate under 50% shown at all? Recommendation: no; name the rate when shown.

## Sources read
Niche: about/data, colleges/rankings/methodology, about/2027-best-colleges-rankings, about/methodology/safest-colleges,
about/how-niche-updates-data, the help-center data articles (K-12 Public, Places to Live), colleges/nichols-college
(admissions, campus-life, careers), via search-engine indexes; James G. Martin Center (2023) on Niche's sources. Census
LEHD: data/pseo_experimental.html (coverage by state), data/schema/latest (PSEOE variables). U.S. Department of Education
OPE: the campus safety and athletics data tools. Quad: this folder's README, [ideas/README.md](../ideas/README.md),
`data/meta.json` (23 sources), `lib/fields.ts`.
