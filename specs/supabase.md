# Supabase

What the site keeps in its Supabase (PostgreSQL) project, how it gets there, and how development and production
stay separate. Since 2026-10-07 ([serving-architecture.md](serving-architecture.md)) Supabase holds **people's data,
the high-school table, and the record of what changed**; the college dataset itself ships with every deploy and is
read from the function's own files. For the rules that decide what belongs in a table, see
[database-architecture.md](database-architecture.md).

## Design: git is the source, the deploy serves it

```
npm run sync-data ──► data/*.json ──► PR (CI: lineage, tests, build) ──► main ──► Vercel build ──► the site
                                                                                 │
                                                             deployment succeeds ─┴─► npm run publish-changes ──► dataset_changes ──► update emails
data/high-schools/** changes on main ──────────────────────────────────────────────► npm run publish-high-schools ──► high_schools
```

- **`data/*.json` stay in git as the reviewed source of truth**, and are the serving copy too: `next.config.ts`
  traces them into every server function, and `lib/data.ts` reads them from disk once per instance (about 300 ms
  for the 16.7 MB snapshot). Prerendered pages are built from the same files. A data change is live when its
  deploy is; nothing else has to succeed.
- **The app loads the whole college dataset into memory** (~1,900 colleges) and queries it there
  ([data-layer.md](data-layer.md)). Ranks, medians, facets, and similar colleges need every college, so row-by-row
  SQL would be slower and harder to keep identical. Per-college history, detail, and trend files are read from disk
  per request.
