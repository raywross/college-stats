# Religious Life

> Status: **planned**, with **phase 1 built** (2026-10-03, branch `feature/campus-life`): IPEDS affiliation for every college
> with NCES's own label, an Explore filter by faith family, a Compare row, a "Religious life" block in the profile's
> Campus life section with the CDS answers we already read (C7, H14, F2), "Known for: Faith-centered" from C7, and
> glossary entries. See [Phase 1 as built](#phase-1-as-built). **Phase 3 (national directories) built** 2026-10-04,
> branch `feature/campus-life-2`: six adapters, CCCU membership, the "Faith communities" list, and an Explore
> "has a [tradition] community" filter. See [Phase 3 as built](#phase-3-as-built). The phase 2 pilot pipeline is built
> and run on the 25 pilot colleges ([Phase 2 as built](#phase-2-as-built-pilot)); phase 4 (per-school rollout) is still
> **planned**. Research 2026-09-28: Scorecard API probe, 2025–26 Common Data
> Sets, and a per-school deep dive on UT Austin. Findings are verified unless marked *unverified*. Companions:
> [greek-life.md](greek-life.md), [lgbtq-life.md](lgbtq-life.md). Per-school collection shares the engine in
> [college-reported-data.md](college-reported-data.md#campus-life-sources).

## Goal
Answer, with cited sources: *Is this college religious? How much does faith shape it? Which faith communities are on
campus, and how big are they?* For example: "UT Austin is secular, has a Hillel and a Chabad house, and a
Jewish community Hillel estimates at 2,750 undergrads."

## The core problem
No federal survey asks students their religion, and most colleges (all public ones we checked) don't record it. So
most of what a student wants to know is **spread across many sites run by different organizations, and those sites
disagree**. A college can have 10–20 relevant sources: its CDS, its institutional-research reports, its student-org
directory, a campus ministry office, and a site for each faith group (Hillel, Chabad, Newman Center, Muslim Students
Association, InterVarsity, …).

## Case study: UT Austin (probed 2026-09-28)

| Source | What it says | Format / access | Use |
|---|---|---|---|
| IPEDS / Scorecard | No religious affiliation (public) | API | Affiliation = none |
| UT Institutional Reporting | Nothing on student religion | — | Public universities generally don't collect it |
| UT CDS 2025–26 (Box link from reports.utexas.edu) | C7 "Religious affiliation/commitment" row, H14 "Religious affiliation" aid, F2 "Campus Ministries" | PDF. **Checkmarks are extracted as a separate column of ✔ with no labels**, so plain text can't tell which box is checked | Layout-aware text (pdf.js x/y) recovers the column on every PDF tested in the 2026-10-03 inventory; F2 is a single-column list and survives plain text. No vision call needed ([round 3](college-reported-round-3.md)) |
| Hillel International College Guide (hillel.org/college/university-of-texas-austin) | **2,750** Jewish students, **6.4%** of 42,855 (that's the IPEDS undergrad count, same as ours) | HTML behind a Cloudflare bot check (403 to scripts). `robots.txt` allows crawling with `Crawl-delay: 10` | Estimate, reported by the campus Hillel |
| Texas Hillel (texashillel.org) | "More than **4,000** Jewish students" | HTML | Scope unclear (may include grad students or other Austin colleges) |
| Chabad at UT (jewishlonghorns.com on chabad.org templates; its HornsLink listing) | UT Jewish population "around **5,000**"; 50–100 students at a weekly Shabbat meal | HTML | Estimate by the group itself; age of the claim unknown |
| HornsLink (Campus Labs Engage) org directory | **76 active orgs** in "Religious/Spiritual": Hillel, Chabad, Catholic council, MSA, Hindu YUVA, Sikh Students, Orthodox Christian Fellowship, Baháʼí, and ~50 Christian groups | JSON search API, but UT's `robots.txt` **disallows `/engage/api/`**. Org pages and a sitemap are allowed | Which faith communities exist, and how many groups each has |
| UT course catalog, "Religious Organizations" page | Describes denominational groups near campus | HTML | Supplementary |

**Lesson:** three sources give three Jewish-population numbers (2,750 / 4,000+ / ~5,000), none official, each
measuring something different. The site must show *who says so and what they're counting*, never silently pick one.

**Contrast, religious private colleges publish official figures:** Baylor's Institutional Research "Baylor Trends"
reports enrollment by religious affiliation and Baptist percentage, fall 2018–2024 (40+ identities). Notre Dame's
admissions site says ~80% of undergrads are Catholic. These are the only places a real denominational breakdown
exists, and an agent can find them.

## Source tiers
Every value carries its tier. Tiers never mix in one number, and only tier A feeds ranks, medians, and comparisons.

| Tier | Kind | Examples | Shown as |
|---|---|---|---|
| **A: official statistic** | Federal data, CDS, the college's own IR reports | IPEDS affiliation, CDS C7/H14, Baylor Trends | Normal cited value |
| **B: official directory** | The college's registered-org list or campus-ministry office | HornsLink "Religious/Spiritual" | Presence and group counts ("12 Christian groups") |
| **C: organization estimate** | A faith organization's claim about the campus | Hillel 2,750; Chabad ~5,000 | "Hillel estimates 2,750 Jewish undergrads (2026)", always named and dated, never ranked |
| **D: national directory** | A national organization's list of its campus chapters | Hillel, Chabad on Campus, Newman/FOCUS, InterVarsity, Cru, Chi Alpha, RUF, Baptist Student Ministries, OCF, MSA, LDS Institutes, Hindu YUVA | Presence only ("Has a Chabad house") |

## Reading organization estimates (needs more research)
Tier C numbers aren't wrong because they disagree. They answer different questions. The UT case shows three kinds:

| Source | Level | What it likely counts | Likely bias | Why |
|---|---|---|---|---|
| Hillel International College Guide (2,750, 6.4%) | National | Estimated Jewish **undergrads**, divided by the IPEDS undergrad count | Conservative | Reported by each campus Hillel but published in one format across ~500 campuses; largely built from students who have engaged with Hillel at least once. A survey of a random sample of all students found lower numbers than Hillel's on several campuses, so "conservative" is relative (see eJewishPhilanthropy critique). |
| Texas Hillel (4,000+) | Local | Jewish students the local Hillel knows about; may include grad students | Higher, more local detail | Local staff know their community (contact lists, events, the Jewish community in town). Scope is rarely stated. |
| Chabad at UT (~5,000) | Local | **Participation reach**: students who have come to anything, including ones who never touch Hillel | Highest; overlaps the others | Chabad counts engagement, not identity. Some students it reaches aren't in Hillel's lists, but many are in both. |

The three **can't be added up** (they overlap) and **can't be averaged** (they measure different things). Show them
side by side as a range, each with its source and what it counts.

### Local first, national fallback
Per college and tradition:
1. **Local official source** (the college's own reports or chaplaincy office), if one exists.
2. **Local organization** (the campus Hillel's own site, the campus Newman Center, …). Most detailed for that campus,
   but the scope is often unstated.
3. **National organization's figure for that campus** (e.g. Hillel International's guide). Consistent method,
   comparable across colleges, conservative.
4. **Presence only** (tier D), when no one publishes a number.

The headline is the first source found in that order. The others appear under "Other estimates" with what each
counts. **Only step 3 figures are compared across colleges** (filters, "among colleges with Hillel estimates"),
because they use one method everywhere. A local figure next to a national one at another college would compare
different things.

### What each estimate record needs
`publisher` (organization and level: local/national) · `measure` (population estimate / members / participants /
weekly attendance / class enrollment) · `population` (undergrads / all students / several campuses) · `method` as
stated (engagement list, survey, informed guess, unknown) · `as_of` (the claim's date; many pages are years old) ·
quote and URL. Numbers with unknown measure or population are kept but labeled "scope not stated."

### Each tradition counts differently (research questions)
Hypotheses to confirm in the pilot, not verified facts:

| Tradition | Local sources | National sources | What their numbers usually mean |
|---|---|---|---|
| Jewish | Campus Hillel, Chabad house | Hillel International guide; Chabad on Campus directory (presence) | See above: identity estimate vs. participation. Only tradition with a national per-campus population estimate? |
| Catholic | Newman Center / Catholic student center, campus ministry office (at Catholic colleges) | Catholic college affiliation (IPEDS), FOCUS missionary campuses, Newman center lists | Mass attendance or "registered students"; at Catholic colleges, sometimes an official % Catholic (Notre Dame ~80%). |
| Latter-day Saint | LDS student association, Institute of Religion near campus | Church's Institute locator | Institute **class enrollment**, a real count, possibly not public per campus. BYU schools are affiliated (code 94). |
| Evangelical / Protestant | Cru, InterVarsity, Chi Alpha, RUF, Baptist Student Ministries, local churches' college groups | Each ministry's chapter locator | Weekly large-group attendance or "students involved"; many small groups; high overlap between groups. |
| Muslim | MSA, Muslim chaplain / prayer space | MSA National (presence), *unverified* | Friday prayer attendance or members; rarely published. |
| Hindu, Sikh, Buddhist | Hindu YUVA / Hindu Students Council, Sikh student associations, Buddhist groups | Their national networks, *unverified* | Mostly presence; numbers rare. |
| Orthodox Christian | OCF chapter | OCF directory | Presence; small numbers. |
| Nonreligious | Secular Student Alliance chapter, humanist chaplaincy | SSA directory, *unverified* | Presence. Nonreligious students are a large group nationally but almost never counted per campus. |
| Multi-faith (private colleges) | Office of Religious/Spiritual Life, chaplaincy | — | Often lists every recognized group; sometimes the college's own survey results. Best single local page where it exists. |

**Research to do before building:** for each tradition, find 5–10 campuses with published numbers and write down
what's counted and how (the table above); decide which traditions get numbers and which only presence; check
whether any other national body publishes per-campus figures the way Hillel does; decide how old a claim can be
before it's hidden (proposal: 3 years).

## Measures
1. **Religious affiliation** (tier A, all colleges): IPEDS IC `RELAFFIL`. Scorecard's `school.religious_affiliation`
   agrees (BYU = 94, Benedictine = 30). **685 of our 1,893** colleges are affiliated, all private nonprofit. Labels
   come from the IPEDS dictionary; code and label are both stored.
2. **Faith intensity** (tier A, CDS publishers): C7 religious commitment in admissions (four levels), H14 aid by
   religious affiliation, and optionally CCCU membership (voting members hire only faculty who profess Christian faith;
   >150 U.S./Canada) and the share of degrees in theology (IPEDS completions, CIP 39 + 38.02).
3. **Student religious make-up** (tier A, where published): denomination shares from the college's own reports.
   Expected mostly at religious colleges; the pilot measures how many.
4. **Faith communities present** (tiers B + D): per tradition (Jewish, Catholic, Protestant/evangelical, Orthodox
   Christian, Latter-day Saint, Muslim, Hindu, Sikh, Buddhist, other), whether there's a group, which ones, and a link.
5. **Community size estimates** (tier C): Hillel's Jewish-student estimate and other group-reported sizes, with date.

## Scaling: turn the crawl around
> The shared infrastructure for national directories (adapter contract, crawler, matcher, merge, credited display) is
> built: [campus-directories.md](campus-directories.md). Each directory below is one adapter file.

Crawling 10–20 sites for each of 1,893 colleges is ~30,000 sources. Most can be replaced with one read per national
directory:
- **National directories (tier D): one adapter each, covering every campus.** ~15 directories × one crawl yields
  presence for all colleges. Each entry names a campus in free text ("University of Texas, Austin"), matched to a
  `unit_id` by name + city + state. Matches below a confidence threshold go to review. Stored in
  `data/directories/<org>.json` with the date crawled.
- **Per-school sources: 3–5 per college, found once and saved.** CDS, IR reports (religious colleges), the org
  directory, and the college's Hillel College Guide page. The discovery pass
  ([college-reported-data.md](college-reported-data.md)) records their URLs, and later runs re-fetch only changed
  documents (conditional GET).
- **Estimate:** ~15 directory crawls + ~6,000–9,000 per-school documents on the first run, then a small fraction per
  refresh. Refresh yearly (directories, estimates) and per CDS edition.

### Org directories
Many colleges use a hosted student-org platform. Campus Labs (now Anthology) says it serves 1,400+ colleges across
its products; Engage is its org directory. CampusGroups and Presence are the other large platforms. One adapter per
platform covers many colleges. On Engage, the category taxonomy is set per college (UT's has 14 categories, including
"Religious/Spiritual"), so category mapping is per college, and group names are classified to a tradition by a
cheap model with a keyword pre-pass.

## Access rules (apply to both specs)
- Obey `robots.txt` and crawl delays. Identify our crawler with a contact URL. **Never get around bot protection**
  (Cloudflare challenges, logins). Blocked sources are requested from their owner instead.
- **Ask for data partnerships first where one organization covers many campuses:** Hillel International (College
  Guide estimates), Chabad on Campus, Anthology (Engage directories). One agreement replaces hundreds of scrapes and
  settles licensing.
- Store facts, dates, URLs, and short supporting quotes only, not copies of pages. Always link back.

## Data model (sketch)
```ts
school.religion = {
  affiliation: { code: 30, label: "Roman Catholic" } | null,   // tier A; null = unaffiliated
  admission_weight: "very_important" | "important" | "considered" | "not_considered" | null, // CDS C7: read from reported.admission_profile.factors.religious (cds-admissions.md)
  aid_by_affiliation: boolean | null,                           // CDS H14
  composition: { label: string; share: number }[] | null,       // tier A, college-published
  communities: {                                                // tiers B/D
    tradition: Tradition; groups: { name: string; url: string | null; source: SourceRef }[]
  }[],
  estimates: { tradition: Tradition; count: number | null; share: number | null; by: string; as_of: string; url: string }[], // tier C
}
```
Each field is registered in `lib/fields.ts` ([data-lineage.md](data-lineage.md)). Tier C and D sources get new
source kinds so citations show the organization and date.

## Where it appears
Built in phase 1 unless marked *later*; phase 3 additions are marked *phase 3*.
- **Explore:** "Religious affiliation" filter: ten faith families plus "No affiliation" (`?faith=catholic,none`), exact
  label on the profile. *Phase 3:* "has a [tradition] community" filter (`?faithGroup=jewish,catholic`, tier D, from
  `school.directories.faith`), alongside the affiliation filter.
- **Profile, the students page's "Campus life" section:** a "Religious life" block (`#religion`,
  `components/school/ReligiousLife.tsx`): the affiliation (or "No religious affiliation"), with a link to other
  colleges in its family; "Religious affiliation or commitment: very important" in admission (C7); "Some of the
  college's own non-need-based aid considers religious affiliation" (H14); "Campus ministries: listed among campus
  activities" (F2). Hidden when empty (see the rules below); the section and its "Campus life" link show when only
  this block has data. *Phase 3:* a "Faith communities" list underneath, grouped by tradition with each group's named
  chapters and links, each credited to its organization (`<CreditedList>`, owner decision 4); replaces the generic
  `<DirectoryListings domain="faith">` placeholder. The block now also shows at an otherwise-unaffiliated college that
  has directory listings. *Still later:* tier C estimates (Hillel/Chabad population figures) as labeled callouts —
  needs Hillel's and Chabad's permission first (open question 1), so not built with the rest of phase 3.
- **Compare:** a "Religious affiliation" row (NCES label, or "None"). C7's religion row was already there
  ("Admission: Religious affiliation", cds-admissions.md).
- **"Known for":** "Faith-centered" from C7 = Very important, or CCCU voting (GOVM) membership (*phase 3*), never from
  affiliation alone.
- **Glossary:** religious affiliation, religious commitment in admissions, scholarships for religious affiliation,
  campus ministries, Faith-centered (now also naming CCCU), "listed by a national organization," and *phase 3:*
  Hillel/Chabad and Newman Center.
- **Data page:** the IPEDS IC card names religious affiliation; nothing new to register.

## Phase 1 as built
**Data.** `npm run sync-data` reads `RELAFFIL` from the IC{Y} file it already downloads for campus services
(`IC2025`, 2025–26), and the labels from that file's own data dictionary (`IC2025_Dict.zip`, sheet "Frequencies";
`scripts/lib/ipeds-dictionary.mts`, cached in `.cache/ipeds`). Stored as `school.religion = { affiliation: { code,
label } | null }` (`religion.affiliation`, source `ipeds-ic-char`); `null` is IPEDS "not applicable" (no
affiliation). A college with no IC row or a negative code other than −2 gets no `religion` at all (unknown, never
"none"). The sync fails on a code the dictionary doesn't label or `lib/religion.ts` doesn't group.

**Real data (IC2025, 2026-10-03):** 685 of 1,893 colleges affiliated (all private nonprofit), 1,208 none, 0 missing;
58 distinct codes. Families: Catholic 189, Other Christian 131, Methodist and Wesleyan 97, Baptist 85,
Nondenominational Christian 58, Presbyterian and Reformed 52, Lutheran 35, Jewish 29, Other 7, Latter-day Saint 2
(the Explore filter shows the live counts; they move with each release).

**CDS facts** (`lib/cds/religion.ts`, a `RECORD_STEPS` step in `lib/reported-merge.ts`): `reported.religion.
aid_by_affiliation` = `{ non_need, need }` from H14 (H.1409, H.1418) and `reported.religion.campus_ministries` from F2
(F.201), each with its own lineage record. C7 stays where cds-admissions.md put it
(`reported.admission_profile.factors.religious`); the block reads it, nothing is copied. Of the 10 CDS records on
2026-10-03: C7 religion 10 (all "not considered"), H14 religious scholarships 2 (Vanderbilt, UNC Chapel Hill, both
non-need), F2 campus ministries 8.

**Decisions this spec left open:**
1. **Families** (open question 2): ten, by denominational family, not by theology (no evangelical/mainline split):
   Catholic; Baptist; Methodist and Wesleyan (incl. AME, AME Zion, CME, Free Methodist, Wesleyan, Nazarene);
   Lutheran; Presbyterian and Reformed; Nondenominational Christian (Interdenominational, Non-Denominational,
   Undenominational, Evangelical Christian, Multiple Protestant Denomination); Other Christian (everything else
   Christian, incl. Episcopal, Orthodox, Adventist, Pentecostal, Churches of Christ, Mennonite, Friends, UCC, Church of
   God); Jewish; Latter-day Saint; Other (Unitarian Universalist, "Other (none of the above)"). Plus "No affiliation"
   in the filter. Grouped by code in `RELAFFIL_FAMILY`.
2. **Where the CDS facts live:** under `school.reported.religion`, not `school.religion`, because they are
   college-reported values: `stripReported` and the lineage guard (every `reported.*` value cites the college with a
   quote) then cover them, and re-merging is idempotent, like every other round-3 block. `school.religion` holds only
   the federal affiliation. `admission_weight` from the sketch is not stored: it is C7, read in place.
3. **Blank ≠ no:** H14 and F2 are stored only when a box is marked. An unmarked box stores nothing (the Cost page's
   H14 rule), so `aid_by_affiliation` is never `false`. H14 comes from the same document as the Cost page's "Applying
   for aid" (`pickProcessRecord`); its year is the aid cycle ("Fall 2026 entrants"). F2 comes from the newest document
   that read section F; a blank there hides an older edition's mark. Its year is the edition.
4. **When the block shows:** for an affiliated college, or for any college whose CDS says something (C7 above "not
   considered", H14, F2). C7 "not considered" is shown only at an affiliated college (useful there, noise at a public
   university). An unaffiliated college with none of those gets no block, so 1,200 profiles don't say only "No
   religious affiliation".
5. **Partial coverage:** the CDS facts never feed ranks, sorts, medians, Explore filters, or Compare rows beyond C7's
   existing one. The affiliation filter uses IPEDS only (all colleges).

## Phase 2 as built (pilot)
Built 2026-10-04 on the shared pilot engine ([college-reported-data.md](college-reported-data.md#campus-life-pilot-as-built-2026-10-04)).
Per college: the faith/spiritual-life office or chaplaincy, the college's own list of faith communities, a
college-published report of students' religious affiliation, and campus groups' own size claims.
- **Stored:** the office (name, page, quote) and an official composition (labels with counts and/or shares as printed,
  shares computed from a printed total, population, as of) in the `campus_pages` detail table; the composition only
  after the second check confirms it (owner decision 3, extended to tier A religious figures). Groups the college's own
  pages name become tier B listings in the `directories` table, by tradition; a group's own size claim becomes a tier C
  listing with the fields of [What each estimate record needs](#what-each-estimate-record-needs) folded into its fact
  ("2,750 Jewish undergraduates (2026)", "scope not stated" when the population isn't given) and quote.
- **Shown** in the Religious life block (`components/school/ReligiousLife.tsx`, redesign 2026-10-04): the office as a
  labeled value linked to its page, and the composition as share bars, each with its ⓘ (page, date checked, quote). Tier B and C listings show in
  the faith directory block with the college's page as their credit. Hidden when empty; facts older than two years hide.

**Measured without a model (2026-10-04).** The pipeline's fetcher and page gathering were run on the answer key's own
URLs (257 requests): every page the key could read, and whether the key's hand-copied quotes pass our quote check on
the text we read. 274 of 289 quotes on readable pages passed (94.8%); every miss was in the key, not the check
(bracketed completions such as "C[atholic faith]", a computed sum given as a quote, a home-page quote reused on
sub-pages, a meta description). Average extraction input per college: Greek 30,900 characters (max 70,100), faith
11,600, LGBTQ+ 20,800. For this domain: faith office pages 14 read of 14, the college's group lists 11 of 11, religion
reports 3 of 3 (Baylor's IR PDF is readable although its HTML pages are behind Cloudflare). The key found an official
composition at only 3 of 25 colleges (Baylor, Notre Dame, BYU) and no readable organization estimate (every Hillel
College Guide page is behind Cloudflare).

**Cost (estimates until the workflow run measures them).** Per college: discovery 3 Sonnet calls with up to 12
searches, about $0.20–0.25 (searches $0.10 per 10); extraction about 21,600 Haiku input tokens and 3,600 output from the
measured page sizes, $0.04; escalation (assumed one domain in three) $0.03; second checks $0.02. About $0.30–0.34 per
college, $8 for the 25, $570–640 for ~1,890 colleges. Cheapest configuration to test next: free path probes before paid
search, one discovery call for all three domains, and Message Batches for extraction and checks (half price): about
$0.16–0.20 per college, $300–380 for a full run.

**Worth scaling (pending the live run's precision):** the faith office and the college's group list at private and
religious colleges (the richest lists: Georgetown, Vanderbilt, Grinnell, ASU's CORA, UCLA); the religion report only at
the 685 affiliated colleges. **Not worth it per college:** organization estimates (blocked; ask Hillel for a data
partnership instead) and Engage directories at large publics (robots and JavaScript).
## Phase 3 as built
**2026-10-04, branch `feature/campus-life-2-faith`**, on the shared infrastructure ([campus-directories.md](campus-directories.md)):
six adapters in `scripts/lib/directories/adapters/`, each verified against its live page before writing the parser and
spot-checked on at least 10 matches.

| Organization | Tradition | Access | Entries → matched | Notes |
|---|---|---|---|---|
| Chabad on Campus | Jewish | **Open JSON API** (`chabad.org/api/v2/chabadorg/centers/`), explicitly `Allow`'d in robots.txt even though the HTML directory page it backs 403s. The API ignores `searchQuery` and always returns its whole worldwide directory (4,220 centers 2026-10-04); filtered to `center-type` "Campus Chabad House" (246) | 169 name a campus → 87 matched | Most entries have no address, only a free-text name ("Chabad at Yale University"); the campus is read out after the name's last at/@/of/serving/for that isn't part of the college's own name ("University of Pennsylvania" survives; "Tannenbaum Chabad House" names no campus and is dropped). Lower match rate than the other adapters because of this; the rest are legitimately unmatched (a city alone, several colleges named in one entry, non-U.S. centers) |
| Reformed University Fellowship | Christian | HTML, `ruf.org/campus/`, paginated (24/page, a "Next Page »" link; 9 pages, 206 campuses 2026-10-04). robots.txt disallows only `/wp-admin/` | 206 → 176 | A second "RUF International" or "RUF Global" ministry at the same campus is its own listing (the suffix is stripped from the matched campus name but kept as the listing's distinct name) |
| FOCUS (Fellowship of Catholic University Students) | Catholic | HTML, `focus.org/about/campuses/` (the spec's `focusoncampus.org/find-my-campus` now redirects here), one page, 216 campuses grouped under state headings. `Crawl-delay: 10`, otherwise permissive | 216 → 202 | Highest match rate: FOCUS's own page uses each college's formal name |
| The Navigators | Christian | HTML, `collegiatenavigators.org` (navigators.org's `/ministries/collegiate` redirects here) — not the `navigators.org/location-type/college/` URL this spec first guessed, which 404s. Its "Find a Campus" section server-renders a Google Map's 281 markers as inline JS (no API call needed). `Crawl-delay: 10`, otherwise permissive | 281 → 192 | State is read from the address paragraph; the city is left out (the street address before it can't be isolated reliably, e.g. "255 Heisman Dr Auburn, AL"). A few of Navigators' own addresses give the wrong state (e.g. Doane University, really in Nebraska, listed as "IA") — left unmatched rather than hand-corrected, since that would mean verifying hundreds of entries against reality one by one |
| CCCU (Council for Christian Colleges & Universities) | Christian (membership, not a chapter) | **Public JSON REST endpoint** (`cccu.org/wp-json/imis/member-schools`) behind the member list's Angular app; not disallowed (only `/wp-admin/` is) | 116 US/Canada "GOVM" (voting) members → 111 | A membership fact, not a chapter: `applyCccuMembership` (merge.mts) reads this file separately from the chapter pipeline and sets `school.religion.cccu_member`, never a "Faith communities" listing (owner decision 4's "it's a membership fact, not a chapter") |
| Secular Student Alliance | Nonreligious | Built in infra (see [campus-directories.md](campus-directories.md#example-ssa)); unchanged here | 233 → 206 | — |
| Hillel International | Jewish | **Blocked** — College Guide 403s (Cloudflare-style challenge) to a plain descriptive request, confirming this spec's prior finding; recorded in `data/directories/blocked.json` | — | A data partnership, not a scrape, per this spec's existing recommendation |
| Orthodox Christian Fellowship | Orthodox Christian | **Blocked** — robots.txt itself returns a bare 403; the chapters page does too | — | Recorded in `data/directories/blocked.json` |
| InterVarsity | Christian | Reachable (`intervarsity.org/chapters`, permissive robots.txt), but its chapter list loads only through a Drupal AJAX **form POST** (`/chapters?ajax_form=1`, needs a CSRF `form_build_id`); the adapter contract's crawler is GET-only by design (`ctx.fetchText`/`fetchJson`). Not built — a contract limitation, not a block | — | Would need the crawler extended to do an authenticated-feeling POST, which risks looking like getting around the form rather than reading a public list; left for a future decision |
| Chi Alpha | Christian | Reachable (`chialpha.com` → `/group-locator/`), but it's a search-only widget (by school name or ZIP); no bulk "every campus" endpoint found | — | Not built |
| Catholic Campus Ministry Association | Catholic | Reachable, but its "Member Directory" link is a single stale PDF from February 2019, not text or HTML | — | Not built: too old to be useful, and a PDF isn't a page `ctx.fetchText` is meant to parse |
| Muslim Students Association National | Muslim | Reachable (Squarespace), but its current site has no chapters/locator page or link in its navigation at all (checked 2026-10-04) | — | Not found |
| LDS Institutes of Religion | Latter-day Saint | Reachable, but `churchofjesuschrist.org/si/institute/search` is a general site-search results page, not a campus locator | — | Not found |
| Baptist Collegiate Ministries, Hindu YUVA / Hindu Students Council, Lutheran Campus Ministry (LuMin), Wesley Foundations (UMC), Episcopal campus ministry | Various | Not checked beyond a guessed URL (404, timeout, or no single national page found) | — | Needs hand research to find (if one exists); state Baptist conventions, in particular, would be dozens of separate sites |

**CCCU membership rule, as built:** the adapter keeps only `MemberType: "GOVM"` (the voting/governing membership the
spec's "hire only faculty who profess Christian faith" sentence describes) in the United States or Canada; IAFF
(international affiliate), AMEM (affiliate), and CPAR (corporate partner) are left out, as are international GOVM
members outside the US/Canada (IPEDS doesn't cover them). `isFaithCentered` (`lib/religion.ts`) now returns true for
either C7 = very important *or* `religion.cccu_member`.

**Display, as built:** `ReligiousLife.tsx` now takes the college's detail file too, and renders "Faith communities"
(grouped by tradition, each item via the shared `<CreditedList>`) under the phase 1 facts, in the same block; hidden
when both parts are empty, shown when either has something (an unaffiliated college with a Hillel listing now gets a
block). The generic `<DirectoryListings domain="faith">` placeholder is removed from the students page for this
domain (greek and lgbtq keep it until their own tracks take over).

## Phases
1. **Affiliation for all colleges** (IPEDS). Cheap; ship first. **Built** 2026-10-03, with the CDS items already read
   (C7, H14, F2); see [Phase 1 as built](#phase-1-as-built).
2. **Pilot of 25 colleges** (UT Austin, Notre Dame, Baylor, BYU, a CCCU college, a Jesuit college, an HBCU, a
   liberal-arts college, large publics in several regions): run discovery by hand-checked agent, measure hit rate per
   source type, extraction accuracy, and cost. Decide which sources are worth scaling. Still **planned**.
3. **National directories** (tier D) with the matching step. **Built** 2026-10-04 (six adapters, two confirmed
   blocked); see [Phase 3 as built](#phase-3-as-built). Partnership requests (Hillel, Chabad, Anthology) are still
   outstanding — the owner, not an agent, needs to make those asks.
4. **Per-school rollout** of whatever the pilot shows is worth it. Still **planned**.

## Open questions
1. Headline choice: this spec uses local first, national fallback
   ([above](#local-first-national-fallback)); confirm after the pilot shows how often local figures state their scope.
   Use of Hillel International's figures still needs their permission.
2. How far to split Christian groups (e.g. evangelical vs. mainline)? Recommendation: one "Christian" tradition with
   named groups, until users ask for more.
3. Title IX religious exemptions: leave out (sensitive, and incomplete since 2020).

## Rejected
HERI CIRP Freshman Survey (per-college results aren't public); Niche, U.S. News, and Princeton Review (proprietary);
scraping behind Cloudflare or logins.

## Sources
- Hillel UT page: https://www.hillel.org/college/university-of-texas-austin/; accuracy critique:
  https://ejewishphilanthropy.com/how-many-jewish-undergraduates/
- Texas Hillel: https://www.texashillel.org/; Chabad at UT: https://www.jewishlonghorns.com/,
  https://utexas.campuslabs.com/engage/organization/texasjew
- UT CDS: https://reports.utexas.edu/common-data-set/pdf; UT religious organizations:
  https://catalog.utexas.edu/general-information/student-services/religious-organizations/
- Baylor Trends: https://ir.web.baylor.edu/institutional-reports/baylor-trends; Notre Dame:
  https://admissions.nd.edu/why-nd/spiritual-identity/
- CCCU: https://www.cccu.org/institutions/; Campus Labs reach: https://www.campuslabs.com/campus-labs-platform/student-engagement/
- CDS 2025–26 items C7, F2, H14 (OU, Princeton, UT 2025–26 files)
