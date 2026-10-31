# Part 6, Rollout: phases, owner steps, the free plan, egress, risks

> Status: **planned** 2026-10-31 (owner's brief and answers in [README.md](README.md)); phase 1 started the same day.
> This is the roadmap's work item for the whole [data platform](README.md). Each phase leaves the site no worse than before it; each is one PR into
> `main` (or two where noted), built in units by agents from a brief, verified, QA'd.

## Phases
| Phase | Delivers | The site during it | Proof before merge |
|---|---|---|---|
| **1. Store, import, publisher, loader** | The migrations; the `DataStore`; the import from git; the publisher (compose, render, upload, pointer, change log); the loader with snapshot mode behind `DATA_SNAPSHOT_URL`; the bucket; `fetch-snapshot` and the mini fixture; the admin **Overview** and **Snapshots** screens (read-only plus Point back) | Unchanged: `DATA_SNAPSHOT_URL` is unset on Vercel; the deploy still carries `data/`. The first snapshot is published from the imported layers and compared | The publisher's render equals the committed `schools.json` byte for byte; verify green; a Preview deployment with `DATA_SNAPSHOT_URL` set renders every page from the snapshot and swaps when a second snapshot is published |
| **2. Pipelines write layers; the console reviews** | Every producer on the store; workflows without commits or PRs; `repository_dispatch` to the publisher; change sets, holds, revert in the console; the review queue's Accept/Reject/Re-run moved off the GitHub App; `publish-changes.yml` and `essay-confirmed.yml` retired | Production switches to `DATA_SNAPSHOT_URL` at the start of this phase (owner step, after Pro); data changes arrive by publish | A college-reported run on a pilot writes a change set and the snapshot shows its values; a held run blocks the publish and Revert restores the documents; the digest reports the publish |
| **3. Admin edits and reference documents** | `data_field_edits`, `admin_data_edit`, the live overlay, `quad-edit` lineage, the Edit mode on the college page with history and release, the reference editor | Edits show at once; snapshots bake them | An edit shows on the page within one load, survives a pipeline run, is cited "Edited by Quad", and reverts |
| **4. Git without data** | `data/` removed from the repository except fixtures; the ~100 tests on the mini fixture; tracing rewired; `sync-data` writing `base.*`; docs updated | Unchanged | verify green with no `data/`; a clean clone builds with the mini fixture; a Vercel build fetches the snapshot |

Phases 1 and 2 are the bulk. Phase 3 is small once 2 exists. Phase 4 is wide but mechanical.

## Owner steps, in order
1. Nothing before phase 1 merges: it is additive and off by default.
2. **Before switching production (start of phase 2):** upgrade the data project to **Pro**; set `DATA_SNAPSHOT_URL` on
   Vercel (Production and Preview; the bucket's public URL, not a secret) and the GitHub secrets
   `DATA_SUPABASE_URL`, `DATA_SUPABASE_SECRET_KEY`; redeploy. The migrations are applied by this session to the dev
   project with the database URL in `.env.local`, as the essays migrations were.
3. After phase 2: delete the `COLLEGE_REPORTED_TOKEN`-driven auto-merge expectation from the branch rules if any
   depends on data PRs; nothing else.
4. After phase 4: shrink the repository (`git` history still holds the old data; a history rewrite is optional and
   not planned).

## The free plan, pausing, egress (the owner's question 1)
- **Building and testing on Free works.** The layers are a few tens of megabytes; the publisher's reads are one
  query per collection; Storage holds the snapshots (1 GB on Free). The project pauses after about a week without
  database activity; the pipelines and the nightly publisher keep it awake, and a paused project wakes on the first
  request in about a minute.
- **What a pause affects**: a pipeline run's first writes (retried by the store with a one-minute wait), a publish
  (retried), and the pointer check. **Not** the public site: Storage of a paused project is unreachable too, but every
  instance has its bundled snapshot, so pages render from it; the pointer check fails soft. People's data is the same
  as today.
- **Egress is the reason for Pro before production serving.** A cold instance downloads about 6 MB (the gzipped
  colleges object); a profile render adds about 25 KB. At, say, 300 cold starts a day that is 1.8 GB a day, past
  Free's 5 GB a month in three days; Pro's 250 GB a month covers it many times over. Shards are cached by the CDN and
  by Next's fetch cache, so they add little. The bundled copy keeps cold starts from waiting on the download.
- **Backups**: Pro adds daily backups, which the layers deserve once they are the only copy (phase 4). Until then git
  still holds the data.

## Risks and how each is held
| Risk | Mitigation |
|---|---|
| The publisher's compose drifts from `sync-data`'s order and the first snapshot differs from the committed file | Phase 1's byte-equality proof on the real data; the determinism test on the mini fixture forever after |
| A build depends on Storage being up | `fetch-snapshot` fails the build loudly; Vercel retries a redeploy; the previous deployment keeps serving |
| Two runs write one layer at once (college-reported's `collect` beside a `pilot`) | `expectVersion` on writes; a conflict holds the later change set with a readable reason |
| A pipeline bug writes garbage to a layer | The breaker holds the set; the publisher's lineage check fails the publish; Revert restores versions; Point back restores the site at once |
| The free project pauses mid-run | Store retries; the run resumes from its open change set (today's resumable phases) |
| Tests silently depend on live data | The rule "no test reads the snapshot or the database", enforced by a guard that fails any test importing the Supabase client or reading `.data/` |
| The console's open select on pipeline state exposes something | Nothing in a layer is a person's data; the review queue and docs manifest are about public documents. A test walks the mini layers for email-shaped strings |
| Egress surprises | `data_snapshot_swap` and the loader's log show download counts; the health page shows cold-start rate |
| Lineage weakens with edits (the owner's choice) | Edits still carry who, when and an optional note, and the popover says "Edited by Quad"; the sources list counts them. Nothing is uncited |
| Two sessions edit the same code | One session owns this build (owner, 2026-10-31) |

## Complexity
Very large: new tables and functions with policies, a publisher that must reproduce today's data exactly, a loader
that swaps safely, every producer touched, the console's biggest new section, and a test suite re-pointed at a
fixture. Built in four phases with the byte-equality proof as the gate between them.

## As built, phases 1 and 2 (2026-10-31)
Phase 1 merged as PR #201 (gate: byte-for-byte). Phase 2 is one PR; its production switch is the owner's three
steps in the PR body (GitHub secrets, `DATA_SNAPSHOT_URL`, one publish). The owner chose to stay on the free plan for
now ("comfortable going to prod as is… beta"), so two things changed: the publisher calls a Vercel deploy hook after
each publish (egress near zero), and the dev database made room by archiving past and removed visit events (PR #202:
385 MB → 151 MB for that table; 522 MB → 289 MB for the database; 417 MB after importing every layer). The
high-school shards were not imported (the tables already hold them). Two faults the first real import found are
fixed in the store: a NUL escape in one CDS record (Postgres JSON refuses it) and 16 MB write calls that timed out
(calls are bounded by bytes). The pending essay prompts run under the sixth reader goes through the new pipeline.
