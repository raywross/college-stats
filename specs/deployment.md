# Deployment (Vercel)

How the site runs on Vercel, where each environment reads its data, and how a data publish reaches the live pages.
Database side: [supabase.md](supabase.md).

## Environments

| Vercel environment | Deploys | `DATA_SOURCE` | Reads |
|---|---|---|---|
| **Production** | Every push to `main` | `supabase` | The **prod** Supabase project |
| **Preview** | Every other branch / PR | `json` | That branch's own `data/*.json` |
| Local (`npm run dev`) | — | `supabase` or `json` | The **dev** project, or the files |

Previews read JSON on purpose: a data PR's preview then shows exactly the data in the PR, which a shared dev
project can't promise (it holds whatever was last published to it). It also keeps database keys out of Preview.
The Supabase read path is exercised locally against dev and in Production.

Node is pinned to 24.x (`engines` in `package.json`), matching CI.

## Environment variables

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `DATA_SOURCE` | `supabase` | `json` | |
| `SUPABASE_URL` | prod project URL | — | Needed at build time too: `next build` prerenders pages from the database |
| `SUPABASE_PUBLISHABLE_KEY` | prod `sb_publishable_…` | — | Read-only through RLS |
| `REVALIDATE_SECRET` | 64 hex chars | — | `openssl rand -hex 32`; same value as the GitHub secret |
| `DATA_TTL_SECONDS` | optional | — | Default 600 |

Not in Vercel: `SUPABASE_SECRET_KEY` (only the publish step uses it, from GitHub Actions) and
`COLLEGE_SCORECARD_API_KEY` (only `npm run sync-data` uses it). The Vercel–Supabase integration may add its own
variables (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_*`, `NEXT_PUBLIC_SUPABASE_*`). The app reads
none of them. Nothing references the `NEXT_PUBLIC_` ones, so they never reach the browser.

## Rendering and freshness

| Route | Rendering | Refreshes |
|---|---|---|
| `/`, top 50 `/schools/[id]` | Prerendered at build | On publish (revalidate call), and at least hourly (`revalidate = 3600`) |
| Other `/schools/[id]` | Rendered on first visit, then cached | Same |
| `/data` | Prerendered | On publish, and daily (the "today" marker) |
| `/explore`, `/compare`, `/api/schools` | Per request | From the in-memory copy, re-read after `DATA_TTL_SECONDS` |
| `/glossary` | Static | Never needs to |

Each server instance holds the whole dataset in memory ([data-layer.md](data-layer.md), `lib/data.ts`).

## Publishing data to production

```
merge to main touching data/** ──► .github/workflows/publish-data.yml
                                     1. npm run publish-data (checks, one-transaction publish, read-back) → prod
                                     2. POST $SITE_URL/api/revalidate
```

- `POST /api/revalidate` (`app/api/revalidate/route.ts`) needs `Authorization: Bearer $REVALIDATE_SECRET`. It
  re-reads the dataset in the instance that handles it, then calls `revalidatePath("/", "layout")`: every cached
  page re-renders on its next visit. Answers 401 for a wrong token, and 503 if the secret isn't set (or is under
  32 characters) so the route is never open. The token check is `lib/revalidate-auth.ts`, tested in
  `tests/revalidate-auth.test.mts`.
- Another warm instance may still hold the previous copy for up to `DATA_TTL_SECONDS`, and a page it re-renders
  in that window shows the old data until the next hourly re-render. Publishes are rare, so the hour is the bound.
- Run it by hand: Actions → Publish data → Run workflow (tick "allow shrink" to drop over 10% of colleges).
- Merging code doesn't publish. A PR that needs a schema change: apply the migration to dev, then prod, then
  merge ([supabase.md](supabase.md#environments-two-projects)).

## Setup checklist (one time)

1. **Prod Supabase project**: SQL Editor → run `supabase/migrations/20260928000000_dataset.sql`. Put its URL,
   publishable and secret keys in `.env.production.local`, then `npm run publish-data:prod -- --dry-run` and
   `npm run publish-data:prod`.
2. **Vercel → Settings → Environment Variables**: the table above. Production and Preview are set separately.
3. **GitHub → Settings → Secrets and variables → Actions**: secrets `PROD_SUPABASE_URL`,
   `PROD_SUPABASE_SECRET_KEY`, `REVALIDATE_SECRET`; variable `SITE_URL` (e.g. `https://<project>.vercel.app`, no
   trailing slash).
4. Merge, and let Vercel deploy `main`. Check `/`, `/explore`, a profile, `/compare`, `/data`.
5. Actions → Publish data → Run workflow, to check the secrets and the revalidate call end to end.

## Rollback

- Bad data: revert the data commit on `main`; the workflow republishes the previous files.
- Database trouble: set `DATA_SOURCE=json` in Vercel Production and redeploy. The files ship with every deploy
  (`outputFileTracingIncludes` in `next.config.ts`).
- Bad code: Vercel → Deployments → promote the previous deployment.
