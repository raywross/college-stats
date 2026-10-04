# Greek Life

> Status: **planned**, with **phase 1 built** 2026-10-03 (branch `feature/campus-life`, part of the Campus life
> roadmap group), **phase 4 (national chapter directories) built** 2026-10-04 (branch
> `feature/campus-life-2-fraternities`, fraternities/NALFO/NPHC side; the parallel `feature/campus-life-2-sororities`
> branch did the 26 NPC sororities), and the **phase 2/3 pilot pipeline built** 2026-10-04 (branch
> `feature/campus-life-2-pilot`), with its live run pending ([Phase 2 as built](#phase-2-as-built-pilot)). CDS F1
> (participation) and F4 (housing) are read from `data/cds-records/` into `school.reported.greek`
> (`lib/cds/greek.ts`, display helpers in `lib/cds/greek-display.ts`), merged by `lib/reported-merge.ts` alongside the
> other round-3 blocks. National directories (`scripts/lib/directories/adapters/`, shared infrastructure in
> [campus-directories.md](campus-directories.md)) add council chapter lists the CDS never covers. Shown on the
> profile's Campus life section (`components/school/GreekLife.tsx`; design in [campus-directories.md](campus-directories.md#display-redesign-2026-10-04)),
> Compare's "All the numbers" and "Greek councils present", and Explore filters. Research 2026-09-28: 2025–26 Common
> Data Sets and a per-school deep dive on UT Austin. Findings are verified unless marked *unverified*. Companions:
> [religious-life.md](religious-life.md) (its source tiers, crawl

## Phase 1, as built

Round-3 pattern (`lib/cds/transfer.ts`, `lib/cds/academics.ts`): one module per display spec, wired into
`lib/reported-merge.ts` `RECORD_STEPS`. `school.reported.greek` holds `frat_pct_first_year`, `frat_pct_undergrad`,
`sor_pct_first_year`, `sor_pct_undergrad` (CDS F1, each a 0–1 share, `null` when blank — never 0), and `housing`
(CDS F4, `true` when checked, `null` otherwise, following the E1/E3 convention: a blank box is never read as "no").
F1 is read independently of F4 (the newest document with any F1 answer; separately, the newest document that
answered F.408), so a college can have a newer F4 than F1 or the reverse. Each stored value carries its own lineage
record (F1: the document's fall; F4: the edition) and is registered in `lib/fields.ts` under topic `campus`.

**Decisions this build made that the spec left open:**
- **The data model is `school.reported.greek`** (the round-3 `reported.*` shape), not a separate `school.greek` as
  the original sketch showed — this is CDS F1/F4 data from a college's own record, exactly like transfer admission
  and academics, so it follows their pattern (one lineage record per field, partial coverage, merged by the same
  `RECORD_STEPS` list) rather than inventing a second shape for the same kind of data.
- **Percent-vs-fraction ambiguity ("Howard's 0.61").** The generic CDS reader already resolves most of this
  (`lib/cds-sections.ts` `percentShare`): a model/PDF-form read uses `percentPoints: true`, so a bare number is
  always points, and an Excel cell holds a true fraction. What's left for this module to catch on its own: a
  `greek-f1-ratio` check compares each organization's first-year and all-undergrad percentages (e.g., both
  fraternity columns); if one side is more than 20× the other, it's a likely units mix-up and both values are
  dropped (not merged), rather than guessed at. A real near-zero first-year share next to a normal undergrad share
  (deferred recruitment) is allowed — the check only fires when both sides are nonzero.
- **"Known for: Big Greek life" is not built.** Only 8 colleges carry a Greek-life block in the current round-3
  pilot (7 report an undergrad percentage), far short of a meaningful top decile. `KNOWN_FOR_MIN_REPORTERS = 50`
  (`lib/cds/greek-display.ts`) is the threshold the profile and tests check against; revisit once the pilot scales.
- **Explore's filter** is "Fraternity or sorority participation ≥ X%" at 10/20/30%, matching at least one of the two
  undergrad percentages (never summed, per spec Rules); a college that reports neither never matches, however low
  the floor.
- **Compare** shows the two undergrad percentages and whether fraternity/sorority housing is offered (CDS F4), not
  first-year figures (the spec's "Where it appears" names only the undergrad percentages).

**Not built in phase 1** (still phases 2–4): council breakdowns, member totals, recruitment facts, chapter-level
detail, and anything that crawls an FSL office site.

## Phase 4, as built (national chapter directories)

Built on the shared infrastructure in [campus-directories.md](campus-directories.md) (`scripts/lib/directories/`,
`lib/directories.ts`): one adapter per organization, classified by council, matched to IPEDS unit ids, merged into
each college's `directories` detail table and the `school.directories` summary. This fraternities/NALFO/NPHC track
built the adapters below; the parallel sorority track built the 26 NPC adapters (council `npc`) at the same time.

**What this session actually found**, after checking every organization named in the brief by hand (fetching
robots.txt and the real locator page, not guessing): most national Greek organizations' "find a chapter" pages are
client-rendered (a JavaScript map widget with no server-side data behind the visible HTML), so "readable" by
robots.txt alone didn't mean "scrapable." Six organizations turned out to publish their full roster in a form a
plain HTTP request can read; a seventh (Kappa Alpha Psi) is a genuine block, not a parsing problem. Matching used
IPEDS aliases plus hand-checked answers in `data/directories/matches.json` for renamed/merged colleges (Moravian →
Moravian University, William & Mary, Emory & Henry University, PennWest's campuses, East Texas A&M, …) and for
entries that gave only a bare state/city name with no street address (resolved from the entry's own city/state
field, never guessed) — see the `_why` notes there. Counts after that pass, 2026-10-04:

| Org | Council | Format found | Entries | Matched | Unmatched | Colleges |
|---|---|---|---|---|---|---|
| Sigma Phi Epsilon | `nic` | Ninja Tables widget's own AJAX endpoint (table id + nonce embedded in the page) | 190 | 190 | 0 | 190 |
| Lambda Chi Alpha | `nic` | `window.chaptersMapData` JSON array embedded in the page | 166 | 163 | 3 | 162 |
| Kappa Sigma | `nic` | Same Ninja Tables AJAX pattern, different fields (no city/state given) | 286 | 267 | 19 | 267 |
| Pi Kappa Phi | `nic` | "WP Google Maps Pro" plugin's base64 map data embedded in the page (`categories[0].name` gives Active/Inactive; only Active kept) | 157 | 155 | 2 | 153 |
| Sigma Nu | `nic` | Plain server-rendered HTML table (`<table class="chapters">`, a second `dormant` table left out) | 151 | 149 | 2 | 149 |
| Omega Phi Beta | `nalfo` | Plain HTML table (Entity, College/University, Location); found via NALFO's member-organizations page | 6 | 5 | 1 | 5 |
| Kappa Alpha Psi | `nphc` | **Blocked**: robots.txt doesn't disallow the page, but it returns HTTP 403 to our UA (a bot-protection layer) | — | — | — | — |

The remaining unmatched entries (27 across the five organizations with any) are genuinely unresolvable without
guessing: non-U.S. universities (Canadian chapters several of these fraternities also list), colleges not in this
site's ~1,900, or names ambiguous even with a city (two colleges share "Boca Raton, FL"; "Rutgers, The State
University of New Jersey" doesn't say which of the three campuses). They stay in `data/directories/unmatched/`.

**Named in the brief but not built this round** (so the next session can pick up where recon stopped, rather than
re-discovering the same dead ends):
- **Sigma Alpha Epsilon, Pi Kappa Alpha ("Pike"), Phi Delta Theta, Alpha Tau Omega, Beta Theta Pi, Phi Gamma Delta
  (FIJI), Delta Tau Delta, Kappa Alpha Order, Alpha Sigma Phi** (`nic`): each site is reachable, but its chapter
  list is loaded by a search form, a paginated widget (FacetWP, on Kappa Alpha Order), or a JS map with no visible
  backing data in the page's own HTML — needs a browser, not a plain HTTP client.
- **The other eight NPHC ("Divine Nine") organizations** besides Kappa Alpha Psi: each site returned 200 for its
  locator page, but none of them exposed a static table, embedded JSON, or a discoverable AJAX endpoint the way
  SigEp/Kappa Sigma/Pi Kappa Phi did — likely a client-rendered widget this pass couldn't see into. Delta Sigma
  Theta's locator is on a members-only portal (`members.dstonline.org`), so it's member-locked like NPC/NIC, not
  just hard to parse.
- **NAPA and NMGC** (Asian-interest and multicultural umbrellas): NAPA's site (napa-online.org) didn't respond from
  this environment (DNS/connection failure, matching an earlier recon finding); NMGC's site (nationalmgc.org)
  appears to have been compromised with spam-link injection as of 2026-10-04 and wasn't crawled further. **NALFO**
  itself is just a member-organization list (18 Latino Greek organizations); only one member's own locator (Omega
  Phi Beta) was built this round — the other 17 are untried.
- **LGBTQ+ Greek council**: **Gamma Rho Lambda** is readable (permissive robots.txt, 200 response) but its site is
  a fully client-rendered page builder (GoDaddy Website Builder) with no server-rendered content at all — nothing
  to parse without a browser. **Delta Lambda Phi**: the brief and an earlier recon pass call this blocked
  (`dlp.org` robots.txt disallowing everything); a fresh check today found `dlp.org/robots.txt` now permissive and
  its `/chapters` page returning HTTP 200 — but the page is a Wix site with no server-rendered chapter data either,
  so the practical outcome (no adapter) is the same as "blocked," even though the technical reason has changed
  from "robots disallow" to "nothing to parse." Neither was built; no entries were added to `blocked.json` for
  Gamma Rho Lambda or Delta Lambda Phi, since `Blocked` is for refusals, not unreachable data — see the note in
  [campus-directories.md](campus-directories.md).

**Shared helpers** (`scripts/lib/directories/adapters/`, prefixed `_` so the registry skips them): `_html.mts`
(entity decoding, tag stripping), `_ninja-tables.mts` (the Ninja Tables AJAX pattern SigEp and Kappa Sigma share),
`_wpgmp.mts` (the "WP Google Maps Pro" base64 blob Pi Kappa Phi's page carries).

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
> National chapter directories use the shared infrastructure in [campus-directories.md](campus-directories.md): one
> adapter file per organization, classified by council.

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
  F4 is a single-column list and survives plain PDF text; the F1 grid needs layout-aware text (2026-10-03 inventory:
  Michigan prints one F1 column, Howard's "0.61" means 0.61%). Gender-inclusive housing is not an F4 option; it appears
  only as "Other" text.

## Data model

Phase 1, as built (`lib/types.ts` `ReportedGreek`, under `school.reported.greek` — see "Phase 1, as built" above for
why this shape rather than `school.greek`):
```ts
school.reported.greek = {
  frat_pct_first_year: number | null, frat_pct_undergrad: number | null, // CDS F1, 0–1
  sor_pct_first_year: number | null,  sor_pct_undergrad: number | null,
  housing: boolean | null,                                              // CDS F4; true or null, never false
}
```

Later phases (sketch, not built): a top-level `school.greek` for FSL-sourced facts no CDS carries —
```ts
school.greek = {
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
- **Explore (built):** "Fraternity or sorority participation" filter, ≥ 10/20/30% of undergrad men or women
  (`lib/cds/greek-display.ts` `MIN_GREEK_OPTIONS`), matching either percentage, never summed; colleges that report
  neither never match. **Phase 4 adds** "Has NPHC / Latino / Asian / multicultural / LGBTQ+ Greek life" — one chip
  per council other than NPC/NIC (`GREEK_COUNCIL_FILTERS`), reading `school.directories.greek` from a national
  directory; a college with none listed may still have the chapter (no directory covers every organization yet),
  so this narrows toward, never away from, a college.
- **Profile, the students page's "Campus life" section (built):** fraternity and sorority participation
  `BenchmarkBar`s against the median of reporting colleges (`components/school/GreekLife.tsx`), and whether
  fraternity/sorority housing is offered. Cited, with the CDS edition and fall term. **Phase 4 adds** a "Chapters by
  council" block below it: each council present (CDS's NPC/NIC-style participation plus whatever a directory
  lists) with its chapter count always visible and chapter names behind a native `<details>` disclosure (open
  question 2's recommendation: council totals over a chapter table). A college with neither a CDS answer nor any
  directory listing shows "No fraternity or sorority chapters found in national directories (month, year)" instead
  of the cards — never "none" — and only once at least one directory sweep has run (`latestDirectoryRead`);
  recruitment chips are still phase 3 (FSL reports), not built.
- **Compare (built):** the two undergrad percentages and fraternity/sorority housing. **Phase 4 adds** "Greek
  councils present": every council (NPC/NIC/NPHC/NALFO/NAPA/NMGC/LGBTQ+) a directory or the CDS supports, in a
  fixed order, blank for a college with none.
- **Glossary (built in phase 4):** `npc`, `nic`, `nphc`, `nalfo`, `napa`, `nmgc`, `colony`, cross-linked from
  `greek-life` and `national-directory`.
- **"Known for" (not built):** "Big Greek life" waits for `KNOWN_FOR_MIN_REPORTERS` (50) colleges to report an
  undergrad percentage — 7 do in the current round-3 pilot.

## Phase 2 as built (pilot)
Built 2026-10-04 on the shared pilot engine ([college-reported-data.md](college-reported-data.md#campus-life-pilot-as-built-2026-10-04)).
Per college: the FSL office page, its size, community, and grade reports (followed from the office page by rule, size
reports first, newest first), and its recruitment page.
- **Stored** in the `campus_pages` detail table (`lib/campus-pages.ts` `CampusGreek`): `none_stated` (only when the
  college says it has no fraternities or sororities), `members_total` with its term, `councils[]` (council key from
  `COUNCILS`, the college's name for it, chapters, members, term, each with its page and quote), `housing`
  (chapter houses), `deferred` and `formal_term`. Counts are never summed by the model; a council's numbers are the
  report's own total line.
- **Shown** in `GreekLife.tsx` (redesign 2026-10-04): each council's count leads its row, joined with the chapters
  national lists name for that council (`greekView` in `lib/campus-view.ts`, over `greekCouncils(rows, today)` in
  `lib/campus-pages.ts`); the stated total and members, formal and deferred recruitment, and chapter houses as the
  headline and chips, each with its ⓘ. Members under 10 show as "fewer than 10"; facts older than two years hide.

**Measured without a model (2026-10-04).** The pipeline's fetcher and page gathering were run on the answer key's own
URLs (257 requests): every page the key could read, and whether the key's hand-copied quotes pass our quote check on
the text we read. 274 of 289 quotes on readable pages passed (94.8%); every miss was in the key, not the check
(bracketed completions such as "C[atholic faith]", a computed sum given as a quote, a home-page quote reused on
sub-pages, a meta description). Average extraction input per college: Greek 30,900 characters (max 70,100), faith
11,600, LGBTQ+ 20,800. For this domain: FSL office pages 18 read of 18, report files 15 of 21, recruitment pages 4 of 5,
and 110 pages followed by rule. **UT Austin's size reports can't be read by any polite crawler:**
`studentlife.utexas.edu/robots.txt` (where `deanofstudents.utexas.edu` redirects) has `Disallow: /sfl/downloads/`
for every user agent, which covers all of them (recorded in `data/directories/blocked.json`). The case study's
council table came from those files, so UT needs hand reading or a request to UT. The key has members by council at
only 4 of the 13 colleges with Greek life, chapters by council at 11.

**Cost (estimates until the workflow run measures them).** Per college: discovery 3 Sonnet calls with up to 12
searches, about $0.20–0.25 (searches $0.10 per 10); extraction about 21,600 Haiku input tokens and 3,600 output from the
measured page sizes, $0.04; escalation (assumed one domain in three) $0.03; second checks $0.02. About $0.30–0.34 per
college, $8 for the 25, $570–640 for ~1,890 colleges. Cheapest configuration to test next: free path probes before paid
search, one discovery call for all three domains, and Message Batches for extraction and checks (half price): about
$0.16–0.20 per college, $300–380 for a full run.

**Worth scaling (pending the live run's precision):** the FSL office page (status, councils, chapters, recruitment)
at colleges with Greek life; report files where robots.txt allows them. **Not worth it:** grade reports (chapter GPAs
are out of scope), and per-chapter detail (open question 2).

## Phases
1. **CDS F1 and F4 — built 2026-10-03** (`lib/cds/greek.ts`), reading `data/cds-records/` (populated by `import-cds`
   and the college-reported agent per [college-reported-round-3.md](college-reported-round-3.md)). The F1/FSL
   cross-check isn't built: it needs phase 2's FSL reports.
2. **Pilot of 25 colleges** (shared with religious life, plus Greek-heavy ones such as Alabama, Ole Miss, W&L, an
   HBCU, and a college without Greek life): find FSL offices, parse their reports, measure hit rate and cost.
3. **FSL reports at scale** for colleges where Greek life exists.
4. **National chapter directories** only if needed to cover colleges without FSL reports; ask NPC/NIC for data first.
   The directories this build couldn't read — most NIC fraternities, 7 of the Divine Nine, NAPA, NMGC, most NALFO
   organizations, and the pilot's blocked FSL office pages — are in [campus-sources-later.md](campus-sources-later.md),
   with what each would give and a candidate fix.

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
