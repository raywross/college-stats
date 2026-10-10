# College-Reported Data: Setup

> For the repo owner. Covers the one-time setup for
> [`.github/workflows/college-reported.yml`](../.github/workflows/college-reported.yml) and how to run the
> pipeline ([scripts/sync-college-reported.mts](../scripts/sync-college-reported.mts)) locally. See
> [college-reported-data.md](college-reported-data.md) for what the agent does and why, and
> [supabase.md](supabase.md) for how data reaches the deployed site.

## 1. Create an Anthropic API key
1. [console.anthropic.com](https://console.anthropic.com) → **API keys** → **Create key**. Name it something like
   `college-reported-ingestion` so it's easy to find again.
2. **Set a monthly spend limit** on that key (or the workspace it's in) matching the spec's budget — the pilot and
   early runs should stay well under $1.5–3K/year ([college-reported-data.md#cost](college-reported-data.md#cost)).
   A limit means a runaway run fails loudly (and the workflow's circuit breaker catches a bad *data* run, but not a
   bad *bill*).
3. Copy the key (`sk-ant-…`); you'll paste it twice (local `.env.local` and the GitHub secret below).

## 2. GitHub repository secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value | Required for |
|---|---|---|
| `ANTHROPIC_API_KEY` | The key from step 1 | Any run. Without it the workflow logs `::notice::` and skips cleanly (still green) |
| `COLLEGE_REPORTED_TOKEN` | A fine-grained PAT (below) | CI running on the agent's PRs, and `--auto-merge` actually merging |

**Why the second token:** the workflow's default token (`github.token`) can commit, push, and open a PR, but a
PR opened with it does **not** trigger `pull_request` workflows — so `Verify` (`.github/workflows/verify.yml`)
would never run on it, and `gh pr merge --auto` would wait forever for a check that never starts. A personal access
token sidesteps that restriction.

**Create the fine-grained PAT:**
1. [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) (or
   your GitHub Enterprise equivalent).
2. **Repository access**: "Only select repositories" → this repo.
3. **Permissions → Repository permissions**:
   - **Contents**: Read and write (commit and push the data/release-note branch).
   - **Pull requests**: Read and write (open the PR, comment, merge).
   - Leave **Workflows** off — this token never pushes changes to `.github/workflows/*`, only to `data/` and
     `release-notes/`.
4. **Expiration**: pick a date you're willing to come back for (90 days is a reasonable start); GitHub emails you
   before it expires. A short expiry is safer but means a silent-skip failure mode if you forget — the workflow logs
   an auth error in that case, it doesn't open a broken PR.
5. Generate, copy, and paste it into the `COLLEGE_REPORTED_TOKEN` secret above.

**Note the PR author:** every PR, commit, and comment the workflow makes will show as authored by whichever account
owns this PAT (your account, unless you create a dedicated bot account for it). That's cosmetic, but it's worth
knowing before the first scheduled run shows up in your activity feed.

## 3. Enable auto-merge and branch protection
1. Repo → **Settings → General → Pull Requests** → check **Allow auto-merge**. Without this, `gh pr merge --auto`
   fails outright.
2. Repo → **Settings → Rules** (or the legacy **Branches** page) → make sure `main` has a protection rule or ruleset
   that **requires status checks to pass before merging**, with the `Verify` job (from `verify.yml`) required. This
   is what makes "auto-merge" actually wait for CI instead of merging immediately — `gh pr merge --auto` just
   queues the merge for whenever GitHub considers the PR mergeable, and without a required check, that's at once.
3. If you also want the release-note check to gate the merge, add the `release-note` job from the same workflow to
   the required checks list.

No database or Supabase change is needed for this feature: `school.reported` lives inside the same per-college
document that `data/schools.json` already holds, and a merge to `main` deploys it like every other field
([serving-architecture.md](serving-architecture.md)); the `publish-changes.yml` workflow then records what changed.

## 4. Run it locally first
1. Add `ANTHROPIC_API_KEY=sk-ant-…` to `.env.local` (git-ignored).
2. Dry run against the pilot set (no network writes to `data/`, no model calls that can't be undone — check the
   script's own `--dry-run` behavior, but it should at minimum skip writing files):
   ```sh
   npm run sync-college-reported -- --pilot --dry-run
   ```
   Read the console output: how many colleges it would attempt, whether it found recipes or needs discovery, and
   its cost estimate.
3. For real:
   ```sh
   npm run sync-college-reported -- --pilot
   ```
   This writes `data/college-sources.json`, `data/college-reported.json`, `data/review-queue.json`, and
   `data/reports/college-reported-run-<run>.json`.
4. Merge the published values into the dataset and verify. `npm run merge-reported` is the usual way — it only
   reads/writes `data/schools.json` and `data/college-reported.json` (no network, no API key), exactly the merge
   the workflow runs so the data PR itself carries the site's figures (Decision 5,
   [college-reported-round-2.md](college-reported-round-2.md)). `npm run sync-data` still does the same merge as
   part of its full rebuild, if you're running that anyway:
   ```sh
   npm run merge-reported
   npm run verify
   ```
   `npm run report-college-reported` prints a readable snapshot first, if you want to see what's in
   `data/college-reported.json` before merging it: each published college's term, source kind, which values it has,
   its URL and run, totals by term and source kind, and how many colleges in `data/schools.json` already carry a
   `reported` block (so you can tell whether the merge has run yet).
5. **Score it against the answer key**:
   ```sh
   npm run score-college-reported
   ```
   Prints, per selectivity tier, how many pilot colleges had a newer figure to find, how many the pipeline found,
   how many match the hand-checked key (counts within 0.5%, rates within 0.1 pt), and any college it published where
   the key found nothing newer (look at those first: a real find or a false positive). Writes the table to
   `data/reports/college-reported-pilot-<date>.md`; commit that file with the run. A missed or wrong college means
   fixing its recipe in `data/college-sources.json` and re-running with `--college <id>`.
6. **Review the diff** (`git diff data/`) college by college: does each new `school.reported.admissions` value look
   right against the source quote? And **review the queue**
   (`data/review-queue.json`): does each failure reason make sense, or does it point to a recipe that needs fixing?
7. If it looks right, commit and open a PR by hand the first few times, before trusting the workflow to do it
   unattended.

## 5. Run the first pilot from Actions
1. **Actions → "College-reported data" → Run workflow.**
2. `mode`: **pilot**. `auto_merge`: **off** (leave unchecked) — you want to read the first PR before anything
   merges itself. Leave `rediscover` off and `max_discoveries` at its default unless you're deliberately testing
   those paths.
3. Watch the run. It should either:
   - Skip with a `::notice::` if `ANTHROPIC_API_KEY` isn't set yet (go back to step 2 above), or
   - Finish and, if `data/**` changed, open a PR named `College-reported data: run <run-id>` from a branch
     `data/college-reported-<run-id>`.

**What to look at in that PR:**
- The **Summary** table: colleges attempted, documents read, published, changed, failed, discovered, escalated,
  and the run's **cost**. Compare cost per college against the spec's estimates
  ([college-reported-data.md#cost](college-reported-data.md#cost)) — discovery (Sonnet 5 + web search) should land
  around $0.10–0.25/college, extraction (Haiku 4.5) fractions of a cent to a few cents.
- **Circuit breaker**: should say "Not tripped" for a healthy pilot. If it tripped, the PR explains why and a
  comment on the PR says it's waiting for a person — don't merge it without reading the review queue first.
- The **Published this run** table: each college that passed every check this run, its term, source kind, and
  figures. This PR already includes the `npm run merge-reported` commit (Decision 5,
  [college-reported-round-2.md](college-reported-round-2.md)), so the PR's Vercel preview shows these figures on
  the college's profile right now — check a couple against the quote and link before merging.
- **Unreachable**, if present: colleges whose site blocked the fetch or whose document 404ed. No model call could
  have fixed these, so they aren't counted as check failures; they're retried on the next run.
- The **Review queue** table: college, term, which check(s) failed, and the source URL. A reasonable pilot has a
  handful of these, not most of the 50.
- The **release note** the PR also adds (`release-notes/college-reported-<run-id>.md`): read it as a site visitor
  would — does "What's new" make sense without the internal jargon?
- Let CI (`Verify`) run. If `COLLEGE_REPORTED_TOKEN` isn't set up correctly, CI won't start on this PR at all —
  that's the tell that step 2 above needs fixing.
- Merge it by hand once you're satisfied. The merge deploys, and `publish-changes.yml` records the changes after
  the deploy, so nothing else to trigger — `data/schools.json` rode along in this same PR.

## 6. Resolving a review-queue item
Each item names the college, the failed check(s), and the source URL. Typical fixes:
- **Wrong page/anchor, or the college changed its page layout**: fix the entry in `data/college-sources.json`
  (`sources[].pages`, `sources[].anchor`) by hand, or clear it so the next run re-runs discovery for that college.
- **The college publishes something the checks correctly reject** (e.g. early-decision-only numbers, a transfer
  cohort): add a manual override (same mechanism as the CDS importer's overrides — see
  [sources-and-citations.md](sources-and-citations.md)) if you want to publish a corrected reading, or leave it
  queued if there's genuinely nothing publishable yet.
- **Re-run just that college** once you've fixed its recipe or added the override:
  ```sh
  npm run sync-college-reported -- --college <unit_id>
  ```
  Then `npm run sync-data && npm run verify` and open a PR as usual (or let the next scheduled run pick it up).

## 7. Reading the cost
**While a run is going**, open it in Actions → the "Run the ingestion pipeline" step: each finished college logs a
line like `[12/50] Princeton University done · run cost so far ~$34.10`. If the Anthropic spend limit is reached, the
run stops cleanly (exit code 3), keeps every college it finished, and still opens a PR marked "Stopped early";
cancelling the run from GitHub does the same. The next run picks up the rest.

Every run's summary (`data/reports/college-reported-run-<run>.json`, surfaced in the PR's **Model usage** table)
breaks down calls, tokens, and `cost_usd` per model job (`discovery`, `extraction`, `escalation`). Watch two things
over the first few months:
- **Discovery cost per newly-learned college** — this is the one-time cost across all ~1,900 colleges
  ($200–500 total estimated). It should taper off once most colleges have a working recipe; a run with a lot of
  `discovered` and `escalated` long after the initial rollout suggests recipes are breaking (college sites
  changing layout) rather than new colleges being learned.
- **Extraction cost per run** — should stay in the tens-of-dollars range per run once steady, since it only reads
  documents that changed. If a run's extraction cost jumps, check `documents_read`: a spike there usually means a
  college's index page started looking "changed" every time (e.g. a dynamic timestamp on the page) and needs its
  recipe adjusted so it doesn't get re-read needlessly.

## 8. Auto-merge is on by default
Since 2026-10-03 every run, manual or scheduled, auto-merges its PR once CI passes: whatever passed the checks
publishes, and whatever didn't is in the review queue. The PR is the mechanism (CI, a readable diff, a place for the
queue), not a review step. Two things still hold a PR for a person:
- **The circuit breaker**: more than 25% of already-published values came back different in one run (a systematic
  misread). The PR gets a comment saying so.
- **A run that stopped early** (cost cap, spend limit, cancel): its PR says "Stopped early" and waits.
Untick **auto_merge** in the workflow-dispatch form when you want to read a specific run's PR before it merges.
- If a scheduled run's circuit breaker trips more than once in a row, it's worth turning scheduled auto-merge off
  (comment out `auto_merge: true` in `.github/workflows/college-reported.yml`'s "Resolve run parameters" step) until
  you've found and fixed the underlying cause.

## 9. Archive repo and token
Round 3 keeps every fetched document forever, keyed by the sha256 of its bytes
([college-reported-round-3.md Decision 1](college-reported-round-3.md#decision-1-one-permanent-archive-a-document-is-fetched-once)),
so no college's site is visited twice for the same file. Code: `scripts/lib/college-reported/archive.mts`.

**Without any setup** the archive is the local directory `.cache/college-docs/archive/` (git-ignored). That is
enough for local runs, but in Actions it lives only as long as the Actions cache (evicted after 7 days unused, 10 GB
per repo), so set up the repo below before the full run.

**One-time setup (owner):**
1. Create a **private** repository, e.g. `quad-college-docs`, **with a README** (a release needs a commit to tag;
   an empty repo can't hold releases). Never make it public: we keep colleges' documents, we don't republish them.
2. Edit the fine-grained PAT from step 2 (`COLLEGE_REPORTED_TOKEN`): **Repository access** → add
   `quad-college-docs`; on that repo it needs **Contents: Read and write** (releases and their assets are under
   Contents). Nothing else on that repo. The default `GITHUB_TOKEN` of a workflow can't reach another repo, so this
   PAT is required in Actions.
3. Add a repository **variable** (Settings → Secrets and variables → Actions → Variables) `COLLEGE_DOCS_REPO` =
   `<owner>/quad-college-docs`. It isn't secret; setting it is what switches the archive to release assets.
4. Locally, add the same two lines to `.env.local` when you want local runs to use the shared archive:
   `COLLEGE_DOCS_REPO=<owner>/quad-college-docs` and `COLLEGE_REPORTED_TOKEN=<the PAT>` (or `GITHUB_TOKEN`).

**How it is stored.** One release per month, `docs-2026-10`, created on first use (then `docs-2026-10.2`, … when one
reaches 1,000 assets). Each document is an asset named `<sha256>.<ext>` (`xlsx`, `pdf`, `html`), and a PDF's
numbered line text sits beside it as `<sha256>.lines.json.gz`. A document already uploaded in any month is never
uploaded again. The manifest's `archive` field records where each document is (`gh:docs-2026-10/<sha>.pdf`; a
`local:` value means it was archived on a machine without the repo set). The local directory stays a hot cache in
front of the repo.

**Workflow steps needed** (for whoever edits `.github/workflows/college-reported.yml`; the archive code needs no
flags):
- In the pipeline step's `env` (and the `collect` job's, which re-reads archived text):
  ```yaml
  COLLEGE_DOCS_REPO: ${{ vars.COLLEGE_DOCS_REPO }}
  COLLEGE_REPORTED_TOKEN: ${{ secrets.COLLEGE_REPORTED_TOKEN }}
  ```
  When `COLLEGE_DOCS_REPO` is set and no token is, the run stops at once with "neither COLLEGE_REPORTED_TOKEN nor
  GITHUB_TOKEN is" rather than archiving to a cache that will be evicted.
- Keep the existing "Restore document cache" step (`actions/cache@v4`, path `.cache/college-docs`, key
  `college-docs-<run id>`, restore-keys `college-docs-`): it now also restores `archive/`, so most documents are read
  from the cache without a download. `actions/cache` saves the path automatically at the end of the job; nothing
  else is needed. With the repo set, losing the cache costs only downloads, never a refetch from a college.
- The `collect` job (batch results) needs the same cache restore and env, because escalation reads the archived
  line text.

**Adding a document by hand** (a blocked host, a Google Drive folder): download it in a browser, then
```
npm run archive-doc -- --college <unit_id> --file <path> --url <the link you downloaded it from> [--add-url]
  [--kind cds|class-profile] [--edition 2025-26] [--retrieved YYYY-MM-DD] [--note "…"]
```
It archives the file and lists it in `data/college-docs.json` exactly as a fetch would (`retrieved` = today unless
given). A 2025–26 template workbook is read into `data/cds-records/<unit_id>.json` at once with no model; a PDF or
other file is extracted from the archive by the next pipeline run. `--add-url` also adds the link to
`data/reference/cds-urls.json`, the list discovery tries first. Commit the changed `data/` files. Run it with
`COLLEGE_DOCS_REPO` set so the file reaches the shared archive, not just your machine.

## 10. Links you find by hand, and blocked hosts
Round 3 ([college-reported-round-3.md, Decision 8](college-reported-round-3.md#decision-8-share-links-blocked-hosts-and-the-owners-list)).
Discovery never gets past bot protection: it never switches user agents and never fetches a blocked host another
way. Where it can't reach a document, you can.

**Blocked hosts** — `data/reference/blocked-hosts.json`, written by the pipeline:
```json
{ "hosts": [{ "host": "admission.virginia.edu", "status": "challenge", "first_seen": "2026-10-03", "last_seen": "2026-10-10", "unit_ids": ["234076"] }] }
```
- A host is listed when it answers our requests with 401, 403, 405, 429, or a bot-protection page (Cloudflare's
  "Just a moment…", Incapsula, PerimeterX, DataDome, Akamai "Access Denied"). `404-to-tools` (a 404 to a tool and a
  200 to a browser, like Texas A&M) can't be told from one honest request: enter it by hand if you see it.
- Blocking is per host, not per college: a college whose admissions site refuses us may still publish its CDS on an
  IR host that doesn't.
- When **every** candidate host of a college is listed, no paid discovery step runs for it, and the run's PR lists the
  college for you to add a link by hand. Entries not seen for a year are tried again; delete an entry to retry
  sooner.

**The owner's list** — `data/reference/cds-urls.json`, edited by you. It is step 0 of discovery: an entry is used
before any probe or model, even for a college whose recipe otherwise works.
```json
{ "entries": [{ "unit_id": "152080", "url": "https://drive.google.com/file/d/<id>/view", "kind": "cds", "note": "Notre Dame: picked from the Drive folder", "added": "2026-10-03" }] }
```
- `kind` is `cds` or `class-profile`. Paste the link as the browser shows it: Google Sheets and Drive file links, Box
  `/s/` links, and SharePoint/OneDrive links are rewritten to their direct downloads automatically. A Drive **folder**
  can't be: open it and paste the file's link.
- For a blocked host, also download the file and drop it in the archive, so extraction reads your copy:
  ```sh
  npm run archive-doc -- --college <unit_id> --file <path> --url <original url>
  ```
- Where to look: the PR's "Blocked" list, and recipes whose `discovery.path` is `none` with a `discovery.tried` that
  shows what was attempted.

**Back-off.** A college whose ladder found nothing records `discovery.next_attempt` in its recipe
(`data/college-sources.json`): the next 1 February for every tier but open admission, a year later for open
admission. Runs skip it until then. To retry one sooner, delete its `next_attempt` (or add a link to the owner's list).

## 11. Batches, draft PRs, and the collect job (round 3)
From round 3 ([college-reported-round-3.md](college-reported-round-3.md#decision-5-extraction-runs-as-a-batch)),
extraction, escalation, and link-picker calls go through the Message Batches API at half price. Most batches end within
an hour, but one may take up to 24, so a run can end before its batches do.
- **The `run` job** has `timeout-minutes: 330` (GitHub stops hosted jobs at 6 hours). It passes
  `COLLEGE_REPORTED_POLL_UNTIL` (an ISO time 300 minutes after the job started) to the script, which stops polling
  then and leaves the rest open.
- **The draft signal** is the state file itself: `data/college-batches.json` lists every batch still open when the
  script exits (it is rewritten after each submit and each collect). If it lists any, the run opens its PR **as a
  draft**, notes how many batches are open, and comments that the collect job will finish it. No new exit code: 0/1/2/3
  mean what they meant.
- **The `collect` job** runs every 30 minutes (cron `*/30 * * * *`) and by hand (**Run workflow**, `mode`:
  **collect**). It exits at once unless an open **draft** PR from a `data/college-reported-<run>` branch exists whose
  `data/college-batches.json` lists open batches. Otherwise it checks out that branch and runs
  `npm run sync-college-reported -- --phase collect --run <run>` (collect, settle reservations, resubmit errored or
  expired requests once, submit escalations), then `npm run merge-reported` and `npm run build-trends`, commits, and
  pushes. When no batch is
  left open it rewrites the release note and the PR body, marks the PR **ready**, and applies the same merge rules as
  the run job (the run's `auto_merge` choice is kept in a hidden `<!-- college-reported: auto_merge=… -->` line of the
  PR body). While batches remain (an escalation batch, or resubmitted requests) the PR stays a draft and the next
  collect continues.
- Both jobs are in the workflow's one `college-reported` concurrency group. The collect job's `timeout-minutes: 25`
  keeps it shorter than the cron interval, so it never queues behind itself or displaces a pending scheduled run.
  Collecting is idempotent: a collect cut off before its push leaves the state file unchanged, and the next one
  collects the same batches again (results are kept 29 days).
- Both jobs restore the `.cache/college-docs/` cache (keys `college-docs-<run>` and
  `college-docs-<run>-collect-<id>`, restoring the newest `college-docs-` entry).
- **A stuck draft**: if a draft pipeline PR lists no open batches (say a collect was cancelled after its push), the
  collect job logs a notice and does nothing; mark the PR ready by hand.

The run's calls file, `data/reports/college-reported-calls-<run>.jsonl`, has one line per model call (college, job,
model, mode, document type, call, estimated vs actual input tokens, cache reads and writes, output tokens, stop
reason, cost; batched calls also carry their `custom_id` and batch id), so the console's bill can be matched to the
batch ids. Both files are in the run's artifact.

None of this can be exercised outside GitHub Actions; the YAML was parsed with `js-yaml` and every `run:` block
checked with `bash -n`.

## 12. The two round-3 pilot runs and the go/no-go table
The first run on round-3 code is two small runs, estimated at $4–10 together
([Decision 11](college-reported-round-3.md#decision-11-measure-the-model-before-the-full-run)). They measure what the
full run's estimates assume before any money goes to all 1,893 colleges. Run them locally, one after the other, from a
clean `main` with `ANTHROPIC_API_KEY` in `.env.local`. The archive is the local directory unless `COLLEGE_DOCS_REPO` is
set (§9).

**Run 1: the pilot set, every college up the ladder from step 0** (`--rediscover` matters: 35 of the 50 already have
recipes, so without it the run measures almost no discovery):
```sh
npm run sync-college-reported -- --pilot --rediscover --max-cost 10 --run r3-pilot-1
```
**Run 2: a stratified random sample of the two big tiers** (the pilot has only 20 of their 1,644 colleges):
```sh
npm run sync-college-reported -- --sample 60 --tiers less,open --max-cost 5 --run r3-pilot-2
```
Each run prepares first (no model), prints its projection, and stops with exit 3 before any model call if the
projection is over the cap. Otherwise it discovers, submits one extraction batch, and polls for up to 90 minutes
(`--poll-minutes`). If a batch is still open when it stops, finish it later with the same run id:
```sh
npm run sync-college-reported -- --phase collect --run r3-pilot-1
```
Exit 2 means the breaker tripped: read the review queue before going further. Then run `npm run merge-reported` and
`npm run verify`, and review `git diff data/` as in §4. Both pilots can also run from Actions: run 1 is **Run workflow**
with `mode` **pilot**, `rediscover` on, and `max_cost` 10. Run 2 has no workflow mode, so run it locally.

**Reading the go/no-go table.** Everything is in `data/reports/college-reported-run-<run>.json` (the summary) and
`data/reports/college-reported-calls-<run>.jsonl` (one line per model call). The PR body, or
`node scripts/college-reported-pr-body.mts body --summary <file> --queue data/review-queue.json`, shows the batches,
the projection, documents by type, and the blocked colleges.

| Read | Where | Go ahead if | Otherwise |
|---|---|---|---|
| Share found at steps 0–1, by tier | `discovery`: colleges under `known`, `guessed`, `manual`, and `probe-*`, against `tiers.<tier>.colleges`. Run 1 for the two selective tiers, run 2 for less selective | ≥ 40% of very selective + selective; ≥ 25% of less selective | Add probe patterns from the misses (`discovery.tried` in each recipe) before spending on steps 3–4 |
| Cost per college at steps 2, 3, 4 | `discovery.picker`, `.search`, and `.full`: `cost_usd ÷ colleges` | $0.003–0.005 picker, $0.05–0.08 search, $0.08–0.15 full | Re-estimate; tighten step 3 to one search |
| Share of each document type | `documents.<type>.fetched` | `xlsx-template` + `pdf-form` ≥ 10% | Re-estimate extraction cost (the spec assumes ~20%) |
| Flattened-PDF tokens | Calls file, `document_type: "pdf-flat"`: `input_tokens` summed per `custom_id` pair; `output_tokens` per call | ≤ 45 K in per document; ≤ 4 K out (`C`) and ≤ 8 K (`rest`) | Revisit the code table's size and line ids |
| Split fallback share | `documents.pdf-flat.split_fallback ÷ fetched` | < 10% | Improve the C/D markers (layout.mts `splitCD`) |
| Undecided grid rows | `documents.*.grid_rows_undecided` | Not measured yet (always 0): spot-check C7 and C8 in a few records instead | Turn on the vision last resort, or improve the layout pass |
| Cache reads | `usage_rows` for extraction: `cache_read_tokens ÷ (calls × the static prefix, ~5 K for C and ~10 K for rest)` | ≥ 25% | Remove the cache marker (`cache: "off"`) |
| Token estimate | Calls file: `estimated_input_tokens` vs `input_tokens` | Within 20% | Reserve with `countTokens` instead |
| Failure share per code | `items.<code>`: `failed ÷ (passed + failed)`; the breaker trips on any code over 20% of 20+ model-read documents | < 20% each | Fix that item's label, normalization, or check |
| Deterministic documents | Howard (form PDF) and the four template workbooks: their records in `data/cds-records/`, and no calls-file line for them | Every in-scope code read with no model call | Fix the readers before the full run |
| Batch time | `batches[].submitted` → `ended` | Under the run job's 300-minute polling window | Rely on the collect job |
| Projection | `projection.full_run_usd` (scaled from the run's colleges to all 1,893) | ≤ the planned cap ($150, owner decision 5) | Raise the cap or narrow the tiers |

The PR body's "Blocked colleges" list names the colleges every candidate host refused. Add links you find by hand to
`data/reference/cds-urls.json` (§10) before the full run.

## What to check in your own tests
- [ ] A profile for a college with a published `reported` value shows the chip/popover next to the federal figure,
  with the verbatim quote, the source link, and "checked automatically" (see
  [college-reported-data.md#display](college-reported-data.md#display)).
- [ ] `/data` section 5 shows the right count of colleges with a newer college-reported figure.
- [ ] `/explore` and `/compare` are unaffected — `school.reported` never feeds ranks, medians, filters, sorts, or
  comparison numbers.
- [ ] Each review-queue item's failed check and quote actually support the stated reason (spot-check a few against
  the source URL).
- [ ] Cost per college, for both discovery and extraction, falls within the ranges in
  [college-reported-data.md#cost](college-reported-data.md#cost); investigate before scaling up if not.
