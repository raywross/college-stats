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
- The sync (`scripts/sync-data.mts`) reads `data/college-reported.json` after overrides are applied and before
  `validateLineage` runs: for each entry whose `unit_id` matches a school, it sets `school.reported.admissions` and
  spreads the entry's lineage into `school.lineage`. It never touches a federal field — `reported` and
  `reported.admissions.*` lineage are the only things it writes. Missing file = skipped (silent, since the pipeline
  hasn't published yet). Printed as `  college-reported:     N colleges`, alongside the other sync counts.
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
- **PR body and release note:** generated from the run summary and `data/review-queue.json` by
  `scripts/college-reported-pr-body.mts` (`prBody`, `releaseNote`; unit-tested against fixtures in
  `tests/college-reported-pr-body.test.mts`): counts, cost, circuit-breaker status, and a table of *this run's*
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
`npm run sync-college-reported` (`scripts/sync-college-reported.mts`) needs `ANTHROPIC_API_KEY` (`.env.local` or the
environment). Flags: `--pilot` (colleges in `data/reference/college-reported-pilot.json`, `{ "colleges": [{ unit_id,
tier, sector }] }`; without the file it picks 50 deterministically across admit-rate tiers × sectors and says so),
`--college <unit_id>` (repeatable), `--all` (every college; the scheduled mode), `--rediscover` (ignore stored
recipes; documents with the same URL keep their hashes, so unchanged files are still skipped), `--dry-run` (nothing
written to `data/`; downloads are still cached), `--max-discoveries N` (Sonnet discovery budget, default 100),
`--run <id>` (default: start time, ISO). Exit code 2 = circuit breaker tripped (files are still written).

Files, all under `scripts/lib/college-reported/` except the CLI:
- `pipeline.mts`: `createPipeline({ client, fetch, now, sleep?, minDelayMs?, cacheDir?, concurrency?, log? })` →
  `run({ schools, sources, reported, queue, run, rediscover?, maxDiscoveries? })`, working on the files' contents in
  memory and returning them updated with a `RunSummary`; `circuitBreaker()`.
- `llm.mts`: `discover()` (Sonnet 5, `web_search_20260209` + `web_fetch_20260209`, recipe returned through a strict
  `save_recipe` tool, `pause_turn` resumed) and `extract()` (Haiku 4.5, `output_config.format` = `EXTRACTION_SCHEMA`,
  falling back to a strict forced tool if a model rejects structured outputs; system prompt marked for caching).
- `http.mts`: robots.txt (RFC 9309; disallowed URLs are skipped and logged; an unreachable robots.txt disallows),
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
- Missing anchors and unreadable documents are queued as `quote-present` failures ("no figures read: …").
- Counts: `attempted` = colleges where something was read or discovered (an all-304 college is not an attempt);
  `changed` = published values that changed within the same entering term (a new term is a new year, not a change);
  the breaker's changed share is over all values in `college-reported.json` before the run.
- Tests (`tests/college-reported-pipeline.test.mts`) pass a fake client (answers `save_recipe` calls with a canned
  recipe and extraction calls with canned JSON, recording every request) and a fake fetch (a URL → response table).
  They prove: same hash and 304 skip the model (and send the conditional headers), a new index link is read alone,
  the Excel fixture (`tests/fixtures/cds-c1.xlsx`) is read deterministically and its entry passes `validateSchool`,
  a PDF fixture's page text reaches the model, failing checks escalate Haiku → Sonnet → Opus and land in the queue
  with nothing published, robots.txt is obeyed, the breaker trips just past its limits, and the summary counts.
