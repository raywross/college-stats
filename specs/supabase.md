# Supabase

How the dataset moves from JSON files to a Supabase (PostgreSQL) database, and how development and production
stay separate.

## Design: git is the source, Supabase serves it

```
npm run sync-data ──► data/*.json ──► PR (CI: lineage, tests, build) ──► main ──► npm run publish-data ──► Supabase ──► app
```

- **`data/*.json` stay in git as the reviewed source of truth.** Everything already built around them keeps
  working: `npm run verify` checks lineage on every PR, diffs show what a sync changed, and the planned
  college-reported pipeline ([college-reported-data.md](college-reported-data.md)) auto-merges through CI.
- **Supabase is the serving copy.** `npm run publish-data` uploads exactly what is in the files: nothing is published
  that didn't pass the checks.
- **The app loads the whole dataset into memory either way** (~1,900 colleges, 3.6 MB) and queries it there
  ([data-layer.md](data-layer.md)). Ranks, medians, and similar schools need every college, so row-by-row SQL
  queries would be slower and harder to keep identical. Move queries into SQL only if the dataset grows past what
  fits in memory.
- **Data created by users** (accounts, saved lists; [backlog.md](backlog.md)) will live only in Supabase, with no
  JSON counterpart. That is when Supabase becomes necessary, not just convenient.

## Switch: `DATA_SOURCE`

| Value | Reads from | Use |
|---|---|---|
| `json` (default) | `data/schools.json`, `meta.json`, `release-calendar.json` | Offline work, CI builds, fallback |
| `supabase` | The project in `SUPABASE_URL`, with `SUPABASE_PUBLISHABLE_KEY` | Local dev against the dev project; Vercel |

`lib/data.ts` keeps one copy in memory per server instance. From Supabase, each request first checks which publish
the project serves and reloads if it's newer ([Revalidation](#revalidation)). If Supabase can't be reached, the copy
in memory keeps serving. `getData()` is wrapped in React `cache()`, so one request always sees one publish. Missing
keys or an empty project fail loudly on the first load, with a pointer to this page. The app never silently falls
back to JSON.

## Schema (`supabase/migrations/`)

| Table | Contents | Access |
|---|---|---|
| `schools` | `unit_id` (PK), `position` (order in schools.json), `name`, `state`, `data` (one `School`, verbatim) | Public read |
| `dataset_files` | `meta` and `release_calendar` documents | Public read |
| `dataset_publishes` | Log: time, college count, `retrieved`, git commit, who | Secret key only |
| `school_histories` | `unit_id` (PK), `data` (one `SchoolHistory`, verbatim: data/history/schools/{id}.json) | Public read |
| `history_files` | `meta`, `national`, `facts`, `cpi` from data/history/ | Public read |

- Documents are **`json`, not `jsonb`**: jsonb reorders object keys (e.g. race/ethnicity shares come back as
  asian, black, other, white, …), and the UI iterates some objects in key order.
- Row-level security is on for every table. Anyone may `select` the dataset tables. There are no write policies.
- **`publish_dataset(p_schools, p_meta, p_release_calendar, p_git_commit, p_published_by)`** replaces everything in
  one transaction, so readers never see half a publish and colleges dropped from the sync disappear. Only
  `service_role` (the secret key) may call it.
- **`publish_history(p_schools, p_files)`** (migration `20260928120000_history.sql`) does the same for history
  ([trends-data.md](trends-data.md)): `npm run publish-data` calls it after the dataset when data/history/ exists, then
  reads every shard back. The app reads one shard per profile and the shared files once per publish; if the tables
  are missing, pages render without history (so code can merge before the migration, but apply it before publishing).
- Migrations follow the Supabase CLI layout (`<timestamp>_<name>.sql`), so they can later be applied with
  `supabase db push`. The first one is pasted into the SQL Editor. To switch to the CLI later, mark it applied with
  `supabase migration repair --status applied 20260928000000`.

## Publishing (`npm run publish-data`)

`scripts/publish-data.mts`. `npm run publish-data` uses `.env.local` (dev) if it exists; environment variables win
over the file, which is how the GitHub Action points it at prod. `npm run publish-data:prod` uses `.env.prod.local`
(prod; git-ignored, copied into worktrees by `.worktreeinclude`). It's deliberately not `.env.production.local`,
which Next.js would load into every local `next build`/`next start` and point them at prod.

