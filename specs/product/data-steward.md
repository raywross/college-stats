# Data Steward: An Agent That Clears the Review Queue, and Operations Built Around It

> Status: **planned** 2026-10-13. Asked by the owner after Operations went live: "it's not particularly usable from
> there, as it's going to require some type of agentic workflow." Written after one pass of exactly that work, done
> by hand in a Claude Code session (PR [#153](https://github.com/raywross/college-stats/pull/153)): the pass's
> findings are the evidence for every choice below. Replaces the Review queue and Approvals halves of
> [admin.md Operations](admin.md#operations-reruns-and-approvals); Runs and Start a run stay. Part of
> [product](README.md).

## Goal
The owner should never read the review queue item by item. An agent, the **Data Steward**, reads it after every
pipeline run (and when asked), groups it into a handful of **issues** with a cause each, checks each cause against the
colleges' own documents, and turns what it can prove into **proposals**: pull requests with the evidence attached.
The owner reads a page of proposals, not 14,000 rows, and approves, declines, or asks a question. Nothing reaches the
site without that approval and the CI checks every data PR already runs.

## What the first pass found (2026-10-13)
The queue held **20,811 items at 383 colleges**. One session's work, all of it the kind the Steward is for:

| Finding | Items | How it was found | Resolution |
|---|---|---|---|
| The re-judge script never touched the queue: values that had passed stayed queued | 2,450 | queue vs. record status | code fix: `queueAfterRejudge` |
| The 2025-26 form's running header says "Common Data Set 2024-2025"; eight colleges' documents were held whole | ~4,150 | clustered `edition-mismatch` by detail, then read the 8 PDFs' C1 and B22 years | check fix: items' own years outrank the header |
| B22 quotes either the cohort fall or the census fall; the check accepted only one | 111 (+ confirms) | read the quotes of every mismatch | check fix: E or E − 1 |
| Unblocking those documents would have published grid marks read a column off | 61 | read every C7 and C8A grid in the 8 PDFs | `misread` holds with what the PDF shows |
| **The same misreads are live**: in 8 published colleges sampled, about half the C7/C8 marks are under the wrong column | ~3,550 values at ~189 colleges | sample of passed values vs. PDFs | owner decision (below) |
| Documents filed under the wrong edition (Illinois Wesleyan's 2020-21 as 2025-26; Pikeville's 2024-25 as 2025-26) | ~1,840 | the item-text years | refile: not done, needs the owner |
| A stopped run's PR (#141) that can't merge, holding $14 of discovery | 50 recipes | diff against main | carried over, PR closed |

Result: 20,811 → 14,568 items, no new value published that the PDF contradicts, and two systemic problems found
that no item in the queue pointed at. Lessons that shape the design:

1. **The unit of work is a cause, not an item.** 70% of the volume came from three causes. Items are evidence.
2. **Every resolution was one of seven kinds** (below). The Steward's output is typed by them.
3. **Proof needs the document.** Every finding came from reading the PDF; the queue's detail strings were only
   pointers. The archive must be reachable, which today it isn't (see [Prerequisites](#prerequisites)).
4. **Passing is not the same as right.** The worst problem (C7/C8 columns) was in values that passed every check. The
   Steward also samples *passed* values, per check family, against their documents.
5. **Fixing a check is a two-sided change.** Loosening `edition-mismatch` freed 4,000 values, including the misread
   grids. A check-fix proposal always lists the values it would publish and samples them against the documents before
   it's offered.

## The seven kinds of resolution
| Kind | What changes | Who can approve | Cost |
|---|---|---|---|
| **Check fix** | `lib/cds-checks.ts` + a test + `npm run check-cds-records` + rebuilds | owner | $0 |
| **Pipeline fix** | queue, reader, or discovery code | owner | $0 |
| **Hold** (`misread`) | a record's items, with what the document shows (`npm run hold-misread`) | owner | $0 |
| **Correct** | a record's item value, cited to page and line, `method: "corrected"` (new) | owner | $0 |
| **Refile** | a document's `edition` (and its items' years) | owner | $0 |
| **Re-read** | dispatch `college-reported.yml` `mode: college` for named colleges, or a schema bump | owner, with the projected cost | $ |
| **Recipe** | `data/college-sources.json` (new link, clear for rediscovery, drop a bad one) | owner | $ next run |

Plus **reject** (the document is right and nothing is publishable: `resolved: rejected`, as today) and **leave**
(queued for a reason no change fixes yet, with the reason). A correction lives in the record, not in
`data/overrides.json`: overrides apply only in `npm run sync-data`, while the record is what `merge-reported` reads.

## The Steward

### What a run does
1. **Cluster.** Group open items by check and a normalized detail (numbers, years, codes masked), then by document.
   Each cluster gets a size, its colleges, and up to five example items. Recompute after every merge.
2. **Triage.** For the largest clusters (by items, then by colleges whose published value is affected), write a
   hypothesis: check bug, reader bug, document problem, misfiled edition, or a real disagreement.
3. **Verify.** Read the documents behind a sample of the cluster (the archive copy by sha256; the PDF's text with
   layout, and the page image when the text is ambiguous) until the hypothesis holds or fails. Record what each
   document shows, with page and line.
4. **Propose.** One proposal per cause: a branch `steward/<cause>-<date>`, the change, `npm run verify`, and a PR whose
   body follows [Proposals](#proposals). A proposal that would publish values also samples them (lesson 5).
5. **Audit.** Each run, sample a few passed values from one check family in rotation (C7/C8 grids, C9 bands, B4–B11
   grids, H2), compare with the documents, and open an issue when the error rate is above 5%.
6. **Report.** A run summary (clusters, proposals opened, audits, spend) as the PR-less output, stored in
   `data/reports/steward-<run>.json` and shown on Operations.

### What it may and may not do
- **May**: read the repository, the records, the queue, the archive; run the repo's scripts and tests; create
  `steward/*` branches; open, update, and comment on its own PRs; write `data/reports/steward-*.json`.
- **May not**: merge anything, push to `main`, edit `.github/workflows/`, dispatch a paid run, or spend more than the
  run's budget. A re-read is a proposal; the owner's approval dispatches it.
- **Never** publishes a value it hasn't compared with the document. A correction or hold cites page and line; a check
  fix lists what it frees, and its sample.

### Where it runs
**Recommended: GitHub Actions, `steward.yml`, running Claude Code** (the Claude Agent SDK, or `claude-code-action`),
because everything it needs is already there: the checkout, `npm ci`, the archive token, `pdftotext`, and the ability
to open PRs with the App's token. Triggers:
- `workflow_run` after `college-reported.yml` completes (the queue just changed);
- `workflow_dispatch` from Operations with `cause` (one cluster's key) or `unit` (one college), and `request_id`;
- a weekly schedule for the audit alone.

The alternative is **Managed Agents** (Anthropic hosts the loop and a sandbox per session; scheduled deployments;
"outcomes" grade the work against a rubric until it passes). It removes the workflow file, but the sandbox needs the
repository cloned and GitHub credentials through a vault, and the archive token as well; nothing is gained over
Actions while the pipeline itself runs there. Revisit if the Steward needs to run longer than a job's 6-hour limit.

### Models and cost
- The Steward itself: **`claude-opus-5`**, adaptive thinking, effort `high` (triage and proofs are judgment-heavy).
- Reading a cluster's sample of documents fans out to sub-agents on **`claude-sonnet-5`** (`claude-haiku-4-5` for a
  plain "what does line N say"), each returning a short structured finding, so the main context holds conclusions,
  not PDFs.
- Budget per run: **$5 default, $20 on dispatch**, shown on the dispatch form. The first pass's investigation,
  done by hand, would have been about 30 document reads and a few hours of agent time.
- Re-reads stay on the pipeline's Batch API path at half price, exactly as today; the Steward only proposes them.

### Proposals
A proposal is a PR labeled `steward` with a fixed body, rendered on Operations:
```
Cause: <one sentence>
Kind: check fix | pipeline fix | hold | correct | refile | re-read | recipe
Affected: <n> items at <n> colleges; <n> published values change (list)
Evidence: per document checked: college, edition, page/line, what it shows, what we hold
Sample of what this publishes: <n> values checked against their documents, <n> wrong (each listed)
Cost: $0 | projected $x (re-read)
Reverting: <how>
```
Operations' **Approve** merges it (squash; refused while checks are pending or failed); **Ask** posts the owner's
question as a comment and re-dispatches the Steward on the same branch to answer it; **Decline** closes it with a
reason the next run reads, so the same proposal isn't made twice.

## Operations, redesigned
| Section | Today | New |
|---|---|---|
| Start a run | forms per workflow | kept; adds **Run the Steward** (budget, optional cause or college) |
| Runs | last 30 runs | kept; Steward runs show proposals opened and spend |
| Open data PRs | data PRs with Approve, Hold, Close | becomes **Proposals**: Steward PRs first, then pipeline PRs, each with the proposal summary |
| Review queue | 25 items per page of 14,000 | becomes **Issues**: clusters with size, cause, status (new, investigating, proposed, waiting on owner, left), and the item table one click down |
| — | — | **Audits**: per check family, the latest sample's error rate and the values found wrong |

The per-item Accept / Reject buttons go: accepting one item at a time is how 14,000 items happen. A single item can
still be held, corrected, or rejected from its college's Health page, which writes the same kind of proposal.

## Prerequisites
1. **The document archive** ([college-reported-setup.md §9](../college-reported-setup.md#9-archive-repo-and-token)).
   `COLLEGE_DOCS_REPO` isn't set, so every document is archived only in the Actions cache (evicted after 7 days
   unused), and every manifest entry reads `local:`. Without it the Steward can't read a document it didn't fetch
   itself, and a re-judge can't re-run the line checks (`number-on-line`, the cover check). **Blocking.**
2. **Line text kept with each PDF** (`<sha>.lines.json.gz`, already written when the archive repo is set): lets a
   check-fix proposal re-judge line checks and lets a grid-column check exist.
3. `ANTHROPIC_API_KEY` in Actions (exists), and the Quad console App's permissions plus **Issues: write** if Issues
   are mirrored to GitHub (not required).

## Build order
1. Archive repo set up; a backfill job re-fetches every manifest document still on its source and uploads it.
2. `lib/admin/clusters.ts`: the clustering, tested on the committed queue (pure, $0). Issues section on Operations.
3. `steward.yml` + the Steward's instructions (`.claude/agents/steward.md`) + the proposal body check (a CI job that
   fails a `steward` PR missing Evidence or Sample). First runs dispatched by hand, budget $5.
4. Proposals section, Ask and Decline.
5. Audits: the rotation and the weekly schedule.
6. A **grid-column check**: from the line text's x positions, the column each C7/C8A mark sits under, compared with
   the headings. Retires the hold below.

## Tests
- Clustering: the committed queue's top clusters are stable under re-ordering and number changes; a cause key
  doesn't merge two checks.
- A `steward` PR without Evidence, or a check fix without a Sample, fails CI.
- The Steward's workflow has no `contents: write` on `main`, and its token can't merge (branch rule or App scope).
- Approve refuses a proposal whose checks haven't passed; Decline's reason is in the next run's input.

## Owner decisions
1. **The live C7/C8 grids.** About 3,550 grid values at ~189 colleges come from a model reading a flattened PDF, and
   the sample suggests about half are a column off (for example Harvard's alumni relation shows Very Important; the
   PDF marks Considered). Recommended: **hold them all now** with a rule-based `grid-column` failure on model-read
   C7 and C8A rows (about 20 lines in `lib/cds-checks.ts`, tried on 2026-10-13: it holds 3,680 record items, kept out
   of the queue and the circuit breaker) until the grid-column check exists. Cost: those colleges show the federal
   factors and test policy instead, and the chances estimate loses CDS factors there (Purdue's GPA weight, for one).
   The alternative is to leave them and let the Steward's first audit hold the wrong ones college by college.
2. **Where it runs.** Recommended: Actions with Claude Code. Alternative: Managed Agents (above).
3. **Budget.** Recommended: $5 per automatic run, $20 per dispatched run, $40 a week in total; the Steward stops and
   reports at its limit.
4. **Refiling.** Recommended: the Steward may propose refiling a document to another edition when two of the items'
   own years agree on it; the owner approves each.
5. **Auto-approve.** Recommended: none at first. After a month, holds (which only remove values from the site) could
   merge without the owner when CI passes.

## Open questions
- Should Issues mirror to GitHub Issues, so they can be discussed there? Recommended: no; the console is the place,
  and a PR is where discussion of a change happens.
- Should the Steward also look at `data/college-failures.json` (fetch failures, dead links)? Recommended: yes, as a
  cluster source in step 2, with recipe proposals; it's the same loop.
