# Official Links: Website, Admissions, Apply, Visit, Aid (IPEDS HD + the college's site)

> Status: **built** 2026-10-04: steps 1 and 3 (see "As built (steps 1 and 3)") and step 2, the site probe (see
> [As built: the probe (step 2)](#as-built-the-probe-step-2)). First of the [identity family](README.md) (links,
> social accounts, short names, colors and marks). Research 2026-10-03: `HD2025` downloaded and its URL columns counted for all 1,893
> colleges; the Scorecard `school.school_url` field checked for all of them; twenty college homepages fetched to see
> what a "visit" link looks like. Values below are measured unless marked *estimate*.

## Question it answers
*Where is this college's website? Where do I apply, book a campus tour, or ask about aid?* Today a profile shows a
college's figures and a single external link, the net price calculator on the Cost page. The homepage is already in
the dataset (`links.website`, from College Scorecard, present for all 1,893 colleges) but is shown nowhere.

## Source

### IPEDS directory `HD{Y}` (already downloaded by `sync-data`)
The directory file the site reads for setting and Carnegie classes ([campus-profile.md](../data-expansion/campus-profile.md))
also carries the URLs each college reports to NCES every fall. Counted in `HD2025` for the site's 1,893 colleges
(2026-10-03):

| Column | What the college reports | Colleges with a value | Keep? |
|---|---|---|---|
| `WEBADDR` | Homepage | 1,893 | Yes: cross-check against Scorecard's `school.school_url` (same origin); prefer HD when they differ, since it is a year newer |
| `ADMINURL` | Admissions office page | 1,800 | Yes: `links.admissions` |
| `APPLURL` | Online application | 1,757 | Yes: `links.apply` |
| `FAIDURL` | Financial aid office page | 1,807 | Yes: `links.financial_aid` |
| `NPRICURL` | Net price calculator | 1,877 | Already stored from Scorecard (`links.price_calculator`); HD fills the gaps |
| `VETURL` | Veterans' tuition policies | 1,454 | Yes, low priority: `links.veterans` (shown only on the Cost page) |
| `DISAURL` | Disability services | 1,893 | Yes: `links.disability_services`, beside the disability-services share from [campus-services.md](../data-expansion/campus-services.md) |
| `ATHURL` | Student-Right-to-Know athlete graduation report | 913 | No: a compliance page, not something a visitor wants |

Values are messy: some lack a scheme (`www.uah.edu/admissions`), some have spaces (`tcc.ruffalonl.com/Alabama State
University/Freshman-Students`), a few are a bare domain. `normalizeUrl()` in `sync-data` already handles the first
two for Scorecard's fields; reuse it.

### The college's own site: the visit page
No federal file lists campus tours. The Common Data Set does not either. The admissions page almost always links to
one ("Visit", "Visit campus", "Tours", "Plan your visit"), so it can be found without a model:

1. Fetch `links.admissions` (fall back to the homepage) with the college-reported crawler's HTTP client
   (`scripts/lib/college-reported/http.mts`: robots.txt, one request a second per host, a named user agent).
2. Collect the page's links (`findLinks` in `documents.mts`) on the same registrable domain.
3. Score each link's text and path: `visit` in the text or path +3; `tour` +2; `open house` or `admitted student`
   +1; `virtual` −1 (a virtual tour is a second choice, kept as `links.virtual_tour` when it is the only match);
   links in `<nav>` or `<header>` +1; links to a PDF or to a social site −∞.
4. Keep the best link when its score is ≥ 3, with the anchor text as the lineage quote. Otherwise `links.visit` is
   null and the college goes on a list for the Haiku picker (the round-3 discovery ladder's step 2,
   [college-reported-round-3.md](../college-reported-round-3.md#decision-6-discovery-is-a-ladder-cheapest-first)):
   the link list in, one URL or "none" out, about $0.003 a college. *Estimate:* the heuristic finds the page for
   three in four colleges; the picker for most of the rest; a few hundred stay null until a person adds them.

The probe runs as `npm run probe-sites` and as a step of `npm run sync-data -- --links` (off by default, since it is
~14,000 requests; it took 18 minutes for all 1,893 colleges, 40 at a time, on 2026-10-04). It never runs on Vercel.
A monthly schedule is left for the owner (see the As built section). Built 2026-10-04: see
[As built: the probe (step 2)](#as-built-the-probe-step-2) for the scorer's refinements and the measured coverage.

## Ingest
- `sync-data` reads the seven columns from the `HD{Y}` rows it already keeps, normalizes them, and stores them under
  `links`. The homepage: HD `WEBADDR` when present, else Scorecard; when the two differ by more than scheme or
  `www.`, keep HD and print the pair as a warning (the first run will show how often they differ).
- `--links` adds the visit probe and a **liveness check**: a `HEAD` (then `GET` on 405) of every stored link, at most
  one per host per second. A link that answers 404, 410, or a DNS failure twice in a row (two runs) becomes null,
  with the old value kept in `data/link-issues.json` for review; 403, 429, and timeouts keep the link (many college
  sites block bots but work in browsers; Princeton's homepage answered 403 to the probe on 2026-10-03). Redirects
  are followed to judge liveness, but the stored URL stays the one the source published (decided in
  [As built](#as-built-the-probe-step-2): a replaced HD link would no longer be what the college reported to NCES).
- Overrides: `data/overrides.json` can set any `links.*` value with a `_lineage` of source `college-site`, for the
  colleges whose visit page nobody could find.

## Store
```ts
links: {
  website: string | null;              // existing
  price_calculator: string | null;     // existing
  admissions: string | null;
  apply: string | null;
  financial_aid: string | null;
  visit: string | null;                // found on the college's site; lineage carries the page it was found on and the link text
  virtual_tour: string | null;
  veterans: string | null;
  disability_services: string | null;
}
```
Register each in `lib/fields.ts` with source `ipeds-hd`, topic `institution`, vintage `ipeds-hd` (the HD edition is
the year the college reported the link). `links.visit` and `links.virtual_tour` use source `college-site` and a
per-value lineage record `{ url: <page it was found on>, retrieved, method: "extracted", quote: <link text> }`, like
every other college-site value, so the ⓘ popover can say "Found on the college's admissions page, 2026-10-12".

Supabase: the `links` object is part of the school document, so `publish-data` needs no schema change.

## Display
- **Profile hero** (`app/schools/[id]/page.tsx`): a row of outlined pill links under the chips, in this order:
  **Website · Admissions · Apply · Visit · Financial aid**. Each is an `<a target="_blank" rel="noopener">` with the
  external-link icon and the college's domain as its `title`. Missing links are left out, never shown disabled. On
  phones the row scrolls sideways like the "Known for" chips. The row's `SourceNote` lists the HD edition and, when
  present, the college's site for the visit link.
- **Compact header** (topic pages): one "Website" icon link at the right of the name, so a visitor on any topic page
  can reach the college in one tap. Nothing else; the band is already full on phones.
- **Cost page and Cost card**: "Financial aid office" next to the existing net price calculator link; "Veterans'
  benefits" under it when present.
- **Students page**: "Disability services" beside the disability-services share.
- **Explore cards and rows**: no links (they would compete with the card's own link to the profile).
- **Compare**: a "Website" row at the end of the table, one link per college.
- **Saved lists** ([product/saved-lists.md](../product/saved-lists.md)), when built: Apply and Visit links beside each
  saved college, since that is where a family acts on them.

Links open the college's site, so they carry no figure and need no year in the text; the ⓘ popover still shows where
each came from.

## Keep history?
No. A link is replaced when it changes. `data/link-issues.json` keeps the last broken value for a person to look at.

## Checks (each shown to fail when broken)
- `tests/links.test.mts`: normalization (scheme added, spaces encoded, trailing junk dropped); HD beats Scorecard
  only on a real difference; the visit scorer picks "Visit campus" over "Virtual tour" and rejects a PDF; the
  liveness rule nulls a link only after two failures and never on 403 or 429.
- Lineage guards: every `links.*` field registered; `college-site` values carry `url` and `retrieved`
  (`validateLineage`, existing).
- A fixture HD file with the seven columns, so `sync-data`'s reader is covered without the network.

## Cost
HD columns: nothing. The visit probe and liveness check: HTTP only, no model. The Haiku picker for colleges the
heuristic misses: *estimate* 500 colleges × $0.003 ≈ $1.50, once; later runs only for colleges still without a link.

## Open questions for the owner
1. Show the Apply link at all? It sends a student to an application portal (often Common App) and is the one link a
   college might prefer visitors reach through its own admissions page. Default: show it; it is what the college
   reported to NCES as its application address.
2. Run the visit probe inside the monthly college-reported run (same crawler, same robots rules, one more page per
   college) or as its own job? Default: inside, after the CDS discovery, so a college's site is visited in one pass.

## Implementation plan
1. `scripts/sync-data.mts`: read the HD columns, normalize, store; warn on homepage disagreements. `lib/fields.ts`
   and `lib/types.ts` entries. Fixture and tests. Ships the hero links row with Website, Admissions, Apply, Financial
   aid (one PR).
2. **Built 2026-10-04** as `scripts/lib/site-probe.mts` (`npm run probe-sites`, and behind `--links`): the visit
   scorer and liveness check, reusing the crawler's HTTP client, with its own link parser (landmarks); the homepage's
   social links and icon candidates in the same pass; `data/site-probe.json`, `data/link-issues.json`; the Haiku picker
   behind `--picker`. Second PR, with the Visit link. See [As built](#as-built-the-probe-step-2).
3. Compact header, Cost, Students, Compare placements; the `/data` page's source description for HD gains "and the
   links each college reports".

## As built (steps 1 and 3, 2026-10-04)

### Step 1: `lib/links.ts`, `lib/fields.ts`, `scripts/sync-data.mts`
- `normalizeUrl` (pure, exported) now handles every messy case this spec and the real `HD2025` file show: no scheme
  (adds `https://`), a literal space in the path (percent-encoded, not dropped), trailing sentence punctuation
  pasted in with the link (`.`, `,`, `;` dropped — a real trailing slash is kept, since that's meaningful), and
  IPEDS's missing codes `-1`/`-2`/`-3` (treated as absent, same as blank). It then validates the result with
  `new URL()` without reformatting it (no added trailing slash, no case changes, no `.href` reserialization), so a
  genuinely malformed value (e.g. a bare `https://` with nothing after it) becomes `null` instead of a broken link,
  while an already-good URL passes through byte-for-byte.
- `applyLinks(school, hdRow?)`: without `hdRow` (the `merge-identity` path) it's a complete no-op, exactly as the
  foundation's stub comment said. With a row: `website` is HD's `WEBADDR` whenever present (now the field's default
  source — `lib/fields.ts`'s `"links.website"` changed from `scorecard(...)` to `hdLink(...)`); only when HD has none
  does Scorecard's value (already on `school.links.website` from `toSchool`) stay, with a `{ source: "scorecard" }`
  lineage record. `price_calculator` keeps Scorecard as the default and is filled from `NPRICURL` only when
  Scorecard has none, with `{ source: "ipeds-hd" }`. `admissions`, `apply`, `financial_aid`, `veterans`,
  `disability_services` are set straight from HD, `null` when the column is blank, no lineage record (HD is their
  only registered source).
- **Idempotence**: clears its own two lineage entries before recomputing them on every call (not just when a row is
  given), which matters in one specific way — once HD has filled `price_calculator`, `school.links.price_calculator`
  itself can no longer be told apart from a Scorecard value that happens to be non-null. Re-applying with the same
  row has to get the same answer anyway, so the check now reads the existing `{ source: "ipeds-hd" }` lineage record
  *before* clearing it, not just whether the field is currently empty. `tests/links.test.mts` has a dedicated case
  for this (the one place a naive "fill only if empty" rule would have silently dropped the lineage record on a
  second pass).
- `websiteMismatch(school, hdUrl, scorecardUrl)` and the pure `urlsDiffer(a, b)` it's built on (both exported):
  `urlsDiffer` ignores scheme, a leading `www.`, and a trailing slash; `websiteMismatch` returns a formatted
  `"name (id): HD …, Scorecard …"` line, or `null` when they agree or HD has nothing to compare. `sync-data.mts`
  collects these into `websiteWarnings` the same way it already collects `directoryWarnings` — captures Scorecard's
  website right before `applyIdentity` overwrites it, computes the pair after, and prints the count plus the first
  20 at the end of the run.
- `buildMeta`'s `ipeds-hd` source description gains a sentence: "Also the links each college reports: its website,
  admissions and application pages, financial aid and net price calculator offices, and veterans' and
  disability-services offices."
- `linkHost(url)` (exported, pure): the link's host for a `title` tooltip or a Compare cell, with a leading `www.`
  dropped.

### Step 3: Display
- **`OfficialLinks`**: Website · Admissions · Apply · Visit (or Virtual tour, when there's no Visit) · Financial aid,
  as outlined pills, each `<a target="_blank" rel="noopener">` with the external-link icon and `linkHost(href)` as
  `title`. A pill's field is only added to its `SourceNote` when that pill is actually shown, so the row never cites
  a source for a link the college doesn't have. Returns `null` (no row, no source note) when the college has none of
  these five.
- **`HeroIdentity`**: kept the foundation's placement under "Known for". Screenshots (desktop 1280 and phone 390,
  both themes) showed the plain foundation markup — pills and `SocialLinks` in one unconstrained flex row — would
  make the pill strip's mobile horizontal scroll bleed only to the edge of whatever width the social icons left it,
  not the true viewport edge (the same `-mx-4` trick the "Known for" chips use only reaches the real edge when the
  scrolling element is the full width of the page gutter). Fixed by giving the pill wrapper `max-sm:w-full`: on
  phones it claims the full line (forcing `SocialLinks` to wrap below, where the chips-style edge-to-edge scroll
  needs the room), and from `sm:` up — where the pills wrap instead of scrolling, so the bleed trick is inactive
  anyway — it reverts to its content width and happily shares the row with the social icons after it, per the spec.
- **`CompactHeader`**: one Website icon link (lucide `Globe`, `title`/`aria-label` from `linkHost`) between the name
  link and `CompareButton`. Left the `<Crest>` line untouched for the brand track.
- **Cost page and `CostCard`**: both now put "Financial aid office" beside the existing net price calculator link
  (a new dashed box next to it on the page; a new `CardStats` cell next to "Your price" on the card), with
  "Veterans' benefits" as a smaller line underneath when present. Neither adds a per-link `InfoTip`: the existing net
  price calculator link had none either, so this matches established practice; the fields are still registered in
  `TOPIC_FIELDS.cost` so the page's closing `SourceNote` cites them.
- **Students page**: "Disability services office" added inside the same `<li>` as the disability-services share, in
  `components/school/CampusServices.tsx` (where `demographics.disability_services` renders); registered in
  `TOPIC_FIELDS.students`.
- **Compare**: a literal trailing `<tr>` after the generic "All the numbers" rows (an actual `<a>` per college, which
  the generic string-cell renderer can't produce), with a `SourceTip` (no glossary term needed) beside the "Website"
  label. `links.website` added to the page's `tableFields` so `MultiSourceNote` covers it.
- **Explore**: untouched, per spec.
- **Open question 1 (show Apply?)**: went with the spec's default — shown.
- Files touched outside the links track's explicit list, kept minimal: `lib/profile-topics.ts` (registered
  `links.price_calculator`/`financial_aid`/`veterans` in `TOPIC_FIELDS.cost`, `links.disability_services` in
  `TOPIC_FIELDS.students`, and the hero's link fields in `PROFILE_FIELDS`'s hand-added tail) and
  `tests/profile-topics.test.mts` (the matching `LEGACY_FIELDS` entries its reconciliation test requires for any
  newly-shown field, each commented "Deliberately new"). Nobody else owns this file; the edits are additive only.

### Tests
`tests/links.test.mts` (17 cases): `normalizeUrl`'s four messy-value categories plus the missing-code and
pure-rejection cases; `urlsDiffer`/`websiteMismatch`'s scheme/www/slash tolerance and "only with a real HD value"
rule; `applyLinks`'s website and price_calculator rules each tested both ways (HD wins outright; Scorecard-fills-gap
only); the no-row no-op; two idempotence tests (same row twice; HD's homepage disappearing between passes); and
`tests/fixtures/identity/hd-links.csv` (3 rows, a real BOM, and the spec's own messy examples: a scheme-less domain,
a path with a literal space, a scheme plus trailing punctuation, `-2`, a quoted value ending in a comma, and two
bare domains) read with the exact `parseCsv` sync-data uses.

### Real-run numbers (`npm run sync-data`, `HD2025`, 2026-10-04; 1,893 colleges)
| Field | Colleges | Note |
|---|---|---|
| `links.website` | 1,893 (100%) | Every one from HD; the Scorecard-fallback branch never fired — `HD2025`'s `WEBADDR` has full coverage |
| `links.price_calculator` | 1,889 | All from Scorecard; HD's `NPRICURL` filled **0** gaps — the 4 colleges with neither (Oregon Health & Science, Rush, Samuel Merritt, MD Anderson Cancer Center) have no `NPRICURL` in HD either, confirmed against the raw file |
| `links.admissions` | 1,800 | |
| `links.apply` | 1,757 | |
| `links.financial_aid` | 1,807 | |
| `links.veterans` | 1,454 | |
| `links.disability_services` | 1,893 (100%) | |
| Website mismatches (HD vs. Scorecard, beyond scheme/`www.`/slash) | **0** | Scorecard's `school.school_url` and HD's `WEBADDR` appear to already be the same underlying NCES value for this cohort; the fallback and mismatch-warning code paths are exercised by the tests, not by this run |

The per-column counts match the spec's own 2026-10-03 research table exactly, which is a good independent check that
the reader lines up with the real file. Comparing this run's `links.website` against the previous (Scorecard-only)
committed data turned up one real improvement from the normalization work, not a data difference: eight South
University campuses whose Scorecard URL has a literal space in a query fragment (`#location=Austin, TX`) now come
out correctly percent-encoded (`#location=Austin%20TX`) instead of carrying a raw space.

### Left for the owner / integrator
- Nothing blocking. The visit probe (step 2) will add `links.visit`/`links.virtual_tour`; `OfficialLinks` already
  renders them and cites whichever one is present, so no further change is needed here once that track's files
  merge in.
- `data/schools.json`/`data/meta.json` were regenerated locally to produce the numbers above and were reverted
  (`git checkout --`) before committing, per the shared brief; the integrator's full `sync-data` after merging every
  track will pick up these links for real.

## As built: the probe (step 2)

Built 2026-10-04 by the probe track. Its agent was stopped by an account spend limit before it committed, so the
integrator recovered its worktree as it stood (code, tests, and the full run's data; the tests and the identity
idempotence test pass on it) and wrote this section from that data.

- **Files**: `scripts/lib/site-probe.mts` (the pass), `scripts/probe-sites.mts` (`npm run probe-sites`, with `--ids`,
  `--sample N`, `--concurrency`, `--picker`), `lib/site-probe.ts` (`applyProbeLinks`, the liveness rule,
  `nextLinkIssues`), and `npm run sync-data -- --links`, which runs the same probe after the sync. `PoliteHttp` gained
  `head`, `skipReason`, and `crawlDelayMs`; the changes are additive and the college-reported pipeline's tests pass.
- **Its own link parser**: `findLinks` (documents.mts) gives neither a link's landmark nor every occurrence, so the
  probe reads every anchor with its `<nav>`, `<header>`, or `<footer>` landmark (or ARIA role), and the head's
  `<link>` tags for the icon candidates.
- **The scorer**, beyond the weights above, from the full run's wrong picks: −2 for a map, directions, or parking page
  whose path doesn't name a visit or tour; never a site's front page ("Visit our main site"), a visit that isn't a
  prospective student's (accreditation, patient, clinic, "Visit the Newsroom", "Visit the Library"), or a
  graduate-only page. A visit section's own page beats the pages inside it (`/visit/` over `/visit/admitted/`), and a
  tie goes to a link on the page's own host (Pitt's admissions page lists every campus's visit page), then page order.
- **Redirects** are followed to judge liveness only. A stored link keeps the URL its source published, so a value
  never says something its cited source (IPEDS, Scorecard) didn't.
- **Liveness**: only 404, 410, and a host that doesn't exist (confirmed by a DNS lookup) count as failures; at most one
  failure a day counts, so two runs on one day can't null a link; a link becomes null after two failed runs for the
  same URL (`FAILURES_TO_NULL`), its old value kept in `data/link-issues.json`.
- **The Haiku picker** is built behind `--picker`, capped in US dollars and tested with a fake client. It was not run,
  since it calls the paid API: 492 colleges have neither a visit page nor a virtual tour, so at about $0.003 each a run
  would cost about $1.50.
- **Schedule**: not added to the college-reported workflow. That pipeline auto-merges, its commit and PR steps assume
  college-reported changes under `data/`, and the brand step that follows the probe writes `public/brand/`. Until a
  separate monthly workflow exists, run `npm run probe-sites` and then `npm run sync-brand` by hand; the second run
  is also what nulls a link that failed twice.

### Real run (2026-10-04, all 1,893 colleges)

| Measure | Colleges |
|---|---|
| Homepage answered | 1,648 |
| Homepage not reached (largest reasons: a bot-protection page 95, 403 37, robots.txt 33, timeout 32, TLS 22) | 245 |
| Admissions page answered | 1,608 |
| Visit page found by the scorer | 1,390 (73%) |
| Virtual tour only | 11 |
| Neither (the picker's list) | 492 |
| Homepage links to at least one social network | 1,547: Facebook 1,534, Instagram 1,503, YouTube 1,394, X 1,099, LinkedIn 994, TikTok 498 |
| Icon candidates | 1,808: best a touch icon 983, an `icon` 489, only the conventional paths 336; none 85 |

The liveness check tested 13,894 stored links: 11,806 answered; 484 failed once (404: 347, no such host: 136, 410: 1)
and are in `data/link-issues.json`, none null yet. `data/site-probe.json` is 3.8 MB.
