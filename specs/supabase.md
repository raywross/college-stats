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

`lib/data.ts` loads once per server process. From Supabase it re-reads in the background after
`DATA_TTL_SECONDS` (default 600) and keeps serving the previous copy if a refresh fails. `getData()` is wrapped in
React `cache()`, so one request always sees one publish. Missing keys or an empty project fail loudly, with a pointer
to this page. The app never silently falls back to JSON.

## Schema (`supabase/migrations/`)

| Table | Contents | Access |
|---|---|---|
| `schools` | `unit_id` (PK), `position` (order in schools.json), `name`, `state`, `data` (one `School`, verbatim) | Public read |
| `dataset_files` | `meta` and `release_calendar` documents | Public read |
| `dataset_publishes` | Log: time, college count, `retrieved`, git commit, who | Secret key only |

- Documents are **`json`, not `jsonb`**: jsonb reorders object keys (e.g. race/ethnicity shares come back as
  asian, black, other, white, …), and the UI iterates some objects in key order.
- Row-level security is on for every table. Anyone may `select` the dataset tables. There are no write policies.
- **`publish_dataset(p_schools, p_meta, p_release_calendar, p_git_commit, p_published_by)`** replaces everything in
  one transaction, so readers never see half a publish and colleges dropped from the sync disappear. Only
  `service_role` (the secret key) may call it.
- Migrations follow the Supabase CLI layout (`<timestamp>_<name>.sql`), so they can later be applied with
  `supabase db push`. The first one is pasted into the SQL Editor. To switch to the CLI later, mark it applied with
  `supabase migration repair --status applied 20260928000000`.

## Publishing (`npm run publish-data`)

`scripts/publish-data.mts`, with `.env.local` (dev). `npm run publish-data:prod` uses `.env.production.local`.

1. Lineage check (same as `npm run check:lineage`). Any problem stops the publish.
2. Shrink guard: refuses to drop more than 10% of the colleges already published unless `--allow-shrink`.
3. `publish_dataset()` in one transaction, recording the git commit (`+uncommitted` if `data/` has local changes).
4. Reads everything back through the same code the app uses and requires an exact match with the files.

`--dry-run` runs steps 1–2 and writes nothing. Tested against real Postgres (PGlite): all 1,893 colleges read back
byte for byte, republishing replaces instead of duplicating, an empty publish is rejected, and `anon` can read
but can't write or call the function.

## Keys

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | `.env.local`, Vercel | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `.env.local`, Vercel | `sb_publishable_…`. Read-only through RLS. Replaces the legacy `anon` key |
| `SUPABASE_SECRET_KEY` | `.env.local`, GitHub Actions secrets | `sb_secret_…`. Bypasses RLS. Only the publish script uses it. Never in Vercel, never `NEXT_PUBLIC_` |
| `DATA_SOURCE` | `.env.local`, Vercel | `json` or `supabase` |

None use the `NEXT_PUBLIC_` prefix: `lib/data.ts` is server-only, so the browser never talks to Supabase.

## Environments: two projects

| Project | Used by | Data changes when |
|---|---|---|
| **dev** (`quad-dev`) | Local dev servers (every worktree), Vercel Preview deploys | Anyone runs `npm run publish-data` |
| **prod** (`quad-prod`) | Vercel Production | Only a merge to `main` (GitHub Action), or a deliberate `publish-data:prod` |

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
| 1. Dev project | Apply migration, add keys to `.env.local`, `npm run publish-data`, run locally with `DATA_SOURCE=supabase`, compare pages with `json` | Next (manual steps below) |
| 2. Default locally | Set `DATA_SOURCE=supabase` in `.env.local`; `json` stays for offline work and CI | After phase 1 checks out |
| 3. Production | Create prod project, apply migration, `publish-data:prod`; Vercel env vars (Production → prod, Preview → dev); GitHub Action publishes to prod on merges that change `data/**`; on-demand revalidation so static pages (`/`, top 50 profiles, `/data`) pick up a publish without a redeploy | With the Vercel move |
| 4. Later | Scheduled sync opens PRs ([backlog.md](backlog.md)); user tables (accounts, saved lists) as new migrations; decide whether `schools.json` leaves git | As needed |

**Rollback at any phase:** set `DATA_SOURCE=json` (and restart). The files are always there.

### Phase 1 steps (dev project)
1. **SQL Editor** → New query → paste `supabase/migrations/20260928000000_dataset.sql` → Run.
2. **Project Settings → API Keys**: copy the publishable key and create/copy a secret key. **Project Settings →
   Data API**: copy the project URL. Add them to `.env.local` (see `.env.example`), keeping `DATA_SOURCE=json`.
3. `npm run publish-data -- --dry-run`, then `npm run publish-data`. It should end with "read back and verified".
4. Set `DATA_SOURCE=supabase`, restart the dev server, and check `/`, `/explore`, a profile, `/compare`, `/data`.
   Numbers must match the `json` run exactly.

### Phase 3 notes (production)
- Static pages are built once. With Supabase they need a trigger after each publish: a secret-protected
  `/api/revalidate` route that the publish step calls (`revalidatePath("/", "layout")`), or `revalidate` on
  those routes. Not built yet, because nothing is deployed.
- `next build` on Vercel reads the database to prerender pages, so Vercel needs the URL and publishable key at
  build time as well as at runtime.
- The GitHub Action needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for **prod** as repository secrets.
  CI's `verify` job keeps using JSON and needs no secrets.
