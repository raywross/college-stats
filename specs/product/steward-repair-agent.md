# The Steward as the owner's repair agent

> Status: **plan**, 2026-11-10. Part of [product](README.md); the next round of [data-steward.md](data-steward.md).
> Prompted by the owner's words the same day: "the idea for the steward is for it to be my agent to go and repair
> things, and then give me clear explanations of options with a recommendation. The same way you're able to figure
> out what you just figured out, that's what I want the agent to do."

## The case that prompted this

On 2026-11-10 the owner opened Vanderbilt in the console and saw college reporting marked **Failing**. A Claude Code
session found the cause in about ten minutes and fixed it in PR #245. The Steward had run twice that week and had not
looked at Vanderbilt. What the session did, step by step, is the specification for what the Steward should do:

1. Started from the college the owner was looking at, not from the biggest pile in the queue.
2. Read the health rule to learn what "Failing" means: an open `failed_checks` failure plus a queue item waiting.
3. Read the college's failure row, its queue item, and its sources record. The sources record already said the
   second document was a regular-decision summary (scope `regular-only`).
4. Read the check's own code and saw it compares any two documents for the same term and never looks at scope.
5. Read the whole cluster (six colleges) to judge whether the cause was one college's or the rule's.
6. Read the Steward's own records to learn why it had not reached the cluster: it works largest-first, and this
   cluster was six items among 27,000.
7. Explained all of this in plain words with a recommendation, then wrote the fix, a test, and the spec line.

The Steward, as built, can do steps 3 and 5. It cannot do 1, 2, 4, 6 or 7, and it may not do the fix at all.

## What stands between the Steward and that

| | Today | What it cost Vanderbilt |
|---|---|---|
| **Order of work** | Largest clusters first, by items then colleges. $5 after a run reaches about eight clusters; the next run starts again at the top | A six-item cluster is never reached, however visible its college |
| **What it can read** | A cluster, a record, a document's lines, what the site shows, the failures | It cannot read what a check does, so it can only guess "check bug" from samples |
| **What a failure says** | "applicants 48196 vs other source's 43322 (10.1% apart)" | The other document is not named, nor its scope; the clue was in a record the Steward would have had to go and open |
| **How it sorts a cause** | Under 10 colleges is a "value" issue by rule | A rule defect at six colleges would have been proposed as six "publish the held value" rows, and the rule left in place |
| **What it writes** | Issues (a hypothesis per cluster), proposals (rows), To do rows, decisions | Nothing that answers "why is this college failing, what are my options, and what do you recommend" |
| **What it may change** | Nothing. Every row waits for Approve; a code fix waits for a session | A hold, a reject, or a re-read the Steward is sure of still waits for the owner |

## The round: six changes

Each has options and a recommendation, in the form the owner asked the Steward itself to use.

### 1. Explain: "why is this failing?"
A new output, an **explanation** (`steward.explanations`, one per college or cluster, replaced each time): what is
wrong, why (with the evidence: the documents, the rule, the records), the options with what each one changes and
costs, the recommendation, and what the Steward already did about it. Written for the owner, no keys or codes
without words. Shown on the college's page beside the health badge, on the Issues screen under its cluster, and in the
Inbox's "Needs you" when the recommendation needs the owner.

Triggers:
- **Ask the Steward** on the college's health card and on a cluster's row (dispatch with `unit` or `cause`, mode
  `explain`, budget $1). The answer lands on the page it was asked from within a few minutes.
- **Every college that turns Failing or Stale** since the last run, automatically, after each college-reported run
  (capped at 25 colleges a run, highest reach first).

Options: (a) a separate explain mode and document, as above; (b) extend the issue's hypothesis into this shape and
key it by college too; (c) answer in the console live, no document. **Recommendation: (a).** An issue is per cluster
and written for the Steward's own bookkeeping; the owner needs one page per college that reads top to bottom, and it
has to be stored, because the console cannot wait on a model.

### 2. Read the rules and name the other document
Two new read tools and one change to the checks:
- `read_check(check)`: the check's rule as the spec states it, the code that implements it (the function body from
  `lib/reported-checks.ts` or `lib/cds-checks.ts`, with its comments), and the counts of open items and colleges it
  holds. A check bug is then something the Steward can read, not infer.
- `read_health(unit)`: the college's health rows as the console computes them (`collegeHealth`), with the rule that
  decided each status. This is step 2 above.
- Every `sources-agree`, `federal-disagrees`, `enrollment-disagrees` and `previous-cohort-disagrees` detail names
  both sides: which document (kind, edition, scope) and which federal year. The detail is the first thing the Steward
  and the owner read; it should carry the clue.

Options: (a) the tools read the files from the checkout (the workflow has it); (b) a generated rules catalog the
tools read; (c) leave the Steward to sample. **Recommendation: (a)**, it is a day's work and the checkout is there.

### 3. Order of work: what the owner sees first, then the cheap tail, then the big piles
A run's order becomes:
1. Colleges that turned **Failing** or **Stale** since the last run, highest reach first (reach: on how many students' lists,
   then selectivity tier, then enrollment; the site keeps no page-view counts). These get an explanation and, where
   the Steward is sure, a repair.
