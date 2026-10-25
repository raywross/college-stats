# Common App: Deadlines, Requirements, and Application Trends (Requirements Grid, Explore pages, research reports)

> Status: **built** 2026-10-25 (PR #175, `feature/common-app`; see [As built](#as-built-2026-10-25) at the end). Specified
> 2026-10-06 from a survey of commonapp.org (every number in the sections above was measured that day). Common App
> gave its written yes to the [Permission](#permission) letter on 2026-10-25, and the build started that day. Reads alongside
> [cds-application-logistics.md](cds-application-logistics.md) and [cds-test-scores-and-policy.md](cds-test-scores-and-policy.md)
> (the same facts from each college's own Common Data Set, for the few colleges with one on file), feeds the
> application tracker in [saved-lists.md](../product/saved-lists.md), the early-rounds view in
> [early-decision-strategy.md](../product/early-decision-strategy.md), the aliases table in
> [aliases.md](../school-identity/aliases.md), and the [cycle watch](../ideas/cycle-watch.md) idea.

## Question it answers
*When are this college's deadlines, and does it have Early Decision II? What does it cost to apply, and will it take
a fee waiver? Do I need an essay beyond the Common App one, a writing supplement, two teacher recommendations, a
mid-year report? Does it want test scores this cycle?* And, for the trends pages: *how is this application season
going nationally, and in my state, long before federal data says?*

## Why
The site has these facts for almost nobody. Deadlines and early rounds come only from the Common Data Set records of
the round-3 agent, which today cover a handful of colleges; the test policy comes from IPEDS, which describes the
cycle before last; and nothing anywhere says whether a college wants an essay, a supplement, or recommendations.
Common App publishes all of it, for every member, for the cycle that is open now, in one dated document. About half
of the site's colleges are members.

| Measured 2026-10-06 | Count |
|---|---|
| Colleges on the site | 1,893 |
| With a regular deadline on file (CDS) | 9 |
| With an early-round record on file (CDS) | 8 |
| With a current-cycle test policy on file (CDS) | 10 |
| Common App members on the Explore site | 1,174 |
| Members with an IPEDS id, in a sample of 80 pages | 75 |
| Of those, in the site's 1,893 | 69 |
| Implied members on the site | about 1,000 |

## Source
Four things on commonapp.org, in order of value. None is an API; the first two are public files, the third is a set
of PDFs, the fourth an embedded Tableau Public workbook.

### 1. The Requirements Grid (per member, the current cycle)
`https://content.commonapp.org/Files/ReqGrid.pdf`, titled "2026-27 Requirements Grid", stamped "Updated: 09-25-2026"
on every page, 55 pages, one row per member that takes first-year applications (about 1,128 rows). Columns, with the
grid's own notes (page 55):

| Column | Values | Note |
|---|---|---|
| School type | Coed, Women, Men, Coordinate | note 1 |
| ED, EDII, EA, EAII, REA | a date, or blank when the round is not offered | |
| RD / Rolling | a date, or "Rolling" | |
| Fee, US and Int'l | dollars; `$0` is common | note 2: different fees for international applicants are real |
| Common App fee waiver | Accepted, U.S. only, Not Accepted, blank | |
| Personal essay | Y when the Common App essay is required | note 3 |
| Courses & Grades | Y when the self-reported transcript is required | note 4 |
| Portfolio | SR (SlideRoom), COL (college's own system), blank | note 5 |
| Writing | Y when a writing supplement is required | note 6 |
| Test policy | A always required · F flexible · I ignored · N never required · S sometimes required | note 7; applies to US citizens and permanent residents of traditional age |
| SAT/ACT tests used | free text ("SAT without essay or ACT with science"), "None", or "See website" | "See website" means too complex for the cell |
| English proficiency | C, D, I, P, T, N codes (Cambridge, Duolingo, IELTS, PTE, TOEFL, none) | for international applicants |
| TE, OE | number of teacher and other evaluations required | note 8 |
| MR, CR | Y when a mid-year report / counselor recommendation is required | note 8 |
| Saves forms | Y when recommendations are kept after matriculation | |

The grid is a layout PDF, not a table: a column parse by the header words' x-positions (pdfplumber) recovered 1,080
rows in the survey, with the Writing column mis-assigned (its "Y" lands in a neighbor; the fix is a narrower column
window). Names, not ids: 1,060 of the 1,080 parsed names match an Explore page title exactly; the rest differ by a
hyphen or a campus suffix ("University of Michigan- Dearborn", "Marian University - Indiana") and need the alias
table or a hand map. What the parsed rows said, as a feel for the data (approximate, from the probe parse):

| Item | Rows |
|---|---|
| Offer Early Decision | 231 (ED II: 127) |
| Offer Early Action | 435 (EA II: 79; restrictive: 5) |
| Regular deadline is a date | 495; rolling 584 |
| Fee is $0 | 581 of 1,080 |
| Fee waiver: Accepted · U.S. only · Not Accepted · blank | 521 · 86 · 26 · 444 |
| Personal essay required | 360 |
| Courses & Grades required | 82 |
| Portfolio: SlideRoom · own system | 63 · 17 |
| Test policy: N · S · F · A · I | 529 · 316 · 146 · 56 · 18 |
| Teacher evaluations: one · two | 179 · 51 |
| Counselor recommendation · mid-year report | 246 · 201 |

### 2. The Explore pages (per member, the join key and small facts)
`https://www.commonapp.org/explore/<slug>` is a Gatsby site, so each college also exists as
`https://www.commonapp.org/page-data/explore/<slug>/page-data.json`, and `https://www.commonapp.org/sitemap-0.xml`
lists all 1,174 slugs. The record has `field_su_ipeds` (the IPEDS unit id: the join to the site's `unit_id`),
`field_member_id`, the address with latitude and longitude, admissions phone and email, first-year and transfer
admissions and financial-aid URLs, a DACA aid page (183 members), a transfer-guarantee page (83), social links,
`field_su_alternate_names` (860 members; "VU, Vandy", "K-State, KSU", "Dub Dub U"), need, merit, and international aid
flags (`field_mp_fac_*`), the first-year flags (`field_su_ff_fy_*`: personal essay, test optional, fee waiver,
self-reported scores, recommendations required), MSI filters, setting, control, and size band. A single static query,
`/page-data/sq/d/2437817458.json` (9.4 MB), holds every member's record **except** the IPEDS id, so the join needs
one request per member. The pages also carry marketing text, a student quote, photos, and a logo, none of which this
spec takes (see [Not taken](#not-taken)).

### 3. The reports (national and state aggregates, months ahead of federal data)
The reports index is itself a static query, `/page-data/sq/d/146375732.json` (61 entries with title, date, type, and
PDF link). The series that matter:

| Series | Cadence | What it holds |
|---|---|---|
| Deadline Updates | November to March, two weeks after each 1st | Applicants and applications through that date vs the prior season, by race/ethnicity, first-generation, fee-waiver eligibility, ZIP-code income, state, international, member type and selectivity, test-score reporting |
| End-of-Season report | August (2025–26's on 2026-08-20) | The full season with a decade of context: the same cuts, plus applications per applicant, deadline type (ED/EA/RD), in-state vs out-of-state application behavior, and appendix tables by applicant state and by member state × control and × selectivity |
| Research briefs | a few a year | Early admission (2023: 13% of applicants used ED, 53% EA, with the demographic gaps), test-optional behavior (2021), applications per applicant (2022), first-generation definitions (parts 1–5), transfer, independent students, STEMM persistence |
| Innovations Guide, Impact report | yearly | Program numbers: Direct Admissions (215 members in 2025–26, 234 for 2026–27, 820,000 eligible students, 42 states) |

The key-findings pages are text ("1,527,328 distinct first-year applicants applied to 1,146 member institutions, an
increase of 2%"; "7.06 applications per applicant"; "Mississippi was the fastest-growing state, 28%"). **Every figure
and every appendix table is an image** inside the PDF, so state-level numbers need the vision-model route the
college-reported agent already uses for flattened PDFs, with the usual checks.

### 4. The state dashboard (Tableau Public)
"State-level application trends and insights" embeds `CommonApp2024StateReport/StateReports` from the Tableau Public
profile `common.app.research`, covering the 2023–24 season for all 50 states, DC, the armed forces, and territories.
The workbook's metadata says data access is allowed, so its underlying rows can be downloaded as a crosstab; one
season only, so far.

### Things that exist but are not reachable from a script
- **Direct Admissions participating colleges** (234 for 2026–27): the list is on a Salesforce support page that
  renders only in a browser. A per-college flag needs a browser session once a year, or the list from Common App.
- **Essay prompts per college** ("writing requirements"): the same kind of page. The grid's essay and writing
  columns cover the yes/no.

## Permission
Common App's terms of use (last updated 2025-10-24) define "the Solution" to include **www.commonapp.org** and the
content on it, grant a "personal, revocable, limited… non-commercial" license, forbid "data mining", "page-scrape",
"bots", and derivative works, and forbid linking "to any page of or content on the Solution other than the URL
located at http://www.commonapp.org". Its robots file allows ordinary crawlers but disallows AI-training agents. The
grid and the reports are public downloads meant for counselors and the press, but they are licensed under the same
terms, and the site has paid tiers planned ([commercialization.md](../product/commercialization.md)).

So the first unit of work is a letter, not code. The ask, in one page:

1. **What** we would use: the Requirements Grid's columns, the Explore record's IPEDS id, alternate names, and aid
   flags, headline figures from the reports, and the state workbook's rows.
2. **How** it would appear: per-college facts on that college's page and in filters, each cited "Common App,
   Requirements Grid, updated {date}" in the ⓘ popover with a link to commonapp.org; national lines on the trends
   pages cited to the report by name and date; never bulk re-export of their fields through the
   [data API](../product/data-api.md).
3. **What we would not do**: touch the application platform or any signed-in page; copy marketing text, quotes,
   photos, or logos; scrape more than one request per member per refresh.
4. **What we offer**: attribution on every value, a link from each college's card to the college's own application
   page and to commonapp.org, removal of anything on request, and a copy of the parsed grid back to them if useful.
5. **Who to ask**, in order: the media and research inquiry form (`/contact-media`, "reporter or researcher looking
   to speak to someone at Common App"), copying Emma Steele (`esteele@commonapp.org`, the press contact printed on
   every research report); the Data Analytics and Research team, whose vice president is Mark Freeman (co-author on
   the reports since 2021) and whose corresponding author on the 2025–26 End-of-Season report is Rodney Hughes; the
   partner form (`/contact-partner`, "education services provider or organization interested in partnering"). The
   research Call for Proposals address (`researchproposals@commonapp.org`) is for academic studies on their
   de-identified warehouse, not for this.

Until the answer: the site keeps citing report headline figures the way it cites any published report (a number, the
report's name and date), builds nothing against the grid or the Explore pages, and keeps the survey's parsers out of
the repo. If the answer is no, deadlines and requirements come the slow way: the college-reported agent reads each
college's own admissions page ([college-reported-data.md](../college-reported-data.md)), where the same facts are
published by the college itself.

## Store
A new source `common-app` in `lib/fields.ts` (label "Common App Requirements Grid", vintage = the grid's cycle and
"Updated" stamp, from `meta.json` like every source), and a block per member:

| Field | What | From |
|---|---|---|
| `apply.common_app.member` | true; absent for non-members | Explore |
| `apply.common_app.member_id`, `.slug` | Common App's own id and page slug (stored, not displayed, no link) | Explore |
| `apply.common_app.cycle`, `.updated` | "2026-27", "2026-09-25": the grid's stamp, kept with the values | Grid |
| `apply.deadlines.{ed, ed2, ea, ea2, rea, regular}` | ISO dates; `regular` = "rolling" when the grid says so | Grid |
| `apply.fee.{us, international}` | dollars | Grid |
| `apply.fee_waiver` | `accepted` · `us_only` · `not_accepted` · null (blank) | Grid |
| `apply.essay_required`, `.courses_grades_required`, `.writing_supplement` | booleans; null when blank | Grid |
| `apply.portfolio` | `slideroom` · `own` · null | Grid |
| `apply.test_policy` | `A` · `F` · `I` · `N` · `S`, with `tests_used` and `english_tests` as text and codes | Grid |
| `apply.recommendations.{teacher, other, counselor, mid_year_report}` | counts and booleans | Grid |
| `aid.international_offered` | boolean from `field_mp_fac_international_fa` (439 Yes, 108 No, the rest unanswered) | Explore |
| `links.transfer_guarantee`, `links.daca_aid` | URLs on the college's own site | Explore |
| aliases rows, source `common-app`, weight 2 | split on commas as the IPEDS values are | Explore |

Rules that the lineage guards enforce as usual: every displayed value cites `apply.*` through `citeField`, so the
popover reads "Common App Requirements Grid, 2026-27 cycle, updated September 25, 2026"; no page types a cycle or a
date; the cycle label comes from `apply.common_app.cycle`.

**Newest wins** ([quiet sources rule](../college-reported-data.md)): where a CDS record and the grid both give a
deadline, fee, or test policy for the same cycle, the value with the later as-of date shows (the grid's stamp against
the CDS edition's publication date), the other in the popover. The IPEDS test policy stays the federal value in
`admissions.federal_tests`, as the CDS build already arranged. The grid's codes map to the site's vocabulary:

| Grid | Site term | Note |
|---|---|---|
| N | test-optional | never required |
| I | test-blind | scores ignored |
| A | required | |
| F | required, flexible | the college chooses among tests |
| S | required for some | by program, major, or applicant type; `tests_used` says which |

**Keep history?** Yes, by cycle: every grid edition is stored (`data/common-app/<cycle>-<updated>.json`), and the
diff between editions is exactly the [cycle watch](../ideas/cycle-watch.md) change table (test policy, early rounds,
deadlines, fee and waiver). One edition a year stays after the cycle closes; the in-season refreshes overwrite each
other once the next edition exists.

### National and state figures
A reviewed file, `data/trends/common-app.json`, with one row per season per measure (applicants, applications,
applications per applicant, members, growth by fee-waiver eligibility and first-generation status, share reporting a
test score, applicants by state), each with the report name, date, page, and a quote, typed from the key-findings
text or extracted from the appendix table images by the agent's vision route with a second-pass check. Registered as
source `common-app-reports` with the report date as its vintage.

## Display
- **Profile, Admissions page: "What it takes to apply"**, one card: the rounds offered with their dates ("Early
  Decision November 1 · ED II January 1 · Regular January 1"), fee and whether a fee waiver is taken, the essay,
  supplement, and transcript lines, recommendations ("two teacher evaluations, a counselor recommendation, and a
  mid-year report"), and the test policy with `tests_used` when it is not "See website". The card names the cycle
  from lineage and shows "Rolling" as a word, not a date. After a cycle ends and before the next grid, the card says
  "last cycle" in the same place, from the same field.
- **Explore**: filters "No application fee", "Takes the Common App fee waiver", "Offers Early Decision" (and ED II),
  "Offers Early Action", "No essay beyond the Common App", "Test-optional this cycle" (grid N or I); a "Common App"
  chip is **not** shown (quiet sources: the fact is the deadline, not the vendor).
- **Saved lists and the application tracker** ([saved-lists.md](../product/saved-lists.md)): deadline columns and the
  requirements checklist per college, which the tracker today leaves for the student to type.
- **Early decision strategy** ([early-decision-strategy.md](../product/early-decision-strategy.md)): "offered, and
  when" for every member, so the ED view is not limited to colleges with a CDS on file.
- **Aliases**: "Vandy", "K-State", "Dub Dub U" in search, weighted like Wikidata's.
- **Trends hub and state pages**: a "This season on the Common App" block (applicants, applications per applicant,
  growth for fee-waiver-eligible and first-generation applicants, the share reporting a score) and, on each state's
  page, that state's applicant count and growth, each cited to the report; the series by season once two End-of-Season
  reports are on file.

## Sync
`npm run sync-common-app`: download the grid (keep the PDF under `data/common-app/`), parse by column window, join
names to IPEDS ids through the Explore records (one request per member, cached by slug, refreshed yearly), write the
block, and print every unmatched name for the hand map. In season the grid is refreshed monthly (its stamp changes;
the sync is a no-op when the stamp is unchanged); the Explore join yearly, in August when membership changes. The
reports file is hand-reviewed per release, like `data/overrides.json`.

## Checks
- Parse: the row count within 2% of the grid's own count of members (the sitemap's first-year members minus the
  international ones the site doesn't carry); every date within the cycle's window (September of the stamp year to
  August of the next); fees within $0–$250; test policy one of the five codes; a row whose name matches no Explore
  title and no alias goes to the unmatched list, never to a guess.
- Join: IPEDS ids found on Explore must exist in `data/schools.json` or be logged as not carried (community colleges,
  the 66 non-US members); a title match that lands on a different id than last cycle is a change for review.
- Lineage: `npm run check:lineage` finds every `apply.*` field; the hard-coded-year guard applies to the card.
- Fixture tests: the parser on three saved grid pages (a wrapped name, a "See website" cell, a Coordinate college);
  the code map; the newest-wins choice against a CDS record with an earlier and a later date.
- A test asserts the site never links to an Explore page or any commonapp.org URL other than the homepage.

## Not taken
Marketing text, student quotes, photos, logos, and the "Why apply" copy on the Explore pages (the colleges' and
Common App's words); admissions staff emails (stored for a future contact card only if the owner wants it, never
published without the college's own page saying the same); the essay prompts page and the Direct Admissions list
(browser-only, see above); anything from the application platform or a signed-in page.

## Complexity
Medium: one PDF parser with fixtures, one join with a hand map, a block of fields and a source, one profile card, six
filters, two product hooks, and a reviewed figures file. The permission step is the long pole and sets the start date.

## Open questions
1. **Ask or wait?** Recommendation: ask now, with the one-page letter above; the answer sets whether anything else
   here is built. If the owner would rather not ask, the agent route for deadlines is the fallback and this spec is
   parked.
2. **Explore join or grid only?** The grid alone gives names; the join needs 1,174 small requests a year. If Common
   App would rather send a member list with IPEDS ids, take that instead.
3. **Show the international fee?** The grid has it for every member; the site's international visitors are a small
   share. Recommendation: in the popover, not the card.
4. **Direct Admissions flag.** Worth a yearly browser pass to mark the 234 members? Recommendation: ask Common App
   for the list in the same letter; a flag with no date is worse than none.

## As built (2026-10-25)
Built on `feature/common-app` (PR #175) the day Common App answered the letter, in six units on their own branches
plus one integration fix, from a brief kept outside the repo (`~/Projects/college-stats/common-app-build/`): U1a grid
parser, member reader, name join, `sync-common-app` (opus); U1b types, registry, lineage, `merge-common-app`,
newest-wins, guards (opus); U2 the profile card (sonnet); U3 Explore filters (sonnet); U4 planner hooks (sonnet); U5
the trends block (sonnet). Where this section and the sections above disagree, this section is what runs.

**Sources and files.** One source `common-app` (label "Common App", publisher Common App, Inc., url the homepage, the
only commonapp.org URL the site may link; a guard test enforces it) with two vintages: `common-app-grid` ("2026-27
cycle, updated September 25, 2026", from the edition file) for `apply.*`, and `common-app-members` ("Member pages read
October 25, 2026") for the Explore-derived fields and aliases. The ⓘ reads "Common App, 2026-27 cycle, updated
September 25, 2026". Editions live at `data/common-app/grid/<cycle>_<updated>.json` with the PDF beside them;
`data/common-app/members.json` caches the 1,177 member pages; `data/common-app/name-map.json` is the hand map.
`apply.common_app` also carries `retrieved`, the day the PDF was read. Non-members never list Common App in a footnote
(`sourcesForFields` skips a per-college source the school has no value for).

**The grid, measured.** 1,128 rows (55 pages, stamp 09-25-2026). 1,059 members are in the dataset, 1,025 with a grid
row and 34 without (transfer-only, or not yet joined); 67 members have no IPEDS id on Explore and 50 more are not
colleges the site carries. Eight row names matched nothing and stay in `unmatched`: Andrews University, Jack Kent
Cooke Foundation (not a college), Morris Brown College, North Central University (MN), Wiley University (no Explore
record), and three rows all named "Siena University". Two Explore records and two grid rows share Oberlin's IPEDS id
(204501); the first (Arts and Sciences) is kept and the merge warns. International aid: 410 yes, 89 no. Links kept:
75 transfer guarantees, 165 DACA aid pages; 6 skipped because they pointed off the college's own site. 1,166 alias rows.

**Blank means no.** The grid prints Y only where something is required, so a blank essay, Courses & Grades, writing
supplement, or saves-forms cell is stored as `false`, not null; null appears only without a grid row. The 2026-27 grid
carries **no writing-supplement marks at all** (checked against the PDF text), so the card shows that line only when
true and the "No essay beyond the Common App" filter was not built.

**Newest wins, as built.** Only the grid's **test policy** is written into `admissions.test_policy`; deadlines and
fees stay in `apply.*` and the display layer reads them first (the card, the Applying box, the "No application fee"
filter, the planner's deadlines). The as-of date of a CDS statement is its edition's publication date, taken as
January 1 of the edition's second year ("2025–26" → 2026-01-01), never the day Quad read the document; the grid's
entering fall must also be ≥ the CDS cycle. The grid's policy is applied inside the CDS test step
(`applyNewestTests` → `applyGridPolicy`, read from `school.apply`), so `merge-reported`, `sync-data`,
`merge-common-app`, and the CDS tests' re-merges all land on the same bytes and `restoreFederalTests` undoes it. Code
map as specified (N → test-optional, I → test-blind, A and F → required, S → required for some; the card says
"flexible" for F). Result: the grid supplies the policy at 1,025 colleges, 153 of them over a same-cycle 2025–26 CDS
policy (owner-confirmed), none beaten by a newer CDS. Against the dataset before this build, **607 colleges changed
policy**: 241 test-optional → required for some (code S), 151 test-blind → test-optional (N), 105 test-optional →
required (90 F, 15 A), 41 test-blind → required for some, 26 test-blind → required, and smaller groups. The
test-optional trend files (`data/history/trends/test-optional.json`, `states.json`) were rebuilt and follow; the
state test-optional shares fall accordingly. Selectivity tiers were rebuilt and none moved. The F → required and
S → required-for-some mappings drive most of the shift and are the thing to revisit if families report colleges
shown as requiring tests that admit without them.

**Display, as built.** The card "What it takes to apply" (block id `apply`, before "Applying") renders nothing for a
non-member; its regular deadline beats the CDS one by the same edition rule, and the Applying box then drops its
line while the card shows the CDS date muted, cited to its own field. Glossary terms added: `writing-supplement`,
`courses-and-grades`, `mid-year-report`, `counselor-recommendation`, `teacher-evaluation` (`early-decision-ii`
already existed). Explore gained an "Applying" group of four chips: Takes the fee waiver (accepted or U.S. only),
Early Decision, ED II, Early Action (EA, EA II, or REA); "No application fee" reads the grid's U.S. fee first;
"Test-optional this cycle" is the existing policy filter, which the newest-wins already feeds; no "Common App" chip.
The planner's `deadlineFor` takes the grid's dates first ("Rolling" as a word, no date), the CDS month/day second;
requirements lines for the essay, writing supplement, recommendations, Courses & Grades, fee waiver, and the platform
("Takes the Common App"), each cited; `common_app` is offered as a platform only for members; rounds offered come from
the grid for every member; the stored plan schema is unchanged. On /trends, "This season on the Common App" (after the
studies) shows five figures from `data/trends/common-app.json`: 2 End-of-Season reports (2025–26 dated 2026-08-20,
2024–25 dated 2025-08-13), 16 rows (8 measures × 2 seasons), each with report, page, and a verbatim quote, cited by
report name and date; state figures are images in the PDF and are left out ("state figures to come"). No separate
`common-app-reports` source: the rows cite `common-app` with the report date as the year. The state pages' block and
the international fee (stored, not shown) were not built.

**Sync.** `npm run sync-common-app` (`--grid-only`, `--members-only`, `--refresh-members`, `--limit`, `--dry-run`)
is a no-op when the PDF's "Updated" stamp matches the newest edition; `npm run merge-common-app` applies the committed
files, re-runs the reported merge, refreshes meta and aliases, and writes nothing on a lineage failure; `sync-data`
applies the block before its reported merge. `npm run verify` includes `check:common-app-trends`.

**Open questions, closed.** 1: asked; Common App said yes (2026-10-25). 2: the Explore join, 1,177 cached requests a
year. 3: the international fee is stored and not shown. 4: no Direct Admissions flag; the owner asks Common App for
the list. Not built: essay prompts, the Direct Admissions list, state-level report tables.
