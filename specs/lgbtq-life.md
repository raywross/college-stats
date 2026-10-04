# LGBTQ+ Life

> Status: **planned**, with **phase 1 built** (2026-10-03, branch `feature/campus-life-lgbtq`): the IPEDS another-gender counts for every
> college and the first state-law line (Texas SB 17), shown in an "LGBTQ+ life" block in the students page's Campus life
> section and beside the men/women shares ([As built](#as-built-phase-1)). Phases 2 (other states) through 5
> (policies, centers, conduct codes, pilot, rollout) are still planned, so the spec stays on the roadmap. Research 2026-09-29: IPEDS 2023 data files and dictionaries (every figure below
> about IPEDS was computed from them), Common Data Set templates, the national directories named here, and a
> per-school look at UT Austin with contrasting colleges. Findings are verified unless marked *unverified*.
> Companions: [religious-life.md](religious-life.md) (its source tiers, crawl strategy, and access rules apply here
> too) and [greek-life.md](greek-life.md). Per-school collection shares the engine in
> [college-reported-data.md](college-reported-data.md#campus-life-sources).

## Goal
Answer, with cited and dated sources: *What will life be like here for an LGBTQ+ student? Is there an LGBTQ+ center
or staff? Which student groups? Can I live in gender-inclusive housing and use my name on college records? Does
the nondiscrimination policy cover sexual orientation and gender identity? Does the student conduct policy restrict
same-sex relationships or gender expression? Do state laws limit what a public college can offer?* For example:
"UCLA reports 576 undergraduates of another gender (fall 2023), has an LGBTQ Campus Resource Center, and offers
gender-inclusive housing."

The site describes; it doesn't grade. There is no "LGBTQ-friendly" score, star rating, or rank: each fact stands on
its own with its source, the way the rest of the site avoids letter grades ([design-research.md](design-research.md#deliberately-not-adopted)).

## The core problem
- **No source counts LGBTQ+ students.** No federal survey asks students their sexual orientation, and colleges
  rarely publish it. Gender identity is only partly counted: since 2022–23, IPEDS and the Common Data Set have an
  optional "another gender" count, which most colleges leave blank (below).
- **The best-known rating is gone.** The Campus Pride Index (1–5 stars from a 50+ question self-assessment, with a fee
  to participate since 2019) was the standard reference. Campus Pride's founder and only full-time employee was
  terminated after admitting he misused more than $100,000 in 2023. The Index site now returns an empty page (checked
  2026-09-29), and campuspride.org blocks scripts. It was a college self-assessment even when current, so it was
  never a neutral source. Its trans-policy lists survive, kept independently by the scholar who compiled them
  ([Trans Policy Clearinghouse](#source-tiers)).
- **Support changes quickly, and not only upward.** State laws have closed identity-based centers at public colleges:
  UT Austin's Gender and Sexuality Center closed in 2024 under Texas SB 17. The national directory of campus centers
  is mid-update through a "Center Closures Project" (August 2025). Every fact needs an "as of" date, and old facts
  must expire.
- **Restrictions matter as much as supports.** Some religious colleges' conduct codes prohibit same-sex relationships
  or restrict gender expression. LGBTQ+ students need to know this before applying. It must be shown exactly as the
  college states it, in its own words, never inferred from a religious affiliation.

## Case study: UT Austin and contrasts (probed 2026-09-29)

| Source | What it says | Format / access | Use |
|---|---|---|---|
| IPEDS Fall Enrollment 2023 (`EF2023A`, undergrad row) | UT Austin: "another gender" **blank** (not reported), 21 of 42,444 undergrads "gender unknown" | Bulk CSV from NCES, like the admissions files the sync already reads | Blank = not collected; say so, never show 0 |
| IPEDS contrasts, same file | UCLA **576** of 33,040 (1.7%); Columbia **84** of 9,111 (0.9%); Harvard **0** of 9,095; Howard 0; Stanford, BYU, Vanderbilt, Smith blank | Same | A 0 can mean "we don't record it," not "no one" (Harvard) |
| IPEDS Admissions 2023 (`ADM2023`) | Columbia: 1,189 applicants, 55 admitted, 31 enrolled of another gender. The other nine sample colleges: blank | Bulk CSV | Rarely reported; applicant counts only where present |
| Common Data Set B1 (2022–23 on) | An "Another Gender" column beside Men/Women (seen in Emory, Harvey Mudd, SMU, Cornell 2022–23 files; UC San Diego labels it "Data Unavailable/Gender Nonbinary"). **The 2025–26 template dropped it:** its third column is "Unknown", and colleges are told to spread non-binary students across men and women (2026-10-03 inventory of 19 files), so only older editions carry this count | PDF/Excel per college | Older editions only; the agent stores B1 in full ([cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md)) |
| UT's Gender and Sexuality Center | Became the Women's Community Center in January 2024 (no LGBTQ+ programming), then closed in April 2024 under SB 17 | News coverage + state statute | A center that existed can vanish; state law is the reason |
| Trans Policy Clearinghouse, gender-inclusive housing list | UT Austin **is listed** (no start year given) | HTML list of college names, no links; "Last updated 9/21/26" | Discovery: tells the agent which policy page to find and verify |
| Consortium of Higher Education LGBT Resource Professionals, campus center map | Google map of centers and staff (≥50% FTE); "updating … in progress … information might not be accurate" | Interactive map; count and fields *unverified* | Presence of a center or staff, after verification |

**Lessons:** (1) the only official counts are sparse, and blank, 0, and a real number each mean something different;
(2) the richest facts are policies, found on each college's own pages; (3) a directory listing is a lead to verify,
not a fact to publish, because directories lag closures.

## What "another gender" counts, and what it doesn't
IPEDS added the item to Fall Enrollment, 12-month Enrollment, Admissions, and Completions (it was removed from
Graduation Rates for privacy). A college first says whether it collects another gender at all; if not, the cells
stay blank. Variables: `EFGNDRAN` (fall), `EFYGUAN` (12-month), `APPLCNAN` / `ADMSSNAN` / `ENRLAN` (admissions).
"Gender unknown" (`EFGNDRUN`) is a separate count of students whose gender the college doesn't know.

Across our 1,893 colleges, fall 2023 undergrads: **206** report at least one student of another gender, **252**
report 0, and **1,435 (76%) leave it blank.** Among the 206, the median share is about 1%, and a few art and
liberal-arts colleges are far higher (Hampshire 25%, Reed 22%).

**Fall 2024 (EF2024A, what the site shows; checked 2026-10-03):** 229 colleges report a count (all ≥ 5), 219 report 0,
**327 withheld** (flag "S", below), 1,117 don't collect it, and 1 isn't in the file. First-time applicants (ADM2024):
345 colleges report a number. The fall 2023 figures above still check out against EF2023A: 206 / 252 / 1,430 blank
(1,162 not collected + 268 withheld) + 5 not in the file = the 1,435 above.

**NCES stopped collecting it.** From the 2025–26 surveys, "pursuant to Executive Order (dated January 20, 2025) … non-binary
sex (i.e., Another Gender) will no longer be collected" (IPEDS 2025–26 changes page), in Fall Enrollment, Admissions,
and every other survey. Fall 2024 is the last year. The sync reads the newest file that still has the columns and, once
EF2025A/ADM2025 arrive without them, cites the older file and its fall in each value's lineage record.

It counts students whose records hold a gender other than man or woman (nonbinary, for example). It does **not**
count transgender students overall (a trans woman is counted as a woman), and it says nothing about sexual
orientation. The site's existing gender balance ([student-body.md](data-expansion/student-body.md)) always adds to
100% men and women, because IPEDS has colleges assign unknown and another-gender students to one of the two for its
main tables; the another-gender count belongs next to that figure, with a note saying so. Display rules:
- **Blank** → "Not collected by this college." **0** → "0 reported. The college may not record other genders." Never
  treat either as a finding about students. **Withheld** (blank with flag "S", since fall 2023) → "Not reported: the
  college records other genders but leaves these counts blank when any is under 5, for privacy."
- Show a count and share only above a small-number threshold (proposal: 10 students) so a small college's figure
  can't point at individuals; below it, "fewer than 10."
- **Never ranked, averaged, or turned into a filter or "Known for" chip.** Colleges collect it so differently that a
  higher number mostly means better record-keeping.

## Source tiers
The tiers from [religious-life.md](religious-life.md#source-tiers) apply, with policy pages and state law added to
tier A. Only verified tier A facts appear as plain statements; everything else is labeled by who says so.

| Tier | Kind | Examples | Shown as |
|---|---|---|---|
| **A: official statistic** | Federal data, CDS | IPEDS another gender; CDS B1 | Cited value under the rules above |
| **A: official policy** | The college's own current policy page or handbook, checked on a date | Nondiscrimination statement, housing policy, name and pronoun policy, student health plan, conduct code | "Offers gender-inclusive housing (college housing page, checked 2027-01)" with a link; conduct restrictions quoted |
| **A: state law** | A state statute that applies to public colleges | Texas SB 17 (2023, effective 2024) | One context line on public colleges in that state, citing the statute |
| **B: official directory** | The college's LGBTQ+ center page, registered student-org list | Center or office page; Engage "Pride" and "QTPOC" groups | Presence, names, links, group counts |
| **C: survey or estimate by others** | Class surveys run by a student newspaper; an advocacy group's claim | A campus paper's senior survey (*unverified* which publish sexual orientation) | Named and dated, never ranked; research before adopting |
| **D: national directory** | A national list of campuses | Trans Policy Clearinghouse lists; Consortium center map; oSTEM chapters (*unverified*: "over 100" chapters); LGBTQ+ Greek chapters: Delta Lambda Phi, Gamma Rho Lambda (*unverified*, see [greek-life.md](greek-life.md)) | A lead for the agent to verify; after verification, the fact moves to tier A or B |

**Trans Policy Clearinghouse** (Dr. Genny Beemyn, gennyb.com; formerly hosted by Campus Pride, kept independently
since 2023): seven lists of colleges: nondiscrimination policies covering gender identity, student health insurance
covering transition-related care, gender-inclusive restrooms listed online, gender-inclusive housing (**488**
colleges, some with the year it began; last updated 2026-09-21), name and pronoun changes on campus records,
trans-inclusive athletic policies, and trans admission policies at historically women's and men's colleges. The
lists give names only, so each entry needs a matching step and a check of the college's own page before it's shown.

## Measures
1. **Gender identity counts** (tier A, all colleges): IPEDS fall undergrads of another gender and gender unknown,
   applicants/admitted/enrolled where reported; CDS B1 where newer. History from 2022 on only (the item is new), so
   no trend indicator.
2. **Inclusive policies** (tier A official policy), one yes / no / not found per college, each with URL and date
   checked: nondiscrimination covers sexual orientation; covers gender identity or expression; gender-inclusive
   housing; name and pronouns on campus records; gender-inclusive restrooms (a campus map or list); student health
   plan covers transition-related care; trans admission policy (historically women's and men's colleges).
3. **Conduct restrictions** (tier A official policy): whether the college's current student conduct code or
   community covenant restricts same-sex relationships, gender expression, or transition, quoted with a link and
   date. **Human review before publishing** (below).
4. **Support on campus** (tiers B and D): an LGBTQ+ center or staffed office (Consortium criteria: at least half a
   full-time position), named student groups and how many, oSTEM chapter, LGBTQ+ Greek chapters, and dedicated
   counseling groups where the counseling center lists them.
5. **State context** (tier A state law, public colleges only): laws that close or restrict identity-based offices or
   programs, with statute, effective date, and a one-line neutral summary. Texas SB 17 is verified; at least eight
   other states (Alabama, Florida, Idaho, Iowa, North Dakota, South Dakota, Tennessee, Utah) have been reported to
   restrict DEI at public colleges (*unverified*: each must be read in the statute for what it covers).

## Sensitive facts: rules
- **Quote, don't characterize.** A conduct restriction appears as the college's own sentence (short quote, link,
  date), under a neutral heading ("What the student conduct policy says"). No labels like "unsafe" or "hostile."
- **Only from the college's current document.** Never inferred from religious affiliation, CCCU membership, a Title
  IX exemption, or an advocacy list. Those are leads for where to look, not evidence.
- **Human review.** Every conduct-restriction finding and every "No" on a policy gets a person's check before it's
  published; the agent's extraction alone isn't enough. Findings name the document and its date.
- **Expiry.** Policies and centers are re-checked yearly. A fact older than 2 years is hidden until re-verified, and
  a closed center stays in history ("closed April 2024") rather than silently disappearing.
- **Aggregate only.** No data about individual students or staff beyond what the college publishes, and the
  small-number threshold for counts.
- **Colleges can respond.** A correction link on each fact; corrections are verified against the college's pages.

## Scaling
Same approach as religious life ([religious-life.md](religious-life.md#scaling-turn-the-crawl-around)):
- **National lists, one adapter each:** the seven Clearinghouse lists (name → `unit_id` matching, as in
  `data/directories/`), the Consortium map (ask for an export; its format is *unverified*), oSTEM and LGBTQ+ Greek
  chapter lists. That gives leads for every college in ~10 crawls.
- **Per college, 4–6 pages found once and saved:** the LGBTQ+ center or office page, the nondiscrimination statement,
  the housing policy, the records/name policy, the student health plan summary, and (at religious colleges) the
  conduct code. The discovery pass in [college-reported-data.md](college-reported-data.md) records their URLs; later
  runs re-fetch only changed pages.
- **Extraction:** a cheap model reads each page against a fixed yes/no schema with the supporting quote; conduct codes
  and every "No" go to the review queue.
- **State laws:** a hand-kept table (`data/state-laws.json`), reviewed after each legislative session.

## Access rules
The rules in [religious-life.md](religious-life.md#access-rules-apply-to-both-specs) apply: obey `robots.txt` and
crawl delays, never get around bot protection, store facts and short quotes rather than copies, and link back.
**Ask first** where one party covers many campuses: Dr. Beemyn (Clearinghouse lists), the Consortium (center map),
oSTEM.

## Data model (sketch)
```ts
school.lgbtq = {
  gender: { another: number | null; unknown: number | null; collected: boolean; year: number } | null, // tier A (IPEDS/CDS)
  policies: {                                                       // tier A, per item
    key: "nondiscrimination_orientation" | "nondiscrimination_identity" | "inclusive_housing" | "name_on_records"
       | "inclusive_restrooms" | "health_plan_transition" | "trans_admission";
    value: "yes" | "no" | "not_found"; url: string | null; quote: string | null; checked: string; reviewed: boolean;
  }[],
  conduct: { restricts: boolean; quote: string; url: string; document: string; checked: string; reviewed: true } | null,
  center: { name: string; url: string; status: "open" | "closed"; since?: string; closed?: string; checked: string } | null,
  groups: { name: string; url: string | null; source: SourceRef }[], // tiers B/D
  state_law: { state: string; statute: string; effective: string; summary: string } | null, // public colleges only
}
```
Each field is registered in `lib/fields.ts` ([data-lineage.md](data-lineage.md)); policy and directory sources get
source kinds that show the page and the date checked.

## Where it appears
- **Profile, the students page's "Campus life" section, "LGBTQ+ life" block** (built: the gender counts and the
  state-law line; the rest is planned): support on campus (center, groups), the policy checklist
  (each item linked and dated), the gender counts with their caveat, the state-law line for public colleges, and,
  where present, "What the student conduct policy says." Hidden when there's nothing verified.
- **Explore filters (policy facts only):** "Has an LGBTQ+ center," "Gender-inclusive housing," "Nondiscrimination
  covers gender identity," and "Conduct code restricts same-sex relationships" (to exclude). No filter on counts.
- **Beside the men/women shares** ("Who they are", built): the another-gender count under the same rules, with the
  100% note.
- **Compare:** the checklist rows side by side, each cell dated (planned; the counts never get a row).
- **Glossary:** another gender, gender-inclusive housing, chosen name policy, nondiscrimination policy, LGBTQ+
  resource center, Title IX religious exemption, "as of" dates on policies.

## Phases
1. **Built 2026-10-03.** **IPEDS counts** for all colleges, with the display rules and glossary terms. Adds one file to the sync (fall
   enrollment `EF{Y}A`, undergrad rows; ~3 MB zipped); the admissions file (`ADM{Y}`) is already downloaded. Cheap;
   ship first.
2. **State-law table** for public colleges (Texas first, then each reported state after reading its statute). Texas
   built 2026-10-03; the other states are planned.
3. **Clearinghouse and directory leads** matched to `unit_id`s, plus permission requests (Beemyn, Consortium, oSTEM).
4. **Pilot of 25 colleges:** UT Austin, UCLA, Columbia, Harvard, BYU, a CCCU college, a Catholic college, an HBCU, a
   historically women's college (Smith), Reed, a large public in Florida, a large public in a state without such
   laws, and a mix of sizes. Measure: share of Clearinghouse entries still true, extraction accuracy against a
   hand-checked answer key, review time for conduct codes, cost. Decide which items are worth scaling.
5. **Rollout** of what the pilot supports, with the yearly re-check.

## Open questions
1. ~~Small-number threshold for counts: 10, or IPEDS's own practice?~~ **Answered 2026-10-03.** NCES has the colleges
   suppress at the source: from the 2023–24 Fall Enrollment form on, a college that collects another gender but would
   have "a value of less than 5 students" in any cell answers "No, some cells will have a value of less than 5
   students" and leaves every another-gender cell blank (form instructions, 2023–24 survey package). The data files
   flag those blanks "S" (not listed in the dictionary's imputation codes, but 657 EF2023A rows carry it, and no count
   of 1–4 appears in EF2023A, EF2024A, ADM2023, or ADM2024; EF2022A, before the rule, has 150 undergraduate counts of 1–4). So
   published counts are 0 or ≥ 5. We keep our own threshold of 10 on top ("fewer than 10" for 5–9), as proposed, and
   apply it to gender unknown and the applicant counts too.
2. Title IX religious exemptions: ED's Office for Civil Rights has published exemption request and response letters
   since 2016, but since 2020 a college can claim the exemption without asking first, so the list is incomplete
   (*unverified*: page blocks scripts; confirm by hand). Recommendation, as in religious life: don't show it; use it
   only to find which conduct codes to read.
3. Athletics: varsity eligibility is set nationally (NCAA), so per-college athletic policy covers intramurals and
   club sports only. Keep or drop the item after the pilot.
4. Sexual orientation counts: are there colleges that publish them officially (climate surveys)? Research in the pilot;
   adopt only college-published figures, as tier A, with the survey's response rate.
5. Wording review: have LGBTQ+ student-affairs professionals (the Consortium) review labels and glossary text before
   launch.

## As built (phase 1)
- **Data:** `school.lgbtq = { gender, admissions, state_law }` (`lib/types.ts` `LgbtqLife`; null when none applies).
  `gender = { status: "reported" | "withheld" | "not_collected", another, unknown, undergrads }` from EF{Y}A level 2
  (all undergraduates) `EFGNDRAN`/`XEFGNDRAN`/`EFGNDRUN`/`EFTOTLT`, read in the same pivot as the transfer-in totals.
  `admissions = { status, applicants, admitted, enrolled }` from ADM{Y} `APPLCNAN`/`ADMSSNAN`/`ENRLAN`, the applicants
  cell's flag deciding the status. The spec's `collected: boolean` became `status` because withheld is a third state;
  the year comes from lineage (field vintage, or a lineage record once the newest file lacks the columns), not a
  stored `year`. Readers and display rules: `lib/lgbtq.ts`; sync step: `scripts/lib/lgbtq-sync.mts`.
- **Fields:** `lgbtq.gender` (`ipeds-ef-a`), `lgbtq.admissions` (`ipeds-adm`), `lgbtq.state_law` (new source
  `state-law`, a per-document source: each value's lineage record carries the statute URL and "In effect since …").
- **State laws:** `data/state-laws.json`, hand-kept, validated by the sync (`validateStateLaws`: two-letter state, one
  law per state, public only, statute, act, effective and checked dates, https link, summary ≤ 240 characters). Texas
  only: Texas Education Code §51.3525, added by Acts 2023, 88th Leg., R.S., Ch. 922 (S.B. 17), Sec. 1, eff. January 1,
  2024 (read 2026-10-03 in the enrolled bill, capitol.texas.gov SB00017F, and the current code text, which is
  unamended). Summary: "Texas public colleges may not have diversity, equity, and inclusion offices, including offices
  for programs designed around gender identity or sexual orientation; courses, research, and registered student groups
  are exempt." Applied to the 42 public Texas colleges on the site.
- **Profile:** "LGBTQ+ life" block (`components/school/LgbtqLife.tsx`) in Campus life: the undergraduate count (count
  and share at 10+, "fewer than 10", or the blank/0/withheld sentence), gender unknown, first-year applicants of
  another gender (shown only when reported or withheld; "not collected" is already said once), the caveat, and the
  state-law line with the statute link. Beside the men/women shares in "Who they are": "Another gender: …" plus the
  note that men and women add up to 100% because federal data assigns another or unknown gender to one of the two.
  Campus life now shows (and its nav link) whenever this block has something.
- **Never ranked, averaged, filtered, compared, or "Known for":** no metric, filter, Compare row, or chip;
  `tests/lgbtq.test.mts` fails if the metrics, params, indicators, dataset, compare, insights, Explore, Compare, or
  Home code mentions these fields (checked by breaking it on purpose).
- **Glossary:** another gender, gender unknown, state law on public colleges. The other terms in "Where it appears"
  wait for the phases that show them.

## Rejected
Campus Pride Index and its "Worst List" (offline, pay-to-participate self-assessment, not updated since 2023);
Princeton Review and Niche LGBTQ+ rankings (proprietary, survey-based); composite "friendliness" scores of our own
(against the site's no-grades rule); the Religious Exemption Accountability Project's list as displayed data
(advocacy; used only as a lead); HERI and NSSE survey items (per-college results aren't public).

## Sources
- IPEDS data files and dictionaries, `EF2023A`, `ADM2023`, `EFFY2023` (variables `EFGNDRAN`, `EFGNDRUN`,
  `APPLCNAN`, `ADMSSNAN`, `ENRLAN`, `EFYGUAN`): https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx; survey changes:
  https://nces.ed.gov/IPEDS/report-your-data/archived-changes/2024-25
- Common Data Set 2022–23 template (B1 "Another Gender"): https://commondataset.org/
- Trans Policy Clearinghouse: https://www.gennyb.com/research/trans-supportive-campus-policies/ (housing list:
  …/colleges-and-universities-that-provide-gender-inclusive-housing)
- Consortium of Higher Education LGBT Resource Professionals, campus center map:
  https://www.lgbtcampus.org/find-an-lgbtq-campus-center
- Campus Pride: https://www.insidehighered.com/news/diversity/sex-gender/2024/01/10/campus-pride-terminates-founder-alleged-fraud;
  Index FAQ (8 factors): https://www.campusprideindex.org/faqs/index
- UT Austin center closure: https://thedailytexan.com/2024/01/15/gender-and-sexuality-center-closes-replaced-by-womens-community-center/,
  https://www.kut.org/education/2024-04-02/ut-austin-dei-diversity-law-sb-17; states with DEI laws:
  https://abcnews.com/US/dei-fallout-texas-university/story?id=114470961
- Title IX exemptions: https://www.ed.gov/laws-and-policy/civil-rights-laws/title-ix-and-sex-discrimination/title-ix-key-issues/title-ix-exemptions;
  CRS report R47613: https://www.congress.gov/crs-product/R47613
- oSTEM chapters: https://www.ostem.org/chapters; REAP: https://www.thereap.org/
