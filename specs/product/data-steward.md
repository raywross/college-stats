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

## The kinds of resolution
| Kind | What changes | Who can approve | Cost |
|---|---|---|---|
| **Check fix** | `lib/cds-checks.ts` + a test + `npm run check-cds-records` + rebuilds | owner | $0 |
| **Pipeline fix** | queue, reader, or discovery code | owner | $0 |
| **Hold** (`misread`) | a record's items, with what the document shows (`npm run hold-misread`) | owner | $0 |
| **Correct** | a record's item value, cited to page and line, `method: "corrected"` (new) | owner | $0 |
| **Refile** | a document's `edition` (and its items' years) | owner | $0 |
| **Re-read** | dispatch `college-reported.yml` `mode: college` for named colleges, or a schema bump | owner, with the projected cost | $ |
| **Recipe** | `data/college-sources.json` (new link, clear for rediscovery, drop a bad one) | owner | $ next run |
| **Publish** | a held item that is right as read (a real disagreement with federal data), with the reason | owner | $0 |

Plus **reject** (the document is right and nothing is publishable: `resolved: rejected`, as today) and **leave**
(queued for a reason no change fixes yet, with the reason). A correction lives in the record, not in
`data/overrides.json`: overrides apply only in `npm run sync-data`, while the record is what `merge-reported` reads.

## The Steward

### What a run does
1. **Cluster.** Group open items by check and a normalized detail (numbers, years, codes masked), then by document.
   Each cluster gets a size, its colleges, and up to five example items. Recompute after every merge.
