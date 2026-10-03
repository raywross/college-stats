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
document that `data/schools.json` already holds, and `npm run publish-data` (and the existing
`publish-data.yml` workflow) uploads it exactly as it uploads every other field, after the data PR merges to `main`.

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
- Merge it by hand once you're satisfied. `publish-data.yml` already runs on any merge to `main` that touches
  `data/**`, so nothing else to trigger — `data/schools.json` rode along in this same PR.

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

## 9. Links you find by hand, and blocked hosts
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
