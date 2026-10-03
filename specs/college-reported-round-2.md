# College-Reported Data, Round 2: What the Pilot Taught Us

> Status: **built** 2026-10-03 (see [As built](#as-built)). Follows [college-reported-data.md](college-reported-data.md)
> (phase 1, PR #50) and its first pilot run (PR #51). Changes three things: **the newest figure a college has
> published is the value shown everywhere**, with the source in the tooltip rather than chips; discovery costs about
> a tenth of what it did; and every run saves as it goes. Decided with the owner 2026-10-03 (Decision 1 revised the
> same day).

## What the pilot showed (run `20261003-113224-1`, 50 colleges, 80 minutes)

| | Result |
|---|---|
| Published | 23 (corrected to 22: two Excel CDS files were labeled a year too new) |
| Sent to the review queue | 7 (of which 3 were sites that block automated fetches: 403/405) |
| Discovery timed out | 6 colleges (Maryland, Florida, Florida State, Wisconsin, BYU, Ohio State): nothing learned |
| Cost logged | **$80** (owner's console showed ~$98; timed-out calls aren't logged and the SDK retried them) |
| Discovery (Sonnet 5 + web tools) | 35 calls, **22 M input tokens**, $47 → about **627,000 tokens per call** |
| Escalation (Opus 5 discovery + extraction) | 37 calls, 5.8 M input tokens, $33 |
| Extraction (Haiku 4.5) | 36 calls, 183 K input tokens, **$0.20** |

So the spec's estimate ($0.10–0.25 per college) was ten times too low for discovery, and extraction was far cheaper
than estimated. Reasons, from the log and the code:

1. **Discovery read whole documents.** Web fetch returned entire CDS PDFs and class-profile pages (tens of thousands
   of tokens each), up to 8 of them, inside one call. Every internal tool turn resends them all. A recipe needs only
   URLs; the extractor reads the document afterwards.
2. **Escalation repeated the expensive step with the most expensive model.** Any failed check sent the college to a
   second Sonnet discovery and then an Opus 5 discovery plus extraction, even when the failure was a blocked site
   (403), which no model can fix. 17 of 50 colleges escalated.
3. **Timeouts were retried and lost.** Discovery was a non-streaming call that ran past the SDK's 10-minute limit; the
   SDK retried it twice (billed, unlogged), then gave up with nothing saved.
4. **Nothing was written until the end**, so a budget stop or cancel would have lost the run (fixed in #52).
5. **An Excel CDS that doesn't name its edition took its year from the URL**, where an upload-date folder
   (`/2026/09/CDS_2025-2026.xlsx`) won (fixed in #52).

Accuracy where a figure was found: 8 of the 22 matched the hand-checked answer key exactly, 4 differed from
secondary-source answers by a few hundred (Duke, Stanford, Vanderbilt's rate), and the rest described a different
class than the key had (the pipeline took the CDS's fall 2025, the key a fall 2026 news item, or the reverse). The
checks caught real problems: UCLA's stated rate didn't match its counts; Georgia Tech's two documents disagreed.

## Decision 1: show the newest figures we have, everywhere

Revised 2026-10-03 after the owner saw the first version (chips, a federal line under each headline, comparisons
kept federal) and asked for something quieter and simpler.

**Rule.** The admissions figures a college shows are **the newest it has published**, in every view: the profile,
Explore, Compare, ranks, medians, the home page. A college-reported value from its newest CDS or class profile
replaces the federal value **in the dataset itself** (`data/schools.json`), the way the 8 hand-imported CDS overrides
already do, with a lineage record per value. Comparisons therefore compare the newest each college has against the
newest the other has, even when the years differ. The year is in every value's ⓘ tooltip.

**No chips, no extra lines.** The green source chips and the "Figures marked like this come from…" line above the
tiles are gone from every page. The ⓘ tooltip carries everything: the source and its kind ("Duke University's class
profile for the fall 2026 class", "Harvard University's Common Data Set 2025–26"), the year, the quote, the link, the
retrieval date, and, for a value that replaced a federal one, the federal figure it replaced ("Federal data, fall
2024: 5.8%"). Compare's "All the numbers" table shows a small muted year next to a value whose year differs from the
row's usual one, so two colleges on different years are readable without a chip.

**What replaces what.** `applyNewest` (`lib/newest.ts`, pure; used by `merge-reported` and `sync-data`) rewrites a
school whose `reported.admissions` describes a newer fall than `admissions.year`:
- applicants, admitted, enrolled: each replaced when the college published it; otherwise the federal value stays,
  with its own (federal) year in the tooltip. A profile and even a funnel can mix years; each value says its own.
- acceptance_rate: the college's stated rate; else admitted ÷ applicants when both were published; else the federal
  rate, kept with an explicit lineage record (`source: "ipeds-adm"`, `method: "derived"`, the federal year) so the
  tooltip says it's calculated from the federal counts, not from the mixed ones shown.
- year: the reported class's year when applicants or admitted were replaced; else unchanged.
- `admissions.federal` (new registered field, IPEDS ADM): the federal `{ year, applicants, admitted, enrolled,
  acceptance_rate }`, stored only when something was replaced, for the tooltip's "Federal data…" line and for yield.
- yield (`derived.yield`, render time): enrolled ÷ admitted only when both describe the same class (same lineage
  year); otherwise from `admissions.federal`'s pair, cited to the federal year. Never a mixed-year ratio.
- SAT/ACT, submission rates, test policy, by-sex, factors: federal (the agent doesn't read them yet).
- Hand-imported CDS overrides (`data/overrides.json`): a college-reported class newer than the override's edition
  replaces it the same way; `admissions.federal` then holds the override's values (the previous value), labeled by
  its own source.

`school.reported` stays in the file as the agent's raw record (the Data page's count and `report-college-reported`
read it). The lineage guard requires every replaced `admissions.*` value to carry an `extracted` (or, for a rate
calculated from the college's counts, `derived`) record and `reported.admissions.year` to be newer than
`admissions.federal.year`.

**History and trends** stay federal, as for CDS overrides today: the "Over time" admissions charts end on the federal
year while the headline may be a year newer; the existing note says so. The history latest-point check skips any
value with a lineage record.

## Decision 2: discovery finds links, not figures

Discovery's only job is to return URLs. It must not read documents.

- **Web fetch is capped** at 6,000 tokens per page (`max_content_tokens`), 4 fetches and 4 searches per college, and
  the system prompt says to open only HTML pages that list or link documents, never PDF or Excel files. The extractor
  reads those.
- **No page numbers or anchors from discovery.** The extractor finds section C1 itself (`selectPages` already searches
  for the anchor text; the default anchor for a CDS is "C1" and for a class profile "appl").
- **Guess before searching.** A college that already has a CDS URL (`school.cds.url`, or a recipe's last CDS source)
  gets next year's URL guessed by substituting the edition in the file name (`CDS_2024-2025.xlsx` →
  `CDS_2025-2026.xlsx`, `2024-25` → `2025-26`, `2024_25`, `2425` → `2526`). A HEAD/GET that returns a document of the
  right type becomes the recipe with no model call. Index pages are still re-scanned each run.
- **Streaming with one try.** Discovery streams (`messages.stream` → `finalMessage()`), so a long web-tool loop can't
  hit the client timeout, and the client is built with `maxRetries: 1` for discovery so a genuine failure isn't paid
  for three times. `pause_turn` continues as before, with `cache_control` on the last message so the resent turns are
  cache reads.
- **Effort `low`** for discovery; `medium` only on the one re-discovery.

Expected: a discovery call of roughly 15,000–40,000 input tokens (search results and a few capped pages) and under
1,500 output tokens, about **$0.05–0.12 per college** with the per-search charge; a guessed URL costs nothing.

## Decision 3: escalate only when a model can help

| What happened | Before | Now |
|---|---|---|
| Site blocks us (403/405/429, robots.txt), file 404 | Sonnet re-discovery, then Opus discovery + extraction | Review queue as **`unreachable`** with the URL; no model call. Not counted as a check failure by the breaker |
| Anchor not found / unreadable document | same | One Sonnet re-discovery (links only), then re-extract; still nothing → queue |
| A check failed on real figures (rate mismatch, sources disagree, implausible) | same | **Re-extract once with Sonnet 5** from the same document (a stronger reader, same cheap input); still failing → queue |
| Discovery found nothing | retried next `--rediscover` | unchanged |

Opus 5 is no longer called by the pipeline. `REPORTED_MODELS.escalation` becomes `claude-sonnet-5` and means
"the stronger extractor". The spec's circuit breaker counts only check failures (`failed`), so a batch of blocked
sites can't trip it; `unreachable` items are listed separately in the PR body.

## Decision 4: a dollar cap per run

`--max-cost <usd>` (default **$25** for `--pilot`/`--college`, **$150** for `--all`; the workflow passes an input)
stops the run cleanly at the cap, the same way as a spend-limit error (#52): finished colleges are kept, the summary
says `stopped` with the reason, exit code 3, and the PR says "Stopped early". The cap is checked before each college
starts, against the run's logged cost plus a per-college allowance of $0.50, so a run never overshoots by more than a
few colleges in flight. The owner's console spend limit remains the hard stop.

## Decision 5: the data PR carries the site's data too

A run's PR changed only the pipeline's files, so its preview looked like the live site and the figures reached
profiles only after someone ran `npm run sync-data`. Now:

- `npm run merge-reported` (`scripts/merge-reported.mts`): reads `data/schools.json` and `data/college-reported.json`,
  removes every school's `reported` block and `reported.*` lineage, applies the current entries (through
  `reportedToPatch`, exactly as `sync-data` does), validates lineage, and rewrites `schools.json` one school per line.
  No network, no API keys, a few seconds. `sync-data` keeps doing the same merge, so the two can't disagree.
- The workflow runs it after the pipeline and commits `schools.json` with the other files. The PR's Vercel preview
  (which reads the branch's JSON) then shows the new figures on profiles, and the merge publishes them to Supabase
  through the existing publish workflow.
- The PR body lists each published college with its term, source kind, and the values; the review queue and the
  `unreachable` list follow.

## Round 2.1: after the ten-college test (2026-10-03)

The first run on the round-2 code (10 colleges never tried before: Northwestern, Chicago, Rice, Emory, Carnegie
Mellon, Boston College, Washington, Georgia, Clemson, Elon) took **26.5 minutes and $1.93** against an estimate of
8–12 minutes and $0.60–1.40. 4 published (Rice, Emory, Carnegie Mellon, Elon, all fall 2025), 2 failed a check
(Chicago: the extractor hit its output limit on a PDF; Clemson: "42%" stated vs 42.43% computed), 1 unreachable
(Northwestern: discovery returned last year's CDS URL, which 404s), 3 found nothing newer (Boston College, Georgia,
and Washington, whose file host's robots.txt disallows the CDS). Discovery still averaged 266,000 input tokens per
call ($1.80 of the $1.93), and one college's discovery ran 17 minutes. Changes made in response:

- **Breaker: change share only.** The failure-share trigger (10% of attempted colleges) tripped in both runs on
  blocked sites and rounding, never on a real problem, and held back values that had passed their checks. Only the
  25%-of-published-values-changed trigger remains. Values that pass publish; failures go to the queue.
- **Auto-merge on by default** for manual runs too. The PR stays as the mechanism (CI, diff, queue in the body),
  not a review step.
- **Rate check tolerates printed precision**: a rate printed as a whole percent ("42%") may sit 0.5 pt from the
  computed one; one decimal 0.1 pt; two decimals 0.05 pt (`rateTolerancePts`).
- **Stale CDS links get next year's URL guessed beside them** (`withNextEditions`): a discovery result for an
  edition no newer than the federal year is tried alongside the 2025–26 and 2026–27 guesses.
- **Extraction output limit** 4,096 → 8,192 tokens.
- **Discovery tightened**: 3 searches, 3 fetches of at most 4,000 tokens, `max_tokens` 8,000, and a **6-minute
  timeout per college** (the stream is aborted; the college is queued, no retry).
- **Usage detail** in the run summary: cache reads, cache writes and web searches per job, so the next run can show
  where discovery's tokens go (the cost arithmetic already prices cache reads at a tenth).

## Expected cost after this round

| Run | Before (pilot, measured) | After (estimate) |
|---|---|---|
| 50-college pilot, all needing discovery | $80 logged (~$98 billed) | **$4–8** |
| First `--all` run, 1,893 colleges | ~$3,000–4,000 (extrapolated) | **$120–220** one-time discovery; capped at $150 per run by default, so it takes two runs |
| Steady-state monthly run (unchanged documents) | not measured | **under $5** (index re-checks and a few extractions) |
| Steady-state weekly fall run | not measured | **$5–20** when class profiles land (a few hundred new documents a season) |

These are estimates from token arithmetic, not measurements: the first run on the new code should be a `--pilot`
with `--max-cost 10`, and its summary (`data/reports/`) is the number to trust. The spec's budget ceiling
($1.5–3K/year) now has room in it.

## What did not change

The seven checks, the quote-per-number rule, the lineage guard, the `extracted` records, the review queue, the
circuit breaker's change-share limit, and the schedule.

## As built

Built 2026-10-03 on `feature/college-reported-2` (includes #52's incremental writes and the CDS-year fix).

### Newest-first display (revised)
Data layer, built 2026-10-03 on `feature/cr2-newest-data`:
- `lib/newest.ts` (pure, never mutates; `tests/newest.test.mts`):
  - `applyNewest(school)` does the replacement above when `reported.admissions.year` is newer than `admissions.year`
    (or that is null). Counts are replaced when published, each with a copy of its `reported.admissions.*` record;
    the rate is the stated one, else admitted ÷ applicants (`acceptanceRate`, ≥ 10 applicants) when both counts were
    replaced (`college-site`, `derived`, both quotes), else the previous rate kept with `{ source: <previous>,
    method: "derived", year: <previous> }`, or null with no record. `admissions.year` (and its record, from
    `reported.admissions.entering_term`) moves only when applicants or admitted were replaced. `admissions.federal`
    (placed right after `acceptance_rate`) holds the previous funnel; when that was a hand-imported CDS override,
    `lineage["admissions.federal"]` is the override's record. The previous funnel's provenance is
    `lineage["admissions.year"]`; a value whose own record differs (e.g. a Scorecard-only rate) is left alone so the
    undo is always exact. Returns the same object when there's nothing newer, nothing published, or the school is
    already applied (`admissions.federal` present).
  - `restoreFederal(school)` undoes it byte for byte: values from `admissions.federal`, rewritten records put back
    (the CDS record) or removed, `admissions.federal` and its record dropped, key order kept.
  - `newestAdmissions` remains only as a deprecated shim (reads `school.admissions`, no partial line) until the UI
    branch removes its callers.
- `lib/reported-merge.ts`: `stripReported` = `restoreFederal`, then drop `reported` and `reported.*` lineage (keeping
  `lineage`'s key position); `mergeReported` strips every school, re-adds each entry, then `applyNewest`. Untouched
  schools come back as the same object. Running it on the branch's 22 pilot colleges changed exactly those 22 lines
  of `data/schools.json`, and `restoreFederal` on each gives back the pre-merge line byte for byte.
- `scripts/sync-college-reported.mts` runs the pipeline against `restoreFederal(school)`, so its "newer than federal"
  and consistency checks compare against the baseline, not a previous run's replaced values.
- `lib/lineage.ts`: `validateSchool` (`validateNewest`) enforces the rules in [data-lineage.md](data-lineage.md)
  (replaced values extracted or derived with quote/url/retrieved/year, `admissions.federal` beside them, the year
  moved with applicants/admitted, a value differing from `admissions.federal` cited to the college, the reported year
  newer than `admissions.federal.year`). `lineageFor` fills `Cited.replaces` (year from `lineage["admissions.federal"]`
  for a CDS override, else "Fall {year}") and cites yield's inputs as the pair actually used.
- Yield: `lib/derive.ts#sameClassYield` (what `lib/metrics.ts#yieldRate` returns, so ranks and medians use it):
  enrolled ÷ admitted when their lineage years match, else `admissions.federal`'s pair, else null.
  `derived.yield` in `lib/fields.ts` lists `admissions.federal` as an input.
- History: `scripts/history/build.mts`'s latest-point check already skips any value with a lineage record (every
  replaced value, and the kept rate) and finds the federal fall from a college without an `admissions.year` record;
  `admissions.federal` isn't a series.
- Tests: `tests/newest.test.mts` (each rule, CDS override, idempotence, exact restore, yield both ways),
  `tests/merge-reported.test.mts` (newest values written, a CDS college restored exactly, the committed file equals a
  re-merge), `tests/lineage.test.mts` (`Cited.replaces` present with the right year or absent, each validator rule).
  Breaking the year rule in `validateNewest` and the same-class check in `sameClassYield` each failed a test; both
  were restored.
- No chips (`SourceChip`, `MetricLabel`'s chip, Compare's per-cell chips) and no `SourceExceptions` line anywhere.
  The ⓘ popover (`components/ui/info-tip.tsx`) shows the document kind, year, quote, link, date, and the replaced
  federal figure (`Cited.replaces`, filled by `lineageFor` from `admissions.federal`).
- The admissions page, cards, takeaways, Explore, Compare, ranks, medians, and Home read `school.admissions` as
  before; nothing resolves at render time. Compare cells show a muted year when it differs from the row's.
- `/data`: "How we compare" says every figure is the newest its college has published and years can differ.

### Discovery and escalation
- `scripts/lib/college-reported/llm.mts`: links-only discovery (capped web fetch, no document reads, streaming,
  `maxRetries: 1`, effort low, cache on continuation), Sonnet re-extraction as the only escalation; Opus removed.
- `scripts/lib/college-reported/guess.mts`: next-edition URL guessing from `school.cds.url` and prior CDS sources.
- `unreachable` check id; the breaker counts check failures only.
- `--max-cost`; the workflow input `max_cost`.

### Data in the PR
Built 2026-10-03.
- `lib/reported-merge.ts#mergeReported` (pure: strips every school's `reported` block and `reported.*` lineage, then
  re-applies the current `data/college-reported.json` entries through `reportedToPatch`) is the one merge, called by
  both `scripts/sync-data.mts` and the new `scripts/merge-reported.mts` (`npm run merge-reported`, `--dry-run`), so
  the two can't disagree. `merge-reported.mts` reads `data/schools.json` + `data/college-reported.json`, refuses to
  write if `validateLineage` finds a problem, and rewrites `data/schools.json` one school per line, same format as
  `sync-data`. No network, no API key, a few seconds. `ROOT` is overridable with `MERGE_REPORTED_ROOT` so
  `tests/merge-reported.test.mts` can run the real CLI against a scratch copy of a dataset slice instead of the
  committed files: adding the block and lineage, idempotence (byte-identical output on a second run), a college
  dropped from the file losing its block, and a bad entry's year refusing the write.
- The workflow runs `npm run merge-reported` right after the pipeline (`if: always()`, so a stopped/cancelled run
  still merges what it kept) and before the data-changed check, so the PR's `git add data` picks up
  `data/schools.json` alongside the pipeline's own files.
- `scripts/report-college-reported.mts` (`npm run report-college-reported`; logic in `lib/reported-report.ts`,
  tested in `tests/reported-report.test.mts`): a readable snapshot of `data/college-reported.json` — each published
  college's term, source kind, which values it has, URL, and run; totals by term and by source kind; and how many
  colleges in `data/schools.json` currently carry a `reported` block, so a person can tell at a glance whether the
  merge has run.
- PR body (`scripts/college-reported-pr-body.mts`): a **Published this run** table (college, term, kind,
  applicants, admitted, enrolled, rate, source URL) for `data/college-reported.json` entries whose `run` matches
  this run, resolving names from `data/schools.json` when given (falls back to the unit id); an **Unreachable**
  list for review-queue items whose failures include the `unreachable` check id (compared as a plain string, since
  that id is landing in `lib/reported.ts`'s `CheckId` on a parallel branch), kept out of the ordinary review-queue
  table since no model call could have fixed them; and a `guessed` row in the Summary table, shown only when the
  run summary has that optional field. The CLI takes `--reported` and `--schools` to supply these; both are
  optional, so the pre-Decision-5 fixture tests still pass unchanged. `tests/college-reported-pr-body.test.mts`
  gained fixtures (`reported.json`, an `unreachable` item in `review-queue.json`) and tests for all of this.

### Specs updated
[college-reported-data.md](college-reported-data.md) (display, escalation, cost), [data-lineage.md](data-lineage.md)
(rule 3), [data-page.md](data-page.md), [school-profile.md](school-profile.md),
[college-reported-setup.md](college-reported-setup.md) (max cost, merge step, what a run costs now),
[backlog.md](backlog.md).
