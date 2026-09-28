# Religious Life & Greek Life

> Status: **planned** (not built). Research done 2026-09-28 by querying the Scorecard API, reading published 2025–26
> Common Data Sets, and reviewing third-party sources. Findings are verified unless marked *unverified*.

## Goal
Help students answer two campus-culture questions with cited numbers:
1. **Religious life:** Is this college religiously affiliated, how much does faith shape it (admissions, aid,
   academics), and what religious community is on campus?
2. **Greek life:** How many students join fraternities and sororities, and is there Greek housing?

## The main constraint: no federal data on students
Federal surveys don't ask students their religion or whether they joined a fraternity or sorority. So:
- **Institution-level religious facts** (affiliation, degrees in theology) come from IPEDS and cover every college.
- **Student participation** (Greek membership, religious make-up) comes only from what colleges self-report, mainly
  the **Common Data Set (CDS)**, or from third-party estimates. Coverage is partial and years vary by college.

This shapes the UI: affiliation can be a filter across all 1,893 colleges; Greek percentages are "where reported."

## What's available

### Religious life

| Measure | Source | Coverage | Verdict |
|---|---|---|---|
| **Religious affiliation** (denomination code) | IPEDS IC `RELAFFIL`; also Scorecard `school.religious_affiliation` (verified: BYU = 94, Benedictine = 30) | All colleges. **685 of our 1,893** are affiliated, all private nonprofit (probed 2026-09-28). Most common codes: 30 (189), 71 (70), 54 (49), 66 (42). | **Phase 1.** Cheap: one field. |
| Degrees in religion/theology | IPEDS Completions `C{year}_A`, CIP 39 (Theology & religious vocations) and 38.02 (Religious studies) | All colleges | **Phase 1 (optional).** `C2025_A` is already released and unused (see [backlog](backlog.md)). A share of bachelor's degrees shows how central religion is academically. |
| Religious commitment in admissions | CDS **C7** "Religious affiliation/commitment" (Very important / Important / Considered / Not considered) | CDS publishers | **Phase 2.** Strong signal of how much faith shapes the college, and it separates devout from historically affiliated colleges. |
| Aid based on religious affiliation | CDS **H14** criteria for institutional aid, "Religious affiliation" checkbox | CDS publishers | **Phase 2.** |
| Campus ministries offered | CDS **F2** "Campus Ministries" checkbox | CDS publishers | **Phase 2.** Nearly all large colleges check it, so it's weak alone. Store it; show it only in a list of what's offered. |
| Christian college membership | CCCU member list (>150 in U.S./Canada; voting members hire only faculty who profess Christian faith) | ~150 | **Phase 3.** A public list, matched to unit IDs by hand once, refreshed yearly. |
| Catholic college membership | ACCU member list (~200, *unverified*) | ~200 | **Phase 3.** Mostly redundant with `RELAFFIL = 30`; useful only to catch mismatches. |
| Carnegie "special focus: theological studies" | 2025 Carnegie Classification (294 institutions in that category) | All | **Maybe.** Most are seminaries outside our 4-year dataset. Check the overlap before adding. |
| Jewish student population | Hillel College Guide (per-campus estimates) | ~500+ campuses (*unverified*) | **Deferred.** Estimates are reported by campus Hillels, mostly from students who engage with Hillel. Independent surveys have found lower counts. The site blocks automated fetching and the license is unclear. Only with Hillel's permission, labeled "estimate." |
| Student religious make-up | HERI CIRP Freshman Survey asks "current religious preference" | Participating colleges | **Rejected.** Institution-level results go only to the participating college and aren't public. |
| Title IX religious exemptions | ED Office for Civil Rights list | Colleges that requested one | **Deferred (open question).** Sensitive, and incomplete: since 2020 colleges can claim the exemption without asking first. |

### Greek life

| Measure | Source | Coverage | Verdict |
|---|---|---|---|
| **% of men who join fraternities, % of women who join sororities** | CDS **F1**, two columns: first-time first-year students and all degree-seeking undergrads, "enrolled in Fall {year}" | CDS publishers | **Phase 2, the core metric.** Example (OU CDS 2025–26): fraternities 34.3% first-year / 25.5% undergrad; sororities 40.7% / 33.2%. |
| Fraternity/sorority housing | CDS **F4** checkbox "Fraternity/sorority housing" | CDS publishers | **Phase 2.** |
| Greek chapters and members by campus | NPC and NIC | National totals are public (NPC 2024–25: 375,592 undergrad members, 26 organizations). Campus figures are behind member logins. | **Rejected.** |
| Hazing findings by student group | Campus Hazing Transparency Reports (Stop Campus Hazing Act): each college posts named organizations with findings from July 1, 2025 on, updated at least twice a year; first due Dec 23, 2025. Hazing counts join Clery Annual Security Reports from the Oct 2026 report (2025 incidents). | All Title IV colleges, though ~56% missed the first deadline (HazingInfo.org) | **Deferred (open question).** Unstructured pages, a reputational subject, and it covers all student groups, not only Greek ones. Revisit when HazingInfo.org or ED publishes structured data. |
| Greek "grades," party scene | Niche, U.S. News, Princeton Review | — | **Rejected.** Proprietary and not citable to a primary source. U.S. News's Greek % is the CDS F1 figure anyway. |

## Data model
New fields go in `lib/fields.ts` with sources and vintages ([data-lineage.md](data-lineage.md)).