1. Lineage check (same as `npm run check:lineage`). Any problem stops the publish.
2. Shrink guard: refuses to drop more than 10% of the colleges already published unless `--allow-shrink`.
3. `publish_dataset()` in one transaction, recording the git commit (`+uncommitted` if `data/` has local changes).
4. Reads everything back through the same code the app uses and requires an exact match with the files.
5. If `REVALIDATE_URL` and `REVALIDATE_SECRET` are set, POSTs to the site so static pages regenerate
   ([Revalidation](#revalidation)). A failure here exits non-zero but says the data is already published.

`--dry-run` runs steps 1–2 and writes nothing. Tested against real Postgres (PGlite): all 1,893 colleges read back
byte for byte, republishing replaces instead of duplicating, an empty publish is rejected, and `anon` can read
but can't write or call the function.

## Revalidation

`/`, `/data` and the 50 prerendered profiles (plus every other profile, once visited) are static pages. With
Supabase they must be regenerated after a publish, without a redeploy.

**Trigger:** `POST /api/revalidate` with `Authorization: Bearer $REVALIDATE_SECRET` calls
`revalidatePath("/", "layout")`, which marks every page stale; each regenerates on its next visit. The route returns
401 for a missing or wrong secret, and when `REVALIDATE_SECRET` isn't set at all. `lib/revalidate.ts` compares
digests in constant time. Callers: `publish-data` (step 5) and the GitHub Action.

```sh
curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" https://<site>/api/revalidate
```

**The stale-instance problem:** each server instance (a Vercel function instance, or `next start`) holds the
dataset in memory. The regeneration runs on whichever instance takes the next visit, and that instance may have
loaded its copy before the publish. With the old design (re-read in the background every `DATA_TTL_SECONDS`), it
would render the old copy into the page, and that stale page would then be cached until the next publish.

**Choice: check the version on every request.** `publish_dataset()` stamps `dataset_files.published_at` with the
transaction time. `getData()` (via `lib/dataset-loader.ts`) reads that one timestamp per request and, if it differs
from the copy in memory, waits for a full reload before rendering. A render can therefore never be older than the
publish Supabase is serving, whichever instance runs it.
- Cost: one small query (two rows, no documents) per request that calls `getData()`, plus a full reload (~1 s) only
  after a publish. Static pages call it only when they regenerate. `/explore`, `/compare` and `/api/schools` call
  it on every request, and in exchange they show a new publish at once instead of after 10 minutes.
- Alternatives rejected: reloading inside `/api/revalidate` only refreshes the instance that handled that request.
  A shorter TTL only narrows the window. Next's data cache with `revalidateTag` works but can't be tested faithfully
  with `next start`, and it serves one stale read after the tag is invalidated.
- Consistent reads: the full read takes three requests (colleges come in pages of 1,000). `fetchDatasetFiles`
  compares the version before and after; if a publish landed in between, it reads again (up to 3 times).
- If Supabase is unreachable, the copy in memory keeps serving (logged). A page regenerated at that moment could
  keep an old copy, so `/` and profiles also have `revalidate = 86400` (like `/data`) as a daily fallback.

**Deploy race:** a merge that changes `data/**` starts both a Vercel production build (which prerenders from
Supabase) and the publish Action. If the build reads Supabase before the publish lands, the new deployment's static
pages hold the old data. The Action therefore also revalidates after every successful Vercel production deploy
(`deployment_status`). Whichever finishes last, publish or deploy, triggers a revalidation that sees the new data.

**Tested locally** (2026-09-28, `next build && next start` against the dev project): warmed the server, then
published a marked copy (a renamed UCLA and release label) with revalidation. `/`, `/schools/110662` and `/data`
showed the marker on the first visit. Published the original without revalidating: static pages kept the marker
(cached), `/explore` switched back at once (version check). A curl to `/api/revalidate` then brought the static
pages back. Unit tests (`tests/supabase.test.mts`) cover the reload, a publish landing mid-read, an unreachable
store, and the auth check. They fail if the version check is removed.

## Keys

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | `.env.local`, `.env.prod.local`, Vercel, GitHub secret `PROD_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `.env.local`, `.env.prod.local`, Vercel | `sb_publishable_…`. Read-only through RLS. Replaces the legacy `anon` key |
| `SUPABASE_SECRET_KEY` | `.env.local`, `.env.prod.local`, GitHub secret `PROD_SUPABASE_SECRET_KEY` | `sb_secret_…`. Bypasses RLS. Only the publish script uses it. Never in Vercel, never `NEXT_PUBLIC_` |
| `DATA_SOURCE` | `.env.local`, Vercel | `json` or `supabase` |
| `REVALIDATE_SECRET` | Vercel (Production), `.env.prod.local`, GitHub secret `PROD_REVALIDATE_SECRET` | Random string; guards `/api/revalidate`. Unset = endpoint refuses everything |
| `REVALIDATE_URL` | `.env.prod.local`, GitHub secret `PROD_REVALIDATE_URL` | `https://<production-domain>/api/revalidate` |

None use the `NEXT_PUBLIC_` prefix: `lib/data.ts` is server-only, so the browser never talks to Supabase.

## Environments: two projects

| Project | Used by | Data changes when |
|---|---|---|
| **dev** (`quad-dev`) | Local dev servers (every worktree); for now also Vercel Production ([current state](#current-state-pre-release-dev-only)) | Anyone runs `npm run publish-data` |
| **prod** (`quad-prod`, not created yet) | Vercel Production | Only a merge to `main` that changes `data/**` ([GitHub Action](#production)), or a deliberate `publish-data:prod` |

- **Two projects, not two schemas in one.** Supabase keys, RLS, backups and pausing are per project. Separate
  projects mean a local experiment, a new migration, or a leaked dev key can't touch production.
- **Free plan:** two free projects per organization, which covers dev and prod. Free projects **pause after about a
  week without traffic**. Dev may pause while you work on JSON; restore it from the dashboard (about a minute).
  Production traffic keeps prod awake.
- **Not needed:** Supabase Branching (paid, per-PR databases; overkill for a read-only public dataset) or a local
  Supabase in Docker (`supabase start`; useful only once there are user tables to experiment with offline).
- New migrations: apply to dev first, then prod, then merge the code that needs them. Migrations must stay
  backward-compatible with the running app (add, don't rename) because the app and database deploy separately.

## Transition plan

| Phase | What | Status |
|---|---|---|
| 0. Code | `DATA_SOURCE` loader, `lib/dataset.ts` factory, schema, `publish-data`, tests | ✅ Done (`feature/supabase-migration`) |
| 1. Dev project | Apply migration, add keys to `.env.local`, `npm run publish-data`, run locally with `DATA_SOURCE=supabase`, compare pages with `json` | ✅ Done 2026-09-28 (see below) |
| 2. Default locally | Set `DATA_SOURCE=supabase` in `.env.local`; `json` stays for offline work and CI | After phase 1 checks out |
| 3. Production | Create prod project, apply migration, `publish-data:prod`; Vercel env vars (Production → prod, Preview → JSON); GitHub Action publishes to prod on merges that change `data/**`; on-demand revalidation so static pages (`/`, top 50 profiles, `/data`) pick up a publish without a redeploy | Code done 2026-09-28 (`feature/supabase-prod`): `.env.prod.local`, Action, `/api/revalidate`, per-request version check, tested locally. Deployed to Vercel 2026-09-28 as a pre-release site on the dev project; the prod project comes with the formal release ([Current state](#current-state-pre-release-dev-only)) |
| 4. Later | Scheduled sync opens PRs ([backlog.md](backlog.md)); user tables (accounts, saved lists) as new migrations; decide whether `schools.json` leaves git | As needed |

**Rollback at any phase:** set `DATA_SOURCE=json` (and restart). The files are always there.

### Phase 1 steps (dev project)
1. **SQL Editor** → New query → paste `supabase/migrations/20260928000000_dataset.sql` → Run.
2. **Project Settings → API Keys**: copy the publishable key and create/copy a secret key. **Project Settings →
   Data API**: copy the project URL. Add them to `.env.local` (see `.env.example`), keeping `DATA_SOURCE=json`.
3. `npm run publish-data -- --dry-run`, then `npm run publish-data`. It should end with "read back and verified".
4. Set `DATA_SOURCE=supabase`, restart the dev server, and check `/`, `/explore`, a profile, `/compare`, `/data`.
   Numbers must match the `json` run exactly.

**Phase 1 result (dev project `gwusgmmionqxabifntgv`, 2026-09-28):**
- Migration applied in the SQL Editor. Verified over a direct connection: RLS is on for all three tables; `anon`
  can `select` `schools` and `dataset_files` only; `publish_dataset` is executable by `service_role` only.
- Through the API, the publishable key can read, and its insert and RPC calls are refused.
- `npm run publish-data` published 1,893 colleges in about 2.5 s, and the read-back matched exactly.
- Built the app twice (`json` and `supabase`) and diffed 17 URLs (home, Explore views and filters, four profiles,
  Compare, Data, `/api/schools`). 15 matched exactly, ignoring build hashes. `/explore` had byte-identical visible
  HTML; only the order of React's streamed rows differed. `/data` differed only in the timeline's "today" marker,
  which uses `new Date()` at build time.

## Production

### Current state: pre-release, dev only
The site is still being built, so there is only the **dev** project (`gwusgmmionqxabifntgv`). Vercel's Production
environment, at **https://college-stats-nine.vercel.app** since 2026-09-28, is a pre-release dev site that reads it.
The prod project, the dev/prod split and the control procedures around publishing come with the formal release, once
the planned features are in and the site is circulated more widely ([backlog.md](backlog.md#platform)).
- Vercel Production has `DATA_SOURCE=supabase` and the dev project's `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`.
  Preview has `DATA_SOURCE=json`. No `REVALIDATE_SECRET` and no GitHub `PROD_*` secrets yet, so the Action's jobs
  skip.
- **`npm run publish-data` updates the deployed site.** Dynamic pages (`/explore`, `/compare`, `/api/schools`) show a
  publish on their next request; static ones (`/`, profiles, `/data`) at their daily regeneration or the next deploy.
- At the formal release, follow [Setup](#setup-phase-3) (steps 1, 2, 4 and 5; in step 3 only point
  Production at prod) and update this section.

Found while setting it up:
- The Vercel–Supabase integration adds its own variables (`SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_*`,
  `POSTGRES_*`, …). The app reads none of them; `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` had to be added by
  hand. The build fails with "Supabase is not configured" without them.
- A `DATA_SOURCE` that exists but is empty is treated as unset (`json`).
- **Settings → Git → Production Branch** must be `main`. Per-deployment URLs and `*-<team>.vercel.app` aliases sit
  behind Vercel Deployment Protection (302 to a login); the production domain is public.
- Vercel runs Node 24.x (`engines` in `package.json`), matching CI.

### Publishing to prod: `.github/workflows/publish-data.yml`
- **`publish`** runs `npm run publish-data` against prod when a push to `main` changes `data/**`, or when run by hand
  (Actions → Publish data → Run workflow). It only ever publishes `main`, even when started from another branch.
  Runs are serialized (a newer queued run replaces an older one). If `PROD_SUPABASE_URL` or
  `PROD_SUPABASE_SECRET_KEY` isn't set, it logs a notice and skips, and the run stays green.
- **`revalidate-after-deploy`** runs on each successful Vercel production deploy (`deployment_status`) and POSTs to
  `/api/revalidate`, which closes the [deploy race](#revalidation). It skips when the `PROD_REVALIDATE_*` secrets
  aren't set.
- CI's `verify` job keeps using JSON and needs no secrets.
- A deliberate publish from a laptop: `npm run publish-data:prod -- --dry-run`, then `npm run publish-data:prod`.

### Setup (phase 3)

**1. Publish to prod first,** so the first Vercel build has data. Put the prod project's values in
`.env.prod.local` in the main checkout (same variable names as `.env.local`: `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`), then run `npm run publish-data:prod -- --dry-run` and
`npm run publish-data:prod`. It should end with "read back and verified".

**2. Create a revalidation secret:** `openssl rand -hex 32`. Keep it for steps 3 and 4.

**3. Vercel environment variables** (Project → Settings → Environment Variables; for each, pick the environments
it applies to; mark keys **Sensitive**):

| Name | Production | Preview | Development |
|---|---|---|---|
| `DATA_SOURCE` | `supabase` | `json` | – |
| `SUPABASE_URL` | prod project URL | – | – |
| `SUPABASE_PUBLISHABLE_KEY` | prod publishable key | – | – |
| `REVALIDATE_SECRET` | the secret from step 2 | – | – |

- **No `SUPABASE_SECRET_KEY` in Vercel.** The site only reads.
- The build prerenders from Supabase, so these are needed at build time too. Vercel provides them to both.
- Changing variables doesn't touch the running deployment: **Deployments → latest production → Redeploy**.
- Development stays empty: local dev uses `.env.local`, not `vercel env pull`.
- Preview deploys read their branch's own `data/*.json`, so a data PR's preview shows exactly the data in the PR
  (the shared dev project holds whatever was last published to it), and Preview needs no database keys.

**4. GitHub repository secrets** (repo → Settings → Secrets and variables → Actions → New repository secret):

| Secret | Value |
|---|---|
| `PROD_SUPABASE_URL` | prod project URL |
| `PROD_SUPABASE_SECRET_KEY` | prod secret key (`sb_secret_…`) |
| `PROD_REVALIDATE_URL` | `https://<production-domain>/api/revalidate` |
| `PROD_REVALIDATE_SECRET` | the secret from step 2 |

Optionally add `REVALIDATE_URL` and `REVALIDATE_SECRET` to `.env.prod.local` too, so `publish-data:prod` from a
laptop also revalidates.

**5. Verify the deployed site:**
1. Open `/`, a profile such as `/schools/110662`, `/explore`, `/compare?ids=110662,243744`, and `/data`. They
   should match the local JSON build. A 500 with "Supabase is not configured" or "no published dataset" means step
   1 or 3 is incomplete.
2. `curl -i -X POST https://<domain>/api/revalidate` returns 401. The same request with
   `-H "Authorization: Bearer <secret>"` returns `{"revalidated":true,…}`.
3. Actions → Publish data → Run workflow (on `main`). `publish` should end with "read back and verified" and
   "Revalidated <domain>".
4. After the next production deploy, Actions shows a `revalidate-after-deploy` run. If none appears, check the
   environment name Vercel reports (repo → Environments) against the job's `if:` condition.
