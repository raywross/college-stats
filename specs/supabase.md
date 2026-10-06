# Supabase

How the dataset moves from JSON files to a Supabase (PostgreSQL) database, and how development and production
stay separate. For whether this shape fits the whole roadmap, and the rules for user-data tables, see
[database-architecture.md](database-architecture.md).

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
| `history_files` | `meta`, `national`, `facts`, `cpi` from data/history/, plus `trends/{name}` rows from data/history/trends/ (migration `20261004130000_trend_files.sql`; specs/national-trends.md) | Public read |
| `school_details` | `unit_id` (PK), `data` (one `SchoolDetail`, verbatim: data/detail/schools/{id}.json; lib/detail.ts) | Public read |
| `detail_staging` | Detail files mid-publish | Secret key only |

- **Detail files** (migration `20261002120000_school_details.sql`, added 2026-10-02 with
  [residence.md](data-expansion/residence.md)): published like history, written straight into `school_details` 200 at a
  time (scripts/lib/publish-batches.mts), then read back. `stage_details()`/`publish_details_staged()` exist but aren't
  used.
  `publish-data` stops if the tables are missing, so **apply the migration to dev (and prod) before the next publish**.
  The app's `getDetail()` is fail-soft: without the table, profiles render without home states.
- **The dataset in batches** (migration `20261002140000_school_staging.sql`, added 2026-10-02): wave 2 took
  `data/schools.json` past 11 MB, and one `publish_dataset()` call (the whole file as one argument) hit the statement
  timeout. `stage_schools(p_schools, p_offset, p_reset)` now takes 150 colleges per call, keeping each one's position,
  and `publish_schools_staged(p_meta, p_release_calendar, p_expected, …)` swaps them in with meta and the release
  calendar in one transaction. `publish_dataset()` remains for older checkouts. `publish-data` checks the staging table
  first and stops with the migration's name if it's missing.

- Documents are **`json`, not `jsonb`**: jsonb reorders object keys (e.g. race/ethnicity shares come back as
  asian, black, other, white, …), and the UI iterates some objects in key order.
- Row-level security is on for every table. Anyone may `select` the dataset tables. There are no write policies.
- **`publish_dataset(p_schools, p_meta, p_release_calendar, p_git_commit, p_published_by)`** replaces everything in
  one transaction, so readers never see half a publish and colleges dropped from the sync disappear. Only
  `service_role` (the secret key) may call it.
- **History is published in batches, not atomically** (2026-10-02): once scores, students, and outcomes were added
  (~13 MB), one call exceeded the API's statement timeout, so shards were staged in batches and swapped in with one
  transaction (`stage_history()`/`publish_history_staged()`, migration `20260928180000_history_staging.sql`). After wave
  2 (20 MB) the swap itself timed out, so `publish-data` now upserts 150 shards per call straight into
  `school_histories`, deletes colleges no longer in the data, then writes `history_files`
  (scripts/lib/publish-batches.mts). **Trade-off, accepted 2026-10-02:** while a publish runs, readers can see a mix of
  old and new shards. Each shard is a complete file either way, and everything is read back and compared at the end.
  Detail files work the same way. The staging functions and the single-call `publish_history()` below still exist but
  aren't used.
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
   Then what changed: the published colleges are read back and diffed against the files (`lib/changes.ts`); the
   changes are staged and written into `dataset_changes` in the same transaction as step 3
   (`publish_schools_staged_with_changes()`), or skipped with a warning when the follows migration isn't applied
   ([follow-colleges.md](product/follow-colleges.md#publishing-scriptspublish-datamts-scriptslibpublish-changesmts)).
   `--changes-only` prints the list and writes nothing; add `--prev <dir>` to diff a local copy with no network.
3. `stage_schools()` in batches of 150, then `publish_schools_staged()` in one transaction, recording the git commit
   (`+uncommitted` if `data/` has local changes).
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

**Reads during a publish** (2026-10-05): while a publish swaps the schools table, reads can hit Postgres's statement
timeout. The production build for #80 failed this way, reading colleges mid-publish. `fetchDatasetFiles` now waits
and retries on a statement timeout (`TIMEOUT_WAITS_MS`, about a minute in all) and fails at once on any other error;
`tests/supabase.test.mts` covers both.

## Keys

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | `.env.local`, `.env.prod.local`, Vercel, GitHub secret `PROD_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `.env.local`, `.env.prod.local`, Vercel | `sb_publishable_…`. Read-only through RLS. Replaces the legacy `anon` key |
| `SUPABASE_SECRET_KEY` | `.env.local`, `.env.prod.local`, GitHub secret `PROD_SUPABASE_SECRET_KEY` | `sb_secret_…`. Bypasses RLS. Only the publish script uses it. Never in Vercel, never `NEXT_PUBLIC_` |
| `DATA_SOURCE` | `.env.local`, Vercel | `json` or `supabase` |
| `REVALIDATE_SECRET` | Vercel (Production), `.env.prod.local`, GitHub secret `PROD_REVALIDATE_SECRET` | Random string; guards `/api/revalidate`. Unset = endpoint refuses everything |
| `REVALIDATE_URL` | `.env.prod.local`, GitHub secret `PROD_REVALIDATE_URL` | `https://<production-domain>/api/revalidate` |
| `INVITE_FUNCTION_SECRET` | `.env.local`, Vercel (every environment that invites), **and** a function secret on the matching Supabase project | Random string (`openssl rand -hex 32`); the only thing that lets the site call the `invite-user` [Edge Function](#edge-functions). Unset in the site = invitations use the plain `/invite/<token>` link; unset on the function = it refuses everything |
| `INVITE_ALLOWED_ORIGINS` | Function secret only (not Vercel) | Comma-separated site origins an invite link may land on. Unset = any `https://*.vercel.app` and `http://localhost:*` (dev); **set it on prod** |

None use the `NEXT_PUBLIC_` prefix: `lib/data.ts` is server-only, so the browser never talks to Supabase.

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
  `PROD_SUPABASE_SECRET_KEY` isn't set, it logs a notice and skips, and the run stays green. A failed publish is
  re-run once after 60 s, since the merge's production build can make its statements time out; repeating is safe
  (the first staging batch resets the staging table).
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