2. **Every small cluster** (at most 25 items): each costs cents to read whole, and together they hold the rule
   defects that never surface in the big clusters. One sweep, one issue each.
3. The largest clusters, as today, **skipping any cluster whose issue is `proposed` or `waiting`** unless the queue
   changed under it since (new items or a new run). Today a second run re-triages the same top eight.

Options: (a) this order; (b) largest-first with a reserved share of the budget for 1 and 2; (c) owner picks on
dispatch only. **Recommendation: (a)**, with the share of budget for step 3 set so a $10 run still reaches new
large clusters. The owner's attention is the scarce thing, and it goes to a college page, not a cluster table.

### 4. Kind by cause, not by count
The pre-classification (`lib/steward/kinds.ts`) keeps deciding acquisition and policy, since those follow from the
check alone. "Systemic" stops being a size rule: the Steward may call any cluster systemic when it has read the rule
and shown the rule is wrong for every item it touched, with the sample the systemic proposal already requires. Size
stays as a hint in the cluster listing.

Options: (a) as above; (b) lower the threshold to three colleges; (c) keep ten. **Recommendation: (a).** Vanderbilt's
cluster had six colleges and one cause, the rule. A threshold of any size will miss the next one.

### 5. Repairs it makes itself, in tiers
The owner's "go and repair things". Three tiers, by what a mistake would cost and how it is undone:

| Tier | What | Who decides | Undo |
|---|---|---|---|
| **Does it** | Reject an item when the checks were right and nothing is publishable; hold a value it has shown misread (page and line); add or drop a discovery URL; re-read a college's documents (under $2 a night in Batch); re-run discovery | The Steward, in its own change set, listed in "The Steward did" with the evidence | Every write is a change set; the console's revert |
| **Asks first** | Correct or publish a figure a visitor sees; refile a document to another edition; anything that changes more than 10 colleges | The owner, on the proposal, as today | the same |
| **Writes the fix** | A systemic cause: the check or the reader is wrong | The Steward writes the code: an approved systemic proposal dispatches a Claude Code session in Actions, confined to the checks, readers and tests, that opens a PR with the proposal's sample as its test; the owner merges | the PR |

The third tier is the open phase C of data-steward.md, with the scope fixed: the session gets the proposal, the
evidence, and the sample; it may change `lib/*-checks.ts`, `scripts/lib/college-reported/**`, their tests and the
spec line, and nothing else. It runs `npm run verify`, pushes a `fix/` branch, opens the PR with the release note,
and says in the proposal what it changed. The owner's merge rule stands.

Options: (a) the tiers; (b) everything asks first, as today; (c) everything is done, with a digest and revert.
**Recommendation: (a).** The first tier changes nothing a visitor sees (a reject or hold keeps a value off the site; a
recipe or re-read changes what the next run reads). The second tier is where a wrong decision shows on a page. The
third is where today's round ends in a chat session, and the Steward can carry it to a PR.

### 6. Budget and cadence
| | Today | Proposed |
|---|---|---|
| After a college-reported run | $5 | $10: steps 1 and 2 of the order first, the rest to step 3 |
| Explanations | — | $1 each, at most 25 a run |
| Weekly audit | $10 | $10 |
| Dispatch | $20 | $20 |
| Code fix session | — | $15 a proposal, at most two a week |
| Weekly cap | $40 | $80 |

Options: (a) as proposed; (b) today's numbers with the new order; (c) double everything. **Recommendation: (a).** The
new order spends the first dollars on what the owner will look at; the cap doubles because the Steward now does two
jobs (explain and repair) rather than one.

## What the owner sees after this round
- A college's health card says why in a paragraph, with a recommendation and a button for each option; no code
  names.
- The Inbox's "Needs you" holds the recommendations that need a decision, grouped; "The Steward did" lists last
  night's repairs with their evidence and a revert.
- Proposals stay for the asks-first tier; small ones become rare because the Steward settled them.
- A systemic proposal, once approved, turns into a PR the owner merges, with the proposal's sample as the test.

## Order of work and cost
1. **Explain** (change 1) and **read the rules** (change 2): one unit, Opus. The tools, the mode, the document, the
   college card and the Inbox row. The detail wording in the checks is a small PR of its own.
2. **Order and kinds** (changes 3 and 4): one unit, Sonnet. Pure code in `lib/steward/` with fixtures.
3. **Repairs, tiers one and two** (change 5): one unit, Opus. The Steward's own change set, the "did" list, revert.
4. **The code fix session** (change 5, tier three) and **budget** (change 6): one unit, Opus. The Actions workflow,
   the confinement, the PR body.

Each unit lands behind the console; nothing changes for visitors until the Steward's first repair, and that is a
reject or hold.

## Owner decisions
1. The first tier's list: is a hold on a misread value something the Steward may do alone? (It keeps a value off the
   site; it never puts one on.)
2. Reach: is "on how many students' lists" the first signal, or selectivity tier?
3. The weekly cap: $80, or hold at $40 and accept that explanations come at the expense of triage?
4. Tier three runs Claude Code in Actions on the repository. The 2026-10-13 plan was set aside for the fixed-tool
   script; this brings a coding agent back for one narrow job. Yes, or keep writing fixes in a session?
