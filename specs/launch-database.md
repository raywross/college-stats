# Launch database: a production Supabase project next to Vercel

> Status: **planned** 2026-10-12 (owner). Do it just before the formal release. Extends
> [supabase.md](supabase.md) "Setup at the formal release". Note (2026-10-31): the public dataset's layers and
> snapshots live in whichever project `DATA_SUPABASE_URL` names ([data-platform/](data-platform/README.md)); they can
> stay in the dev project or move with this step, and the app reads snapshots from Storage either way.

## Why
The only Supabase project (`quad-dev`, `gwusgmmionqxabifntgv`) is in **ca-central-1 (Montréal)**, while Vercel runs
the app's functions in **us-east-1 (iad1, Washington)**. Every signed-in request pays about 15–25 ms per database
round trip for the distance, and the planner makes several. The owner hasn't launched, so today's "prod" is really
dev; a project's region can't be changed after it's created, so the fix is a new project in the right region, made
once, at launch.

## What
1. **Create `quad-prod` in East US (North Virginia), us-east-1,** the same AWS region as Vercel's `iad1`.
2. **Schema:** apply every file in `supabase/migrations/` in order (one generated catch-up script, tested against a
   PGlite boot first, like `chances-build/dev-catch-up.sql` was), deploy the `invite-user` Edge Function and its
   secrets ([supabase.md](supabase.md#edge-functions)).
3. **Data the owner wants to keep:** decide at the time whether any accounts in `quad-dev` move (a `pg_dump` of the
   `public` schema's people tables plus the `auth` users, restored into prod, so logins keep working) or prod starts
   empty. High schools are republished from the repo (`npm run publish-high-schools`), not copied.
4. **Auth settings:** site URL and redirect URLs for the production domain, email templates, the email sender.
5. **Switch:** Vercel Production's `SUPABASE_*` variables to prod (Preview and local stay on dev), the
   `PROD_SUPABASE_*` GitHub secrets, redeploy, then check sign-in, a list, the planner, a high-school page, and the
   next deploy's `publish-changes` run ([supabase.md](supabase.md#setup-at-the-formal-release) steps 3–5).
6. **Measure:** with `QUAD_TIMING=1` on a preview, compare a planner save and a student switch before and after.
7. Keep `quad-dev` in Montréal for development, or recreate it in us-east-1 too if dev's speed matters by then.

## Doing it without the owner pasting SQL
So Claude can do the work directly (owner, 2026-10-12: "would be good if I can set up access so that you can just do
all the work directly"), the session needs, in a git-ignored env file:
- **`SUPABASE_ACCESS_TOKEN`**: a personal access token (Supabase dashboard → Account → Access Tokens) for the
  Supabase CLI and Management API: create the project, read its region and keys, deploy the Edge Function, set its
  secrets.
- **`SUPABASE_DB_URL`** for each project (Project Settings → Database → Connection string, the session pooler or
  direct URI): apply migrations and run the dump/restore with `psql`/`pg_dump` (install the Postgres client tools).
- **`VERCEL_TOKEN`** (Vercel → Account Settings → Tokens), scoped to the project's team: set environment variables,
  trigger redeploys, read function logs, and set `regions` if needed. Plus, for previews behind Deployment
  Protection, a **Protection Bypass for Automation** secret (Project → Settings → Deployment Protection), so QA can
  load preview URLs.
Every step that changes a live project is still confirmed with the owner before it runs; the tokens make the work
direct, not unattended. Tokens never go in the repo, a PR, or a log.

## Done when
Production reads and writes a us-east-1 project, sign-in and the planner work on the production domain, and a planner
save is measurably faster than on `quad-dev`.
