# College-Reported Data (Ingestion Agent)

> Status: **built** 2026-10-02 (phase 1, admissions): shared contract, pipeline, checks, sync merge, display, workflow,
> pilot set and answer key; see [As built](#as-built). The pipeline has not yet made a live model call: the pilot run
> is the next step ([college-reported-setup.md](college-reported-setup.md)). Decided 2026-09-28. Depends on
> [data-lineage.md](data-lineage.md). Absorbs the backlog items "Read Common Data Set PDFs" and "Expand Common Data Set
> coverage".

## Why
Federal data lags by design. As of 2026-09-28 the newest federal admissions data is **fall 2024** (IPEDS ADM2024, released
Dec 2025); fall 2025 arrives about Dec 2026. Colleges publish sooner:
- **Common Data Set 2025–26** (fall 2025 entering class, 2025–26 aid): posted by many colleges Feb–Aug 2026, mostly as PDF.
- **Class profiles / admissions news for fall 2026** (the class that just arrived): posted Aug–Oct 2026, e.g. Princeton
  4.0% of 46,618; Columbia 4.23% of 61,031; USC 11.7%.

## Scope
- **Phase 1: admissions** (applicants, admitted, enrolled, admit rate, year, cohort) for the newest year a college
  has published. Priority set by the user: fresher admit rates first.
- **Later:** 2026–27 tuition and cost of attendance; CDS section H aid (need met, merit); B1/B2 enrollment (built from the CDS
  records: [cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md)).
- **All 1,893 colleges** are attempted. Coverage is limited by what colleges publish: selective colleges post class
  profiles; many others post only a CDS; some post neither and stay federal-only. The pilot measures hit rates by tier.

## Decisions (2026-09-28)
- Values that pass every automated check **publish automatically**. Anything that fails goes to a review queue and is
  not published.
- **Start with cheaper models.** A stronger model is used only to learn a college's format (discovery) and when a
  format changes; routine extraction uses the cheapest model that passes the pilot.
- **Never re-read a document we've already processed** unless it changed.
- ~~Federal data remains the comparison baseline~~ Revised 2026-10-03: the newest figure a college has published is
  the value everywhere ([college-reported-round-2.md](college-reported-round-2.md), Decision 1).
- **Access rules:** obey `robots.txt` and crawl delays, identify ourselves honestly, and never get around bot
  protection. **Revised 2026-10-10 for the CDS file only.** Owner decision, in the owner's words: *"We're safe to
  ignore the robots.txt for the purpose of pulling a CDS file. It's public data per the law."* This revises the
  earlier "never bypass blocks" rule for this one case:
  - A recipe source of kind `cds` (the Common Data Set file itself, any format, first fetch or re-fetch) is fetched
    even when robots.txt disallows it (`PoliteHttp.get(url, …, { cdsDocument: true })` in
    `scripts/lib/college-reported/http.mts`, passed by `acquireSource` in `phases.mts`). The log says
    "robots.txt disallows … ; fetched anyway".
  - robots.txt still governs everything else: discovery crawling, sitemaps and IR index pages, class profiles, and
    any non-CDS page.
  - Nothing else changes: the same honest user agent, the 1-second per-host gap and any Crawl-delay, and a 401, 403,
    405, 429, or challenge page is never worked around (no other user agent, no retry past it); it is recorded for
    `data/reference/blocked-hosts.json`, and hosts there stay blocked.

## How it works

### Two passes: learn the format once, then extract cheaply
Colleges rarely change where or how they publish, so each college gets a stored **recipe**.

1. **Discovery (per college, first run or after a format change).** Model: `claude-sonnet-5`, with web search.
   Finds the CDS page and the class-profile/admissions-news page, and writes a recipe:
   ```json
   {
     "unit_id": "186131",
     "sources": [
       { "kind": "cds", "url": "https://…/CDS_2025-26.pdf", "format": "pdf", "pages": [5, 6], "anchor": "C1" },
       { "kind": "class-profile", "url": "https://…/class-of-2030", "format": "html", "anchor": "Admitted" }
     ],
     "index_urls": ["https://…/common-data-set"],      // re-checked to find next year's file
     "learned": "2026-10-02", "model": "claude-sonnet-5"
   }
   ```
2. **Extraction (every run, only for changed documents).** Model: `claude-haiku-4-5`. Our code fetches the recipe's
   URLs itself (plain HTTP, no model tools), sends only the relevant pages/section, and asks for a fixed JSON schema
   (structured outputs) with a verbatim quote per number.
3. **Escalation.** If extraction fails the checks, or the recipe's anchor isn't found, re-run discovery for that
   college. If that fails too, use `claude-opus-5` once; still failing → review queue. *(Changed after the pilot:
   escalation now happens only where a model can help, and Opus is not called; see
   [round 2](college-reported-round-2.md#decision-3-escalate-only-when-a-model-can-help) and "As built → Pipeline".)*

Model IDs live in one config object so they can change after the pilot. CDS **Excel** files go through the existing
deterministic importer (`scripts/import-cds.mts`) first; the model is the fallback.

### Don't re-read unchanged documents
`data/college-sources.json` stores, per document: URL, `ETag`/`Last-Modified`, content hash, last processed date,
and the extraction result.
- Conditional GET (`If-None-Match` / `If-Modified-Since`); a 304 or an identical hash skips the model entirely.
- Index pages (e.g. a college's CDS listing) are re-checked cheaply for new links; a new link (e.g. `CDS_2026-27.pdf`)
  triggers extraction of just that file.
- Downloaded documents are cached in `.cache/college-docs/` (git-ignored) keyed by hash.

### Extraction schema (phase 1)
```ts
{
  cohort: "first-year" | "transfer" | "unknown",       // must be first-year to publish
  scope: "all-rounds" | "early-only" | "regular-only" | "unknown",  // must be all-rounds
  entering_term: "Fall 2026",
  applicants: number | null, admitted: number | null, enrolled: number | null,
  acceptance_rate: number | null,                      // as stated, if stated
  quotes: { applicants?: string, admitted?: string, enrolled?: string, acceptance_rate?: string },
  page?: number
}
```

### Automated checks (all must pass to publish)
1. Cohort is first-year and scope is all rounds (not early decision only).
2. Every published number has a quote, and the number appears in the quote.
3. `admitted ≤ applicants`, `enrolled ≤ admitted`.
4. Stated rate matches `admitted ÷ applicants` within 0.1 pt (when both are given); otherwise the rate is computed.
5. Entering term is newer than the college's federal admissions year.
6. Plausible change vs the latest federal year: applicants within ×0.5–×2, admit rate within ±15 pts (or ±50% relative
   for rates under 10%). Outside → review.
7. If two sources give the same term (CDS vs class profile), they agree within 1%; otherwise → review.

### Publishing
- A GitHub Action runs the pipeline and opens a PR that changes `data/college-reported.json` (one college per line)
  and `data/college-sources.json`. The PR **auto-merges** when CI passes.
- **Circuit breaker:** no auto-merge if more than 25% of already-published values come back different in one run,
  which points to a systematic misread rather than the data. (The original second trigger, more than 10% of
  attempted colleges failing checks, was dropped 2026-10-03: in two runs it fired only on blocked sites and rounding.
  Values that pass their checks always publish; failures go to the review queue on their own.)
- Failed items go to `data/review-queue.json` (college, field, extracted value, quote, URL, failed check) and are
  listed in the PR description. Resolving one = fix the recipe or add a manual override, then re-run.
- `sync-data` merges `college-reported.json` into `school.reported` with field-level lineage (`method: "extracted"`).

### Self-measurement
When IPEDS publishes the same year (e.g. ADM2025 in Dec 2026 vs our fall 2025 CDS extractions), compare them and write
an accuracy report (`data/reports/college-reported-accuracy-{date}.md`). A college whose value differs by more than
1 pt gets its recipe re-learned. This is the ongoing check on the cheaper models.

## Schedule
| Window | Frequency | Why |
|---|---|---|
| Aug–Nov | Weekly | Fall class profiles |
| Dec–Jul | Monthly | CDS editions |
Discovery runs once for all colleges, then only on escalation or when a college has no recipe.

## Cost (estimates, to be measured in the pilot)
- Discovery with Sonnet 5 + web search: roughly $0.10–0.25 per college → ~$200–500 one-time for 1,893.
- Extraction with Haiku 4.5 on changed documents only: fractions of a cent to a few cents each; a typical run touches
  a small share of colleges → tens of dollars per run.
- Starting budget ceiling agreed: ~$1.5–3K/year. Actual spend is logged per run from `usage`.

## Display
Superseded by [college-reported-round-2.md](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have)
(Decision 1, revised 2026-10-03): a college's newer published figures replace its older ones **in the dataset**
(`lib/newest.ts#applyNewest`, run by `merge-reported` and `sync-data`), value by value, with an `extracted` lineage
record each and the replaced funnel kept in `admissions.federal`. Every view (the profile, Explore, Compare, ranks,
medians, Home) shows those newest values; the ⓘ tooltip carries the document, year, quote, link, retrieval date, and
the figure it replaced. No chips. See [data-lineage.md](data-lineage.md) rule 3.

## Pilot (first build step)
~50 colleges across selectivity tiers (very selective, selective, less selective, open admission) and sectors.
Measure: share with a findable newer source, pass rate of checks, accuracy against a hand-checked answer key, cost per
college for each model. Decide whether Haiku 4.5 holds for extraction or extraction moves to Sonnet 5.

## Campus-life sources
[religious-life.md](religious-life.md), [greek-life.md](greek-life.md), and [lgbtq-life.md](lgbtq-life.md) reuse this
engine with more source kinds per college (planned, after the admissions pilot). LGBTQ+ life adds `policy-page`
(nondiscrimination, housing, records, health plan, conduct code), extracted against a yes/no schema with the
supporting quote, and a human-review queue for conduct-code findings:
- **Recipe `sources[].kind`** grows: `cds` (sections C7, F1, F2, F4, H14 added to the extraction schema), `ir-report`
  (e.g. enrollment by religion), `fsl-reports` (fraternity & sorority life size/grade reports), `org-directory`
  (Engage / CampusGroups / Presence), `faith-org` (a campus Hillel page, etc.). Discovery finds them in the same
  visit as the admissions sources.
- **Source tiers** (official statistic, official directory, organization estimate, national directory) are stored
  on every value; see [religious-life.md](religious-life.md#source-tiers).
- **National directories** are crawled once per organization, not per college, and matched to `unit_id`s
  (`data/directories/`).
- **Checkboxes.** Multi-column grids (C7, C8, D5, F3, H14) lose their column in plain PDF text (verified on UT's
  2025–26 CDS and 10 more in the 2026-10-03 inventory); single-column lists (F2, F4, E1, H8) keep "X Label". Rebuilding
  lines by position (pdf.js x/y) recovers the column on every PDF tested, so no vision call is needed
  ([round 3](college-reported-round-3.md), Decision 3).
- **Access rules:** obey `robots.txt` and crawl delays, never get around bot protection, and ask organizations that
  cover many campuses for data directly ([religious-life.md](religious-life.md#access-rules-apply-to-both-specs)).
  The one exception, the CDS file itself (owner decision 2026-10-10, see [Decisions](#decisions-2026-09-28)), doesn't
  extend to campus-life pages.

### Campus-life pilot, as built (2026-10-04)
Branch `feature/campus-life-2-pilot`. The per-college step that [religious-life.md](religious-life.md#phase-2-as-built-pilot)
(phase 2), [greek-life.md](greek-life.md#phase-2-as-built-pilot) (phase 2), and
[lgbtq-life.md](lgbtq-life.md#phase-4-as-built-pilot) (phase 4) call "pilot", for the 25 pilot colleges only (owner
decision 2, 2026-10-04: no full run). `npm run campus-pilot [-- --college <id> … --rediscover --cap 15]`,
`npm run score-campus-pilot -- --key <answer-key.json>`; workflow `.github/workflows/campus-pilot.yml`.

**Pipeline** (`scripts/lib/campus-pilot/`, reusing this engine's pricing, robots-aware HTTP, HTML and PDF text):
1. **Discovery** (`llm.mts`, `REPORTED_MODELS.discovery` = Sonnet 5): one call per domain (Greek, faith, LGBTQ+),
   web search only (at most 4 searches per domain, no web fetch), returning links through a strict `save_links` tool
   (`schema.mts` `DISCOVERY_SCHEMAS`): FSL office, report pages/files, recruitment; faith office, the college's group
   list, a religion report, campus faith groups' own pages; LGBTQ+ center and groups, and the policy pages
   (nondiscrimination, housing, name/pronouns, health plan, restrooms, trans admission at single-sex colleges, and the
   conduct code at religious colleges). Links are saved per college in `data/campus-sources.json` (recipe: links,
   and each page's status, SHA-256, ETag, Last-Modified), so later runs skip discovery and re-fetch only changed pages.
2. **Fetching** (`pages.mts`): our code fetches every page through the national-directory crawler's `PoliteHttp`
   (robots.txt, Crawl-delay, ≥ 2 s per host, `college-stats-research/0.1`), caches bodies in `.cache/campus-pages/`,
   never requests a Campus Labs `/engage/api/` path, and follows a few links from office pages by rule (FSL size,
   community, and grade reports newest first; the office's group pages). Refusals go to `data/directories/blocked.json`
   (org `campus-pilot`; owner decision 1); a host that never answered is a dead page, not a block. Long pages are cut to
   keyword windows (conduct terms in a handbook, "gender-inclusive" on a housing page).
3. **Extraction** (`REPORTED_MODELS.extraction` = Haiku 4.5): one call per domain against a fixed schema through a
   forced strict tool (`EXTRACTION_SCHEMAS`; "not stated" is `""`/`0` rather than `null` to stay under the 16-union
   limit, #64). Every fact names its page (P1, P2, …) and quotes it.
4. **Quote check** (code): each quote must be on its page (`quoteOnPage`: case, spacing, curly quotes, dashes folded;
   "…" splits parts). A failed quote, a failed call, or `confidence: "low"` re-reads the domain once with Sonnet 5
   (thinking off for the forced tool); a quote that still fails drops that fact. Tier A facts must come from the
   college's own domain.
5. **Second check** (owner decision 3, replacing the human review in lgbtq-life.md "Sensitive facts: rules"):
   Sonnet 5 re-reads every LGBTQ+ "no", every conduct restriction, and every official religious composition against
   the stored quote and the page text around it; only confirmed findings are kept (`verified_by: "claude-sonnet-5"`,
   with the date checked); rejections are dropped and listed in the run report.
6. **Spend cap**: every response's usage is priced (`costOf`) into a run budget that refuses a call that could pass
   the cap (default $15, kept across runs in `.cache/campus-pages/spent.json`).

**Files:** `data/campus-pages.json` (published facts, one college per line), `data/campus-sources.json` (recipes),
`data/reports/campus-pilot-<run>.json` (raw extractions, dropped facts with reasons, second checks, every call's
tokens and cost) and `campus-pilot-score-<run>.{json,md}`.

**Into the dataset** (`scripts/lib/campus-pilot/merge.mts`, run by `npm run merge-directories` and `npm run
sync-data`): tier A facts become a `campus_pages` detail table (`lib/campus-pages.ts`, field `detail.campus_pages`,
source `policy-page`, year = newest date checked, checked by `checkCampusPages`); groups the college's own pages
name (tier B) and a group's own size claim (tier C) become listings in the `directories` table, each credited to the
page it came from. The `policy-page` source now describes office pages and reports as well as policies.

**Live run (2026-10-04, GitHub Actions; report `data/reports/campus-pilot-2026-10-04T13-31-00.json`).** The $15 cap
stopped it after 19 of the 25 colleges: **$11.57, $0.61 per college** (discovery's web searches $11.15 of it: 175
searches; extraction $0.23, escalation $0.19, second checks $0.01). At this configuration a full run of ~1,890
colleges would cost about **$1,150**. Scored against the hand-checked key (scratchpad key; kept out of the public repo
because it holds page text beyond the short quotes we publish), excluding facts the key itself couldn't read:

| Fact type | Published | Correct | Precision | Recall |
|---|---|---|---|---|
| Greek councils' chapter counts | 21 | 20 | 95% | 56% |
| Greek life exists / stated none | 9 | 9 | 100% | 50% |
| Faith office | 5 | 5 | 100% | 42% |
| LGBTQ+ center | 3 | 3 | 100% | 30% |
| Policies (nondiscrimination ×2, housing, name, restrooms) and conduct restriction | 7 | 7 | 100% | 6–25% |
| Faith groups by tradition | 28 | 26 | 93% | 35% |
| Greek total members / housing | 4 / 4 | 2 / 2 | 50% | 29% |
| Greek deferred recruitment / formal term | 3 / 2 | 2 / 0 | 67% / 0% | 20% / 0% |
| LGBTQ+ groups | 3 | 2 | 67% | 25% |
| Health plan covers transition care | 1 | 0 | 0% | – |

Second check: 1 finding, confirmed (and right). Discovery found a page of the key's type far less often than a careful
reader did (nondiscrimination 2 of 19 readable, LGBTQ+ center 3 of 14, faith office 5 of 12): recall is the problem,
and nearly all the cost is discovery.

**Decision (2026-10-04): publish only fact types at ≥ ~95% precision.** `HELD_BACK` in
`scripts/lib/campus-pilot/merge.mts` keeps Greek total members, housing, deferred recruitment, and formal term; the
health-plan policy; and faith and LGBTQ+ groups read from college pages out of the dataset (they stay in
`data/campus-pages.json` for re-scoring). A test fails if any of them reaches a detail file. An example of why:
Alabama's "Freshmen … are not allowed to live in a fraternity or sorority house" was extracted as "no deferred
recruitment".

**Before a full run:** cheaper and better discovery (try the college's own site search and common paths before paid
web search; one discovery call for all three domains), tighter Greek recruitment/housing/membership extraction
prompts, then re-run these 25 and re-score. No full run without the owner's go-ahead.

### Campus-life pilot, round 2 plan (2026-10-04)
Branch `feature/campus-pilot-2`. The owner approved a second run on **25 different colleges**
(`data/reference/campus-pilot-2-colleges.json`, none from round 1), keeping round 1's work. The run happens in GitHub
Actions once the workflow is on `main` (dispatch **Campus-life pilot**; the defaults run this list under the $15 cap).

**What changed, and why**
1. **Discovery: free first, then one paid call.** Round 1's cost was discovery: $11.15 of $11.57, nearly all of it the
   search results Sonnet read back (4.3M input tokens over 51 calls), not the $0.01 search fee. Now
   `scripts/lib/campus-pilot/probe.mts` looks on the college's own site first, through the same robots-aware fetcher
   (robots.txt, ≥ 2 s per host): the sitemaps robots.txt lists (or `/sitemap.xml`), the home page and up to four
   student-life/about hubs it links to, well-known subdomains (`fsl.`, `greeklife.`, `chaplain.`, `campusministry.`,
   `lgbtq.`, `housing.`, `registrar.`, `policy.`, `titleix.`, `equity.`, …) and their sitemaps, well-known paths
   (`/fraternity-sorority-life`, `/greek-life`, `/fsl`, `/religious-life`, `/spiritual-life`, `/chaplain`, `/lgbtq`,
   `/pride`, `/gender-sexuality`, `/nondiscrimination`, `/title-ix`, `/housing/gender-inclusive`,
   `/registrar/chosen-name`, …), and, for what's still missing, the site's own `/search?q=` page (two at most).
   Candidates are matched by URL and link text (news, events, and employee/HR pages excluded); the best one or two per
   type are fetched and kept only if the page's own text is about that thing, and a redirect to the home page doesn't
   count. Probe requests are "quiet": a robots.txt refusal of a guessed path is a miss, not a block for the owner's
   list. Then **one** Sonnet call per college (not three) asks only for the scored types the probes missed (FSL
   office, faith office, LGBTQ+ center, nondiscrimination, housing, chosen name; the conduct code at religious colleges,
   trans admission at single-sex ones, the religion report at affiliated ones), with web search **limited to the
   college's own domain** and to 2–4 searches (one per two missing types; round 1 allowed 12). Restroom lists, the
   health plan, and faith groups' own sites are no longer searched for (round 1: rarely published, held back, or
   behind Cloudflare). The recipe records which types the probes found and what the paid call was asked for.
2. **Extraction precision: the quote must state the fact.** The schemas answer `not_stated` instead of being forced to
   yes or no; the prompts say a true sentence about something else is not a quote for a field (with Alabama's house
   rule as the example); and `scripts/lib/campus-pilot/support.mts` checks every fact's quote for its field's key
   terms before it's kept (dropped facts are logged with the reason): deferred recruitment needs recruitment/joining
   words and first-year/term words; housing needs chapter-house words; a formal term's season must be the quote's
   season; a members total must contain the number (digits or words), say it counts the whole fraternity and sorority
   community (not one council's page), and be no more than two years old; council counts must be in their quote;
   policy yes/no quotes must name the category (a "no" must be the list of protected categories); the health plan
   needs coverage and care words in one sentence; a conduct restriction must say what it restricts; faith groups need
   their name in the quote and a word that shows the tradition; LGBTQ+ groups outside a list page must be presented as
   student groups. Stored quotes cut to 160 characters keep the words that state a policy ("…sexual orientation…").
3. **Unchanged:** the second check (Sonnet 5 on every LGBTQ+ "no", conduct restriction, and religious composition)
   and `HELD_BACK`: only a scored run can lift a held-back fact type.
4. **Message Batches** for extraction, escalation, and second checks (half price; `scripts/lib/campus-pilot/batch.mts`).
   Each college's flow still awaits its own call; the batcher sends what has queued after a 20-second lull, polls, and
   hands each flow its result. A batch not ended within 20 minutes is cancelled and its calls (and any errored or
   expired one) are made directly, so the 150-minute job can't stall; the budget holds calls in flight so the cap
   still holds. Discovery stays direct (it streams searches over turns). `--no-batch` / the workflow's `batch` input
   turns it off.
5. **Keeping round 1.** `npm run campus-pilot -- --colleges-file <list>` (default the round-2 list; `--college` still
   overrides), and the workflow's `colleges_file` input. `mergeRun` (`scripts/lib/campus-pilot/files.mts`) changes
   only the colleges the run read: others' published facts and recipes are carried over; a college in the run is
   replaced when it has facts, removed when it ran clean with nothing, and kept when it stopped or failed.
   `tests/campus-pilot-2.test.mts` merges a run on round-2 colleges into the committed round-1 files and checks every
   round-1 line and recipe is still there byte for byte (and that the old overwrite would fail the same check).

**Measured offline on round 1's colleges** (no model; the hand-checked key's URLs used only to score, never as input).
Where the key has a readable page of a type, did discovery give the extractor a readable page whose text states that
thing (19 colleges where round 1's discovery ran; scratchpad `pilot2/useful-score.mts`):

| Source type | Key has a page | Round 1 paid discovery | Round 2 free probes alone |
|---|---|---|---|
| FSL office | 7 | 7 | 6 |
| Faith office | 10 | 5 | 8 |
| LGBTQ+ center | 12 | 3 | 7 |
| Nondiscrimination | 14 | 1 | 6 |
| Gender-inclusive housing | 6 | 1 | 3 |
| Chosen name | 5 | 0 | 1 |
| Conduct code | 3 | 1 | 1 |
| **All** | **57** | **18 (32%)** | **32 (56%)** |

By the key's exact URL (or the same section of the same site) the probes alone match 24 of 68 key pages, round 1's
paid discovery 13. The paid call then looks for what's left; with round 1's paid answers standing in for it, 34 of 57
(60%) — a floor, since round 2's call is narrower and limited to the college's domain. Probes made about 67 requests
per college (about a minute at the polite pace) and found 3.0 types per college on round 1's colleges, 4.3 on round
2's. Some sites refuse our requests outright (a challenge page at Michigan, Williams, Columbia, and Wheaton; 403 at
Brandeis): probes find nothing there, and those pages stay for hand reading (owner decision 1). At Baylor and
Tennessee the sites answer but the probes found nothing; the paid call covers them.

The quote checks alone, applied to round 1's published facts and scored with the same scorer: deferred recruitment
67% → 100% (Alabama's and UCLA's inferences dropped), LGBTQ+ groups 67% → 100% (UCLA's names from a news paragraph),
the health plan's wrong "yes" dropped, Ole Miss's Panhellenic-only total dropped; council chapters stay 95% (counts in
words now read), faith groups 93% → 92% with recall 35% → 31% (groups whose quote doesn't name them). Housing, formal
term, and members stay at 50%/0%/50% on this key, whose misses there are mostly items the key didn't record; the
prompt changes need the live run to measure.

**Projected cost per college** (measured inputs: what the probes left on each college, the search cap for that many
types, round 1's mean discovery call cost at that many searches, $0.104 at 2, $0.129 at 3, $0.271 at 4, and round 1's
reading cost per college halved): **about $0.12–0.13 per college** ($0.112 discovery + $0.011 reading on the round-2
list; $0.134 on round 1's), so about **$3–4 for the 25** and **$230–260 for 1,890 colleges**, against $0.61 and
$1,150 in round 1. Reading will cost more than round 1's figure because the probes hand the extractor more pages;
even at the pilot report's full-page estimate ($0.07 a college directly, $0.035 batched) the total stays under
$0.16 a college.

**After the run:** score it (round 2 has no hand-checked key yet: one is needed for these 25 colleges, or re-run
round 1's colleges with `--rediscover` and score against the existing key), then decide which `HELD_BACK` types the
new numbers lift. No full run without the owner's go-ahead.

### Campus-life pilot, round 2 results (2026-10-04)
Run in Actions on branch `data/campus-pilot-2` (report `data/reports/campus-pilot-2026-10-04T21-07-02.json`, score
`campus-pilot-score-2026-10-04T21-07-02.md`), 23 of the 25 new colleges, scored against a new hand-checked key that
checked all seven policy items at every college (kept in the scratchpad, not the public repo; the scorer reads
`_meta.all_policy_items_checked`). Round 1's colleges are untouched.

**Cost: $7.16, $0.31 a college** (round 1: $0.61), 61 searches. Discovery is still $6.89 of it: the probes found
pages, but the paid call still ran at most colleges and its search results dominate. The projection of $0.12–0.13
was low; a full run at this configuration is about **$590**.

**Precision** (published / correct), after reading every miss: Greek members, housing, deferred recruitment, formal
term 1/1, 1/1, 2/2, 3/3; Greek status 5/5; councils' chapters 13/13 (two "misses" were councils the key omitted:
Wake Forest's NPHC and SMU's IFC); LGBTQ+ center 6/6; nondiscrimination 8/8 and 9/9; name on records 4/4; restrooms
4/4 (Ohio State's "no", which cites the state law requiring single-sex multi-user restrooms, was marked not_found by
the key and confirmed by the second check); faith office 8/9 (UNC's Campus Y was read as a faith office); a 2016
organization estimate was published although estimates expire; faith groups 28/30 and LGBTQ+ groups 2/5 (both held).
**Recall stayed low** (4–41% by type): no FSL report files were read, and name, housing, and restroom pages were
found at a third of colleges or fewer.

**Decisions:** `HELD_BACK` adds the faith office (13/14 across both rounds) and organization estimates. The Greek
detail types stay held: they were right in round 2, but 3–5 checked findings each across both rounds are too few to
publish on. Next before any full run: make the paid discovery call conditional on what the probes missed (most of the
cost), read FSL report files the probes find, and re-score.

### Campus-life pilot, round 3 plan (2026-10-04)
Branch `feature/campus-pilot-3`. The owner approved a third run on **25 new colleges**
(`data/reference/campus-pilot-3-colleges.json`, none from rounds 1 or 2; now the default for `npm run campus-pilot`
and the workflow's `colleges_file`). Unchanged: the $15 cap, Message Batches, the second check, `HELD_BACK` (a test
pins it; only a scored run lifts an entry), and a run changes only its own colleges.

**Why round 2's paid call ran so often** (its run report, offline). It ran at **all 23** colleges discovery reached:
the trigger was "any of eight scored types missing", and gender-inclusive housing was missing at 21 colleges and chosen
name at 18 (the key has no housing page at 11 of those 21), plus the religion report at every affiliated college. It
was asked for 105 types and returned **16 links, 5 readable, 3 published facts** (one wrong: UNC's Campus Y as a faith
office): housing 21 asks/0 readable, name 18/0, faith office 14/1, FSL office 13/0 (3 right links on hosts Actions
couldn't reach), religion report 5/0, trans admission 3/0. The probes' own finds were mostly usable; the unusable ones
were an admissions "student stories" page (Arizona's FSL office), a "discover" news feature and alumni or affinity
pages (UNC's, Bryn Mawr's LGBTQ+ center), and a housing page (Emory's FSL office). Each call read about **47,000 input
tokens per search** (2.89M input over 24 calls, 61 searches; the prompt itself is about 2k): a 2-search call averaged
$0.256, a 3-search one $0.332; output averaged 2,120 tokens ($0.51 in all).

**What changed**
1. **Paid discovery only for what the probes missed.** `PAID_TYPES` (`probe.mts`) is now the FSL office, LGBTQ+
   center, nondiscrimination statement, and (at religious colleges) the conduct code: the published types for which
   round 2's paid call returned anything. When the probes found all of them there is **no paid call**; otherwise it
   asks only for those missing. Housing, chosen name, trans admission (well-known paths and site search added for
   single-sex colleges instead), the faith office (held back), and the religion report are left to the probes. Probes
   skip story, "discover", alumni, affinity, admissions, and housing pages as offices, and a link whose text alone
   matches but points into a section of a general page (`…#fsl`).
2. **Cheaper calls.** At most **2 searches** (1 for up to two missing types; round 2: 2–4), `max_tokens` 3,000 (round
   2: 4,000; 2-search calls wrote 2,686 at most, and a call cut short costs a second turn that re-reads every result).
3. **FSL report files.** After confirming the office, the probes follow its links to size, community, and grade
   reports and scorecards (`fslLinks`/`fslReportLinks`/`fslHubLinks` in `pages.mts`, `fslReports` in `probe.mts`):
   directly, one page down in the office's section (a reports, data, about, councils, or resources page, or the
   office's own site such as Oregon's FSL blog), and every PDF on a page of reports; files on any host the office links
   to, each robots-checked on its own host; never news, stories, sign-in pages, or script viewers (Issuu, Flipsnack,
   Google Drive). A file is kept only if its text reads as a report; up to 4, files first, newest first, saved as
   `fsl_reports` (read as "fraternity & sorority report"). Following from the office no longer wanders onto the rest of
   the site (Morehouse's strategic plan, Penn State's recreation memberships).
4. **Council counts from reports** (`support.mts`): the quote (or, on an HTML page, the council's own address or the
   words just before it) must name the council the count is for, since a report table prints many councils' numbers;
   a count from a report more than two years old (by its term, quote, or file name) is dropped. Every council count
   already published passes.

**Measured on round 2's colleges, offline** (no model; round 2's key used only to score). FSL report reach, by the
key's council and member source URLs (42 at 20 colleges; 12 of them report files, 3 of those behind script viewers):

| | Pages the extractor read | Report files read |
|---|---|---|
| Round 2 as run | 5 of 42 | 1 of 12 |
| Round 2's code, offline | 9 of 42 | 1 of 12 |
| Round 3's code, offline | **17 of 42** | **6 of 12** (Arizona, UGA, Northwestern, UNC, Oregon, SMU) |

Projected cost per college from round 2's own numbers: before, **$0.312** ($0.300 discovery, paid call at 23 of 23,
$0.012 reading). After, the paid call runs at 17 of 23 (15 with one search, 2 with two; asks: nondiscrimination 10,
LGBTQ+ center 9, FSL office 6, conduct code 3): **about $0.12 a college** ($0.106 discovery at half a 2-search call per
1-search call, $0.011 reading; $0.07 at round 1's measured 1-search cost), about **$3 for the 25** and **$220 for
1,890 colleges** (round 2's configuration: $589). Probes make about 72 requests a college (round 2: 67).

**After the run:** score it against a hand-checked key for these 25, then decide which `HELD_BACK` types the numbers
lift. No full run without the owner's go-ahead.

### Campus-life pilot, round 3 results (2026-10-04)
*Next steps across all three rounds, and the full run: [campus-pilot-accuracy.md](campus-pilot-accuracy.md).*

Run in Actions on branch `data/campus-pilot-3` (report `data/reports/campus-pilot-2026-10-04T22-14-48.json`, score
`campus-pilot-score-2026-10-04T22-14-48.md`), all 25 colleges, scored against a new hand-checked key (490 quotes, all
verbatim; every Greek council the colleges name is listed, with or without counts).

**Cost: $3.89, $0.16 a college** (round 2: $0.31; round 1: $0.61), 28 searches; discovery $3.59 of it. A full run at
this configuration is about **$300**.

**Precision, after reading every miss:** Greek status 11/11, councils' chapter counts 13/13 checkable (three more were
councils the key lists without counts), deferred recruitment 4/4, formal term 8/8, Greek total members 3/3,
inclusive housing 2/2, restrooms 4/4, name on records 3/3, LGBTQ+ groups 3/3. Wrong: **members by council 0/4**
(Rutgers: 9, 62, 114, 43 against its report's 88, 879, 1,545, 1,234); **LGBTQ+ center 3/6** (diversity offices at
Davidson, Furman, Villanova read as LGBTQ+ centers); **nondiscrimination 11/13 each** (FAMU's March 2025 statement,
which replaced its list with "any legally protected group status", read as covering both; TCU's short notice read as
"no" although its full policy covers both, and the second check confirmed that "no"); Greek housing 3/4, faith office
7/8, faith groups 18/22 (held already).

**Decisions:** across the three rounds the center is 12/15 and nondiscrimination about 91%, so `HELD_BACK` adds the
LGBTQ+ center, both nondiscrimination items, and council membership (`councilFields: ["members"]`; a council row left
with neither chapters nor members is dropped). The national lists still show these facts, credited. The Greek
recruitment and membership types were right this round but stay held: across three rounds deferred recruitment is
8/9 and the formal term 11/13. A wrong "no" (TCU) is the costliest error this section can make; before lifting either
nondiscrimination item, the extractor must read the full policy, not a notice, and the second check must compare the
two.

## Files (planned)
- `scripts/sync-college-reported.mts` (`npm run sync-college-reported`), `--pilot`, `--college <id>`, `--rediscover`.
- `data/college-sources.json` (recipes, hashes), `data/college-reported.json` (published values),
  `data/review-queue.json`, `data/reports/`.
- `.github/workflows/college-reported.yml`. Secret: `ANTHROPIC_API_KEY`.
- `scripts/merge-reported.mts` (`npm run merge-reported`) and `scripts/report-college-reported.mts`
  (`npm run report-college-reported`): built with Decision 5 of
  [college-reported-round-2.md](college-reported-round-2.md), see its As built for what they do.

## As built

### Checks and merge
`lib/reported-checks.ts` implements the seven automated checks and the conversion from a passing extraction to a
published entry, as pure functions so the pipeline (built separately, importing by name) and the sync can both
depend on them without pulling in the rest of the app:
- `runChecks(x, school, others?)` returns every `CheckFailure` (empty = publishable), numbered 1–7 as in "Automated
  checks" above. Check 2 (quote-present) tolerates thousands separators in counts and "4.0%"/"4 percent" forms for
  rates. Check 4 (rate-matches) and check 6 (plausible-change) use the stated rate when given, else
  admitted ÷ applicants. Check 5 fails a null `entering_term` outright. Check 6 skips a comparison when the
  matching federal value is null; under a 10% federal rate the tolerance is ±50% relative instead of ±15 pts. Check
  7 only compares `others` extractions that share the same `entering_term`.
- `toReportedEntry(x, school, src, run)` builds the `ReportedAdmissions` block (`year` from `fallYear`, rate computed
  when not stated) and an `extracted` `LineageRecord` for **every** registered `reported.admissions.*` path, not
  just the four numbers: the lineage guard (`validateSchool` in `lib/lineage.ts`) requires one for `entering_term`,
  `year`, and `source_kind` too, since each is independently registered in `lib/fields.ts`. Those three cite the
  same document, reusing whichever number's quote is available (they aren't themselves a quoted figure). A computed
  acceptance rate's record quotes the admitted and applicants quotes joined with `" / "` — the evidence is those two
  numbers, since the rate itself was never stated. `lib/reported.ts`'s `ReportedValuePath` type lists all seven
  paths, not only the four figures, to match what the guard actually checks.
- `reportedToPatch(entry)` turns a `ReportedEntry` into `{ reported, lineage }`, ready to merge into a `School`.
- The actual merge — strip every school's `reported` block and `reported.*` lineage, then re-apply the current
  `college-reported.json` entries through `reportedToPatch` — is `mergeReported` in `lib/reported-merge.ts`, shared
  by `scripts/sync-data.mts` (which reads `data/college-reported.json` after overrides are applied and before
  `validateLineage` runs, against `schools` it just built fresh, so stripping is a no-op there) and
  `scripts/merge-reported.mts` (Decision 5 of [college-reported-round-2.md](college-reported-round-2.md): see "Data
  in the PR" there for the committed `data/schools.json` case, where a college dropped from the file must lose its
  block). Neither ever touches a federal field — `reported` and `reported.admissions.*` lineage are the only things
  either writes. Missing file = skipped (silent, since the pipeline hasn't published yet). Printed as
  `  college-reported:     N colleges`, alongside the other sync counts.
- Initial empty files committed so the sync and `npm run check:lineage` have something to read before the pipeline
  exists: `data/college-reported.json` (`{"updated": null, "entries": []}`; `ReportedFile.updated` is `string | null`
  for this reason), `data/college-sources.json`, `data/review-queue.json`, `data/reports/.gitkeep`.
- Tests: `tests/reported-checks.test.mts`, one per check (good fixture passes, a broken variant fails that check
  specifically), plus `toReportedEntry` → `reportedToPatch` → `validateSchool` round-trips clean for both a stated
  and a computed acceptance rate, three tests proving the lineage guard rejects a reported value with no record, a
  non-`"extracted"` method, and a year not newer than federal, and one proving `lineageFor` cites `"college-site"`
  with the quote, year, and URL. Fixtures use Princeton (186131), a plain federal-only school with no CDS override.

### Workflow and setup
Built 2026-10-02. `.github/workflows/college-reported.yml` runs the pipeline and, when it changes `data/**`, opens a
pull request with a generated body and its own release note, merging itself only when asked and only when the
circuit breaker didn't trip. Full repo-owner setup (API key, GitHub secrets, enabling auto-merge, branch protection,
running locally, the first pilot, resolving a review-queue item, reading cost, when to turn scheduled auto-merge
on) is its own doc: [college-reported-setup.md](college-reported-setup.md).

- **Triggers:** `workflow_dispatch` (`mode`: pilot/all/college, `college`, `rediscover`, `auto_merge`,
  `max_discoveries`) and two `schedule` crons implementing the spec's calendar above — a plain weekly-Monday cron
  and a plain monthly-1st cron, each gated at runtime by a step that checks the current UTC month, since one cron
  expression can't mix a weekly Aug–Nov cadence with a monthly Dec–Jul one. Scheduled runs use `mode: all` and
  `auto_merge: true`.
- **Run id:** `<UTC timestamp>-<github.run_number>`, passed to the script as `--run` and used to name the branch
  (`data/college-reported-<run>`), the run summary file the script writes
  (`data/reports/college-reported-run-<run>.json`), and the release note
  (`release-notes/college-reported-<run>.md`).
- **Document cache:** `.cache/college-docs/` is restored and saved with `actions/cache`, keyed per run id with a
  `college-docs-` restore-keys prefix, so a run starts from the newest prior cache without two runs ever racing to
  write the same cache entry.
- **Token:** every git/`gh` step uses `secrets.COLLEGE_REPORTED_TOKEN || github.token`. The default token can
  commit and open a PR, but a PR opened with it doesn't trigger `pull_request` workflows — so `Verify` would never
  run and `--auto-merge` would wait forever. `COLLEGE_REPORTED_TOKEN` is a fine-grained PAT (Contents + pull
  requests, read/write; no Workflows permission needed since this workflow never touches `.github/workflows/*`).
- **Data in the PR:** a step right after the pipeline runs (`npm run merge-reported`, `if: always()` so a stopped
  or cancelled run still merges what it kept) rewrites `data/schools.json` to match the fresh
  `data/college-reported.json`, before the PR's `git add data` — see "Data in the PR" under
  [college-reported-round-2.md](college-reported-round-2.md)'s As built. Then `npm run merge-directories` (no
  network) re-merges `data/directories/` and `data/campus-pages.json` into the schools.json that
  `merge-reported` just rewrote, so it stays exactly a fresh merge (the "merge: idempotent" check). Then
  `npm run build-trends` (no network) rebuilds `data/history/trends/`: some national trends group colleges by the
  current dataset, and `tests/trends-foundation.test.mts` fails a PR whose trend files aren't what the build makes.
  The PR's `git add data` commits them; the collect job does the same after its merge.
- **PR body and release note:** generated from the run summary, `data/review-queue.json`, `data/college-reported.json`,
  and `data/schools.json` (for college names) by `scripts/college-reported-pr-body.mts` (`prBody`, `releaseNote`;
  unit-tested against fixtures in `tests/college-reported-pr-body.test.mts`): counts, cost, circuit-breaker status,
  a "Published this run" table (college, term, kind, applicants, admitted, enrolled, rate, source), an
  "Unreachable" list (review items whose failure is the `unreachable` check, e.g. a blocked site — kept separate
  from the ordinary review-queue table since no model could have fixed them), and a table of *this run's* other
  review-queue items (college, term, failed checks, URL) with a note on how to resolve one. The release note needs
  the PR number, so it's written and pushed as a second commit once the PR exists.
- **Merge logic:** auto-merges (`gh pr merge --auto --squash`) only when `auto_merge` was on for this run **and**
  the script exited 0 (the circuit breaker didn't trip). Otherwise a comment on the PR explains why it's waiting
  for a person — a tripped breaker, or auto-merge simply being off (the pilot default).
- **Permissions and concurrency:** `contents: write`, `pull-requests: write`; concurrency group `college-reported`
  (not cancelled, just serialized) so two runs never push over each other.
- **Not yet buildable/verifiable:** this workflow was written in parallel with
  `scripts/sync-college-reported.mts` itself (another agent's task) — the flags, exit codes (0/1/2), and the run
  summary/review-queue file shapes it depends on come from `lib/reported.ts`'s contract, but the workflow has not
  been exercised against the real script in GitHub Actions (that needs the secrets from
  [college-reported-setup.md](college-reported-setup.md) and a merged script). The YAML was validated by parsing
  it with `js-yaml` and syntax-checking every `run:` block with `bash -n`.

### Pipeline
> **Round 3 (2026-10-03).** `npm run sync-college-reported` now runs the round-3 pipeline
> ([college-reported-round-3.md](college-reported-round-3.md#pipeline-and-cli-2026-10-03-branch-featurecds3-integration)).
> Every document is archived and read once for every CDS item in scope. Template workbooks and fillable forms are read
> by code; other documents are read by Haiku through the Message Batches API. Discovery climbs a ladder, cheapest step
> first, and the run is split into phases (`--phase prepare|discover|submit|collect|all`). C1 still publishes through
> `data/college-reported.json` and `npm run merge-reported` as described below. The flags and the round-2 pipeline
> described in the rest of this section are kept for history; the two pilot runs on round-3 code are in
> [college-reported-setup.md §12](college-reported-setup.md#12-the-two-round-3-pilot-runs-and-the-gono-go-table).

`npm run sync-college-reported` (`scripts/sync-college-reported.mts`) needs `ANTHROPIC_API_KEY` (`.env.local` or the
environment). Flags: `--pilot` (colleges in `data/reference/college-reported-pilot.json`, `{ "colleges": [{ unit_id,
tier, sector }] }`; without the file it picks 50 deterministically across admit-rate tiers × sectors and says so),
`--college <unit_id>` (repeatable), `--all` (every college; the scheduled mode), `--rediscover` (ignore stored
recipes; documents with the same URL keep their hashes, so unchanged files are still skipped), `--dry-run` (nothing
written to `data/`; downloads are still cached), `--max-discoveries N` (Sonnet discovery budget, default 100),
`--max-cost <usd>` (default 25 for `--pilot`/`--college`, 150 for `--all`), `--run <id>` (default: start time, ISO).
Exit code 2 = circuit breaker tripped (files are still written).

**Round 2 (2026-10-03, [why](college-reported-round-2.md)).** The pilot's discovery averaged ~627K input tokens a
call because web fetch returned whole documents; escalation sent blocked sites to Opus. Now:
- **Discovery finds links only**: `web_search` and `web_fetch` at most 4 uses each, `max_content_tokens: 6000` per
  fetched page, a prompt that opens only HTML pages listing documents (never PDF or Excel), no `pages`/`anchor` in
  `save_recipe` (the extractor uses `DEFAULT_ANCHORS`: "C1" for a CDS, "appl" for a class profile), effort `low`.
  It streams (`messages.stream` → `finalMessage()`); a `pause_turn` is resumed with the cache breakpoint on the last
  message block. The CLI's discovery client has `maxRetries: 1` and a 30-minute timeout; extraction keeps the SDK's
  default retries.
- **Guess before discovering** (`guess.mts`): a college needing discovery that has `school.cds.url` or a CDS source in
  its old recipe gets the next one and two editions guessed in the file name (`CDS_2024-2025` → `CDS_2026-2027`,
  `CDS_2025-2026`; also `2024-25`, `2024_25`, `2425`, `CDS2024`). A 200 whose bytes or content type say PDF/Excel
  becomes the recipe (`model: "guessed"`), with no model call; counted as `guessed`.
- **Escalation where a model can help**: every source unfetchable (robots, 401/403/405/429, 404, network) → queued
  with `unreachable` failures, no model call, counted as `unreachable` (not `failed`, so the breaker ignores it);
  anchor missing / unreadable → one re-discovery (effort `medium`), re-read; a check failing on real figures → one
  re-read by `REPORTED_MODELS.escalation` (Sonnet 5) from the cached copy, no refetch; still failing → queue.
- **Cost cap**: before each college starts, logged cost + $0.50 ≥ `--max-cost` stops the run like a spend-limit error
  (`status: "stopped"`, "the run's cost cap of $N was reached", exit 3); colleges in flight finish and are kept. The
  workflow's `max_cost` input (default "25"; scheduled runs 150) is passed through.

**Written as it goes (2026-10-03).** The first pilot wrote nothing until all 50 colleges were done (80 minutes), so a
failure or cancel would have lost the whole run. Now:
- After **every college**, the CLI writes the four data files and the run summary (`status: "running"`, `done`,
  `total`, `finished: null`; writes are atomic, temp file then rename) and logs `[n/total] <college> done · run cost so
  far ~$X`, which the Actions log shows live.
- A **fatal API error** (`fatalApiError`: key refused, 401/403; or a 400/429 naming the spend limit, credit balance, or
  billing) stops the run: no new college starts, a college in flight records nothing (its document isn't marked read,
  so the next run does it), and the summary says `status: "stopped"` with `stopped_reason`. Exit code **3**. Ordinary
  rate limits and overloads aren't fatal (the SDK retries them).
- **Cancelling** (SIGINT/SIGTERM) writes the newest snapshot as stopped and exits 3.
- The workflow runs its artifact, PR, and release-note steps with `always()`, so a stopped, failed, or cancelled run
  still opens a PR for the colleges it finished; such a PR never auto-merges and its body opens with "Stopped early".
  The files are also uploaded as an Actions artifact, `college-reported-<run id>`.

Files, all under `scripts/lib/college-reported/` except the CLI:
- `pipeline.mts`: `createPipeline({ client, fetch, now, sleep?, minDelayMs?, cacheDir?, concurrency?, log? })` →
  `run({ schools, sources, reported, queue, run, rediscover?, maxDiscoveries?, maxCost? })`, working on the files'
  contents in memory and returning them updated with a `RunSummary`; `circuitBreaker()`.
- `llm.mts`: `discover()` (Sonnet 5, links only, streamed; see Round 2 above; recipe returned through a strict
  `save_recipe` tool, `pause_turn` resumed) and `extract()` (Haiku 4.5, or Sonnet 5 on escalation;
  `output_config.format` = `EXTRACTION_SCHEMA`, falling back to a strict forced tool if a model rejects structured
  outputs; system prompt marked for caching). `guess.mts`: `guessNextEditionUrls(url, federalYear)`.
- `http.mts`: robots.txt (RFC 9309; disallowed URLs are skipped and logged; an unreachable robots.txt disallows;
  since 2026-10-10 a `cds` source's file is fetched regardless, see [Decisions](#decisions-2026-09-28)),
  one request at a time per host at least 1 s apart (longer for a Crawl-delay), conditional GETs, sha256, the
  `.cache/college-docs/<sha256>` cache. 401/403/429 and challenge pages stop there; no user-agent switching.
- `documents.mts`: HTML → text (headings as `##`, table cells joined with `|`), PDF text per page with pdf.js
  (`pdfjs-dist` legacy build: whole document up to 30 pages, else the recipe's pages and anchor pages ±1; under 200
  characters of text = scanned, sent as a PDF block), index-page link scanning (a CDS or class-profile link for a
  newer year than the recipe has becomes a new source).
- `scripts/lib/cds-xlsx.mts`: the Excel CDS reader shared with `import-cds` (moved there unchanged). Excel CDS files
  are read without a model: C1 totals, the edition from the workbook's own title (else the URL), and quotes like
  `C1 Total first-time, first-year students who applied: 45,409`. The model reads the C sheet only if C1 isn't found.
- `models.mts`: per-model prices (estimates) and the usage/cost log; `files.mts`: one-entry-per-line JSON files
  sorted by `unit_id`, run summaries in `data/reports/college-reported-run-<run>.json`; `pilot.mts`: the pilot pick.

Behaviour worth knowing:
- A document is read (by code or model) only when it is new, its hash changed, or escalation forces a re-read; a
  304 or the same hash keeps the stored extraction. `processed` is the date of the last real read.
- Figures that fail only check 5 (not newer than the federal year) mean the college hasn't published a newer year:
  not published, not queued, not escalated. A recipe marked `none_found` is retried only with `--rediscover`.
- Missing anchors and unreadable documents are queued as `quote-present` failures ("no figures read: …") after their
  one re-discovery; a college none of whose sources could be fetched is queued as `unreachable` (the PR body lists
  these separately).
- Counts: `attempted` = colleges where something was read or discovered (an all-304 college is not an attempt);
  `changed` = published values that changed within the same entering term (a new term is a new year, not a change);
  the breaker's changed share is over all values in `college-reported.json` before the run.
- Tests (`tests/college-reported-pipeline.test.mts`) pass a fake client (answers streamed `save_recipe` calls with a
  canned recipe and extraction calls with canned JSON, recording every request) and a fake fetch (a URL → response
  table). They prove: same hash and 304 skip the model (and send the conditional headers), a new index link is read
  alone, the Excel fixture (`tests/fixtures/cds-c1.xlsx`) is read deterministically and its entry passes
  `validateSchool`, a PDF fixture's page text reaches the model, discovery streams with capped web tools and is never
  sent a document, a resumed `pause_turn` moves the cache breakpoint, a guessed URL that exists skips discovery, a
  failed check gets one Sonnet re-read from the cache and then the queue, a missing anchor gets one re-discovery at
  effort medium, blocked sites go to the queue as `unreachable` with no model call and don't trip the breaker,
  robots.txt is obeyed (`tests/cds-pipeline.test.mts` "robots.txt: …" covers the 2026-10-10 CDS exception: a
  disallowed CDS file is fetched and read, a disallowed class profile and index page are still skipped, and a CDS file
  answering 403 gets one request with our user agent and is queued `unreachable`), the cost cap stops the run, the breaker trips just past its limits, and the summary counts.
  `tests/college-reported-guess.test.mts` covers the pilot's real CDS URL shapes.

### Pilot set and answer key
`data/reference/college-reported-pilot.json` (50 colleges) and `data/reference/college-reported-answer-key.json`
(hand-checked figures), built and verified 2026-10-02 (`tests/college-reported-pilot.test.mts`).

**How the 50 were chosen.** Every candidate was pulled from `data/schools.json` (never typed from memory — old
sample data once had wrong IPEDS ids) and tiered by its *federal* acceptance rate: very-selective <15%, selective
15–50%, less-selective 50–85%, open-admission >85%. The target split (15/15/12/8) came out exact. Sectors split
25 public / 25 private-nonprofit, with 5 HBCUs (Howard, Spelman, Morehouse, Texas Southern, Jackson State), 8
religious colleges across traditions (Notre Dame, Georgetown, Villanova — Catholic; Baylor — Baptist; Yeshiva
University — Jewish; BYU — LDS; Pepperdine — Churches of Christ; Liberty — Evangelical), and large publics in both
the selective and less-selective tiers (Michigan, UVA, UT Austin, Wisconsin-Madison, Ohio State, Texas A&M, UTEP,
University of New Mexico, …). Princeton, Columbia, and USC (named in the spec's "Why") and all 8 colleges with a
CDS override in `data/overrides.json` (Berkeley, UIUC, UMD, Cornell, NYU, Vanderbilt, William & Mary, Purdue) are
included by construction, not by luck.

**Answer-key hit rate by tier**, out of colleges actually checked (not all 50 were attempted — selective tiers
were prioritized, per the task):

| Tier | Checked | Found a newer figure | Hit rate |
|---|---|---|---|
| Very-selective | 15 | 15 | 100% |
| Selective | 14 | 14 | 100% |
| Less-selective | 6 | 2 | 33% |
| Open-admission | 5 | 0 | 0% |

This is itself the pilot's headline finding, not just a coverage gap: **selectivity predicts discoverability**.
Every very-selective and selective college in the sample had a class-profile page, news article, or CDS citation
with a genuine Fall 2025 or Fall 2026 figure. Below ~50% acceptance, the web thins out fast:
- **Aggregator sites recirculate federal data under a fake "newer" label.** The University of New Mexico page we
  could fetch stated outright that its numbers were "sourced from IPEDS/College Scorecard public data"; Liberty
  University's most-repeated aggregator figure (24,942 / 24,687 / 98.98%) turned out to match our *existing*
  Fall-2024 federal rate (0.9898) almost exactly, just relabeled with a different class year on the page. A
  pipeline that trusts the first search hit without checking it against the federal baseline it already has would
  happily "discover" the same number twice and call it new.
  Check #5 (entering term newer than the federal admissions year) and #6 (plausible change vs. federal) exist for
  exactly this failure mode — this is the concrete case that justifies them.
- **Small or niche colleges have thin, inconsistent web coverage.** Yeshiva University, Brigham Young University,
  Southern New Hampshire University, and Baylor each turned up two or three mutually inconsistent numbers across
  low-quality SEO-aggregator mirrors with no way to tell which (if any) was right, and no official page we could
  reach to settle it. These were recorded as `none_found` rather than guessed.
- **A college's own page is the best source when it's reachable, but bot protection blocks many of them.**
  Princeton, Columbia, Notre Dame, and Michigan's own domains all returned HTTP 403 to automated fetches; Harvard's
  own Office of Institutional Research fact book and William & Mary's and Villanova's own admissions pages were
  not protected and gave the cleanest, most reliable quotes in the whole set. The production pipeline will need a
  real browser-like fetch path (or a documented allowlist of secondary sources) for the colleges that block plain
  HTTP — this will hit discovery hardest, since discovery is model + web search, not a page we already know to
  fetch.
- **The newest "entering class" isn't always the one you'd guess.** Several colleges' own pages (Florida,
  Villanova) already showed their *Fall 2026* class profile as of this check — i.e., discovery needs to re-check
  a college's known pages even between scheduled runs, not just use whatever class year it learned first.
- **Even official-looking secondary sources disagree with each other** for the same college and term (NYU: two
  sources differ by several thousand applicants for the same "Class of 2029"; Texas A&M: 89,422 vs. 62,967
  applicants for the same "Fall 2025"). Check #7 (sources agree within 1%) will matter in practice, not just in
  theory.

### Display
Built 2026-10-02 (phase 1: a side block above the funnel), **replaced 2026-10-03** by
[college-reported-round-2.md](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have) Decision 1: the
college's newest figures now *are* the headline, not a block beside it. QA'd against the first live run's published
data (`data/college-reported-20261003-113224-1`, 22 colleges: Harvard fall 2025 CDS full funnel, Duke fall 2026
class profile with applicants/admitted but no enrolled yet, Purdue applicants + enrolled but no admitted, Illinois
rate only) merged into a local `data/schools.json` copy with a throwaway script and reverted before committing.

- **`lib/newest.ts`** (pure, `tests/newest.test.mts`): `newestAdmissions(school)` resolves which source's funnel to
  show — see [college-reported-round-2.md](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have)
  for the rule. Returns the chosen funnel (source, year, term, counts, rate, yield, and the `FieldPath` to cite for
  each), plus `partial` when the college has a newer figure that doesn't clear the bar for a full funnel.
- **Admissions topic page** (`app/schools/[id]/admissions/page.tsx`): the eyebrow year, the funnel's bar rows (each
  row shown independently — Duke's applicants/admitted show without an invented enrolled count), the 100-square
  waffle (needs all three counts, so it falls back to federal when the college's newest class is missing one), the
  yield ring, and the admit-ratio headline all read `profile.newest` (computed once in `lib/profile-data.ts`). The
  acceptance-rate and yield distribution strips, and the admissions map, stay federal (`profile.rate`/`yld`), since
  those compare this college against every other on the same year. `newest.source === "reported"` adds
  `FederalBaselineLine` ("Federal data, Fall 2024: 5.8%") under the headline; `newest.partial` adds
  `PartialReportedLine` under the (federal) funnel instead. Every displayed figure is cited with
  `citeField(newest.paths.<field>, school)`, which resolves to the right `reported.admissions.*` or `admissions.*`
  path for the source in play.
- **Overview card** (`components/profile/AdmissionsCard.tsx`): the same `profile.newest` drives the ring, headline
  rate, admit-ratio title (`admitRatioFromRate`, a `lib/metrics.ts` export that takes a rate instead of a `School` so
  it works with either source), and the Applied/Admitted/Yield stats row; `FederalBaselineLine`/`PartialReportedLine`
  replace the phase-1 `ReportedRateLine`.
- **`lib/insights.ts`**: `admissionsTakeaway` and `yieldTakeaway` import `newestAdmissions` directly (the one file
  outside the admissions page allowed to — `tests/reported-guards.test.mts` bans the import everywhere comparisons,
  ranks, or charts live, not here) so the takeaway sentence names the newest rate; the national-percentile comparison
  inside it still comes from `rankOf`, which is always federal.
- **`reported.*` fields** in `TOPIC_FIELDS.admissions` (all four) and `OVERVIEW_FIELDS` (acceptance rate) in
  `lib/profile-topics.ts` are unchanged from phase 1.
- **Popover copy** (`components/ui/info-tip.tsx`, revised 2026-10-03): a `college-site` value reads "Reported by
  {college} in its Common Data Set {year}" or "…in its class profile for the {year} class", then the quote, the
  link, "Federal data, {year}: {value}" for what it replaced, and the retrieval date. No chips anywhere.
- **Data page** (`app/data/page.tsx`): section 4 says every figure is the newest its college has published, in every
  view, with years that can differ between colleges; section 5's count says "in use across the site".
- **Explore/Compare note** (`components/ui/BaselineNote.tsx`): figures are the newest each college has published;
  years can differ; each value's ⓘ shows source and year.
- **Guard**: `tests/reported-guards.test.mts` still greps the phase-1 banned files/dirs for any `school.reported`
  reference, and adds a second check banning `lib/newest`/`newestAdmissions` from the same comparison-only files
  (`lib/metrics.ts`, `lib/dataset.ts`, `lib/compare.ts`, `lib/indicators.ts`, `app/explore/**`, `app/compare/**`,
  `app/page.tsx`, `components/charts/**` — a narrower list than the `school.reported` ban, since `lib/insights.ts` is
  allowed to use `lib/newest`). Verified to fail: a throwaway `import { newestAdmissions } from "./newest"` was added
  to `lib/metrics.ts`, the guard test was run and failed on that line, then the line was reverted (not committed).
- **Not built with this PR**: the ingestion pipeline itself (`scripts/sync-college-reported.mts`) and
  `scripts/merge-reported.mts` — both specified and built separately
  ([college-reported-round-2.md](college-reported-round-2.md), decisions 2–5).
