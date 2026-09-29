# College-Reported Data (Ingestion Agent)

> Status: **planned** (not built). Decided 2026-09-28. Depends on [data-lineage.md](data-lineage.md). Absorbs the
> backlog items "Read Common Data Set PDFs" and "Expand Common Data Set coverage".

## Why
Federal data lags by design. As of 2026-09-28 the newest federal admissions data is **fall 2024** (IPEDS ADM2024, released
Dec 2025); fall 2025 arrives about Dec 2026. Colleges publish sooner:
- **Common Data Set 2025–26** (fall 2025 entering class, 2025–26 aid): posted by many colleges Feb–Aug 2026, mostly as PDF.
- **Class profiles / admissions news for fall 2026** (the class that just arrived): posted Aug–Oct 2026, e.g. Princeton
  4.0% of 46,618; Columbia 4.23% of 61,031; USC 11.7%.

## Scope
- **Phase 1: admissions** (applicants, admitted, enrolled, admit rate, year, cohort) for the newest year a college
  has published. Priority set by the user: fresher admit rates first.
- **Later:** 2026–27 tuition and cost of attendance; CDS section H aid (need met, merit); B1/B2 enrollment.
- **All 1,893 colleges** are attempted. Coverage is limited by what colleges publish: selective colleges post class
  profiles; many others post only a CDS; some post neither and stay federal-only. The pilot measures hit rates by tier.

## Decisions (2026-09-28)
- Values that pass every automated check **publish automatically**. Anything that fails goes to a review queue and is
  not published.
- **Start with cheaper models.** A stronger model is used only to learn a college's format (discovery) and when a
  format changes; routine extraction uses the cheapest model that passes the pilot.
- **Never re-read a document we've already processed** unless it changed.
- Federal data remains the comparison baseline ([data-lineage.md](data-lineage.md#rules)).

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
   college. If that fails too, use `claude-opus-5` once; still failing → review queue.

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
- **Circuit breaker:** no auto-merge if more than 10% of attempted colleges fail checks, or more than 25% of published
  values change in one run. That points to a pipeline or model problem, not the data.
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
See [data-lineage.md](data-lineage.md#display-which-citation-where). On a profile: "Admit rate, fall 2026: 4.0% ·
reported by the college" with the federal figure underneath and a lineage popover (quote, link, retrieved date,
"checked automatically"). Not used in Explore, Compare, ranks, medians, or Home charts.

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
- **Checkboxes** (CDS F2/F4/C7/H14) lose their labels in PDF text extraction (verified on UT's 2025–26 CDS), so these
  items go to a layout-aware parser or a vision call.
- **Access rules:** obey `robots.txt` and crawl delays, never get around bot protection, and ask organizations that
  cover many campuses for data directly ([religious-life.md](religious-life.md#access-rules-apply-to-both-specs)).

## Files (planned)
- `scripts/sync-college-reported.mts` (`npm run sync-college-reported`), `--pilot`, `--college <id>`, `--rediscover`.
- `data/college-sources.json` (recipes, hashes), `data/college-reported.json` (published values),
  `data/review-queue.json`, `data/reports/`.
- `.github/workflows/college-reported.yml`. Secret: `ANTHROPIC_API_KEY`.
