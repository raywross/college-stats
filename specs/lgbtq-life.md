# LGBTQ+ Life

> Status: **planned**, with **phases 1 through 3 built**. Phase 1 (2026-10-03, branch `feature/campus-life`): the IPEDS
> another-gender counts for every college and the first state-law line (Texas SB 17), shown in an "LGBTQ+ life" block in
> the students page's Campus life section and beside the men/women shares ([As built](#as-built-phase-1)). Phase 2
> (2026-10-04, branch `feature/campus-life-2-state-laws`): the state-law table covered six states, each read in the
> statute; the owner's review (2026-10-04, branch `feature/campus-life-3-state-laws`) added Ohio, Tennessee, and North
> Carolina, whose general DEI-office bans don't name LGBTQ+ programs, for nine ([Phase 2 as built](#phase-2-as-built-state-laws)). Phase 3 (2026-10-04, branch
> `feature/campus-life-2`): eight national-list adapters (seven at the Trans Policy Clearinghouse, one the
> Consortium's campus-center map), the policy checklist, and "Support on campus" on the profile, plus Explore filters
> and Compare rows for the policy facts only ([Phase 3 as built](#phase-3-as-built-national-lists-and-the-policy-checklist)).
> The phase 4 pilot (per-college policy pages, centers, conduct codes) is built and was run on the 25 pilot colleges
> ([Phase 4 as built](#phase-4-as-built-pilot)); phase 5 (rollout) is still planned, so the spec stays on the roadmap. Research 2026-09-29: IPEDS 2023 data files and dictionaries (every figure below
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

**Owner decision 4 (2026-10-04, shared with religious-life.md and greek-life.md):** lists compiled by others (the
Clearinghouse, the Consortium's center map, any national directory) publish with credit — the fact shows with the
organization's name, the date we read it, and a link to the list, as a labeled tier (B/C/D), never as a plain fact.
Phase 3 builds this for the Clearinghouse's lists (tier D, `kind: "policy"`) and the Consortium's map (tier D,
`kind: "center"`): `specs/campus-directories.md` lineage rules enforce the credit; `lib/lgbtq-policy.ts`'s checklist
shows each as "Listed by [organization] ([date read])," never "Yes."

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
   programs, with statute, effective date, and a one-line neutral summary. Built for nine states (Alabama, Florida,
   Idaho, Iowa, North Carolina, Ohio, Tennessee, Texas, Utah) after reading each statute; 18 other states checked and
   left out, each with its reason ([Phase 2 as built](#phase-2-as-built-state-laws)).

## Sensitive facts: rules
- **Quote, don't characterize.** A conduct restriction appears as the college's own sentence (short quote, link,
  date), under a neutral heading ("What the student conduct policy says"). No labels like "unsafe" or "hostile."
- **Only from the college's current document.** Never inferred from religious affiliation, CCCU membership, a Title
  IX exemption, or an advocacy list. Those are leads for where to look, not evidence.
- **Second check (was: human review).** Every conduct-restriction finding and every "No" on a policy is re-checked
  before it's published; the agent's extraction alone isn't enough. Findings name the document and its date.
  *Departure, owner decision 3 (2026-10-04):* the re-check is a second model (claude-sonnet-5) reading the stored
  quote against the page, not a person; only findings it confirms are published (`verified_by`), and disagreements
  are dropped and logged in the run report.
- **Expiry.** Policies and centers are re-checked yearly. A fact older than 2 years is hidden until re-verified, and
  a closed center stays in history ("closed April 2024") rather than silently disappearing.
- **Aggregate only.** No data about individual students or staff beyond what the college publishes, and the
  small-number threshold for counts.
- **Colleges can respond.** A correction link on each fact; corrections are verified against the college's pages.

## Scaling
> National lists use the shared infrastructure in [campus-directories.md](campus-directories.md): one adapter per
> list (kind `center`, `group`, or `policy` with its policy key), and `PolicyCheck` for tier A policy pages.

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
**Superseded 2026-10-04 (phase 3 as built):** this section originally said to ask Dr. Beemyn, the Consortium, and
oSTEM before reading their lists. Phase 3 instead followed the campus-directories infrastructure's rule, shared with
every other national list on the site (specs/campus-directories.md): crawl what `robots.txt` and a site's terms
allow, politely and once; record what they don't (`data/directories/blocked.json`), never bypassed. The Clearinghouse
(`Crawl-delay: 10`, otherwise permissive) and the Consortium (same) were both reachable this way; oSTEM returns 403
to `robots.txt` itself and is recorded blocked, not asked.

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
- **Profile, the students page's "Campus life" section, "LGBTQ+ life" block** (built through phase 3): the gender
  counts and the state-law line (phase 1); "Support on campus" (a center or staffed office and student groups, tiers
  B/D, with the caveat that directories lag closures and defer to the state-law line when both are present) and the
  policy checklist (each item linked and dated, tier D leads shown as "Listed by …", never a plain yes) (phase 3).
  "What the student conduct policy says" (tier A, human-review departure per owner decision 3) waits for phase 4.
  Hidden when there's nothing verified.
- **Explore filters (policy facts only, built):** "Has an LGBTQ+ center," "Gender-inclusive housing," and
  "Nondiscrimination covers gender identity" (`lib/lgbtq-policy.ts`). "Conduct code restricts same-sex relationships"
  (to exclude) waits for phase 4's conduct-code facts. No filter on counts.
- **Beside the men/women shares** ("Who they are", built): the another-gender count under the same rules, with the
  100% note.
- **Compare (built):** the checklist rows side by side, each cell dated (`lib/lgbtq-policy.ts` `comparedChecklist`);
  the counts never get a row.
- **Glossary (built):** another gender, gender unknown, state law on public colleges (phases 1–2); gender-inclusive
  housing, chosen name policy, nondiscrimination policy, LGBTQ+ resource center, Trans Policy Clearinghouse (phase
  3). Title IX religious exemption and policy "as of" dates wait for phase 4.

## Phases
1. **Built 2026-10-03.** **IPEDS counts** for all colleges, with the display rules and glossary terms. Adds one file to the sync (fall
   enrollment `EF{Y}A`, undergrad rows; ~3 MB zipped); the admissions file (`ADM{Y}`) is already downloaded. Cheap;
   ship first.
2. **Built 2026-10-04.** **State-law table** for public colleges (Texas first, then each reported state after reading
   its statute). Texas built 2026-10-03; Alabama, Florida, Idaho, Iowa, and Utah added 2026-10-04
   ([Phase 2 as built](#phase-2-as-built-state-laws)).
3. **Built 2026-10-04.** **Clearinghouse and directory leads** matched to `unit_id`s: the seven Trans Policy
   Clearinghouse lists and the Consortium's campus-center map, both public pages read under the shared access rules
   (robots.txt, polite pacing); oSTEM is blocked (403), recorded rather than bypassed. The "ask first" step this
   phase originally called for wasn't taken — the campus-directories infrastructure's rule is to crawl what robots.txt
   and a site's terms allow and record what they don't, the same as every other national list on the site
   ([Phase 3 as built](#phase-3-as-built-national-lists-and-the-policy-checklist)).
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
  are exempt." Applied to the 42 public Texas colleges on the site. Phase 2 added five states and three validator
  checks ([Phase 2 as built](#phase-2-as-built-state-laws)).
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

## Phase 2 as built (state laws)
Built 2026-10-04. Every state below was checked in its legislature's own text (enrolled bill, session law, or current
code); news and trackers were leads only. We kept facts, citations, and short quotes, not copies of the texts.

**Rule for inclusion** (owner decision 2026-10-04, replacing the narrower first rule). A state gets a line when an
enacted statute or session law (not a bill, executive order, or board policy) closes or restricts diversity, equity,
and inclusion or identity-based offices, centers, or programs at public colleges, and its text either names LGBTQ+
programming or is open-ended enough that its terms could reach it. The summary says which, so the line never
overstates the law's reach:
- **Names them:** the text names sexual orientation or gender identity (or concepts such as gender theory or queer
  theory) in what it closes, or hands the definition to a binding state rule that does. The summary says so (Alabama,
  Florida, Idaho, Iowa, Texas, Utah).
- **General DEI-office ban:** the text closes DEI offices without defining DEI (Ohio), or defines what it bars by an
  open category ("any other demographic characteristic", Tennessee; "protected classification under federal law" and
  any office "named diversity, equity, and inclusion", North Carolina), without naming sexual orientation or gender
  identity. The summary ends "doesn't name sexual orientation or gender identity". Whether such a law reaches a
  particular LGBTQ+ center is for the college and the courts; we report what the text says.
- **Out:** a law whose definition is a closed list that leaves out sexual orientation and gender identity ("race,
  color, sex, ethnicity, or national origin": Arkansas, West Virginia, Wyoming; Oklahoma; Kentucky, which also exempts
  open resource centers), laws limited to hiring, admissions statements, mandatory training, or course content, one-year
  budget provisos, and laws blocked by a court order until the order is lifted (the line says "in effect since").

The first rule (phase 2) took only laws whose text names LGBTQ+ programming and listed Ohio, Tennessee, and North
Carolina as close calls; the owner chose to include them. `tests/lgbtq.test.mts` pins both directions: exactly the
general-ban states carry the "doesn't name" clause.
- **Board policies:** left out (decision 2026-10-04). They aren't statutes and change without a session. The ones
  found are Idaho's State Board resolution (December 2024), now covered by Idaho's statute, and South Dakota Board of
  Regents guidance on training and email signatures.
- **Florida** is included through its statute's delegation: §1004.06(2)(a)2 bars state or federal funds for programs
  that "advocate for diversity, equity, and inclusion … as defined by rules of the State Board of Education and
  regulations of the Board of Governors", and BOG Regulation 9.016(1)(a)1 defines DEI as any program that "classifies
  individuals on the basis of race, color, sex, national origin, gender identity, or sexual orientation and promotes
  differential or preferential treatment" (Rule 6A-14.0718 covers the state colleges; amended 2026-08-25). The `act`
  field names both rules.

**Data.** `data/state-laws.json` (reviewed 2026-10-04), one entry per state. Iowa's two acts amend one chapter, so
they share an entry (`name` and `act` list both). No schema change was needed. `validateStateLaws` gained three
checks, each proved by a test that breaks it: `name` and `summary` start with the same state name, no law's `checked`
date is after the table's `reviewed` date, and entries stay sorted by state code. The profile still shows one line per
college. `meta.sources["state-law"].url` is the first entry's statute (Alabama); each value's lineage record carries
its own statute URL, which is what the ⓘ tooltip shows. The owner's review (2026-10-04) added three entries and `scripts/merge-state-laws.mts`
(`npm run merge-state-laws`), so a table change no longer needs a full sync; with the unchanged table it reproduced the
synced dataset byte for byte.

**Included** (public colleges on the site, from `data/schools.json` after the 2026-10-04 sync; 125 in all, 78 from
the first six states and 47 from the three added after the owner's review):

| State | Law | Statute | Effective | Summary (as shown) | Public colleges |
|---|---|---|---|---|---|
| Alabama | SB 129 (2024), Ala. Acts 2024-34 | Code of Alabama §41-1-90 et seq. | 2024-10-01 | Alabama public colleges may not sponsor programs where attendance is based on race, sex, gender identity, sexual orientation, or similar traits, or keep offices promoting them; student and faculty groups may host them without state funds. | 14 |
| Florida | SB 266 (2023), Laws of Fla. ch. 2023-82, s. 4 | Fla. Stat. §1004.06 (with BOG Reg. 9.016, Rule 6A-14.0718) | 2023-07-01 | Florida public colleges may not use state or federal funds for programs advocating diversity, equity, and inclusion, defined in state rules as favoring people by race, sex, gender identity, or sexual orientation; student groups are exempt. | 12 |
| Idaho | SB 1198 (2025), 2025 Idaho Sess. Laws ch. 317 | Idaho Code §67-5909D | 2025-07-01 | Idaho public colleges may not have diversity, equity, and inclusion offices, defined to include programs promoting concepts such as gender theory or queer theory; research and registered student groups not using state funds are exempt. | 4 |
| Iowa | SF 2435 (2024), 2024 Iowa Acts ch. 1152; HF 856 (2025), 2025 Iowa Acts ch. 113 (adds community colleges) | Iowa Code ch. 261J | 2025-07-01 | Iowa public universities and community colleges may not have offices that promote programming designed around race, ethnicity, gender identity, or sexual orientation; courses, research, student groups, and health services are exempt. | 3 |
| North Carolina | SB 558, S.L. 2026-21 (law notwithstanding the Governor's veto 2026-06-24) | N.C. Gen. Stat. §§116-415 to 116-417 (Ch. 116, Art. 39) | 2026-06-24 | North Carolina public universities and community colleges may not keep offices named diversity, equity, and inclusion or promoting different treatment by federally protected class; the law doesn't name sexual orientation or gender identity. | 16 |
| Ohio | SB 1 (2025), 136th General Assembly | Ohio Rev. Code §3345.0217 | 2025-06-27 | Ohio public colleges may not keep diversity, equity, and inclusion offices or departments or hold DEI trainings; the law doesn't define DEI or name sexual orientation or gender identity in the office ban, and student groups are exempt. | 20 |
| Tennessee | SB 1084 (2025), Pub. Ch. 458, "Dismantling DEI Departments Act" | Tenn. Code Ann. Title 49, ch. 7, part 1 (new section; the section number wasn't read on a state site) | 2025-05-09 | Tennessee public colleges may not favor people by race, ethnicity, sex, age, or any other demographic characteristic to increase diversity, equity, or inclusion, or keep such offices; it doesn't name sexual orientation or gender identity. | 11 |
| Texas | SB 17 (2023), Acts 2023, 88th Leg., R.S., Ch. 922 | Tex. Educ. Code §51.3525 | 2024-01-01 | Unchanged from phase 1 | 42 |
| Utah | HB 261 (2024); renumbered by SB 1001 (2025 1st Special Session); amended by Laws of Utah 2026, ch. 438 | Utah Code §53H-1-504 (formerly §53B-1-118) | 2024-07-01 | Utah public colleges may not keep offices or programs that treat people differently by race, sex, sexual orientation, gender identity, or similar traits, or that are named diversity, equity, and inclusion; teaching and research are exempt. | 3 |

Notes on the included texts:
- **Alabama:** read in the enrolled bill (alison.legislature.state.al.us, `SB129-enr.pdf`). §1(3) defines a DEI
  program as one "where attendance is based on an individual's race, sex, gender identity, ethnicity, national origin,
  or sexual orientation"; §2(1) bars sponsoring one or keeping "any office, physical location, or department that
  promotes" them; §4(1) lets student, staff, and faculty groups host them "provided that no state funds are used".
  The act number (2024-34) and codification (§41-1-90 et seq.) come from the University of Alabama in Huntsville's
  compliance page: Alabama's code site is JavaScript-only, so neither was read on a state site (*re-check by hand*).
- **Idaho:** read in the current code section (history: "added 2025, ch. 317, sec. 2") and the bill page (signed
  2025-04-04, effective 2025-07-01). It also exempts centers for American Indian students. Idaho's 2024 SB 1274
  (diversity statements in hiring and admissions) is hiring-only and left out.
- **Iowa:** read in Iowa Code 2026 ch. 261J (each section "effective July 1, 2025", 2024 Acts ch. 1152, §37) and 2025
  Iowa Acts ch. 113 (Division II adds community colleges; with no special effective date it took effect July 1,
  2025). §261J.1(1)(d) names "gender identity, or sexual orientation"; (e) names "transgender ideology",
  "heteronormativity", and "gender theory".
- **Utah:** read in the enrolled HB 261 (§53B-1-118 as enacted, effective July 1, 2024) and the current §53H-1-504
  ("Amended by Chapter 438, 2026 General Session", effective 2026-07-01). The 2026 change added privacy as an
  "important government interest" and exempted invited speakers; the ban itself is unchanged. The old §53B-1-118 page
  now lists no versions.
- **North Carolina** (re-read 2026-10-04): the session law (ncleg.gov `SL2026-21.html`) and the codified Article 39
  (ncleg.gov, Chapter 116, Article 39, history "2026-21, s. 2"). §116-417(a)(4) bars maintaining "an office,
  division, or other unit (i) promoting discriminatory practices or divisive concepts or (ii) referred to as or named
  diversity, equity, and inclusion"; §116-416(3) defines a discriminatory practice by "an individual's protected
  classification under federal law", and the divisive concepts in (4) are about race and sex. Sexual orientation and
  gender identity aren't named. Exempt: First Amendment speech, individual research, policies required by law, and
  instruction that doesn't endorse the concepts (§116-417(b)). "Public institution of higher education" is a UNC
  constituent institution or a community college (§116-416(6)); all 16 on the site are UNC universities. Ratified
  2025-06-26, vetoed, and "Became law notwithstanding the objections of the Governor at 3:25 p.m. this 24th day of
  June, 2026"; Section 6 makes it effective when it becomes law.
- **Ohio** (re-read 2026-10-04): the current section on codes.ohio.gov ("Effective: June 27, 2025", "Senate Bill 1 -
  136th General Assembly", one version). (B)(1)(a)(ii)–(iii) bar "the continuation of existing" and "establishing new
  diversity, equity, and inclusion offices or departments", (i) DEI orientation and training courses (exceptions for
  legal compliance, licensure, accreditation), (iv) DEI in job descriptions, and (vi) new DEI scholarships; (b) bars
  renaming an office to the same purpose. DEI isn't defined. Sexual orientation, gender identity, and gender expression
  appear only in (v), the ban on consultants who "promote admissions, hiring, or promotion on the basis of" them.
  (D)(2) keeps disability services and "student organizations, including fraternities and sororities". It applies to
  every "state institution of higher education" (§3345.011: state universities, their branches, community and
  technical colleges), so all 20 Ohio public colleges on the site.
- **Tennessee** (re-read 2026-10-04): Senate Amendment 1 (SA0330, capitol.tn.gov), which replaced the bill's text and
  is what passed: the Senate adopted it 2025-04-22 and the House substituted the Senate bill with its own amendments
  tabled or withdrawn. Section 6 adds a section to Title 49, Chapter 7, Part 1: a public institution of higher education
  "shall not use a discriminatory preference in an effort to increase diversity, equity, or inclusion or establish or
  maintain an office, division, or department for such purposes", where a discriminatory preference grants or
  withholds benefits "based on race, ethnicity, sex, age, or any other demographic characteristic, rather than on
  individual merit, qualifications, or lawful eligibility criteria". Sexual orientation and gender identity aren't
  named. A college may be exempted when compliance would lose federal funds (comptroller notice, renewed yearly).
  Section 37: "This act takes effect upon becoming a law". The bill page (wapp.capitol.tn.gov) records "Signed by
  Governor" and "Effective date(s)" 05/09/2025 and Pub. Ch. 458 assigned 05/15/2025, so the effective date is
  2025-05-09 (the first table had 2025-05-15, the chapter date). The Secretary of State's public-chapter PDF still
  returns 403, and the codified section number (secondary sources say §49-7-192) wasn't read on a state site, so the
  statute field names the part, not a number (*re-check by hand*).
- **Florida:** read in the 2026 Florida Statutes (history "s. 4, ch. 2023-82; s. 11, ch. 2026-28"; the 2026 change
  added the terrorist-organization clause) and the Senate bill page (effective 7/1/2023, Chapter 2023-82).

**Checked and left out** (2026-10-04). "Read" means the statute or enrolled text was read; "lead" means only news or
a legislature status page was seen.

| State | What was found | Why it's out |
|---|---|---|
| Arizona | SB 1694 (2025) | Vetoed 2025-05-02 (lead) |
| Arkansas | Act 116 (2025) and Act 341 (2025, "Arkansas ACCESS Act", Ark. Code §6-60-1601 et seq.) | Read: both define DEI by race, color, sex, ethnicity, or national origin; neither names sexual orientation or gender identity |
| Georgia | HB 127 / SB 120 (2025) | Not enacted (lead) |
| Indiana | SEA 289 (2025), P.L. 196-2025; EO 25-14 | **Couldn't read the text:** iga.in.gov is JavaScript-only (bill PDFs return an empty app shell). Left out until read by hand. The executive order is out by rule |
| Kansas | HB 2105 (2024); 2025 SB 125 §161; 2026 HB 2513 | HB 2105 bans ideological statements in hiring and admission (lead). SB 125 §161 (read) is a one-year budget certification that agencies eliminated DEI positions and removed "gender identifying pronouns or gender ideology" from email signatures; DEI is undefined. HB 2513 is a general-education course proviso (lead). None names LGBTQ+ programs |
| Kentucky | HB 4 (2025), Acts ch. 120 | Read: DEI defined by religion, race, sex, color, or national origin, and "services and programming of resource centers" are excluded when optional and open to all |
| Louisiana | SB 128 (2025) | Not enacted (lead) |
| Mississippi | HB 1193 (2025), approved 2025-04-17, effective on passage | Read: names "transgender ideology", "gender-neutral pronouns", "heteronormativity", and "gender theory", and diversity training on gender identity and sexual orientation, so it would qualify. **Blocked by a federal preliminary injunction** (August 2025; Fifth Circuit appeal argued September 2026, undecided; lead). Add it when the injunction is lifted |
| Missouri | SB 410, SB 680, HB 1196; EO 25-18 | Bills died (lead); executive order out by rule |
| Montana | HB 635 (2025) | Failed in the House (lead); no 2026 session |
| Nebraska | LB 552 (2026) | Read on the bill page: "Returned by Governor without approval on April 16, 2026"; no override vote recorded after it |
| New Hampshire | HB 2 (2025 budget), DEI sections | **Blocked by a federal preliminary injunction** (2025-10-02, vagueness; lead) |
| North Dakota | SB 2247 (2023), N.D.C.C. ch. 15-10.6 as enacted | Read: bars asking viewpoints and mandatory noncredit training on race and sex concepts; no office closure. SB 2392 (2025) failed 1–46 |
| Oklahoma | SB 796 (2025), 70 O.S. §3251, effective 2025-07-01 | Read: bars DEI positions and programs only "to the extent they grant preferential treatment based on … race, color, ethnicity, or national origin", and mandated pronoun disclosure. EO 2023-5 out by rule |
| South Carolina | H.3927 (2025) | Read on the bill page: passed the House, in Senate Judiciary since 2025-04-10; not enacted |
| South Dakota | HB 1012 (2022), 2022 S.D. Sess. Laws ch. 39 | Read: mandatory training on "divisive concepts" (race, sex, religion, and similar) only. Board of Regents policy out by rule |
| West Virginia | SB 474 (2025), W. Va. Code §18B-1G-1 et seq., effective 2025-07-11 | Read: DEI defined by race, color, sex, ethnicity, or national origin only. EO 3-25 out by rule |
| Wyoming | HB 147 (2025), Enrolled Act 67, W.S. 9-25-101, effective 2025-07-01 | Read: DEI defined by race, color, religion, sex, ethnicity, or national origin; no sexual orientation or gender identity. SF 103 was vetoed |

Ohio, Tennessee, and North Carolina were here until the owner's 2026-10-04 decision moved them to the table above.
Open: **Mississippi** qualifies on its text and waits on the courts; **Indiana** is unread (under the broader rule it
may qualify once read); **Kansas**'s budget proviso is a one-year certification, not a standing ban.

**Re-check after each legislative session** (most adjourn by June) and after any court ruling:
1. New enactments: search each legislature for bills on "diversity, equity, and inclusion" at public colleges, with
   news trackers (BestColleges, the Chronicle) as leads. Watch Indiana (read SEA 289 by hand), Mississippi (Fifth
   Circuit), New Hampshire (injunction), Ohio, Tennessee, and North Carolina (amendments, and whether a later text
   names sexual orientation or gender identity, which changes the summary), repeat bills in Missouri, South Carolina, Georgia, Louisiana, Nebraska, and Arizona, and Kansas
   budget provisos (yearly).
2. Amendments and renumbering of included laws: re-read each URL. Utah renumbered Title 53B to 53H in 2025, and
   Florida's definition lives in board rules that change without a session (BOG 9.016, Rule 6A-14.0718).
3. Update `checked` for each law re-read and `reviewed` for the table (the validator refuses a `checked` date after
   `reviewed`), then run `npm run merge-state-laws` (no network; applies the table to `data/schools.json` and
   `meta.json` exactly as `sync-data` does, and refuses to write if the table or lineage check fails) so the lines and
   lineage dates move. `npm run sync-data` does the same step as part of a full sync.

## Phase 4 as built (pilot)
Built 2026-10-04 on the shared pilot engine ([college-reported-data.md](college-reported-data.md#campus-life-pilot-as-built-2026-10-04)).
Per college: the LGBTQ+ center or office page, the college's list of LGBTQ+ groups, and the policy pages (lgbtq-life
"Scaling"); the conduct code only at religious colleges, trans admission only at historically single-sex colleges.
- **Stored** in the `campus_pages` detail table: `center` (open or closed, with the closure date when stated) and
  `policies[]` as `PolicyCheck` rows (lib/directories.ts): each item "yes" or "no" with its page, date checked, and
  quote; "not found" is never stored (a missing page is not a no). Every "no" and the conduct restriction carry
  `verified_by` (owner decision 3, above); `checkCampusPages` refuses one without it. The conduct quote is the
  college's own words, cut at a word boundary to 160 characters. College-recognized groups are tier B listings in
  the `directories` table.
- **Shown** by `LgbtqPolicies` (`components/school/CampusPages.tsx`), after the LGBTQ+ life block: the center, the
  policy items ("Yes"/"No" and the item, each with its ⓘ), and "What the student conduct policy says" as a quote.
  Nothing is graded or ranked; no filter or Compare row yet (the Explore filters wait for rollout coverage).
  Facts older than two years hide.

**Measured without a model (2026-10-04).** The pipeline's fetcher and page gathering were run on the answer key's own
URLs (257 requests): every page the key could read, and whether the key's hand-copied quotes pass our quote check on
the text we read. 274 of 289 quotes on readable pages passed (94.8%); every miss was in the key, not the check
(bracketed completions such as "C[atholic faith]", a computed sum given as a quote, a home-page quote reused on
sub-pages, a meta description). Average extraction input per college: Greek 30,900 characters (max 70,100), faith
11,600, LGBTQ+ 20,800. For this domain: nondiscrimination statements 19 read of 19, name policies 10 of 10, housing 7 of
7, restroom lists 6 of 6, conduct codes 4 of 4 (Liberty's full Liberty Way is in a JavaScript-only viewer; the
doctrinal statement was read), health plan pages 2 of 2, center pages 11 of 14 (the other three are dead: UT's
diversity.utexas.edu, Alabama's safezone site, Harvard's bgltq.fas). The key found **no** college whose own page states
that its student plan covers transition-related care.

**Cost (estimates until the workflow run measures them).** Per college: discovery 3 Sonnet calls with up to 12
searches, about $0.20–0.25 (searches $0.10 per 10); extraction about 21,600 Haiku input tokens and 3,600 output from the
measured page sizes, $0.04; escalation (assumed one domain in three) $0.03; second checks $0.02. About $0.30–0.34 per
college, $8 for the 25, $570–640 for ~1,890 colleges. Cheapest configuration to test next: free path probes before paid
search, one discovery call for all three domains, and Message Batches for extraction and checks (half price): about
$0.16–0.20 per college, $300–380 for a full run.

**Worth scaling (pending the live run's precision):** the nondiscrimination statement (readable everywhere the key
read it; the "partial" cases, Notre Dame and Baylor, cover these only in harassment policy), the center page (with
closures), housing and name policies, and the conduct code at religious colleges. **Not worth it per college:** the
student health plan item (0 of 25 colleges state it on a page; drop it or ask the Clearinghouse list's compiler) and
restroom lists (rarely published, rarely answerable).
## Phase 3 as built (national lists and the policy checklist)
Built 2026-10-04, branch `feature/campus-life-2-lgbtq-lists`, on the shared campus-directories infrastructure
(`specs/campus-directories.md`). Nine adapters, read 2026-10-04 (`scripts/lib/directories/adapters/`): the Trans
Policy Clearinghouse's seven lists (six as the `_tpc-common.mts` shared accordion parser, one — trans admission — as
its own prose parser), the Consortium's campus-center KML export, and oSTEM (blocked).

**Per-list coverage** (`npm run sync-directories -- --domain lgbtq`, matched against the 1,893 colleges on the site):

| List | Adapter key | Tier | Entries | Matched | Multi | Unmatched | Colleges |
|---|---|---|---|---|---|---|---|
| Gender-inclusive housing | `tpc-housing` | D | 489 | 444 | 0 | 45 | 444 |
| Gender-inclusive restrooms online | `tpc-restrooms` | D | 494 | 408 | 0 | 86 | 408 |
| Chosen name and pronouns on records | `tpc-name-pronouns` | D | 857 | 539 | 0 | 318 | 539 |
| Nondiscrimination covers gender identity | `tpc-nondiscrimination` | D | 1,931 | 952 | 0 | 979 | 952 |
| Student health plan covers transition care | `tpc-health-plan` | D | 186 | 177 | 0 | 9 | 177 |
| Trans-inclusive athletic policy | `tpc-athletics` | D | 63 | 61 | 0 | 2 | 61 |
| Trans admission (women's/men's colleges) | `tpc-trans-admission` | D | 32 | 32 | 0 | 0 | 29 |
| LGBTQ+ center or staffed office | `lgbt-campus-consortium` | D | 276 | 256 | 4 | 20 | 254 |
| oSTEM chapters | `ostem` | — | **blocked** (403 to `robots.txt` itself; recorded in `data/directories/blocked.json`, not bypassed) | | | | |

Unmatched entries are mostly community colleges, graduate-only schools, and non-U.S. campuses the lists cover but
this site doesn't (legitimate, per `specs/campus-directories.md#how-to-add-an-adapter`); the nondiscrimination list's
51% unmatched rate reflects that it alone covers far more two-year and non-U.S. institutions than the site tracks.
Five hand-checked answers went to `data/directories/matches.json`: Worcester Polytechnic Institute (the Consortium
spelled out "(WPI)"); Saint John's University, Collegeville MN (both the Clearinghouse's and the Consortium's "no
state given" entry shares a domain, csbsju.edu, with the College of Saint Benedict, so it's the MN coordinate
campus, not St. John's University-New York); and UC-Denver, whose Consortium entry actually names three Auraria
Campus institutions sharing one center, two of which (University of Colorado Denver, Metropolitan State University
of Denver) are on this site.

**Adapters:**
- `_tpc-common.mts` (not itself an adapter; `_`-prefixed per the registry's convention): parses the WordPress
  accordion five of the seven Clearinghouse lists share (one panel per state, each a `<ul>` of college names,
  sometimes "(YYYY)" for a start year or a "**" footnote), drops entries the list itself marks "removed" (six, all on
  the nondiscrimination list, after a 2025 state law or a college's own choice) rather than publish a policy that's
  gone.
- `tpc-housing.mts`, `tpc-restrooms.mts`, `tpc-health-plan.mts`, `tpc-name-pronouns.mts`, `tpc-nondiscrimination.mts`,
  `tpc-athletics.mts`: one adapter per list, each `kind: "policy"` with its matching `PolicyKey`.
- `tpc-trans-admission.mts`: the one Clearinghouse list that's prose, not the accordion — each college gets a bolded
  name (sometimes linked) and Dr. Beemyn's description or a quoted excerpt. The section a college's paragraph is in
  (permits, prevents, bans, or men's-college policy) becomes the entry's `name`, not its `fact`: three colleges
  (Bennett, Stephens, Sweet Briar) appear in two sections with the same URL, and the runner's entry-level
  de-duplication keys on campus/name/url, so without a distinct name per section the second finding silently
  vanished into the first — caught by comparing the crawl's raw count (32) against the written file's (29, before
  the fix) during this build.
- `lgbt-campus-consortium.mts`: the find-an-lgbtq-campus-center page embeds a Google My Maps map
  (`google.com/maps/d/u/1/embed?mid=…`); reading the same map's own public KML export
  (`google.com/maps/d/kml?mid=…`) is that map's documented public-export feature, not a way around anything (the
  page itself has no other data feed). 273 placemarks, one per campus, named like "University of Michigan-Ann Arbor"
  with a description of "Center name<br>Founded: YYYY<br>URL" lines; about a fifth have no description at all (still
  a center the Consortium lists, just with no further detail, so counted, not dropped) and a few list more than one
  center for the same campus (UCLA's two). **`trans_athletics` policy key added** to `lib/directories.ts`
  `POLICY_KEYS` (open question 3's own framing: "a per-college policy covers intramurals and club sports only") so
  all seven Clearinghouse lists have a matching key, not six.
- `ostem.mts`: fetches the chapters page and throws if it *isn't* blocked, so a future unblock is noticed rather than
  silently never read; as of 2026-10-04 it's still 403 on `robots.txt` itself.

**Policy checklist and tier A precedence (`lib/lgbtq-policy.ts`, kept apart from `lib/lgbtq.ts`'s gender-identity
counts on purpose — see the guard note below):**
- `policyChecklist(lgbtq, directoryListings)`: one row per `PolicyKey` with something to show, in `POLICY_KEYS`
  order. A verified tier A fact from `school.lgbtq.policies` (not yet populated; phase 4's pilot track builds it)
  replaces a tier D lead for the same key, even when the tier A answer is "no" — the college's own checked page
  outranks any list. Absence is never shown as "No": a key with neither tier is left out of the checklist entirely.
  Every row's text names its source ("Listed by Trans Policy Clearinghouse (2026-10-04)" for tier D; "…, per the
  college's own page (checked …)" for tier A), never a plain "Yes"/"No". Fixture-tested
  (`tests/lgbtq-directories.test.mts`): a tier D lead, a tier A "yes" that replaces it, a tier A "no" that still
  replaces it (and is never shown as a plain "No"), and a tier A "not_found" that falls back to the tier D lead
  rather than showing blank.
- `hasLgbtqCenter` / `policyIsYes`: Explore's filter predicates, reading `school.directories.lgbtq` (tier D presence)
  and, when present, `school.lgbtq.policies` (tier A, which wins).
- `comparedChecklist(schools, details)`: Compare's rows, one per key any compared college has something for; built
  as its own small section (not folded into the generic "All the numbers" `TABLE_ROWS`, whose cell functions take
  only `School` — the tier D leads live in each college's *detail* file, so the checklist needed per-school detail
  access the generic table doesn't thread through).
- **The guard, widened on purpose.** `tests/lgbtq.test.mts`'s "never ranked, averaged, filtered, compared" test
  (phase 1) banned the bare word "lgbtq" from `lib/params.ts`, `lib/dataset.ts`, `app/explore`, `app/compare`, and
  others — right for phase 1, when nothing LGBTQ+-related belonged in any of them, but too wide for phase 3, which
  the spec always meant to put policy facts in those same files ("Where it appears": Explore filters, Compare rows).
  The owner's scaling note for this build — "policy facts are allowed there, counts are not" — says which half of the
  old rule to keep: the test now bans `GenderDetail`/`GenderAdmissions`/"another gender" and any import of
  `lib/lgbtq.ts` from those files, instead of the bare word, so the policy facts can reach them while the counts
  still can't.

**Display (`components/school/LgbtqLife.tsx`):** "Support on campus" (centers and groups via `listingsFor`,
`CreditedList`, with the lag-closures caveat, and — when both a center and a state law are present — a note that the
law can close an office like it, so a listed center isn't a claim that it's still open) and the policy checklist
(each item linked, dated, with a ⓘ: `citeListing` for a tier D item, a glossary term for the five with one). Takes
over the generic `<DirectoryListings domain="lgbtq">` placeholder entirely rather than running both.

**Explore and Compare:** three filters (`lgbtqCenter`, `lgbtqHousing`, `lgbtqNondiscrimination`) in a new "LGBTQ+
campus life" `FilterPanel` section, with facets and removable chips; a "LGBTQ+ policies" Compare table, its own
section (not the generic numbers table, for the reason above), one row per key any compared college has something
for.

**Glossary:** gender-inclusive housing, chosen name policy, nondiscrimination policy, LGBTQ+ resource center, Trans
Policy Clearinghouse — five new entries (`lib/glossary.ts`), cross-linked to each other and to the existing
national-directory and state-law terms.

**Not built this phase:** per-college policy pages (tier A), conduct-code quotes, and the second-model review of "no"
answers (owner decision 3) all wait for phase 4's pilot; `PolicyCheck`'s validator (`policyCheckProblems`) and the
`"policy-page"` source were already in place from the shared infrastructure, ready for that track to write into.

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
- Trans Policy Clearinghouse, all seven lists (read 2026-10-04):
  https://www.gennyb.com/research/trans-supportive-campus-policies/colleges-and-universities-that-provide-gender-inclusive-housing,
  …/gender-inclusive-restrooms, …/name-and-pronouns/, …/nondiscrimination-policies, …/medical-expense-coverage,
  …/athletic-policies, …/historically-womens-mens-colleges
- Consortium of Higher Education LGBT Resource Professionals, campus center map:
  https://www.lgbtcampus.org/find-an-lgbtq-campus-center (its embedded Google My Maps export, read 2026-10-04:
  https://www.google.com/maps/d/kml?mid=1uYlF3milN1euuDcLS_iXLncpsHQ&forcekml=1)
- Campus Pride: https://www.insidehighered.com/news/diversity/sex-gender/2024/01/10/campus-pride-terminates-founder-alleged-fraud;
  Index FAQ (8 factors): https://www.campusprideindex.org/faqs/index
- UT Austin center closure: https://thedailytexan.com/2024/01/15/gender-and-sexuality-center-closes-replaced-by-womens-community-center/,
  https://www.kut.org/education/2024-04-02/ut-austin-dei-diversity-law-sb-17; states with DEI laws:
  https://abcnews.com/US/dei-fallout-texas-university/story?id=114470961
- Title IX exemptions: https://www.ed.gov/laws-and-policy/civil-rights-laws/title-ix-and-sex-discrimination/title-ix-key-issues/title-ix-exemptions;
  CRS report R47613: https://www.congress.gov/crs-product/R47613
- oSTEM chapters: https://www.ostem.org/chapters; REAP: https://www.thereap.org/
- State laws, phase 2 (read 2026-10-04). Included: Alabama SB 129 enrolled,
  https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2024RS/SB129-enr.pdf (act number and
  codification: https://www.uah.edu/compliance/federal-law-sb129-compliance-guidance); Florida §1004.06,
  https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=1000-1099/1004/Sections/1004.06.html,
  SB 266 https://www.flsenate.gov/Session/Bill/2023/266, BOG Regulation 9.016
  https://www.flbog.edu/wp-content/uploads/2024/01/Regulation-9.016-Prohibited-Expenditures_-post-circulation_v6-FINAL.pdf,
  Rule 6A-14.0718 https://www.flrules.org/gateway/ruleNo.asp?id=6A-14.0718; Idaho §67-5909D
  https://legislature.idaho.gov/statutesrules/idstat/Title67/T67CH59/SECT67-5909D/ and
  https://legislature.idaho.gov/sessioninfo/2025/legislation/S1198/; Iowa ch. 261J
  https://www.legis.iowa.gov/docs/code/261J.pdf and 2025 Acts ch. 113
  https://www.legis.iowa.gov/docs/publications/iactc/91.1/CH0113.pdf; Utah §53H-1-504
  https://le.utah.gov/xcode/Title53H/Chapter1/53H-1-S504.html and HB 261 enrolled
  https://le.utah.gov/~2024/bills/hbillenr/HB0261.pdf. Left out (read): Arkansas Acts 116 and 341 of 2025
  (arkleg.state.ar.us ACT116.pdf, ACT341.pdf); Kansas SB 125 (2025) enrolled, kslegislature.gov; Kentucky Acts 2025
  ch. 120 https://apps.legislature.ky.gov/law/acts/25RS/documents/0120.pdf; Mississippi HB 1193 as sent to the
  Governor https://billstatus.ls.state.ms.us/documents/2025/html/HB/1100-1199/HB1193SG.htm; Nebraska LB 552
  https://nebraskalegislature.gov/bills/view_bill.php?DocumentID=63261; North Carolina S.L. 2026-21
  https://www.ncleg.gov/BillLookUp/2025/S558; North Dakota SB 2247
  https://ndlegis.gov/assembly/68-2023/regular/bill-overview/bo2247.html; Ohio R.C. 3345.0217
  https://codes.ohio.gov/ohio-revised-code/section-3345.0217; Oklahoma SB 796 enrolled, oklegislature.gov; South
  Carolina H.3927 https://www.scstatehouse.gov/sess126_2025-2026/bills/3927.htm; South Dakota 2022 ch. 39
  https://mylrc.sdlegislature.gov/api/Documents/SessionLaw/236258.html?Year=2022; Tennessee SB 1084 and Senate
  Amendment 1 https://wapp.capitol.tn.gov/apps/BillInfo/Default.aspx?BillNumber=SB1084&GA=114,
  https://www.capitol.tn.gov/Bills/114/Amend/SA0330.pdf; West Virginia SB 474 enrolled
  https://www.wvlegislature.gov/Bill_Status/Bills_history.cfm?input=474&year=2025&sessiontype=RS&btype=bill; Wyoming
  HB 147 enrolled https://wyoleg.gov/2025/Enroll/HB0147.pdf. Leads: https://www.bestcolleges.com/news/anti-dei-legislation-tracker/,
  https://www.ednc.org/6-26-2026-north-carolina-lawmakers-ban-dei-in-public-schools-higher-education-state-agencies/,
  https://mississippitoday.org/2026/09/01/dei-ban-wingate-ai-mississippi/,
  https://www.gladlaw.org/federal-court-temporarily-blocks-new-hampshire-law-attacking-diversity-equity-and-inclusion/
