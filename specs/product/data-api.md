# Data API and MCP Server: The Dataset, History, and Lineage for Account Holders

> Status: **built** 2026-10-20 on `feature/data-api` ([foundation](#built-foundation-2026-10-20),
> [routes and pages](#built-routes-and-pages-2026-10-20), [MCP](#built-mcp-2026-10-20)); rewritten the same day from the
> 2026-10-02 draft. For people with a Quad
> account (owner decision 2026-10-20): every request carries a key made on `/account`, with one exception added
> 2026-10-21 when this work merged with [assistants.md](assistants.md): the same MCP server also answers without a key
> at `/mcp`, limited per address, because the assistants' connector menus can't send a header. Nothing else is open
> to anonymous callers. Builds on [accounts.md](accounts.md) (built), the deploy-carried dataset
> ([serving-architecture.md](../serving-architecture.md), built), and [telemetry.md](telemetry.md) (built). Paid
> tiers wait for [commercialization.md](commercialization.md). Part of [product](README.md).

## Goal
Offer the site's cleaned, cross-checked dataset (about 1,900 colleges, the derived metrics, 20+ years of history, and
per-field lineage) two ways, to people who have signed up:

1. **A keyed HTTP API** (`/api/v1`) for researchers, journalists, counselors with a spreadsheet, and anyone writing
   code against the data.
2. **An MCP server** (`/api/mcp`, the Model Context Protocol) so an assistant such as Claude, Cursor, or ChatGPT can
   look up a college, compare several, read a field's lineage, or pull a history series on a person's behalf, with
   the same key; and the same server at `/mcp` without a key, for the connector menus of Claude, ChatGPT, and Gemini
   ([assistants.md](assistants.md): the `/connect` page and the skill file).

The raw federal data is public and the repo is public, so what the API adds is convenience and trust: one schema,
derived values that are documented and tested, lineage on every value, and the same numbers the site shows. Both
surfaces are thin: every answer comes from `getData()` and the `lib/` code the pages use, serialized once by
`lib/api/`, so the REST API, the MCP tools, and the site can never disagree.

## What changed since the first draft (2026-10-02 → 2026-10-20)
The draft assumed nothing but the JSON files and an internal `/api/schools` route. Since then:
- **Accounts are built** ([accounts.md](accounts.md)): sign-in, `/account`, row-level security, a PGlite harness for
  policy tests, and the admin console ([admin.md](admin.md)) with its own `is_admin()` rules. Key management lives on
  `/account/api-keys` from day one; "keys issued by hand" is no longer needed.
- **Account holders only.** The draft's keyless free tier is gone (owner decision 2026-10-20). A person signs up (13+,
  birth year), then makes a key. One tier for now, "account", with limits below; the `tier` column is there for the
  paid tier [commercialization.md](commercialization.md) adds later.
- **The deploy carries the dataset** ([serving-architecture.md](../serving-architecture.md)): `data/*.json` is read
  from disk once per instance, Supabase holds only people's data and the change log. So the API needs no dataset
  tables, there is no "publish id" from Supabase (the dataset's `retrieved` date and the deploy stand in), and bulk
  files would be a new storage decision. **Bulk downloads are deferred** (the files are in the public repository;
  a signed download can come with the paid tier).
- `/api/schools` is gone (search runs in the browser over `/search-index.json`), so the API is the only JSON surface
  for the dataset. The planned app API ([iphone-app/api.md](../iphone-app/api.md)) serves rendered screens to our own
  client and stays separate; both read the same `lib/` code.
- **Hidden fields and the method.** The registry now marks fields computed for Quad's method and never shown
  (`hidden: true`, `HIDDEN_FIELDS`: `selectivity.band`, `derived.selectivity_score*`), and the estimate's method is
  proprietary ([chances/README.md](../chances/README.md)). The API never serializes a hidden field, `selectivity.band`,
  or anything from `lib/selectivity.ts`, `lib/chances/`, or `lib/admin/`; `tests/admin-hidden.test.mts` already walks
  what API routes import, and the API's own tests check the output.
- **Telemetry is built**: `api_request` is a server event through `trackServer()` (`lib/analytics-server.ts`), and the
  usage table below is what limits and, later, billing read.
- **MCP is new.** The 2026-07-28 MCP spec is stateless over HTTP; Vercel's `mcp-handler` 2.x (with
  `@modelcontextprotocol/server` 2 and zod 4) mounts a server in one Next.js route handler and verifies bearer
  tokens with `withMcpAuth`, so the same API key authenticates both surfaces.

## Who may call, and how
- **A key belongs to a person** (`api_keys.user_id`, the signed-in account) and is made on `/account/api-keys`: a
  name ("My notebook"), then the key shown **once**; the table stores only its SHA-256 hash and the first characters
  for display. Up to **5 active keys** per account (a trigger enforces it). Revoke at any time; a revoked key fails at
  once. A paused (`profiles.suspended_at`) or deleted account's keys fail too.
- **Key format:** `quad_` + 40 lowercase base-32 characters (200 bits from `crypto.randomBytes`); the prefix lets
  secret scanners and the error message recognize it. Sent as `Authorization: Bearer quad_…` on every request to
  `/api/v1/*` (except `openapi.json`) and `/api/mcp`.
- **Verification without the secret key.** Vercel holds only the publishable key, so the lookup is a `security definer`
  function callable by `anon`: `api_key_use(p_hash text, p_endpoint text)`. It finds the unrevoked key whose hash
  matches, refuses when the owner is paused or deleted, counts the request in `api_usage` for today, and returns
  `{ key_id, user_id, tier, allowed, used_today, limit_per_day }`. Knowing the hash proves knowing the key, so exposing
  the function to `anon` gives nobody anything a guess wouldn't (the same reasoning as `invitation_preview`). One
  round trip per request.
- **Limits** (`API_KEY_LIMITS` in `lib/api/keys.ts`, one typed object the docs page prints): **5,000 requests a day
  per key** (the function's count) and **60 a minute per key** (an in-memory token bucket per server instance,
  `lib/chances/rate-limit.ts`'s `TokenBuckets`, the burst guard). Over either: `429` with `Retry-After`. The MCP
  server counts each tool call as one request against the same limits.
- **Errors:** `{ error: { code, message } }`. `401 missing_key` / `401 invalid_key` (revoked, unknown, or the owner
  paused; the message says to make one on `/account/api-keys`), `404 not_found`, `400 bad_request` (the parameter
  named), `429 rate_limited`, `503 unavailable` when Supabase can't answer the key check (the dataset is fine; the
  gate isn't).
- **Without a key, `/mcp` only** (`lib/api/mcp-route.ts createPublicMcpRoute`): the same ten tools, limited to 60
  requests a minute per calling address (`PUBLIC_MCP_LIMIT`, an in-memory bucket per server instance; `429` with
  `Retry-After` and a message naming `/account/api-keys` and `/api/mcp`), every tool call recorded as `api_request`
  with an empty `key_id`. What a key buys over it: the REST API, a limit that is yours rather than your network's,
  `/me`, and usage you can see on `/account/api-keys`.
- **Admins** see nothing special here; the admin console may list a person's keys later ([admin.md](admin.md)).

## Endpoints (`/api/v1`)
All `GET`, all JSON, all keyed unless marked. Query strings follow the site's (`lib/params.ts`), so an Explore URL's
filters work as API parameters.

| Endpoint | Returns | Notes |
|---|---|---|
| `/schools` | `{ items: PublicSchool[], total, next_cursor }` | Explore's filters (`q`, `state`, `type`, `size`, `minAR`…, every key `parseFilters` reads), `sort` (`lib/dataset.ts` sort keys), `fields=` to pick top-level keys, `limit` ≤ 100 (default 50), `cursor` (opaque) |
| `/schools/{unit_id}` | One `PublicSchool` | The same object the site renders, less hidden fields; `fields=` to pick keys |
| `/schools/{unit_id}/history` | `{ unit_id, history, definitions, sources }`: the shard (`SchoolHistory`), each public series' definition (label, field, unit, `year_kind`, breaks, sources; `lib/api/serialize.ts seriesDefinitions`, shared with the MCP tool `get_history`), and the files behind them (`historySources`) | 404 when the college has no history |
| `/schools/{unit_id}/lineage` | `{ unit_id, fields: Record<FieldPath, Cited> }` | `lineageFor` per registered, non-hidden field the college has a value for; `fields=` to pick; the API's distinctive feature |
| `/schools/{unit_id}/changes` | The college's recent `dataset_changes` rows with `describeChange` text | From Supabase (public read); `[]` when unconfigured |
| `/fields` | The registry: path, label, topic, source, vintage, formula and inputs for derived fields, `notify` flags | Non-hidden fields only. Documentation generated from code |
| `/meta` | `{ retrieved, sources, vintages, release_calendar, counts }` | What the Data page shows |
| `/national` | Per metric (`lib/metrics.ts METRICS`): median, reporting count, distribution bins; plus `history/national.json` | What percentiles and "typical" lines use |
| `/me` | The key's owner (display name, not email), key name, tier, `used_today`, limits | For checking a key works |
| `/openapi.json` | OpenAPI 3.1 for everything above | **No key.** Generated from `lib/api/routes.ts` |

Responses carry `X-Dataset-Retrieved` (the dataset's `meta.retrieved`), an `ETag` (hash of the body; `If-None-Match`
→ `304`), and `Cache-Control: private, no-store` (keyed and counted; the CDN never serves them). Every number is the
same one the site shows, from `getData()`; the API never computes separately, and the `Cited` records are
`lib/lineage.ts`'s, unchanged.

### `PublicSchool`
`lib/api/serialize.ts publicSchool(school)`: the `School` record with every `HIDDEN_FIELDS` path removed (including
`selectivity.band`), `lineage` kept (it is the raw record; `/lineage` is the resolved form), and nothing added.
`fields=` keeps `unit_id` and `name` always. A test asserts, for every college in the dataset, that no hidden path
and no `band` key survives, and that every other leaf equals the dataset's.

## MCP server (`/api/mcp`, and `/mcp` without a key)
`mcp-handler` in `app/api/mcp/route.ts` (GET and POST), wrapped in `withMcpAuth` using the same key check; the same
handler in `app/mcp/route.ts` behind the per-address limit instead of a key. Tools, each a thin call into `lib/api/`:

| Tool | Input | Returns |
|---|---|---|
| `search_colleges` | `query` (name, nickname, or place) and/or Explore filters (`state`, `type`, `size`, admit-rate and score ranges), `limit` ≤ 50 | `SchoolIndexEntry`-like rows: id, name, city, state, type, admit rate |
| `get_college` | `unit_id` or `name` (resolved through the same search; ambiguity returns candidates), optional `fields` | `PublicSchool` |
| `compare_colleges` | `unit_ids` (2–10), optional `metrics` | The metrics table (`lib/metrics.ts` values with each college's rank and the national median) |
| `get_history` | `unit_id`, optional `series` | The history series requested, with definitions |
| `get_lineage` | `unit_id`, optional `fields` | Resolved `Cited` records: source, year, method, formula, quote |
| `list_fields` | optional `topic` | The registry rows |
| `get_dataset_info` | none | `/meta` |
| `search` | `query` | `{ results: [{ id, title, url }] }`, the shape ChatGPT's deep research expects, over the site's own search (`searchSchools`), linking the request's origin |
| `fetch` | `id` | `{ id, title, text, url, metadata }`: the college as a text document, one line per public value with its source and year (`publicSchool` values, `schoolLineage` citations, `fieldRegistry` labels and topics) |
| `glossary` | optional `term` | The glossary's public entries (`lib/glossary.ts`, less "Your account"): key, term, short, long, why, category, related |

Results are JSON in the tool result's `text` (structured output when the client advertises support) and include
`cited` on every value a tool returns outside a whole record, so an assistant can quote the source and year. Prompts
(`how_to_cite`) and a resource (`quad://fields`) are nice-to-have, not required. Tool descriptions carry the terms
below in one sentence.

**Connecting** (shown with the person's real key on `/account/api-keys` right after it's made, and generically on
`/developers`). Claude Code speaks Streamable HTTP and sends the header itself:

```
claude mcp add --transport http quad https://usequad.app/api/mcp --header "Authorization: Bearer quad_…"
```

Claude Desktop and Cursor run [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a local stdio bridge
(`claude_desktop_config.json`, `~/.cursor/mcp.json`). Cursor and Claude Desktop on Windows don't escape spaces inside
`args`, so the header goes in with no space after the colon and the `Bearer …` value comes from `env`, the form
mcp-remote's README gives, which works on every client:

```json
{
  "mcpServers": {
    "quad": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://usequad.app/api/mcp", "--header", "Authorization:${QUAD_AUTH}"],
      "env": { "QUAD_AUTH": "Bearer quad_…" }
    }
  }
}
```

Clients that can't send a header (the connector menus of Claude, ChatGPT, and Gemini, and the Gemini CLI's plain
`httpUrl`) take `/mcp` instead, with no key: `/connect` gives the steps for each ([assistants.md](assistants.md)).

## Keys, usage, and the schema
```
api_keys  (id uuid pk, user_id uuid → auth.users, name text, key_prefix text, key_hash text unique, tier text default 'account',
           created timestamptz, last_used_at timestamptz, revoked_at timestamptz)
api_usage (key_id uuid → api_keys, day date, requests int, primary key (key_id, day))
```
- RLS: a person reads their own keys (never `key_hash`; a view or column grant hides it), inserts their own (the app
  hashes), and revokes their own (update `revoked_at` only). `api_usage` is readable by the key's owner for `/me` and
  the keys page; written only by `api_key_use()`.
- `api_key_use(p_hash, p_endpoint)` (security definer, `search_path = ''`, `anon` and `authenticated` may execute):
  described above. It also sets `last_used_at` (at most once a minute, to keep the write cheap).
- Usage rows older than 90 days are deleted by the function when it writes a new day's row (no cron).
- Telemetry: `api_request` (`side: "server"`, properties `endpoint`, `status`, `transport`: `rest` / `mcp`,
  `key_id`) after each response, through `trackServer()`; never the query or the key.

## Terms
Shown on `/developers` and in the key dialog; the person accepts them when making a key (a line, not a contract page).
- Federal data is public domain; derived values and the schema are Quad's and are licensed for use with attribution
  ("Data: Quad, from College Scorecard and IPEDS, {retrieved date}").
- Common Data Set and college-reported values are the colleges' own publications; the API passes them with their
  lineage and the user takes on the same citation duty.
- No reselling the data as a dataset; no use for lead generation targeting students; no scraping around the limits.
- Keys are personal: don't share one, and revoke one that leaks.

## Pages
- **`/account/api-keys`** (signed in): the keys table (name, prefix, created, last used, today's requests, Revoke),
  "Make a key" (name, the terms line, then the key shown once with Copy and the connection snippets), and the limits.
  A section on `/account` links to it. Phone layout per [mobile.md](../mobile.md).
- **`/developers`** (public, static): what the API is, how to get a key (sign up → account → keys), authentication,
  the endpoint table and the MCP tools generated from `lib/api/routes.ts`, the field registry (from `lib/fields.ts`,
  non-hidden, grouped by topic with source and year labels from lineage), the lineage model in the Data page's words,
  limits, errors, terms, and a link to `/api/v1/openapi.json`. Linked from the footer's Explore list and the Data page.
  It names `/mcp` as the one keyless address and links `/connect`.
- **`/connect`** (public, static; [assistants.md](assistants.md)): the keyless address, the skill file, and the steps
  for Claude, ChatGPT, and Gemini, for people who aren't developers.

## Files
- `supabase/migrations/20261020130000_api_keys.sql`
- `lib/api/keys.ts` (pure: format, generate, hash, prefix, limits), `lib/api/auth.ts` (server: `authenticateApiRequest`,
  the burst limiter, the telemetry call), `lib/api/respond.ts` (JSON, headers, ETag, errors), `lib/api/serialize.ts`
  (pure: `publicSchool`, `schoolLineage`, `fieldRegistry`, `datasetMeta`, `national`, `compareTable`),
  `lib/api/routes.ts` (pure: the endpoint and tool table the OpenAPI document, `/developers`, and tests read),
  `lib/api/openapi.ts` (pure: the document from the table), `lib/api/mcp.ts` (tool definitions over the serializers),
  `lib/api-keys-store.ts` (server: create, list, revoke with the user's session)
- `app/api/v1/**/route.ts`, `app/api/mcp/route.ts`, `app/mcp/route.ts` (the keyless address), `app/account/api-keys/`
  (page, actions, components), `app/developers/page.tsx`; `lib/api/skill.ts`, `lib/api/zip.ts`, `app/connect/`,
  `components/connect/` ([assistants.md](assistants.md))
- Tests: `tests/api-keys-policies.test.mts` (PGlite: owner-only reads, no hash readable, five-key limit, `api_key_use`
  counts and refuses revoked / paused / over limit; a broken policy fails), `tests/api-keys.test.mts` (format,
  hashing, prefix), `tests/api-v1.test.mts` (serializer parity against the dataset, hidden fields absent, `fields=`,
  cursor paging, 401/404/429 with an injected key check, ETag/304, the OpenAPI document lists every route),
  `tests/api-mcp.test.mts` (tool list matches the table; each tool's output equals the REST serializer's; no key →
  401), `tests/assistants.test.mts` (`/mcp` without a key, the per-address 429, `search`/`fetch`/`glossary`, the skill
  zip, `/connect`), `tests/developers-page.test.mts` (the page names every route and tool in the table)
- Dependencies: `mcp-handler@^2`, `@modelcontextprotocol/server@^2`, `zod@^4`

## Build order
1. **Foundation:** migration and policy tests, `lib/api/*` (keys, auth, respond, serialize, routes, openapi), the
   telemetry event, the dependencies, and `/me`, `/meta`, `/fields`, `/openapi.json`.
2. In parallel: **routes** (`/schools*`, `/national`), **MCP** (`/api/mcp` and `lib/api/mcp.ts`), **pages**
   (`/account/api-keys`, `/developers`, the links).
3. Integrate, verify, QA, release note; the owner applies the migration to dev before testing a preview.

## Built: foundation (2026-10-20)
Unit A of the build (branch `feature/data-api-foundation`). What later units build on:

| File | Exports |
|---|---|
| `lib/api/keys.ts` (pure) | `API_KEY_PREFIX`, `API_KEY_LIMITS`, `generateApiKey`, `isApiKey`, `hashApiKey`, `apiKeyPrefix`, `bearerToken`, `normalizeKeyName` (1–60 characters, trimmed), `base32` |
| `lib/api/auth.ts` (server) | `authenticateApiRequest(request, endpoint, deps?)`, `verifyApiKeyToken(token, endpoint, deps?)` (the same check from a bare token, for the MCP server's `verifyToken`), `recordApiRequest`, `lookupKeyInfo(request)` (for `/me`), `MINUTE_BUCKETS`, `AUTH_MESSAGES`; `ApiAuthDeps` takes `lookup`, `now`, and `buckets` |
| `lib/api/respond.ts` | `apiJson`, `apiError`, `authFailure`, `etagFor`, `etagMatches` |
| `lib/api/handler.ts` (server) | `withApiKey<P>(id, handler, deps?)`, `badRequest(param, message)`, `notFound(message)` |
| `lib/api/serialize.ts` (pure) | `publicSchool`, `stripPaths`, `schoolLineage`, `fieldMatches`, `fieldRegistry`, `fieldTopics`, `datasetMeta`, `schoolSummary`, `compareTable`, `nationalSummary`, `COMPARE_DEFAULT_METRICS` |
| `lib/api/routes.ts` (pure) | `API_ROUTES` (me, meta, fields, openapi), `MCP_TOOLS` (empty), `API_BASE`, `MCP_PATH`, `routeFilePath(route)`, `apiRoute(id)` |
| `lib/api/openapi.ts` (pure) | `buildOpenApi(routes, { serverUrl })` |
| `lib/api-keys-store.ts` (server) | `listMyApiKeys`, `createMyApiKey`, `revokeMyApiKey`, `sortApiKeys`, `ApiKeysSetupError`, `API_KEYS_NOT_SET_UP` |

Decisions made while building:
- **`key_hash` is hidden by column privileges**: `authenticated` may select every `api_keys` column but `key_hash`
  (`select *` is refused). The app reads `api_keys_public`, a `security_invoker` view of those columns plus today's
  `used_today`, so the keys page is one read. Inserts may set only `id, user_id, name, key_prefix, key_hash` (never
  `tier`); updates only `revoked_at`, once (a trigger also refuses any other change and un-revoking).
- **`/me` reads names through a second anon-callable function**, `api_key_info(p_hash)` (key name, prefix, dates,
  the owner's display name; never the email; counts nothing), so `api_key_use()` keeps exactly the contract's columns.
- **The burst guard runs before the database**, keyed by the key's hash: a request over 60 a minute is refused
  without a round trip and isn't counted against the day. A malformed key is refused without one too. Only requests
  that pass spend a token, so an unknown key always gets 401.
- **429 for the day** carries `Retry-After` until midnight UTC; **503** carries `Retry-After: 60`; **401** carries
  `WWW-Authenticate: Bearer realm="Quad API"`.
- **`api_key_use()` keeps counting past the limit** (the count is what billing will read) and answers `allowed:
  false`; `p_endpoint` is checked for shape (`^[a-z][a-z0-9_.]{0,79}$`) and not stored yet.
- `/fields` takes `topic=` (an unknown topic is `400 bad_request`); `/openapi.json` uses the request's origin as its
  server and is recorded as `api_request` with endpoint `openapi`.
- `ApiRoute.path` is the full path (`/api/v1/schools/{id}`); the route file is `app` + the path with `{x}` as `[x]` +
  `/route.ts`. `FieldRow` adds `source_label` and `notify`; `CompareRow` and the national metrics add `field`.

## Built: MCP (2026-10-20)
Unit C of the build (branch `feature/data-api-mcp`).

| File | What it holds |
|---|---|
| `lib/api/mcp.ts` (pure) | `MCP_TOOL_DEFS` (the seven tools: title, description, zod 4 `inputSchema`, logic), `MCP_TOOL_NAMES`, `runTool(name, args, ctx)` (validate and run without HTTP), `registerQuadTools(server, { context, record })` (the `createMcpHandler` initializer), `resolveCollegeName`, `groupCitations`, `MCP_INSTRUCTIONS`, `MCP_ATTRIBUTION` |
| `lib/api/mcp-route.ts` (server) | `createMcpRoute(deps?)`: `createMcpHandler` behind `withMcpAuth`; `verifyMcpToken` (wraps `verifyApiKeyToken(token, "mcp")`); `MCP_RESOURCE_METADATA_PATH` |
| `app/api/mcp/route.ts` | `GET`, `POST`, `DELETE` = `createMcpRoute()` |
| `app/.well-known/oauth-protected-resource/api/mcp/route.ts` | The RFC 9728 document the 401 challenge names: `resource` = the MCP endpoint, `authorization_servers: []` |
| `lib/api/routes.ts` | `MCP_TOOLS`: one row per tool (name, summary, inputs) |
| `tests/api-mcp.test.mts` | Tool names = `MCP_TOOLS` = the table above; inputs = the schemas; each tool's JSON = its serializer's; names, candidates, errors; no hidden field in any output; telemetry; the route's 401 / 429 / 503 and a full initialize → tools/list → tools/call |

Decisions made while building:
- **One key check per HTTP request**, endpoint `mcp`, through `verifyApiKeyToken` (the REST path): it counts one
  request against the day and spends one token of the minute. A `tools/call` is one request, so each tool call counts
  once; the protocol's own requests (2025-era `initialize`, `notifications/initialized`, `tools/list`, a `GET` probe)
  count too, a handful per session. There is no second lookup per tool.
- **Errors match REST.** `withMcpAuth` only knows 401, so the route keeps what the key check said: 429 (with
  `Retry-After`) and 503 go out as themselves; a 401 keeps `withMcpAuth`'s challenge (`WWW-Authenticate: Bearer
  error="invalid_token", …, resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`) with the API's error
  body, which says where to make a key. The metadata sits at the path-inserted URL (RFC 9728 §3.1) so its `resource` is
  `/api/mcp` itself; it lists no authorization servers until OAuth comes (open question 1).
- **Telemetry:** each tool call records `api_request` with `transport: "mcp"`, `endpoint: "mcp.<tool>"`, a status
  (200; 400 bad input; 404 unknown college or no history; 500), and the key id from `ctx.http.authInfo.clientId`
  (`verifyToken` returns `{ token, clientId: keyId, scopes: [], extra: { userId } }`). A refused request records
  endpoint `mcp` with no key. Arguments the SDK's own schema check rejects never reach the tool, so those calls aren't
  recorded (the client still gets an `isError` result naming the argument).
- **Outputs** are the serializers' (no arithmetic in the tools): `get_college` = `publicSchool` (or, for an ambiguous
  name, `{ ambiguous, query, message, candidates: SchoolSummary[] }`); `get_lineage` = `{ unit_id, fields:
  schoolLineage }` and `list_fields` = `{ fields: fieldRegistry }` (the REST shapes); `get_dataset_info` =
  `datasetMeta`; `search_colleges` = `{ total, items: schoolSummary[], cited }` over `getSchools(parseFilters(…))`,
  in Explore's order; `compare_colleges` = `{ colleges, metrics: compareTable, cited }`; `get_history` = `{ unit_id,
  series, definitions (label, field, unit, year_kind, breaks, sources), repeated?, sources: historySources }`.
  `cited` folds `schoolLineage` records by field, each distinct record once with its `unit_ids`, so ten colleges cost
  about one college's citations. `structuredContent` goes with the small answers (search, compare, dataset info,
  candidates); records, lineage, registry, and history go as text only.
- **Names** resolve through `searchSchools` (the scorer search uses): an exact name only one college has, else the
  scorer's best exact short name ("MIT", "ASU" → Arizona State), else a lone match; anything else returns up to 10
  candidates.
- Search inputs are Explore's filters with MCP-style names (`query`, `states`, `types`, `sizes`, `min_admit_rate` /
  `max_admit_rate` in percent, `min_sat`…`max_act`, `limit` ≤ 50, default 10); `compare_colleges.metrics` and
  `get_history.series` are enums of the public metric and series keys; `list_fields.topic` an enum of public topics.
  `MCP_TOOLS` rows use `ApiParam` as it is: `in` is always `"query"`, and a list input is typed by its items with
  "A list of …" in its description.

### Merged with the assistants work (2026-10-21)
Two chats built an MCP server the same day: this keyed one, and a keyless one for the assistants' connector menus
(`feature/quad-mcp`, [assistants.md](assistants.md)). They merged into one server:
- **One tool set, two addresses.** `lib/api/mcp-route.ts mcpHandlerFor(request, deps)` builds the handler per request
  (the request's origin goes into the tool context for the links `search` and `fetch` return); `createMcpRoute` wraps
  it in `withMcpAuth` for `/api/mcp`, `createPublicMcpRoute` in the per-address bucket for `/mcp`. The keyless
  server's own JSON-RPC code, its `/api/v1/colleges`, `/compare`, and `/glossary` routes, and its OpenAPI document were
  dropped for this branch's; the keyed REST API is the only REST surface.
- **Three tools added** to the seven: `search` and `fetch` (ChatGPT's deep research only works with those two names and
  shapes) and `glossary`. `fetch` is the one tool that renders text: `publicSchool`'s values, one line each with the
  label from `fieldRegistry` and the source and year from `schoolLineage`, grouped by topic in registry order; it
  computes nothing and skips computed fields. `McpToolContext.origin` is optional; without it the links name the
  production address (`DOCS_ORIGIN`).
- **Telemetry** is unchanged: a keyless tool call is `api_request` with `transport: "mcp"` and an empty `key_id`; a
  refused burst records endpoint `mcp` with status 429.
- The skill file (`lib/api/skill.ts`) now teaches the keyless connector first, the keyed API and `/api/mcp` for people
  with a key, and the pages otherwise, and reads its paths and limits from `lib/api/routes.ts` and `lib/api/keys.ts`.

## Built: routes and pages (2026-10-20)
Units B and D of the build (`feature/data-api-routes`, `feature/data-api-pages`), integrated on `feature/data-api`.

### Routes (`app/api/v1/schools*`, `app/api/v1/national`)
- `lib/api/query.ts` (pure) parses the list query: every key `parseFilters` reads (`states=`, `types=`, `sizes=`, the
  ranges, `near`/`within`, `income`, …, exactly as Explore spells them), `sort` validated against Explore's `SORT_KEYS`
  (now exported from `lib/params.ts`; `sortBy` accepted as an alias), `sortDir`, `limit` (1–100, default 50, above 100
  clamped), `cursor` (base64url of the offset; anything non-canonical is a 400), and `fields`. **Unknown parameters
  are a 400 naming the parameter**, so a misspelled filter can't silently return every college; Explore's `view`,
  `page`, `chart`, and `forMe` are accepted and ignored so a pasted Explore URL works. `near` must be a ZIP the site
  knows. The list applies `resolveNear` and `estimatesShown()` the way the Explore page does, so `sort=distance`,
  `income`, and `minAidIncome` behave the same; a parity test checks several Explore URLs page by page.
- `fields=` is validated: on records against the union of top-level keys across the dataset; on `/lineage` against
  public registered paths or prefixes, so a hidden name is refused without being named.
- `/history` answers `{ unit_id, history, definitions, sources }` (the shard, each public series' definition from
  `lib/api/serialize.ts seriesDefinitions`, and `historySources`), the same shape the MCP tool uses. `/changes` reads
  `getSchoolChanges` (empty without Supabase) and drops changes to hidden fields. `/national` is `nationalSummary`
  over the metrics and `history/national.json`.
- Tests (`tests/api-v1-routes.test.mts`) drive the real route files with a stubbed publishable-key client: Explore
  parity, a cursor walk of the whole dataset with no repeats, 404s, hidden-field absence, `fields=`, and that every
  `parseFilters` key is documented in `API_ROUTES`.

### Pages (`/account/api-keys`, `/developers`)
- `/account/api-keys`: the keys as a table from `sm` and stacked cards on phones (name, prefix, created, last used,
  today's requests against the daily limit, Revoke with an inline two-step confirm). "Make a key" takes a name and the
  terms line; the new key is shown once with Copy and the three connection snippets (curl, Claude Code, `mcp-remote`
  JSON), built by `lib/api-snippets.ts connectionSnippets(origin, key)` with the request's origin, and stays until
  "I've saved it". With five active keys the form becomes a note. Before the migration is applied the page shows the
  store's setup notice. An account scheduled for deletion is sent to `/account`. `/account` gained an "API keys"
  section between "Your data" and "Delete your account".
- `/developers` (static): what the API and MCP server are, getting a key, authentication and limits (from
  `API_KEY_LIMITS`), errors, the endpoint table and parameters from `API_ROUTES`, the MCP tools from `MCP_TOOLS`, the
  connection snippets with a `quad_…` placeholder and `https://usequad.app` as the origin, the field registry from
  `fieldRegistry(meta)` in closed `<details>` per topic (the Data page's topic labels, moved to `lib/topic-labels.ts`;
  a row without a single release year reads "Dated on each value"), the lineage model in the Data page's words, the
  terms (`lib/api-terms.ts`), and the `openapi.json` link. Linked from the footer's Explore list and the Data page's
  Sources section. `tests/developers-page.test.mts` checks both pages read the tables and limits rather than literals
  and carry no hard-coded year.
- Shared pieces live in `components/api/` (`CopyButton`, `CodeBlock`, `ConnectionSnippets`) because both pages use them.

### Not exercised in this environment
The signed-in flow (making a key, calling the API with it, the MCP server with a real key) needs Supabase with the
migration applied; this environment has neither. The policy tests prove the SQL against real Postgres, and the route
and tool tests prove the handlers with an injected key check. The owner tests the whole path on a preview after
applying `20261020130000_api_keys.sql` to dev.

## Open questions
1. **OAuth for MCP clients that can't set a header** (claude.ai's connectors). Answered 2026-10-21 by `/mcp`: those
   clients get the same tools without a key, limited per address. OAuth would still be needed for a signed-in tool set
   (a person's own list and plan) and for a per-person limit in those clients; Supabase Auth could be the authorization
   server then (the 2026 spec's Client ID Metadata Documents), with `mcp-handler`'s `protectedResourceHandler`.
2. **Bulk downloads and the paid tier.** Deferred to [commercialization.md](commercialization.md): the dataset is in
   the public repository today; a signed bulk file and the 100,000-a-day tier come with billing and `entitlements()`.
3. **Daily limit.** 5,000 a day and 60 a minute per key is the recommendation (a notebook that walks every college
   once uses 1,900); raise it per key by hand (a `tier` value) if someone asks.