2. **Triage.** For the largest clusters (by items, then by colleges whose published value is affected), write a
   hypothesis: check bug, reader bug, document problem, misfiled edition, or a real disagreement, and sort it into one
   of the [four kinds of issue](#four-kinds-of-issue-each-resolved-its-own-way). Acquisition issues become To do tasks
   and policy questions become Decisions; neither becomes a PR.
3. **Verify.** Read the documents behind a sample of the cluster (the archive copy by sha256; the PDF's text with
   layout, and the page image when the text is ambiguous) until the hypothesis holds or fails. Record what each
   document shows, with page and line.
4. **Propose.** One proposal per cause: a branch `steward/<cause>-<date>`, the change, `npm run verify`, and a PR whose
   body follows [Proposals](#proposals). A proposal that would publish values also samples them (lesson 5). Value
   proposals write their rows file first and generate the change from it.
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

## Four kinds of issue, each resolved its own way
Not everything the queue holds is a decision about a value. The Steward sorts every issue into one of four, and each
has its own place in the console:

| Kind | What it is | Example from the first pass | Resolved by | Where |
|---|---|---|---|---|
| **Value** | One college's figure: hold it, correct it, publish it, refile its document, or leave it | Neumann's C7 read a column off; Pikeville's document filed under the wrong year | a decision per row, with the Steward's recommendation | the college's **Review** page, and the proposal it belongs to |
| **Systemic** | A rule or the pipeline is wrong for every college it touches | the stale "2024-2025" header; the queue never following a re-check | approving or declining the whole change (it's code) | **Proposals** |
| **Acquisition** | We can't get or read the document; no decision about a value can help | Juilliard's site blocks us; Northwestern's CDS link is a 404; a SharePoint link needs a login | a person: find the link in a browser, upload the file, or mark "no CDS published" | **To do** (owner tasks) |
| **Policy** | A choice only the owner makes, often affecting many colleges at once | hold every model-read C7/C8 grid; how old a figure may be and still show | a written decision, recorded in the spec and the Steward's instructions | **Decisions** |

A **real disagreement** (a college's figure differs from the federal one because the cohorts differ, and both are
right) is a value issue with the recommendation "publish; differs from federal because …", so the reason travels with
the figure.

### The college's Review page: `/admin/colleges/[unit]/review`
Everything pending for one school on one page, linked from the college's admin page, its Health row, and every
proposal that touches it. One row per field (Neumann, as it stood after the first pass; proposal numbers are
illustrative):

| Field | On the site now | Proposed | From | Issue | Recommends | Proposal |
|---|---|---|---|---|---|---|
| Class rank (C7) | Considered · CDS 2025-26 | Not considered · CDS 2025-26 (corrected) | C7 grid: X under "Not Considered" · [PDF] | read a column off | **Approve** | correct #161 |
| Legacy (C7) | Considered · CDS 2025-26 | Not considered (corrected) | C7 grid, Alumni/ae relation row · [PDF] | read a column off | **Approve** | correct #161 |
| Retention | 72.1% · IPEDS, fall 2023 class | 69.6% · CDS 2025-26, fall 2024 class | B22: "69.63%" · [PDF] | held by the stale header check | **Approve** | check fix #160 |
| Test policy (C8A) | Not considered · IPEDS | — | C8A: "No"; every mark under "Not considered" | none: the CDS agrees | — | — |

- **On the site now** is what a visitor sees, with its source and year, so a decision is always "this instead of that".
- **From** links to the document at the page (the archive copy), with the cited line quoted.
- **Recommends** is *Approve* (the Steward checked the document and is confident) or *Your call* (the evidence is
  mixed, and the row says why). A change the Steward doesn't believe isn't proposed.
- A row that belongs to a **value** proposal has its own tick box here and on the proposal; deciding it in either
  place decides it in both. A row that belongs to a **systemic** proposal shows its effect at this college and links
  to the proposal; it can't be decided alone.
- The school's acquisition tasks (no CDS found, blocked host) show at the top of the page, with the upload.
- **Colleges to review** (on Operations) lists the colleges with pending rows, ordered by how many visible figures
  would change, then by "your call" rows, with the count of each.

### Proposals
A proposal is a PR labeled `steward`. A **systemic** proposal has a fixed body, rendered on Operations:
```
Cause: <one sentence>
Kind: check fix | pipeline fix
Affected: <n> items at <n> colleges; <n> published values change (list)
Evidence: per document checked: college, edition, page/line, what it shows
Sample of what this publishes: <n> values checked against their documents, <n> wrong (each listed)
Reverting: <how>
```
It is approved or declined whole. If one row of its evidence looks wrong, **Ask** posts the question and re-dispatches
the Steward on the same branch to answer it (it may narrow the rule or add holds).

A **value** proposal (hold, correct, refile, publish, recipe, re-read) carries its rows in
`data/reports/steward/<proposal>.json`, one per college and field, with the columns of the Review page. The branch's
changes are generated from that file by a script (`npm run apply-proposal`), so:
- every row is pre-ticked to match its recommendation, and one button approves all the *Approve* rows;
- approving with rows unticked makes the console rebuild the branch from the ticked rows only (no agent run), CI runs,
  and it merges when green;
- an unticked row is recorded as declined, with the owner's reason if given; the next run doesn't propose it again
  unless the document changes;
- a re-read proposal shows a running cost total as rows are ticked.

Approve is refused while checks are pending or failed; Decline closes the whole proposal with a reason.

## Operations, redesigned
| Section | Today | New |
|---|---|---|
| Start a run | forms per workflow | kept; adds **Run the Steward** (budget, optional cause or college) |
| Runs | last 30 runs | kept; Steward runs show proposals opened and spend |
| Open data PRs | data PRs with Approve, Hold, Close | becomes **Proposals**: systemic first, then value proposals, then pipeline PRs |
| Review queue | 25 items per page of 14,000 | becomes **Colleges to review** (per school, above) and **Issues** (clusters by cause, with status: new, investigating, proposed, waiting on owner, left) |
| — | — | **To do**: acquisition tasks for a person, each with the college, what's missing, the hosts tried, and an upload |
| — | — | **Decisions**: policy questions waiting on the owner, with the Steward's recommendation and what each answer changes |
| — | — | **Audits**: per check family, the latest sample's error rate and the values found wrong |

The per-item Accept / Reject buttons over the raw queue go: deciding one queue item at a time is how 14,000 items
happen. A decision is always about a field at a college (the Review page) or about a cause (Proposals).

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
3. The college **Review** page over today's data (the queue, records, and what the site shows), before any agent:
   it's useful on its own and is where the Steward's rows will land. **To do** from `college-failures.json` and the
   blocked hosts, with the upload (`archive-doc`).
4. `steward.yml` + the Steward's instructions (`.claude/agents/steward.md`) + the proposal checks (a CI job that
   fails a systemic PR missing Evidence or Sample, or a value PR whose change doesn't match its rows file). First
   runs dispatched by hand, budget $5.
5. Proposals section: whole approval for systemic, per-row ticks for value (`apply-proposal`, rebuild on trim), Ask,
   Decline. Decisions section.
6. Audits: the rotation and the weekly schedule.
7. ~~A grid-column check~~ **Built 2026-10-13** (decision 1): `lib/grid-columns.ts` and `npm run check-grid-columns`
   place each model-read C7/C8A mark from the document's own layout (PDF layout text, or the workbook's cells); the
   `grid-column` check holds what couldn't be placed. First run: 3,212 marks placed (817 corrected), 958 held. The
   pipeline doesn't run it on new reads yet: until it does, a new run's grid marks stay held until the script runs.

## Tests
- Clustering: the committed queue's top clusters are stable under re-ordering and number changes; a cause key
  doesn't merge two checks.
- A `steward` PR without Evidence, or a check fix without a Sample, fails CI.
- The Steward's workflow has no `contents: write` on `main`, and its token can't merge (branch rule or App scope).
- Approve refuses a proposal whose checks haven't passed; Decline's reason is in the next run's input.
- A value proposal trimmed to some rows rebuilds to exactly those rows' changes (`apply-proposal` on a fixture); an
  unticked row is recorded as declined and isn't proposed again for the same document.
- The Review page shows, for each row, the value the site shows now (from the same reader the profile uses), so
  "now" can't drift from what visitors see; a systemic row has no tick box.
- Every issue the clustering produces has exactly one of the four kinds.

## Owner decisions
1. **Decided 2026-10-13: fix the columns.** Built as step 7 of the build order rather than a blanket hold: each mark
   placed by position, corrected where the model was wrong, held only where it can't be placed. The question as
   written: About 3,550 grid values at ~189 colleges come from a model reading a flattened PDF, and
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
- Should the Steward also look at `data/college-failures.json` (fetch failures, dead links)? Recommended: yes: a
  failure it can fix (a moved link it finds) is a recipe proposal; one it can't (a site that blocks us) is a To do.
- Should a To do upload go straight to the archive and a re-read, or through a proposal? Recommended: straight to the
  archive (the file is the person's own find), then the Steward reads it and its values arrive as a value proposal
  like any other.