```ts
school.religion = {
  affiliation: { code: 30, label: "Roman Catholic" } | null, // null = no affiliation (not "unknown")
  theology_degree_share: number | null,  // phase 1 optional: CIP 39 + 38.02 share of bachelor's degrees
  admission_weight: "very_important" | "important" | "considered" | "not_considered" | null, // CDS C7
  aid_by_affiliation: boolean | null,    // CDS H14
  campus_ministries: boolean | null,     // CDS F2
  cccu_member: boolean | null,           // phase 3
}
school.greek = {
  frat_pct_first_year: number | null,    // CDS F1, 0–1
  frat_pct_undergrad: number | null,
  sor_pct_first_year: number | null,
  sor_pct_undergrad: number | null,
  housing: boolean | null,               // CDS F4
}
```

- **Sources and vintages.** Affiliation: `ipeds-ic` (a new `IC{year}` vintage, since the sync reads only
  `IC{year}_AY`/`COST1` today). Degree share: a new `ipeds-c` source. CDS fields: `cds` with the edition, per school.
  CCCU: a new `cccu` source with the date the list was checked.
- **Denomination labels** come from the IPEDS dictionary for that year's file, not a hand-typed table. The sync fails
  on a code without a label. Store both code and label so a later relabeling doesn't break filters.
- **Blank is not 0.** In F1, Princeton leaves the Greek rows blank, while colleges without Greek life often enter 0%.
  Store blanks as `null`. A college with no chapters shows "No fraternities or sororities" only when the CDS says 0%
  (or F4 and a stated policy agree), never because a value is missing.
- **CDS wording changes between editions** ("Percent of males who join fraternities" in older editions, "Percent of
  men…" in 2025–26). The importer matches both.
- **Denominators.** F1 is a percentage of men or women, not of all students. Label it that way, and never add the two
  into a "% Greek" without weighting by the gender split (which needs a same-year CDS B1).

## Ingestion
- **Phase 1:** add `RELAFFIL` to the sync from the `IC{year}` file (cross-check against Scorecard's field; they
  should match). Optionally add CIP 39 / 38.02 from `C{year}_A`.
- **Phase 2:** extend `scripts/import-cds.mts` (Excel) to read C7, F1, F2, F4, H14, and add the same items to the
  schema of the college-reported data agent ([college-reported-data.md](college-reported-data.md)). They come from the
  same document the agent already reads for admissions, so the extra cost is small. Checks: percentages 0–100,
  first-year and undergrad values within 40 points of each other (flag otherwise), and C7 must be one of four
  values.
- **Phase 3:** `data/lists/cccu.json` (unit ID, name as listed, date checked), matched by hand, with a test that every
  ID exists in `data/schools.json`.

## Where it appears
- **Explore filters:** "Religious affiliation" (Any / None / Affiliated / specific denomination group). Group the ~60
  codes into ~8 families (Catholic, Baptist, Methodist, Lutheran, Presbyterian, Latter-day Saints, Jewish, Other
  Christian, Other) for the filter, and show the exact label on the profile. A "Greek life" filter (share of men or
  women joining ≥ X%) with a "where reported" note.
- **Profile, new "Campus life" section** (after Students): affiliation with `<InfoTip>`, C7 phrased in plain
  English ("Religious commitment is *very important* in admissions"), Greek `BenchmarkBar`s for fraternities and
  sororities against the median of reporting colleges, housing chip. Each value is cited, with CDS values showing their
  edition. Hidden when empty, per [school-profile.md](school-profile.md#missing-data).
- **Compare:** affiliation and the two undergrad Greek percentages as rows.
- **"Known for" chips:** "Strong Greek life" (top decile of reporting colleges); "Faith-centered" only when C7 is
  Very important or the college is a CCCU member, not on affiliation alone (many affiliated colleges are secular in
  practice).
- **Glossary** (`lib/glossary.ts`): religious affiliation, Greek life, CDS F1 definitions, CCCU.

## Rules
- Neutral tone: facts, no rankings of religiosity, no value judgments. Both "Faith-centered" and "Secular" are
  descriptions, not scores.
- Greek participation from different CDS editions is shown with its year. Ranks and medians use only colleges on the
  same or adjacent edition, and state the count ("of 412 colleges reporting").
- No estimate is shown as a count without "estimate" in the label (applies to Hillel if ever added).

## Open questions
1. Title IX religious exemptions and hazing transparency reports: include (factual, useful to some students) or leave
   out (sensitive, incomplete)? Recommendation: leave out for now, and revisit hazing once structured data exists.
2. Ask Hillel for permission to use their College Guide estimates?
3. Is "enrollment at religious colleges" wanted as a national stat (e.g. a Home fact: share of 4-year undergrads at
   affiliated colleges)? It can be computed from phase 1 data.

## Sources
- College Scorecard API, `school.religious_affiliation` (probed 2026-09-28)
- CDS 2025–26 sections C7, F1, F2, F4, H14 (read from University of Oklahoma and Princeton 2025–26 CDS files):
  https://www.ou.edu/content/dam/irr/docs/common-data-sets/norman-campus-only/2025-26-nc/IRR%20CDS-F.pdf
- CCCU: https://www.cccu.org/institutions/, https://www.cccu.org/about/
- Hillel College Guide: https://www.hillel.org/college-tools/; accuracy critique:
  https://ejewishphilanthropy.com/how-many-jewish-undergraduates/
- HERI CIRP Freshman Survey: https://heri.ucla.edu/cirp-freshman-survey/
- 2025 Carnegie Classification: https://carnegieclassifications.acenet.edu/carnegie-classification/classification-methodology/2025-institutional-classification/
- Title IX exemptions: https://www.ed.gov/laws-and-policy/civil-rights-laws/title-ix-and-sex-discrimination/title-ix-key-issues/title-ix-exemptions
- NPC fast facts: https://npcwomen.org/news/npc-fast-facts/
- Stop Campus Hazing Act: https://www.clerycenter.org/scha-what-you-need-to-know;
  compliance: https://www.campussafetymagazine.com/insights/56-of-colleges-missed-stop-campus-hazing-act-compliance-deadline/177103
