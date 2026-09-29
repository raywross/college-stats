# Greek Life

> Status: **planned** (not built). Research 2026-09-28: 2025–26 Common Data Sets and a per-school deep dive on UT
> Austin. Findings are verified unless marked *unverified*. Companions: [religious-life.md](religious-life.md) (its
> source tiers, crawl strategy, and access rules apply here too) and [lgbtq-life.md](lgbtq-life.md) (LGBTQ+ Greek
> chapters). Per-school collection shares the engine in
> [college-reported-data.md](college-reported-data.md#campus-life-sources).

## Goal
Answer, with cited sources: *Is there Greek life? How big is it? Which kinds of organizations (fraternities,
sororities, historically Black, Latino, Asian, multicultural)? Is there Greek housing, and when can students join?*

## Where the data is
Federal data has nothing on Greek life. Two kinds of college-published source cover it:
- **CDS F1** gives one standard number per college (share of men in fraternities, share of women in sororities) but
  only for colleges that publish a CDS.
- **The college's fraternity & sorority life (FSL) office** often publishes more: members and chapters by council,
  chapter GPAs, recruitment rules. Formats vary by college.

## Case study: UT Austin (probed 2026-09-28)

| Source | What it says | Format / access |
|---|---|---|
| UT CDS 2025–26, F1 (fall 2025) | Men in fraternities **11%** first-year / **13%** undergrad; women in sororities **16%** / **17%** | PDF behind a Box share link. F1 numbers extract as text. **F4 "Fraternity/sorority housing" is a checkbox whose ✔ comes out separately from its label** |
| FSL "Our community" page | "7,200+" members, ~60 chapters, five councils plus an affiliate circle | HTML |
| FSL **chapter size reports**, spring 2026 (one PDF per council, each semester) | Per chapter: initiates, new members, total. Totals: University Panhellenic 3,984 · Interfraternity 2,293 · Texas Asian Pan-Hellenic 442 · Latino Pan-Hellenic 218 · National Pan-Hellenic 173 · Affiliate 81 = **7,191** | PDF printed from an internal UT app; predictable URLs (`/sfl/downloads/2026SpringIFCSizeReport.pdf`) |
| FSL **grade reports** (each semester, per council) | Chapter GPAs against all-university averages | PDF |
| HornsLink (Engage) | Category "Sororities and Fraternities" | Same `robots.txt` limit as in [religious-life.md](religious-life.md#case-study-ut-austin-probed-2026-09-28) |

**The sources agree.** UT has 42,855 undergrads. If about 55% are women (*unverified*; the gender split comes from
IPEDS EF), 17% of women ≈ 4,000 sorority members, against 3,984 in Panhellenic. The fraternity numbers are similarly
close. So where both exist, the CDS F1 can be checked against the FSL reports, and disagreement flags a bad
extraction.

## Measures
1. **Participation rate** (tier A, CDS F1): % of men in fraternities, % of women in sororities, first-year and all
   undergrads. The headline, and the only measure comparable across colleges.
2. **Size and makeup** (tier A, FSL reports): total members, chapters, and members by council type: Panhellenic
   (NPC), Interfraternity (IFC/NIC), NPHC (historically Black), Latino, Asian, multicultural, other. Tells a student
   *which* Greek communities exist and how big each is.
3. **Greek housing** (CDS F4 checkbox, or the FSL site).
4. **Recruitment facts** (FSL pages, extracted): formal recruitment term, whether first-years can join in their first
   semester (deferred recruitment), cost ranges if published.
5. **Academics** (FSL grade reports): Greek GPA against the all-undergrad GPA. *Maybe*; publishing varies widely.
6. **Chapters present** (tier D, national headquarters' "find a chapter" pages): which national organizations have a
   chapter. Useful where the college publishes nothing.
7. **Hazing findings** (Campus Hazing Transparency Reports, required since Dec 23, 2025, updated at least twice a
   year; ~56% of colleges missed the first deadline): **deferred, open question.** They name student organizations
   (not just Greek ones), and each college posts its own format.

## Scaling
- **Presence first.** NPC sororities are on "more than 670 campuses," so many of our 1,893 colleges likely have no
  Greek life. A cheap pass (CDS F1 = 0 or blank, no FSL office found, no tier D chapters) marks "none found" so the
  expensive steps run only where Greek life exists. Show "none found," not "none," unless the college states it (e.g.
  CDS 0% or a published policy).
- **Per college, 2–4 sources:** CDS, the FSL office landing page, and its report files (size/grade/community
  reports, usually PDFs linked from one "reports" page). Discovery records the FSL "reports" page as the index URL;
  new semesters show up as new links there (UT's filenames follow a pattern).
- **National directories:** ~26 NPC sororities, the NIC fraternities, the 9 NPHC organizations, plus Latino/Asian/
  multicultural councils (NALFO, NAPA, NMGC; counts *unverified*). Each headquarters has a chapter locator in its own
  format: roughly 60–100 adapters, so phase 4 only if the pilot shows the need. NPC's and NIC's campus-level data is
  behind member logins, so ask them rather than scrape.
- **Extraction:** size and grade reports are tables. Parse them deterministically where the layout is known (UT's
  come from one internal app, so all six councils share a layout) and fall back to a cheap model with a table schema.
  Checkboxes (CDS F4) need layout-aware parsing or a vision call.

## Data model (sketch)
```ts
school.greek = {
  frat_pct_first_year: number | null, frat_pct_undergrad: number | null, // CDS F1, 0–1
  sor_pct_first_year: number | null,  sor_pct_undergrad: number | null,
  housing: boolean | null,                                              // CDS F4
  status: "present" | "none_reported" | "none_found" | null,
  councils: { type: CouncilType; name: string; chapters: number | null; members: number | null }[] | null,
  members_total: number | null, term: string | null,                    // e.g. "Spring 2026"; FSL report
  recruitment: { deferred: boolean | null; formal_term: string | null } | null,
}
```

## Rules
- **Blank is not 0.** Princeton leaves the F1 Greek rows blank (it has eating clubs, not recognized Greek life);
  others enter 0%. Store blank as `null`.
- **F1 is per gender**, not per student body. Never add the two into "% Greek" unless weighted by the same-year
  gender split, and say so.
- **Counts are by semester.** Spring counts run lower than fall (after graduations, before recruitment), and "total
  members" usually includes new members. Always label the term; never compare fall at one college with spring at
  another in a rank.
- **CDS wording changed** ("males/females" in older editions, "men/women" in 2025–26): match both.
- Neutral tone. Size is a fact, not a grade (no "party school" labels).

## Where it appears
- **Explore:** "Greek life" filter (fraternity or sorority participation ≥ X%, where reported) and "has NPHC /
  Latino / Asian / multicultural chapters."
- **Profile, "Campus life" section:** fraternity and sorority participation `BenchmarkBar`s against the median of
  reporting colleges; a council breakdown (members by council type) where FSL reports exist; housing and recruitment
  chips. Cited, with CDS edition or report term.
- **Compare:** the two undergrad percentages.
- **"Known for":** "Big Greek life" (top decile of reporting colleges on the undergrad percentages).

## Phases
1. **CDS F1 and F4** through `import-cds` (Excel) and the college-reported agent (PDF), with the F1/FSL cross-check
   where both exist.
2. **Pilot of 25 colleges** (shared with religious life, plus Greek-heavy ones such as Alabama, Ole Miss, W&L, an
   HBCU, and a college without Greek life): find FSL offices, parse their reports, measure hit rate and cost.
3. **FSL reports at scale** for colleges where Greek life exists.
4. **National chapter directories** only if needed to cover colleges without FSL reports; ask NPC/NIC for data first.

## Open questions
1. Hazing transparency reports: include (per-college counts only, linking to the college's report) or leave out?
   Recommendation: revisit once a structured dataset exists (HazingInfo.org is building one) or ED publishes
   the Clery hazing statistics (first in the Oct 2026 reports, covering 2025).
2. Chapter-level detail (a table of chapters and sizes on the profile)? Recommendation: council totals only. Chapter
   tables change every semester and invite rankings of individual chapters.

## Sources
- UT FSL: https://deanofstudents.utexas.edu/sfl/, reports: https://deanofstudents.utexas.edu/sfl/reports-and-forms.php
- UT CDS: https://reports.utexas.edu/common-data-set/pdf
- CDS 2025–26 F1/F4 (OU, Princeton, UT 2025–26 files)
- NPC fast facts: https://npcwomen.org/news/npc-fast-facts/; College Panhellenics:
  https://npcwomen.org/about/our-members/college-panhellenics-overview/
- Stop Campus Hazing Act: https://www.clerycenter.org/scha-what-you-need-to-know; compliance:
  https://www.campussafetymagazine.com/insights/56-of-colleges-missed-stop-campus-hazing-act-compliance-deadline/177103;
  HazingInfo dataset: https://hub.hazinginfo.org/blog/coming-soon-new-national-hazing-data
