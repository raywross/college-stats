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
- **Later:** 2026–27 tuition and cost of attendance; CDS section H aid (need met, merit); B1/B2 enrollment.
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
  [college-reported-round-2.md](college-reported-round-2.md)'s As built.
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
  robots.txt is obeyed, the cost cap stops the run, the breaker trips just past its limits, and the summary counts.
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