- **High schools are the one dataset that belongs in a table** (35,000 rows searched by trigram): they are
  published to Supabase and read row by row, with the files as the fallback ([Where the app reads](#where-the-app-reads)).
- **What changed between two deploys** is computed from git, not from the database, and written to
  `dataset_changes` after each production deploy, so the digest ([follow-colleges.md](product/follow-colleges.md))
  and the profile's What changed panel keep working.
- **Data created by users** (accounts, households, lists, the planner) lives only in Supabase, with no JSON counterpart.

The serving design this replaced (the dataset in Supabase tables, a per-request version check, a publish Action
racing the Vercel build) is summarized in [History](#history) for the record.

## Where the app reads

| Data | Read from | Switch |
|---|---|---|
| Colleges, meta, release calendar, aliases | `data/*.json` on disk, once per server instance (`lib/data.ts`) | none |
| Per-college history and detail, trend files, history's shared files | `data/history/**`, `data/detail/**` on disk, per request | none |
| High schools | the `high_schools*` tables (`lib/supabase-high-schools.ts`) or `data/high-schools/**` (`lib/high-school-store.ts`) | `HIGH_SCHOOLS_SOURCE=supabase\|json`; default `supabase` when `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are set, else `json` |
| What changed (profile panel, digest) | `dataset_changes` when `SUPABASE_URL` is set; otherwise nothing | none |
| Accounts, households, lists, planner | their tables, through row-level security | none |
| Search index (`/search-index.json`) | built from the files at deploy time; matched in the browser | none |

`DATA_SOURCE`, the old switch, is ignored; `lib/data.ts` logs one warning if it is still set. The build never
contacts Supabase: CI builds with no keys, and a Preview without keys reads the high-school files, which are traced
into the deploy for that reason.

## Schema (`supabase/migrations/`)

| Table | Contents | Access |
|---|---|---|
| `dataset_publishes` | One row per recorded publish: time, college count, `retrieved`, git commit, who | Secret key only |
| `dataset_changes` | One row per college × field × publish (lib/changes.ts); the What changed panel and the digest read it | Public read |
| `dataset_change_staging` | Staged changes between `stage_dataset_changes()` and `publish_changes()` | Secret key only |
| `high_schools`, `high_school_details`, `high_school_files`, `search_high_schools()` | The high-school dataset and its trigram search ([high-school-data.md](product/high-school-data.md)) | Public read |
| Accounts, households, invitations, student profiles, lists, follows, notification prefs, digests, and the rest | [accounts.md](product/accounts.md), [household-hub.md](product/household-hub.md), [saved-lists.md](product/saved-lists.md), [follow-colleges.md](product/follow-colleges.md) | Per policy |

**Retired on 2026-10-07** by `supabase/migrations/20261007130000_retire_dataset_tables.sql`: `schools`,
`school_staging`, `dataset_files`, `school_histories`, `history_staging`, `history_files`, `school_details`,
`detail_staging`, `school_aliases`, and the functions `publish_dataset`, `stage_schools`, `publish_schools_staged`,
`publish_schools_staged_with_changes`, `stage_history`, `publish_history`, `publish_history_staged`, `stage_details`,
`publish_details_staged`, `publish_aliases`. Their migrations stay in the folder (the PGlite tests apply every
migration in order, so the end state is what the tests prove).

- Row-level security is on for every table. Nothing public is writable through the API.
- Migrations follow the Supabase CLI layout (`<timestamp>_<name>.sql`); each is pasted into the SQL Editor, dev
  first, then prod. They must stay backward-compatible with the running app (add, don't rename), because the app and
  the database deploy separately.

## Publishing

### The change log: `npm run publish-changes`
`scripts/publish-changes.mts`. Runs after each successful production deploy
([workflow](#the-workflow-githubworkflowspublish-changesyml)), or by hand.
1. Takes `--head <sha>` (default `HEAD`) and `--base <sha>` (default: the newest `dataset_publishes.git_commit`
   that exists in the repo; none → a first publish with no changes).
2. Reads `data/schools.json`, `data/meta.json`, and `data/release-calendar.json` at both commits with `git show`,
   with no network read of any old dataset, and diffs them (`lib/changes.ts`).
3. Stages the changes (`stage_dataset_changes()`, 2,000 per call) and calls `publish_changes()`, which inserts the
   `dataset_publishes` row and moves the changes in, in one transaction. A re-run for the same commit is a no-op
   (`reused: true`).
4. `--dry-run` prints the summary and writes nothing. Without `SUPABASE_URL` and `SUPABASE_SECRET_KEY` it logs a
   notice and exits 0.

### High schools: `npm run publish-high-schools`
`scripts/publish-high-schools.mts`: validates `data/high-schools/**` against the colleges, then writes the
`high_schools*` tables in batches and reads them back (not atomic, as before). Runs when a merge to `main` changes
`data/high-schools/**`, or by hand. `--dry-run` checks only.

### The workflow: `.github/workflows/publish-changes.yml`
- **`changes`** runs on each successful Vercel production deploy (`deployment_status`, environment `Production…`):
  checks out the deployed commit with full history, runs `publish-changes --head <sha>`. So a change is recorded
  only after the site shows it; a dropped push event means a missing digest line, never a broken site.
- **`high-schools`** runs on a push to `main` that changes `data/high-schools/**`.
- **Run workflow** by hand with `what: changes | high-schools | both`.
- Both skip with a notice while `PROD_SUPABASE_URL` / `PROD_SUPABASE_SECRET_KEY` aren't set. CI's `verify` job
  needs no secrets.

## Revalidation
Static pages (`/`, `/data`, profiles, trends) carry `revalidate = 86400` and are rebuilt by every deploy, which is
also when the data changes. `POST /api/revalidate` with `Authorization: Bearer $REVALIDATE_SECRET` still marks every
page stale (`revalidatePath("/", "layout")`) for use by hand; nothing calls it automatically any more. It returns
401 for a missing or wrong secret, and when `REVALIDATE_SECRET` isn't set at all.

## Keys

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | `.env.local`, Vercel, GitHub secret `PROD_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `.env.local`, Vercel | `sb_publishable_…`. Read-only through RLS. Replaces the legacy `anon` key |
| `SUPABASE_SECRET_KEY` | `.env.local`, GitHub secret `PROD_SUPABASE_SECRET_KEY`; Vercel only once the digest emails are set up (the cron route needs it) | `sb_secret_…`. Bypasses RLS. Used by `publish-changes`, `publish-high-schools`, and `/api/cron/digests`. Never `NEXT_PUBLIC_` |
| `HIGH_SCHOOLS_SOURCE` | `.env.local` (optional), Vercel (optional) | `supabase` or `json`; unset = `supabase` when the two keys above are set, else `json` |
| `REVALIDATE_SECRET` | Vercel (Production), optional | Random string; guards `/api/revalidate`. Unset = endpoint refuses everything |
| `CRON_SECRET` | Vercel | Bearer token for Vercel Cron's daily `/api/cron/digests` ([follow-colleges.md](product/follow-colleges.md#setup-owner)) |
| `INVITE_FUNCTION_SECRET` | `.env.local`, Vercel (every environment that invites), **and** a function secret on the matching Supabase project | Random string (`openssl rand -hex 32`); the only thing that lets the site call the `invite-user` [Edge Function](#edge-functions). Unset in the site = invitations use the plain `/invite/<token>` link; unset on the function = it refuses everything |
| `INVITE_ALLOWED_ORIGINS` | Function secret only (not Vercel) | Comma-separated site origins an invite link may land on. Unset = any `https://*.vercel.app` and `http://localhost:*` (dev); **set it on prod** |

None use the `NEXT_PUBLIC_` prefix: `lib/data.ts` and the high-school readers are server-only, so the browser never
talks to Supabase directly except through Supabase Auth's own flows.

## Edge Functions

`supabase/functions/` holds code that runs **inside Supabase** (Deno), not on Vercel. There is one function,
`invite-user`. It is the **only code outside the database with admin power** over the project: it holds the secret
key that bypasses row-level security. Keep it that way: no other function, route, or script on Vercel gets admin
power, and this one stays small (it touches auth users and one column of `invitations`, nothing else). It is touched
rarely, so everything needed to change, deploy, test, or roll it back is written down here and in the header of
`supabase/functions/invite-user/index.ts`.

### invite-user: what it does and why
When someone is invited to a household by email ([household-hub.md](product/household-hub.md#adding-a-person)), the
site asks this function to create their account, with the email already confirmed and their name, role, and phone in
the user metadata, and to mint a one-time link that signs them in. They open the link, land on `/auth/confirm`
(implicit flow, [accounts.md](product/accounts.md#sign-in)), choose a password on `/account/password?welcome=<id>`, and
that accepts the invitation (`accept_invitation_by_id()`). No sign-up form, no confirmation email.

Creating a confirmed user and minting a sign-in link are Supabase Auth **admin** calls that need the secret key. The
owner decided (2026-10-06, [household-hub.md](product/household-hub.md#owner-decisions) decision 1) that the key
stays inside Supabase, where Edge Functions get it automatically, rather than going to Vercel ([Keys](#keys)). The site
holds only `INVITE_FUNCTION_SECRET`, which can do exactly one thing: ask for a link for an invitation whose token it
already has.

| Piece | File |
|---|---|
| The function (wiring: env, Supabase client, `Deno.serve`) | `supabase/functions/invite-user/index.ts` |
| Its logic, with no Deno or Supabase imports, so Node tests can run it | `supabase/functions/invite-user/handler.ts` |
| The site's only caller | `lib/invite-function.ts` (`inviteFunctionConfigured()`, `inviteUser({ token, redirectTo })`) |
| Gateway settings | `supabase/config.toml` (`[functions.invite-user] verify_jwt = false`) |
| Tests | `tests/invite-function.test.mts` (every branch with fake dependencies; the client; guards) |

`tsconfig.json` and `eslint.config.mjs` skip `supabase/functions/` (Deno code: `npm:` imports, `Deno` globals).
`handler.ts` is still type-checked through the test that imports it.

### Contract
```
POST {SUPABASE_URL}/functions/v1/invite-user
Authorization: Bearer {SUPABASE_PUBLISHABLE_KEY}       -- and apikey: the same; the API gateway routes on it
X-Invite-Secret: {INVITE_FUNCTION_SECRET}
{ "token": "<64 hex>", "redirectTo": "https://<site>/auth/confirm?next=…" }

200 { "link": "https://<ref>.supabase.co/auth/v1/verify?token=…&type=magiclink&redirect_to=…" }
400 { "error": "bad_request" }             -- not JSON, token not 64 lowercase hex, or redirectTo's origin not allowed
401 { "error": "unauthorized" }            -- X-Invite-Secret missing or wrong, or the function has no secret set
404 { "error": "invitation_not_found" }    -- no pending (not accepted, not revoked), unexpired invitation
405 { "error": "method_not_allowed" }      -- not POST
409 { "error": "already_registered" }      -- the address already has an account: use the signed-in accept flow
500 { "error": "internal_error" }          -- Auth or database failure (details in the function's logs)
```
Steps: compare `X-Invite-Secret` in constant time → validate the body → SHA-256 the token (hex, exactly like
`create_invitation()`'s `encode(sha256(convert_to(token, 'UTF8')), 'hex')`) and read that invitation with the service
role → `auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name, role_hint, phone,
invitation_id } })` → `update invitations set accepted_by = <user>` (only while pending; if that fails the new user is
deleted again) → `auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } })` → the link.

- **Copy link / retries.** If `createUser` says the address is taken **and** `invitations.accepted_by` is that same
  account (this function created it for this invitation), the function carries on and mints a fresh link. Any other
  existing account → 409. Minting a new link makes the previous one stop working (Supabase keeps one per user).
- **Why `magiclink`, not `invite`.** Supabase Auth refuses `generateLink({ type: "invite" })` for a user whose email is
  already confirmed (`email_exists`, in supabase/auth `internal/api/mail.go`). The user is created confirmed, so the
  function mints a magic link, which signs a confirmed user in the same way.
- **Link lifetime.** The link expires with the project's **Email OTP expiration** (Authentication → Providers →
  Email; one hour by default, 24 hours at most), not with the invitation's seven days. "Copy link" and "Send again"
  mint a fresh one; `/auth/confirm` explains an expired link.
- **Mapping in the site** (`lib/invite-function.ts`): 200 → `{ ok: true, link }`; 409 → `already_registered`; 404 with
  `invitation_not_found` → `not_found`; unset variables → `not_configured`; anything else, a network error, or no
  answer in 10 s → `error`. Nothing throws; the Server Action falls back to the plain `/invite/<token>` link.
- **Logging.** Neither side logs the token, the link, the secret, or an email address; only invitation and user ids.
- **Gateway JWT check is off** (`verify_jwt = false`). The gateway's check accepts only JWTs and the site's
  `sb_publishable_` key isn't one; Supabase's docs say to authorize API-key callers in code
  ([API keys, known limitations](https://supabase.com/docs/guides/api/api-keys)). The `X-Invite-Secret` check is that
  authorization. Never deploy this function without `INVITE_FUNCTION_SECRET` set: it then refuses every request, which
  is safe, but invitations fall back to sign-up.

### Secrets
| Name | Set by | Value |
|---|---|---|
| `SUPABASE_URL` | Supabase (injected) | The project URL |
| `SUPABASE_SECRET_KEYS` | Supabase (injected) | JSON dictionary of the project's secret keys; the function uses `default` (else the first). Falls back to the legacy `SUPABASE_SERVICE_ROLE_KEY`, also injected |
| `INVITE_FUNCTION_SECRET` | Us, twice: `npx supabase secrets set --project-ref <ref> INVITE_FUNCTION_SECRET=<value>` **and** Vercel → Settings → Environment Variables (Sensitive), plus `.env.local` for local dev against dev | `openssl rand -hex 32`. Use a different value for dev and prod |
| `INVITE_ALLOWED_ORIGINS` | Us: `npx supabase secrets set --project-ref <ref> INVITE_ALLOWED_ORIGINS=https://college-stats-nine.vercel.app,https://<preview-or-other-origin>` | Comma-separated origins (no paths). Unset = `https://*.vercel.app` and `http://localhost:*`, acceptable on dev only. Supabase Auth's own Redirect URLs list must also allow the same hosts ([accounts.md](product/accounts.md#sign-in)) |

`npx supabase secrets list --project-ref <ref>` shows the names (not the values). Changing a secret takes effect
without redeploying.

### Deploy
From the repo root (the CLI runs through `npx`; nothing to install). Dev first, check it, then prod.
```sh
npx supabase login                                         # once per machine; opens the browser
npx supabase link --project-ref <ref>                      # dev: gwusgmmionqxabifntgv (writes supabase/.temp/, git-ignored)
npx supabase secrets set --project-ref <ref> INVITE_FUNCTION_SECRET=<value>
npx supabase secrets set --project-ref <ref> INVITE_ALLOWED_ORIGINS=<origins>     # prod (optional on dev)
npx supabase functions deploy invite-user --project-ref <ref> --no-verify-jwt
```
Then set the same `INVITE_FUNCTION_SECRET` in Vercel and redeploy the site (variables don't reach a running
deployment). The function needs the household-hub migration (`invitations.display_name`, `phone`) applied first.
If the CLI stops because Docker isn't running, add `--use-api` to the deploy command (it then bundles on Supabase's
side).

### Test against dev
1. `npm test` runs `tests/invite-function.test.mts` (no network).
2. Make a pending invitation on dev (Add someone on `/household` with `INVITE_FUNCTION_SECRET` unset locally, and copy
   the token from the `/invite/<token>` link), then:
```sh
curl -i -X POST "$SUPABASE_URL/functions/v1/invite-user" \
  -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "X-Invite-Secret: $INVITE_FUNCTION_SECRET" -H "Content-Type: application/json" \
  -d '{"token":"<64 hex>","redirectTo":"http://localhost:3000/auth/confirm?next=/account"}'
```
   Expect `200 {"link": …}`; the same call again also returns 200 (a fresh link); without `X-Invite-Secret`, 401; with a
   made-up token, 404. Open the link in a private window: it should land signed in. Then delete the test user in the
   dashboard (Authentication → Users).
3. Logs: dashboard → Edge Functions → invite-user → Logs.

### Roll back
Redeploy the previous version from git:
```sh
git log --oneline -- supabase/functions/invite-user        # pick the commit before the bad one
git checkout <sha> -- supabase/functions/invite-user
npx supabase functions deploy invite-user --project-ref <ref> --no-verify-jwt
git checkout HEAD -- supabase/functions/invite-user        # put the working tree back
```
To switch the feature off without a deploy, remove `INVITE_FUNCTION_SECRET` from Vercel and redeploy the site:
invitations fall back to the `/invite/<token>` link. To remove the function entirely:
`npx supabase functions delete invite-user --project-ref <ref>`.

## Environments: two projects

| Project | Used by | Data changes when |
|---|---|---|
| **dev** (`quad-dev`) | Local dev servers (every worktree); for now also Vercel Production ([current state](#current-state-pre-release-dev-only)) | A production deploy records its changes; a merge that changes `data/high-schools/**` republishes high schools; people use the site |
| **prod** (`quad-prod`, not created yet) | Vercel Production, at the formal release | Same, pointed at prod |

- **Two projects, not two schemas in one.** Supabase keys, RLS, backups and pausing are per project. Separate
  projects mean a local experiment, a new migration, or a leaked dev key can't touch production.
- **Free plan** (owner decision 2026-10-07: stay on it for now): two free projects per organization; a Nano instance
  (0.5 GB); free projects **pause after about a week** of low database activity. Since the dataset no longer comes
  from Supabase, a pause leaves every public page and search working; only sign-in, lists, and the planner wait for
  the project to wake (about a minute). The upgrade triggers are in
  [serving-architecture.md](serving-architecture.md#2-supabase-holds-peoples-data-and-the-searchable-tables).
- **Not needed:** Supabase Branching or a local Supabase in Docker.
- New migrations: apply to dev first, then prod, then merge the code that needs them.

## Production

### Current state: pre-release, dev only
The site is still being built, so there is only the **dev** project (`gwusgmmionqxabifntgv`). Vercel's Production
environment, at **https://college-stats-nine.vercel.app** since 2026-09-28, is a pre-release dev site. The prod
project and the dev/prod split come with the formal release ([backlog.md](backlog.md#platform)).
- Vercel Production has `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` for the dev project (accounts and high
  schools); Preview may have them or not (without them, high schools come from the files). A `DATA_SOURCE` variable
  left over from before 2026-10-07 is ignored and can be deleted.
- A merge to `main` deploys; the build reads only the files in the repo.
- Once the `PROD_SUPABASE_*` GitHub secrets exist, each production deploy is followed by a `publish-changes` run that
  records what changed for the digest.

Found while setting it up (2026-09-28):
- The Vercel–Supabase integration adds its own variables (`SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_*`,
  `POSTGRES_*`, …). The app reads none of them; `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are added by hand.
- **Settings → Git → Production Branch** must be `main`. Per-deployment URLs and `*-<team>.vercel.app` aliases sit
  behind Vercel Deployment Protection (302 to a login); the production domain is public.
- Vercel runs Node 24.x (`engines` in `package.json`), matching CI.

### Setup at the formal release
1. Create the prod project (same region as the Vercel project), apply every migration under `supabase/migrations/`
   in order in the SQL Editor, deploy the `invite-user` Edge Function with its secrets ([Deploy](#deploy)).
2. Put the prod project's values in `.env.prod.local` (git-ignored) and run `npm run publish-high-schools` against
   it (`--env-file=.env.prod.local`), then `npm run publish-changes` once to record the first publish.
3. Vercel environment variables (Project → Settings → Environment Variables; mark keys **Sensitive**):

| Name | Production | Preview | Development |
|---|---|---|---|
| `SUPABASE_URL` | prod project URL | dev project URL (optional) | – |
| `SUPABASE_PUBLISHABLE_KEY` | prod publishable key | dev key (optional) | – |
| `REVALIDATE_SECRET` | optional | – | – |
| `CRON_SECRET`, `INVITE_FUNCTION_SECRET`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` | per [follow-colleges.md](product/follow-colleges.md#setup-owner) and [Edge Functions](#edge-functions) | – | – |

   Changing variables doesn't touch the running deployment: **Deployments → latest production → Redeploy**.
4. GitHub repository secrets `PROD_SUPABASE_URL` and `PROD_SUPABASE_SECRET_KEY` pointing at prod.
5. Point Vercel Production at prod and redeploy; check sign-in, a list, a high-school page, and that the next
   deploy's `publish-changes` run goes green.

## History
How the dataset was served from 2026-09-28 to 2026-10-07, kept for the record (the full text is in git before the
serving-architecture merge):
- `DATA_SOURCE=supabase` made `lib/data.ts` page the `schools` table (1,000 rows a request), `dataset_files`, and
  `school_aliases` into memory per server instance, and check `dataset_files.published_at` before every render so no
  instance served an older publish. History, details, and trend files were rows read per request.
- `npm run publish-data` staged colleges 150 at a time and swapped them in one transaction
  (`stage_schools()` / `publish_schools_staged()`, after a single call exceeded the statement timeout at 11 MB);
  history, details, and high schools were upserted into the live tables in batches, not atomically, after their
  swaps timed out too; aliases went in one call; everything was read back and compared; then `/api/revalidate` was
  called.
- `.github/workflows/publish-data.yml` ran the publish on every `data/**` merge, alongside the Vercel build the
  same merge started. The build's reads timed out while the swap held the table (#80, 2026-10-05); fixes were a
  retrying reader, one publish retry after 60 s, and a second job that revalidated after every deploy. Measured on
  2026-10-07: a cold instance made about nine sequential requests for 16.7 MB; every dynamic request paid a version
  query; the search box called a function per keystroke. [serving-architecture.md](serving-architecture.md) has the
  measurements and the decision.
