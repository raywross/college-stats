# Religious Life

> Status: **planned** (not built). Research 2026-09-28: Scorecard API probe, 2025–26 Common Data Sets, and a
> per-school deep dive on UT Austin. Findings are verified unless marked *unverified*. Companions:
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
| UT CDS 2025–26 (Box link from reports.utexas.edu) | C7 "Religious affiliation/commitment" row, H14 "Religious affiliation" aid, F2 "Campus Ministries" | PDF. **Checkmarks are extracted as a separate column of ✔ with no labels**, so plain text can't tell which box is checked | Needs layout-aware parsing or a vision model |
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
  admission_weight: "very_important" | "important" | "considered" | "not_considered" | null, // CDS C7
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
- **Explore:** affiliation filter (grouped into ~8 families for the filter, exact label on the profile) and "has a
  [tradition] community" filters (tier B/D).
- **Profile, "Campus life" section:** affiliation; "Religious commitment is *very important* in admissions" (C7);
  a faith-communities list with links; tier C estimates as labeled callouts. Hidden when empty.
- **"Known for":** "Faith-centered" only from C7 = Very important or CCCU membership, never from affiliation alone.
- **Glossary:** religious affiliation, CCCU, Hillel/Chabad/Newman Center, "organization estimate."

## Phases
1. **Affiliation for all colleges** (IPEDS). Cheap; ship first.
2. **Pilot of 25 colleges** (UT Austin, Notre Dame, Baylor, BYU, a CCCU college, a Jesuit college, an HBCU, a
   liberal-arts college, large publics in several regions): run discovery by hand-checked agent, measure hit rate per
   source type, extraction accuracy, and cost. Decide which sources are worth scaling.
3. **National directories** (tier D) with the matching step, and partnership requests (Hillel, Chabad, Anthology).
4. **Per-school rollout** of whatever the pilot shows is worth it.

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
