# College-Reported Data, Round 2: What the Pilot Taught Us

> Status: **built** 2026-10-03 (see [As built](#as-built)). Follows [college-reported-data.md](college-reported-data.md)
> (phase 1, PR #50) and its first pilot run (PR #51). Changes three things: **the newest figure a college has
> published is what the profile shows** (not a side block), discovery costs about a tenth of what it did, and every
> run saves as it goes. Decided with the owner 2026-10-03.

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

## Decision 1: show the newest figures we have

**Rule.** On a college's profile, the admissions headline figures (applicants, admitted, enrolled, admit rate, yield)
come from the **newest class the college has published**, whichever source that is: a college-reported value
(`school.reported.admissions`, from its CDS or class profile) when it describes a newer fall than the federal
admissions year, otherwise the federal or hand-imported CDS value as today. The year is always shown with the figure
and the chip says where it came from. **A profile may mix years**: the admit rate can be fall 2025 while SAT ranges
are fall 2024. Each value carries its own year, so this is honest; the owner prefers fresher numbers to uniform ones.

**What stays federal.** Explore, Compare, ranks, medians, percentiles, similar-school matching, trend indicators,
history charts, and Home facts keep using the federal values. Those compare colleges with one another, and most
colleges have no newer figure; mixing in a few colleges' newest classes would compare one college's fall 2025 with
another's fall 2024. `BaselineNote` on Explore and Compare says so, and the guard test
(`tests/reported-guards.test.mts`) keeps `school.reported` out of that code. This is the only place the owner's
"newest everywhere" preference is narrowed; it is easy to revisit per view.

**The funnel never mixes sources.** Applicants, admitted, enrolled, and the rate shown together come from one source:
the college-reported set when it has at least applicants and admitted (or a stated rate), otherwise the federal set.
A college that published only applicants for fall 2026 keeps its federal fall 2024 funnel and shows the newer
applicant count as a line beneath ("Fall 2026: 46,618 applied · reported by the college").

**The federal figure stays one line away.** Under a college-reported headline the page shows "Federal data, fall
2024: 5.8%", cited, so the comparison baseline is visible and the change is readable.

**Where this applies.** `lib/newest.ts` (pure): `newestAdmissions(school)` → `{ source: "reported" | "federal",
year, term, applicants, admitted, enrolled, acceptance_rate, paths }` where `paths` are the field paths to cite for
each value (`reported.admissions.*` or `admissions.*`). Used by the admissions topic page, the overview admissions
card and tile, the takeaway sentence, the admit-ratio headline, and the yield ring. `derived.yield` stays registered
against the federal inputs; a yield from reported counts is computed by the resolver and cited to the reported paths.

**Hand-imported CDS overrides** (8 colleges, `data/overrides.json`) are unchanged: they already replace federal values
in `schools.json`. A college-reported figure newer than an override's edition still wins on the profile. The backlog
item to keep newer overrides out of comparisons stands.

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
circuit breaker's change-share limit, the schedule, and the display rule that comparisons stay federal.

## As built

Built 2026-10-03 on `feature/college-reported-2` (includes #52's incremental writes and the CDS-year fix).

### Newest-first display
- `lib/newest.ts`: `newestAdmissions(school)` (pure; `tests/newest.test.mts`). Picks the college-reported funnel when
  it is newer than the federal year and has applicants and admitted (or a stated rate), else federal; never mixes
  the two within the funnel; exposes the field paths to cite.
- Admissions topic page, `AdmissionsCard`, the overview tile, `admissionsTakeaway`, `admitRatio` use it. Under a
  college-reported headline: "Federal data, {year}: {rate}" (cited). A partial newer figure (applicants only) shows
  as a line under the federal funnel. Chips: `College Fall 2025`.
- Explore, Compare, ranks, medians, trends, Home: unchanged, guarded by `tests/reported-guards.test.mts`.
- `/data`: section 4 now says profiles show the newest figure a college has published, comparisons use federal data.

### Discovery and escalation
- `scripts/lib/college-reported/llm.mts`: links-only discovery (capped web fetch, no document reads, streaming,
  `maxRetries: 1`, effort low, cache on continuation), Sonnet re-extraction as the only escalation; Opus removed.
- `scripts/lib/college-reported/guess.mts`: next-edition URL guessing from `school.cds.url` and prior CDS sources.
- `unreachable` check id; the breaker counts check failures only.
- `--max-cost`; the workflow input `max_cost`.

### Data in the PR
- `scripts/merge-reported.mts` (`npm run merge-reported`); the workflow runs it and commits `data/schools.json`.
- PR body: published colleges table, unreachable list.

### Specs updated
[college-reported-data.md](college-reported-data.md) (display, escalation, cost), [data-lineage.md](data-lineage.md)
(rule 3), [data-page.md](data-page.md), [school-profile.md](school-profile.md),
[college-reported-setup.md](college-reported-setup.md) (max cost, merge step, what a run costs now),
[backlog.md](backlog.md).
