# Data Steward: An Agent That Clears the Review Queue, and Operations Built Around It

> Status: **planned** 2026-10-13; **revised** 2026-10-26 after the roadmap review (the acquisition work of
> [manual-collection.md](../manual-collection.md) and [campus-sources-later.md](../campus-sources-later.md) folded in as
> [Documents a person has to fetch](#documents-a-person-has-to-fetch)); **revised again 2026-11-01** against the system as
> it stands after the [data platform](../data-platform/README.md) (phases 1–4, 2026-10-31 to 2026-11-01): the review
> queue is a collection in the data store, the console has Holds, change sets, a page per college and a Jobs section,
> no data change travels by pull request any more, and the Steward's outputs become **documents the console reviews**
> rather than PRs. The owner's words (after Operations went live): "it's not particularly usable from there, as it's
> going to require some type of agentic workflow." The first pass of exactly that work, done by hand (PR
> [#153](https://github.com/raywross/college-stats/pull/153), 2026-10-13), is the evidence for every choice below.
> Part of [product](README.md).

## Goal
The owner should never read the review queue item by item. An agent, the **Data Steward**, reads it after every
college-reported run (and when asked), groups it into a handful of **issues** with a cause each, checks each cause
against the colleges' own documents, and turns what it can prove into **proposals** with the evidence attached. The
owner reads a page of proposals, not 21,000 rows, and approves, declines, or asks a question. Nothing reaches the site
without that approval; approved rows become the same field edits, holds and refiles the console already makes by
hand, and the next publish carries them.

## Where things stand (2026-11-01)
| | 2026-10-13 | 2026-10-26 | 2026-11-01 |
|---|---|---|---|
| Open review items | 20,811 at 383 colleges | 12,947 (14,568 after the first pass) | **20,990 at 593 colleges** (`reported.review_queue`; no item resolved through Holds yet) |
| Where the queue lives | `data/review-queue.json` in git | the same | the `reported.review_queue` collection in Supabase, one document per item, read by the console's Holds |
| How a value is corrected | a record change in a data PR | the same | a **field edit** (`admin_data_edit`, cited "Edited by Quad", [data-platform/change-sets.md](../data-platform/change-sets.md)); the record keeps what was read |
| How a document is held or refiled | `npm run hold-misread`, `refile-document` on the files, a PR | the same | the same scripts on the store, one change set each |
| Documents | archived in the Actions cache only (`local:`) | the same | **1,211 documents, all still `local:`**; `COLLEGE_DOCS_REPO` unset |
| The console | Operations with a 25-per-page queue | the same | Holds (Accept the value, Reject, Re-run discovery), Change sets, Snapshots, Reference, a page per college with Edit, Jobs |

The queue's open items by cause today (the clusters a run would start from):

| Check | Items | Colleges | Check | Items | Colleges |
|---|---|---|---|---|---|
| `number-on-line` | 5,281 | 327 | `enrollment-disagrees` | 1,117 | 148 |
| `parts-sum` | 4,634 | 316 | `ratio-matches` | 911 | 202 |
| `previous-cohort-disagrees` | 3,554 | 36 | `edition-mismatch` | 780 | 12 |
| `federal-disagrees` | 3,076 | 263 | `grid-column` | 609 | 54 |
| `sums-to-100` | 1,999 | 138 | `residency-sum` | 425 | 29 |
| `order` | 1,911 | 204 | `quote-present` | 378 | 88 |
| `aid-year` | 1,408 | 23 | the rest (9 checks) | about 1,300 | |

Two of the top seven sit at few colleges (`previous-cohort-disagrees` at 36, `aid-year` at 23): the first pass's lesson
that a few causes carry most of the volume still holds.

## What the first pass found (2026-10-13)
The queue held **20,811 items at 383 colleges**. One session's work, all of it the kind the Steward is for:

| Finding | Items | How it was found | Resolution |
|---|---|---|---|
| The re-judge script never touched the queue: values that had passed stayed queued | 2,450 | queue vs. record status | code fix: `queueAfterRejudge` |
| The 2025-26 form's running header says "Common Data Set 2024-2025"; eight colleges' documents were held whole | ~4,150 | clustered `edition-mismatch` by detail, then read the 8 PDFs' C1 and B22 years | check fix: items' own years outrank the header |
| B22 quotes either the cohort fall or the census fall; the check accepted only one | 111 (+ confirms) | read the quotes of every mismatch | check fix: E or E − 1 |
| Unblocking those documents would have published grid marks read a column off | 61 | read every C7 and C8A grid in the 8 PDFs | `misread` holds with what the PDF shows |
| **The same misreads were live**: in 8 published colleges sampled, about half the C7/C8 marks were under the wrong column | ~3,550 values at ~189 colleges | sample of passed values vs. PDFs | the grid-column check, built 2026-10-13 |
| Documents filed under the wrong edition (Illinois Wesleyan's 2020-21 as 2025-26; Pikeville's 2024-25 as 2025-26) | ~1,840 | the item-text years | `refile-document`, by hand |
| A stopped run's PR that can't merge, holding $14 of discovery | 50 recipes | diff against main | carried over |

Lessons that shape the design:
1. **The unit of work is a cause, not an item.** 70% of the volume came from three causes. Items are evidence.
2. **Every resolution is one of a few kinds** (below). The Steward's output is typed by them.
3. **Proof needs the document.** Every finding came from reading the PDF; the queue's detail strings were pointers.
4. **Passing is not the same as right.** The worst problem (C7/C8 columns) was in values that passed every check. The
   Steward also samples *passed* values, per check family, against their documents.
5. **Fixing a check is a two-sided change.** Loosening `edition-mismatch` freed 4,000 values, including the misread
   grids. A check-fix proposal always lists the values it would publish and samples them against the documents.

## The kinds of resolution, on today's mechanisms
| Kind | What changes | How the console applies it | Cost |
|---|---|---|---|
| **Correct** | the value a visitor sees: a field edit (`quad-edit`, note "Corrected from {document}, page {n}, line {m}") and the item resolved `accepted` | `admin_data_edit` + `admin_data_resolve_review`, as Holds' Accept does today | $0 |
| **Publish** | a held value that is right as read (a real disagreement with federal data, with the reason) | the same as Correct, with the reason in the note | $0 |
| **Hold** (`misread`) | a record's items marked misread, with what the document shows (`hold-misread`) | the Steward's `apply` job, in a change set | $0 |
| **Refile** | a document's `edition` and its items' years (`refile-document`) | the `apply` job | $0 |
| **Reject** | the checks were right and nothing is publishable: the item resolved `rejected` | `admin_data_resolve_review` | $0 |
| **Recipe** | the college's `reported.sources` document (a new link, clear for rediscovery, drop a bad one) | the `apply` job | $ next run |
| **Re-read** | `college-reported.yml` `mode: college` for named colleges, or a schema bump | dispatched from the proposal, with the projected cost | $ |
| **Leave** | queued for a reason no change fixes yet, with the reason | recorded on the issue | $0 |
| **Check fix**, **Pipeline fix** | `lib/cds-checks.ts`, the reader, discovery (code) | a code PR, written in a Claude Code session from the Steward's analysis (phase C automates it) | $0 |

A correction lives as a field edit, not a record change: the record keeps what the model read, the edit says what is
right and why, and the lineage popover says "Edited by Quad" with the note. A hold or a refile changes the record,
because they say what the *document* shows.

## The Steward

### What a run does
1. **Cluster.** Group open items by check and a normalized detail (numbers, years, codes masked), then by document.
   Each cluster gets a size, its colleges, and up to five example items. The clustering is pure code
   (`lib/steward/cluster.ts`), run by the console live as well, so the Issues screen is useful before any agent runs.
2. **Triage.** For the largest clusters (by items, then by colleges whose published value is affected), write a
   hypothesis (check bug, reader bug, document problem, misfiled edition, a real disagreement) and sort it into one of
   the [four kinds of issue](#four-kinds-of-issue-each-resolved-its-own-way). Acquisition issues become To do rows and
   policy questions become Decisions; neither becomes a proposal.
3. **Verify.** Read the documents behind a sample of the cluster (the archive copy by sha256 when the archive has
   it; else the document fetched again from its `final_url` and checked against the sha; the PDF's numbered line text
   from `pdftotext -layout`, and the page image when the text is ambiguous) until the hypothesis holds or fails.
   Record what each document shows, with page and line. A document that can't be fetched is an acquisition row.
4. **Propose.** One proposal per cause: a document in `steward.proposals` with its kind, the rows (college, field or
   code, what the site shows now, what is proposed, the evidence with page and line, the recommendation), and the
   change it would make. A proposal that would publish values also samples them (lesson 5).
5. **Audit.** Each run, sample a few passed values from one check family in rotation (C7/C8 grids, C9 bands, B4–B11
   grids, H2), compare with the documents, and open an issue when the error rate is above 5%.
6. **Report.** A run summary (clusters, proposals opened, audits, spend) in `steward.runs`, shown on the Issues screen
   and in the Jobs section's run history.

### What it writes, and what it may not do
- **Writes** only the `steward.*` collections (`issues`, `proposals`, `todo`, `decisions`, `audits`, `runs`), through
  one change set per run (source `steward`). None of them is composed into a college, so a run never changes a
  snapshot; the Steward does not ask the publisher for one.
- **May** read the repository, the store (every layer), the archive and the documents; run the repo's read-only scripts.
- **May not** write any other collection, dispatch a paid run, merge or push anything, edit workflows, or spend more
  than its budget. Everything that changes the site goes through the console's Approve, which applies the rows with
  the mechanisms above under the admin's own session, or through the `apply` job for the kinds that need the scripts.
- **Never** proposes a value it hasn't compared with the document. A correction or hold cites page and line; a check
  fix lists what it frees and its sample.

### Where it runs
**GitHub Actions, `steward.yml`, running `scripts/steward.mts`**: a scripted agent on the Anthropic SDK's tool runner
with a fixed set of tools (read a cluster, read a record, read a document's lines by sha or url, read what the site
shows, write a proposal or issue), not a general coding agent. Everything it needs is there: the checkout, `npm ci`,
`pdftotext`, the store's secret key, the API key. Triggers:
- `workflow_run` after `college-reported.yml` completes (the queue just changed), budget $5;
- `workflow_dispatch` from the console with `budget`, an optional `cause` (one cluster's key) or `unit` (one
  college), a `proposal` (answer an owner's question on it), and `request_id`;
- a weekly schedule for the audit alone;
- `mode: apply` with a proposal id: no model, just the scripts, run by the console's Approve for the kinds that need
  them (hold, refile, recipe, reject in bulk), in a change set with source `steward-apply`.

The 2026-10-13 plan ran Claude Code itself in Actions so it could write code PRs. Since then every data change moved
off PRs, and the one thing a general agent adds (writing a check fix) is better done in a session with the Steward's
analysis in hand; a fixed toolset is cheaper, its outputs are typed, and its budget is a token count the script
enforces. Managed Agents remain the alternative if a run ever needs more than a job's six hours.

### Models and cost
- Triage and verification: **Opus 5.5** (`claude-opus-5-5`), adaptive thinking, effort `high`. The id lives in one
  place (`scripts/lib/steward/models.mts`).
- Reading a document's lines for one question fans out to **Sonnet 5** (`claude-sonnet-5`); a plain "what does line
  N say" to **Haiku 4.5** (`claude-haiku-4-5-20251001`). Each returns a short structured finding, so the main context
  holds conclusions, not PDFs.
- Budget per run: **$5 after a pipeline run, $20 on dispatch, $40 a week in all**; the script stops and reports at its
  limit. Re-reads stay on the pipeline's Batch API path at half price; the Steward only proposes them.
- A `--dry-run` mode with recorded answers runs the whole loop with no key, for tests and for a first look at the
  screens.

## Four kinds of issue, each resolved its own way
| Kind | What it is | Example from the first pass | Resolved by | Where |
|---|---|---|---|---|
| **Value** | One college's figure: correct it, publish it, hold it, refile its document, reject, or leave | Neumann's C7 read a column off; Pikeville's document filed under the wrong year | a decision per row, with the Steward's recommendation | the college's **Review** page, and the proposal it belongs to |
| **Systemic** | A rule or the pipeline is wrong for every college it touches | the stale "2024-2025" header; the queue never following a re-check | approving the analysis, then a code PR | **Proposals** |
| **Acquisition** | We can't get or read the document; no decision about a value can help | a site that blocks us; a CDS link that is a 404; a SharePoint link behind a login | a person: find the link in a browser, upload the file, or mark "no CDS published" | **To do** |
| **Policy** | A choice only the owner makes, often affecting many colleges | hold every model-read grid; how old a figure may be and still show | a written decision, recorded with the Steward's recommendation | **Decisions** |

A **real disagreement** (a college's figure differs from the federal one because the cohorts differ, and both are
right) is a value issue with the recommendation "publish; differs from federal because …", so the reason travels with
the figure as the edit's note.

### The college's Review page: `/admin/colleges/[unit]/review`
Everything pending for one school on one page, a tab of the college's page (linked from its header beside Edit, from
its Health card, and from every proposal that touches it). One row per field or code:

| Field | On the site now | Proposed | From | Issue | Recommends | Proposal |
|---|---|---|---|---|---|---|
| Class rank (C7) | Considered · CDS 2025-26 | Not considered (corrected) | C7 grid: X under "Not Considered" · [PDF p.4] | read a column off | **Approve** | correct #7 |
| Retention | 72.1% · IPEDS, fall 2023 class | 69.6% · CDS 2025-26, fall 2024 class | B22: "69.63%" · [PDF p.3] | held by the stale header check | **Approve** | check fix #6 |
| Test policy (C8A) | Not considered · IPEDS | — | C8A: every mark under "Not considered" | none: the CDS agrees | — | — |

- **On the site now** is what a visitor sees, with its source and year from the same `citeField` the profile uses.
- **From** links the document at the page (the archive copy or the college's URL) with the cited line quoted.
- **Recommends** is *Approve* (the Steward checked the document and is confident) or *Your call* (the evidence is
  mixed, and the row says why). A change the Steward doesn't believe isn't proposed.
- A row that belongs to a **value** proposal has its own tick here and on the proposal; deciding it in either place
  decides it in both. A row of a **systemic** proposal shows its effect here and links to the proposal.
- Before any Steward run, the page already shows the college's open items grouped by code, with what the site shows
  now, the document, and the existing Accept the value / Reject actions: it replaces reading Holds college by college.
- The school's acquisition rows (no CDS found, blocked host) show at the top.
- **Colleges to review** (on the Issues screen) lists colleges with pending rows, ordered by how many visible figures
  would change, then by "your call" rows.

### Proposals
A proposal is a document in `steward.proposals`:
```
{ key, kind: correct | publish | hold | refile | reject | recipe | reread | systemic, cause, status: open | approved | declined | applied | asked,
  summary, evidence: [{ unit_id, edition, sha256, page, line, shows }], rows: [{ unit_id, code | field, now, proposed, source, recommends, decision? }],
  sample?: { checked, wrong: [...] }, change?: { what, how, revert }, question?, answer?, run, created, decided_by?, decided_at? }
```
- A **value** proposal's rows are pre-ticked to match the recommendation; **Approve** applies the ticked rows (edits
  and resolutions directly; holds, refiles, recipes through the `apply` job; re-reads by dispatching the pipeline with
  the cost shown) and records the unticked ones as declined with the owner's reason, so the next run doesn't propose
  them again unless the document changes. A re-read proposal shows a running cost total as rows are ticked.
- A **systemic** proposal has a fixed body: Cause, Kind (check fix | pipeline fix), Affected (items, colleges, the
  published values that change), Evidence (per document checked), Sample of what it publishes, Reverting. **Approve**
  records the decision and the analysis for the code session that implements it; **Ask** posts a question on the
  proposal and dispatches the Steward on that proposal to answer it (it may narrow the rule or add holds);
  **Decline** closes it with a reason.
- Every decision is an admin action, logged (`steward.approve`, `steward.decline`, `steward.ask`, `steward.decide`).

## Documents a person has to fetch
*Folded in 2026-10-26 from [manual-collection.md](../manual-collection.md) and [campus-sources-later.md](../campus-sources-later.md).*
The crawlers obey robots.txt and stop at bot challenges, and they should. That leaves public documents we know about
but can't read by machine: Common Data Sets on a university's Google Drive or behind a WAF, class profiles, campus-life
pages behind Cloudflare or a member login, high school profiles on hosts whose robots.txt disallows crawlers. The **To
do** list is where every one of these lands.

- **Most CDS items need no browser.** [collegedata.fyi](https://www.collegedata.fyi) (open, MIT-licensed) keeps an
  archived copy of each CDS file it indexes with the college's own `source_url`. Its 231 source URLs went into the
  `cds-urls` reference document on 2026-10-13 (PR #142); the archived copies are the first route for hosts that block us.
- **Upload is the route to scale**, not a browser session: a person adds the document through the console, and the
  Steward reads it like any archived document. The upload needs the archive backend (below); until then the row shows
  the page to open and a person marks it found, with the URL, for the next run to fetch.

**The To do row**: kind, subject (college or school), edition, the landing page, the document URL once located, the
host, why a machine couldn't (`robots-path`, `robots-host`, `challenge`, `bot-check`, `viewer`, `js-only`, `terms`,
`login`, `not-found`, `no-document`), reach, demand (a signed-in student's high school, a college on a plan, a follow),
status (`open`, `found`, `no-document`, `done`), route, and every attempt. Rows come from the engines' own records:
`reported.failures` (discovery and fetch failures: 964 discovery and 242 fetch failures today), the review queue's
`unreachable` and `not-a-url` items, and `directories.blocked`. The Steward opens a row when it meets an acquisition
issue and closes it when the document arrives; a person works the list highest reach first.

**Routes, in order:** (1) a public archive's copy (`archive-doc`); (2) a partnership or data request to the
organization; (3) a headless render of a page whose own JavaScript builds the list, only where no challenge or login
stands in front; (4) the owner opening the document once in their own browser and uploading it. Route 4 is for dozens
of documents a year.

**Rules** (unchanged): only public links for the public; no sign-in, no challenge or CAPTCHA, no user-agent change, no
endpoint the page doesn't link; a page that says the document is for counselors, members, or staff is `ask`; a site
whose terms forbid automated access is `ask`; every fetch recorded; removal honored. **Still needs the owner's
confirmation**: a person in their own browser may open a document the page links even where robots.txt disallows
crawlers (the crawlers never do).

## The console: where it all shows
The Steward's screens join the **Data** section (`/admin/data`), beside Change sets, Holds, Snapshots and Reference,
because that is where the queue and the holds already live:

| Screen | Shows | Actions |
|---|---|---|
| **Issues** (`/admin/data/issues`) | The clusters, live from the queue (cause, items, colleges, examples), joined with the Steward's issue documents (kind, hypothesis, status: new, investigating, proposed, waiting on owner, left); the last run's summary and spend; **Colleges to review** | Run the Steward (budget; optional cause or college), Leave with a reason |
| **Proposals** (`/admin/data/proposals`) | Systemic first, then value proposals, by status; a proposal page with its rows, evidence and sample | Approve (ticked rows), Decline, Ask |
| **To do** (`/admin/data/todo`) | Acquisition rows, highest reach first, with the page to open and why a machine couldn't | Found (with the URL), No document published, Done |
| **Decisions** (`/admin/data/decisions`) | Policy questions with the Steward's recommendation and what each answer changes | Decide (with a note) |
| **Audits** (`/admin/data/audits`) | Per check family, the latest sample's error rate and the values found wrong | Open the college's Review page |
| **Review** (`/admin/colleges/[unit]/review`) | One college's pending rows | Accept the value, Reject, Leave; the proposal's ticks |

**Holds** stays for what it does today (review items one at a time, the held essay records) and gains a line pointing
at Issues when the queue is large. **Operations** keeps Start a run (which gains Run the Steward) and Runs; its
"Review queue" section becomes a link to Issues, and "Approvals" lists code PRs only (data arrives without them).
**Jobs** lists the Steward as a GitHub job with its three schedules and its run history.

Console writes to the `steward.*` collections (a decision, a To do status, an answer) go through one function,
`admin_steward_write(collection, key, body, note)`, restricted to those collections, logging `steward.*` with before
and after, so the Steward's documents and the admin's decisions share one history.

## Prerequisites
1. **The document archive.** `COLLEGE_DOCS_REPO` is unset: every document is in the Actions cache only (evicted after
   seven days unused), and every manifest entry reads `local:`. The Steward works without it by fetching a document
   again from its `final_url` and checking the sha (as `check-grid-columns` does), but a document the college has since
   replaced or removed can't be checked, the upload route doesn't exist, and a re-judge can't re-run the line checks.
   **Owner step, recommended before the first real run**: create the private repository and set the variable
   ([college-reported-setup.md §9](../college-reported-setup.md#9-archive-repo-and-token)); a backfill job then
   uploads what the cache still holds and re-fetches the rest. Supabase Storage is the other backend the archive was
   written for, on the Pro plan (1 GB on Free is too small for 1,211 documents).
2. `ANTHROPIC_API_KEY` and the store's secret key in Actions (both exist).
3. `pdftotext` on the runner (the college-reported workflow installs it already).

## Build order
- **A. No agent, $0** (useful at once): `lib/steward/cluster.ts` and the four-kinds rules; the `steward.*`
  collections; the Issues screen over the live queue; the college Review page over today's data; To do from the
  failures, the queue and the blocked lists; `admin_steward_write`; Holds' and Operations' links.
- **B. The Steward**: `scripts/steward.mts` with its tools, `steward.yml`, the Jobs and Operations entries, the
  proposal documents, the Proposals screen with Approve (edits and resolutions directly; the `apply` job for holds,
  refiles, recipes; re-reads dispatched), Decline, Ask; Decisions; the dry-run mode and its fixtures. First runs
  dispatched by hand, budget $5.
- **C. Audits and systemic automation**: the weekly audit rotation and the Audits screen; the code PR for an approved
  systemic proposal written by an agent (Claude Code in Actions, or Managed Agents), with the owner merging.
- Step 0 (collegedata.fyi into discovery) and the grid-column check were built on 2026-10-13.

## Tests
- Clustering: a fixture of real queue items (trimmed, in `tests/fixtures/steward/`) gives stable top clusters under
  re-ordering and number changes; a cause key never merges two checks; every issue has exactly one of the four kinds.
- The Steward's run in dry-run mode: the recorded answers produce the expected proposals with evidence; a proposal
  without evidence, or a correction without page and line, is refused by the writer; the budget stops a run.
- `steward.yml` has no `contents: write`, dispatches nothing paid, and passes only the secrets it reads.
- Approve applies exactly the ticked rows (an edit per correction, a resolution per reject, one `apply` dispatch
  for the rest) and records the unticked ones as declined; Approve is refused on a proposal already decided.
- The Review page shows, for each row, the value the site shows now from the same reader the profile uses.
- `admin_steward_write` refuses any collection outside `steward.*` and logs before and after (PGlite).
- The `steward.*` collections are never composed into a snapshot (the publisher's layer list) and never served by the
  Data API.

## Owner decisions
1. **Decided 2026-10-13: fix the columns** (the grid-column check, built).
2. **Where it runs.** A scripted agent with fixed tools in Actions (above), not Claude Code with the repository.
   Recommended; the 2026-10-13 plan's alternative stays available for phase C.
3. **Budget.** Recommended: $5 per automatic run, $20 per dispatched run, $40 a week in total.
4. **Refiling.** Recommended: the Steward may propose refiling a document to another edition when two of the items'
   own years agree on it; the owner approves each.
5. **Auto-approve.** Recommended: none at first. After a month, holds (which only remove values from the site) could
   apply without the owner.
6. **The archive repository**: create it now (the owner's step above), or accept fetch-by-URL for the first runs.

## Open questions
- Should Issues mirror to GitHub Issues? Recommended: no; the console is the place.
- Should the Steward also read `reported.failures` for moved links it can find? Recommended: yes: a failure it can
  fix is a recipe proposal; one it can't is a To do row.
- Should a To do upload go straight to the archive and a re-read, or through a proposal? Recommended: straight to the
  archive, then the Steward reads it and its values arrive as a value proposal like any other.

## As built (2026-11-01)
Build units S1 (clusters, kinds, To do sources, `admin_steward_write`) and S3 (the run, the workflow, the registry row)
on `feature/data-steward`; S2 (the console screens) is being built in parallel and isn't merged here — see "Still to
document" below.

### Clustering (`lib/steward/cluster.ts`)
`maskDetail` replaces a CDS template code (`C.116`, `B.2202`, `H.2A01`) with `CODE`, an edition or academic year
(`2025-26`, `2024-2025`) and a standalone four-digit year with `Y`, and every other number (with its separators and
decimals) with `#`, then collapses whitespace. The cluster key is `${check}|${maskedDetail}`.

A check clusters by the check alone (`detail: ""`) when it's in `FREE_DETAIL_CHECKS` (`previous-cohort-disagrees`,
`aid-year`: each names a varying field or a quoted value that isn't the cause) **or** when, among the items given, its
masked details leave more than `FREE_DETAIL_LIMIT` (30) distinct values — `freeDetailChecks` finds both kinds
together so the Issues screen and the Steward agree on which checks are "free". Two checks never share a key: the
check is always the key's first segment.

A cluster key over `CLUSTER_KEY_MAX` (200 characters, the store's document-key limit) is cut to fit and given an
8-hex FNV-1a tag of the full masked detail, so two different long details that happen to share a 200-character prefix
still get different keys. An item with several failures is counted in every one of its failures' clusters — resolving
one cause doesn't clear the item from the others. Only items with no `resolved` are clustered; `clusterItems` (the
Steward's `read_cluster`, the Issues screen's unfolded examples) applies the same filter.

### Kind rules (`lib/steward/kinds.ts`), checked in this order
1. **acquisition**: the check is `unreachable` or `not-a-url`; or it's `line-in-document` and the cluster names no
   document at all; or the cluster's documents are all **unfetched** (none has a `reported.docs` manifest entry —
   when the manifest can't be read, nothing counts as unfetched and this rule never fires).
2. **policy**: the check is in `POLICY_CHECKS` (`previous-cohort-disagrees`, `plausible-change`, `newer-than-federal`).
3. **systemic**: one masked detail holds more than `SYSTEMIC_SHARE` (60%) of its check's open items **and** spans more
   than `SYSTEMIC_COLLEGES` (10) colleges. For a cluster that already has a detail (not a free-detail check), its own
   items/colleges are that share; for a free-detail check, the check's single most common masked detail (by items,
   then colleges) stands in for it.
4. **value**: everything else.

### To do sources (`lib/steward/todo-sources.ts`)
Three sources, merged by key (`<kind>:<unit_id or name-slug>:<edition or "->`, de-duplicated, most-specific `why` and
every attempt kept): `reported.failures` rows whose `reason_code` is in `ACQUISITION_REASONS` (`no_document_found`,
`class_profile_only`, `robots_disallowed`, `host_blocked`, `unreachable`, `malformed_url` — a read, fetch, or checks
failure never becomes a To do row, only a discovery/fetch one does); the review queue's open items whose failures
include `unreachable` or `not-a-url` (`ACQUISITION_QUEUE_CHECKS`); and `directories.blocked` records. `whyFromWords`
and the two `whyOf*` functions turn a reason code or free text into one of `terms`, `login`, `challenge`,
`robots-host`, `robots-path`, `viewer`, `js-only`, `bot-check`, `no-document`, `not-found`, or `unknown`, ranked most-
specific first so merging two sources keeps the sharper reason. `routeOf` starts a row at `ask` (terms, login),
`render` (js-only), or `null` (every other why, including the ones that still need `person`/`archive-doc` picked by a
person) — matching "Routes, in order" above only partly: the code picks the easy half, a person decides the rest.

### Review rows (`lib/steward/review-rows.ts`)
"On the site now" is read live, not from any stored proposal text: for a row with a registered field, `nowAtField`
calls the same `citeField` the profile uses; for a CDS code with no registered field, `nowAtCode` reads the newest
`passed` item in the college's own `reported.cds_records` document (there is no other place a value like that is
published). `PENDING_PROPOSAL_STATUSES` is `open`, `asked`, `approved` — a proposal row that's `declined` or `applied`
never reaches the Review page, so once the owner has settled a row (either way) it drops out on its own.

### `admin_steward_write` (`supabase/migrations/20261101140000_steward.sql`)
Refuses: a non-admin (`admin only`, 42501); a collection that doesn't match `^steward\.[a-z][a-z0-9_]*$`
(`not_steward_collection` — a `reported.*` or any other key is refused, not just disallowed); a key outside 1–200
characters (`invalid_key`); a body that isn't valid JSON or isn't a JSON object (`invalid_body`); a note over 500
characters (`invalid_note`). It opens one `edit`/`console` change set, writes the document, closes it `applied`, and
logs one `steward.write` row with the **changed top-level keys only** (added, removed, or altered) and, for just
those keys, the before and after values. Writing the identical body back still opens, writes, and closes a change set
— the `changed` array is simply empty (proved in `tests/steward-policies.test.mts`); there is no short-circuit that
skips the write.

### The run (`scripts/steward.mts`, `scripts/lib/steward/*.mts`)
**CLI**: `npm run steward -- --store <supabase|file:dir> --mode run|audit|apply|answer [--budget N] [--cause <key>]
[--unit <6-digit id>] [--proposal <key>] [--run-ref <id>] [--request-id <id>] [--dry-run <answers dir>]`. With no
`--budget`, the default is mode-specific — **run 20, audit 10, answer 5** (`DEFAULT_BUDGETS.dispatch/audit/answer`;
`afterPipeline` at 5 is used only by the workflow's own `--budget 5` after a pipeline run, not as a CLI default) — and
every budget, asked or default, is then cut to whatever the trailing-seven-days `$40` cap (`WEEKLY_CAP_USD`, summed
from `steward.runs.spent_usd`) has left (`runBudget`).

**Exit codes**: `0` done; `2` the budget stopped a call before it was made (what was already written stays; the run
record's `stopped` says where); `1` a failure (an uncaught error, a `--dry-run` request with no recorded answer, or
`apply` refusing before any write, e.g. a proposal that's already applied).

**One change set per run, always closed `applied`** — even a budget stop or a failure. The code's own reasoning
(steward.mts): a Steward set holds only `steward.*` documents, which are never composed into a snapshot, so closing
it `held` would gain nothing and would needlessly block the publisher's own "any held set to review" checks.
**`apply`'s own change set** (source `steward-apply`) is the one exception with real teeth: a refusal *before* any
write (e.g. "already applied") closes an **empty** set `applied`; a failure *partway through* applying (after some
holds/refiles/recipe writes/rejections already landed) closes the set **`held`** with the error, so a person judges
what's there — a hold or refile job is never silently abandoned mid-way.

**Tools, as built** (`scripts/lib/steward/tools.mts`): reads `list_clusters`, `read_cluster`, `read_record`,
`read_document_lines`, `read_site_value`, `read_failures`; base writes `write_issue`, `write_proposal`, `write_todo`,
`write_decision`; `write_audit` is added only in audit mode and `write_answer` only in answer mode (`toolNames`) —
`write_answer` is a tool this build added beyond the shared contract's list, needed because the contract gives
answer mode no way to post its answer. `read_document_lines` with a `question` fans out to Sonnet 5, and with a
`line` and no `question` returns the window of text itself; with a `line` *and* a `question` it fans out to Haiku 4.5
instead of Sonnet.

**Models**: Opus 5.5 (`claude-opus-5-5`) runs the main loop with `thinking: { type: "adaptive" }` and
`output_config.effort: "high"`. A sub-read on Sonnet 5 (`claude-sonnet-5`) also thinks adaptively but at `effort:
"low"`; a sub-read on Haiku 4.5 (`claude-haiku-4-5-20251001`) gets no `thinking` field and no `effort` at all — it
only answers a structured JSON schema (`subRead`, tools.mts).

**Dry run** (`scripts/lib/steward/dry-run.mts`): `requestKey(body)` is the first 16 hex characters of the sha256 of
the request body's stably-ordered JSON with `stream` and `max_tokens` stripped (so two requests the model would see
identically share an answer, and tests pin them). A missing answer throws `MissingAnswer` with the key and a path
under the OS temp dir where the unanswered request was saved for whoever records it; recording a fresh answer from
the live API is allowed only with `STEWARD_RECORD=1`, a real `ANTHROPIC_API_KEY`, and no `CI` env var.

**Budget reservation**: between two main-loop calls, the script estimates the next call's cost (treating the
cached conversation history as costing about a fifth as much, since a cache read is a tenth of input price),
`ensure()`s it's affordable, then `reserve()`s that estimate — so any sub-read tool calls made *before* the next main
call (a `read_document_lines` question, say) can only spend what's left above that reservation, and the already-
checked next main call stays affordable.

**Parallel tool calls, queued by the writer**: the SDK's tool runner can call several tools from one turn
concurrently; every `write_*` tool is routed through `StewardWriter.serial()`, which chains them onto one promise so
they run one at a time in call order. This matters concretely: a proposal write reads back the issue its `cause`
names to list itself there, and that issue is sometimes written in the very same turn.

**Document line text**: `documents.mts` reuses the college-reported pipeline's own line builders — `layoutDocument`
for model-read types (flattened/scanned PDFs, older workbooks, HTML, class profiles), the workbook's sheet-plus-cell
reader for a template workbook, and `pdftotext -layout` (`gridLayout`, split into pages at form feeds) for a form
PDF — so a line number the Steward cites is the **same line id a record's own `line` field already cites**, not a
re-derived one. When the archive lacks a document, it's fetched again by its manifest `final_url`/`url` (or the bare
URL given) through a polite GET, and the fetched bytes' own sha256 is checked against the manifest entry before the
text is trusted (a mismatch answers `{unavailable, reason: "the file at its URL has changed..."}`, exactly
`check-grid-columns.mts`'s approach); a fetched document is written back into the archive so one run reads it once.

**Writer refusals** (`scripts/lib/steward/writer.mts`), beyond the contract's three: every row needs a non-empty
`now` and `proposed` (and a `unit_id`); `correct`/`publish` also needs a `value`, a registered field an admin edit
could actually set (`editProblem`), and either `source.page` or — only when the row's `sha256` names a workbook
document (its manifest `type` starts with `xlsx`) — a `source.quote` with the cell instead; `hold`/`reject` need a
`code` or a queue `item`; `hold` additionally needs the `edition`; `refile` needs `sha256` and `edition`; `recipe`'s
`field` must be `sources.add`, `sources.drop`, or `rediscover`, and add/drop need an `http(s)` URL as `value`. **Rows
the owner declined before** are dropped silently from a new proposal — `rowIdentity` (`unit_id|field or code|sha256`)
matches a row against every `declined` row ever written to any proposal — and if every row of a non-systemic proposal
is dropped this way, the whole write is refused ("nothing to propose"). A `write_decision` whose question the owner
already answered is refused outright, by its slugged key.

**Proposal keys**: `<kind>-<cause or the first row's unit_id>-<run>`, each segment slugged and the whole thing capped
well under the store's 200-character key limit, unless the model supplies its own `key`.

**Recipe rows** (`scripts/lib/steward/apply.mts` `recipeAfter`): `sources.add` puts the URL at the front of
`reported.sources`' list (dropping any existing entry for that URL) and clears `none_found`; `sources.drop` removes a
URL; `rediscover` clears `none_found` and any `discovery.next_attempt` back-off so the next run looks again. A row
that would change nothing returns `null`, and `apply` logs "recipe already says so" instead of writing.

**Answer mode reopening a proposal**: `writeAnswer` requires a non-empty answer, validates any rows the model adds by
the *proposal's own kind*'s row rules, appends them to the existing rows, and — only when the proposal's status was
`asked` — flips it back to `open`, so Ask → Answer puts the proposal back in front of the owner's next pass.

**Audit families**: `AUDIT_FAMILIES = ["grids", "bands", "aid-grids", "h2"]` (C7/C8 grids, C9 bands, B4–B11 grids, H2
aid), picked by `weekOf(date) % 4` (`weekOf` is UTC whole weeks since January 1). `auditSample` ranks candidate
values by a sha256 of a weekly seed so the same week always samples the same up-to-25 values (one per college before
a second from any) and later weeks sample others. After `write_audit`, `issueForAudit` reads back what was just
written and, above `AUDIT_ISSUE_RATE` (5%) wrong, writes or updates an issue keyed **`audit|<family>`**, kind
`systemic`.

### The workflow (`.github/workflows/steward.yml`)
**Triggers**: `workflow_run` on "College-reported data" `completed`; `schedule` `0 9 * * 0` (Sunday 09:00 UTC);
`workflow_dispatch` (`mode`, `budget`, `cause`, `unit`, `proposal`, `request_id`). The "Resolve the mode and budget"
step hardcodes `budget=5` for `workflow_run` and `budget=10` for `schedule`, and otherwise uses the dispatch input
(default `"20"`) — the same numbers as `DEFAULT_BUDGETS` by trigger.

**The gate** ("Check that the college-reported run changed the queue"): for `workflow_run`, it reads the triggering
run's own jobs (`GET …/actions/runs/{id}/jobs`) and only proceeds when that run **succeeded** *and* at least one of
its steps named "Run the ingestion pipeline" or "Collect the open batches" **also succeeded** — the half-hourly
"collect" firing that finds no open batch, and an off-season firing, complete the workflow with nothing to show for
it and are skipped with a notice, same as a failed run. Every other trigger always proceeds.

**Permissions**: the top level is `contents: read` only. The `steward` job adds `actions: read` (for the gate's own
API read of the triggering run); the `apply` job — the only one that can run for `workflow_dispatch` with
`mode: apply` — gets `actions: write` *instead*, used for exactly one thing: `gh workflow run publish-snapshot.yml`
when applying actually changed a record. No job can push, commit, or edit a workflow.

**Secrets**: `ANTHROPIC_API_KEY`; `DATA_SUPABASE_URL`/`DATA_SUPABASE_SECRET_KEY` with the `PROD_SUPABASE_*` fallback
at the workflow's `env:` level; `COLLEGE_REPORTED_TOKEN` (the archive, when `COLLEGE_DOCS_REPO` is set). **Missing-
secret skip**: a step sets `ready=false` with a `::notice::` (no later step runs) when `ANTHROPIC_API_KEY` or either
Supabase variable is unset, in the same style as the other data workflows; the `apply` job has its own, narrower
check (it needs no model key, since `apply` makes no model call).

**Document cache**: a single `actions/cache/restore@v4` step restores `.cache/college-docs` (keyed to this run, with
a `college-docs-` prefix fallback to reuse what `college-reported.yml` saved) — **there is no matching `cache/save`
step**, so anything the Steward fetches fresh during a run is not written back to the shared Actions cache for the
next workflow; it only lives in that one job's local archive directory until the runner is torn down.

### The publisher and steward-only change sets
`scripts/lib/data-platform/ledger.mts`'s `changesSnapshot(set)` says a closed set can change what the next snapshot
composes unless *every* collection its summary lists starts with `steward.` (or it wrote nothing) — so a Steward run's
set, `steward-apply`'s own set, and the console's future `admin_steward_write` edits never by themselves make
`publish-snapshot.mts` think there's something new to publish. `apply` doesn't rely on that check noticing anyway: it
explicitly dispatches `publish-snapshot.yml` itself, and only when its own result says a hold or refile changed a
`reported.cds_records` document (`publish: true`) — recipe and reject rows never trigger it, because they change
nothing a snapshot composes until the *next* college-reported run reads the new recipe.

### Prices
`scripts/lib/steward/models.mts` hardcodes Opus 5.5 at $5/$25 per million input/output tokens, Sonnet 5 at $3/$15,
Haiku 4.5 at $1/$5, a cache read at a tenth of input, a cache write at 1.25× input, and thinking counted as output
(it's inside `output_tokens`). The file says plainly that if a model's real list price is ever *lower* than what's
hardcoded here, "the budget only stops early" — the prices are written to over-count against real billing, never
under-count, so a run would stop a little short of its nominal budget rather than risk spending past it.

### Owner assumptions, as the code holds them
1. Confirmed: `scripts/steward.mts` is a plain CLI script over the SDK's tool runner with a fixed, named tool set; it
   never touches the repository's files or git, unlike a general coding agent.
2. Confirmed: $5 after a pipeline run, $20 on dispatch, $10 for the weekly audit, $40 a week in all — both in
   `budget.mts`'s `DEFAULT_BUDGETS`/`WEEKLY_CAP_USD` and in `steward.yml`'s own hardcoded per-trigger budgets.
3. Lives in the system prompt only ("two of the items' own years must agree"), not enforced by the writer, which
   checks only that a refile row names a `sha256` and an `edition`. The owner's "approves each" half is enforced
   structurally: `apply.mts` only ever applies rows whose `decision` is already `"approved"`.
4. Confirmed: nothing here marks a proposal `approved` on its own; `applyProposal` refuses any proposal that isn't
   already `approved`, and `admin_steward_write` only ever writes the body its caller (a Server Action, built in S2)
   passes it.
5. Confirmed: `documents.mts` falls back to fetching a document again by URL and checking its sha256 against the
   manifest, exactly as `check-grid-columns.mts` does; an unfetchable or sha-mismatched document becomes
   `{unavailable, reason}`, which the system prompt turns into a To do row, never a value.
6. Confirmed: `write_proposal` requires `change: {what, how, revert}` for a systemic proposal, and `apply.mts`'s
   `APPLIED_KINDS` excludes `systemic` (and `correct`/`publish`/`reread`) — none of those kinds is ever applied by
   the job; a systemic proposal only records the owner's approval for a person to act on later.

### Still to document
S2's pieces — the five Data screens (Issues, Proposals, To do, Decisions, Audits), the college Review page, Approve /
Decline / Ask / Decide, and the dispatch rows (`steward`, `steward-apply`, `steward-answer`) — aren't merged yet; the
lead completes this section's console half once S2 lands.
