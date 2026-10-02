# Data API: The Dataset, History, and Lineage for Developers

> Status: **planned** (not built). Independent of accounts (API keys are their own thing), though key management
> moves into `/account` once accounts exist. Part of [product](README.md).

## Goal
Offer the site's cleaned, cross-checked dataset (1,893 colleges, the derived metrics, 20+ years of history, and
per-field lineage) over a keyed HTTP API with bulk downloads, for researchers, journalists, and edtech teams. The
strategy document prices it at $1,200+ a year. The raw federal data is public and the repo is public, so what's
sold is convenience and trust: one schema, derived values that are documented and tested, lineage on every field,
a changelog, uptime, and support.

## What exists today
`/api/schools` (search and lookup for the site's own client components) and the JSON files in git. The API below
is versioned and separate, so the internal route can change freely.

## Endpoints (`/api/v1`)
| Endpoint | Returns | Notes |
|---|---|---|
| `GET /schools` | Paged list with the same filters as Explore (`lib/params.ts`), plus `fields=` to pick keys | Page size 100, cursor paging |
| `GET /schools/{unit_id}` | One `School` record | The same object the site renders |
| `GET /schools/{unit_id}/history` | The history shard | |
| `GET /schools/{unit_id}/lineage` | Source, year, method, and quote (where present) per field | From `lib/lineage.ts`; the API's distinctive feature |
| `GET /fields` | The field registry (`lib/fields.ts`): path, label, source, vintage, formula | Documentation generated from code |
| `GET /meta` | Sources, vintages, release calendar, publish id | |
| `GET /national` | National distributions and medians used for percentiles | |
| `GET /bulk/{dataset}.{json\|csv}` | Signed download links for the whole snapshot, history, and (later) details | Built at publish time; CSV flattened with documented column names |
| `GET /changelog` | Publishes with what changed (counts, sources, release notes) | |

Responses carry `X-Dataset-Publish` (the publish id) and `ETag`s. Every number is the same one the site shows,
from `getData()`; the API never computes separately.

## Keys, limits, tiers
```
api_keys (id, owner_user_id | owner_org_id, name, key_hash, tier, created, last_used, revoked_at)
api_usage (key_id, day, requests)
```
- Keys are shown once and stored hashed. `Authorization: Bearer`.
- **Free** (with a key): 1,000 requests a day, no bulk, attribution required. **Paid** ($1,200/year, or $120/month):
  100,000 a day, bulk downloads, history and lineage endpoints, email support, a changelog webhook.
- Rate limiting in a small Postgres function (per key per minute) to start; Upstash or Vercel KV if the counting
  load matters.
- Usage is counted server-side (`api_request` in [telemetry.md](telemetry.md#event-registry) plus the usage table
  for billing).

## Terms
- Federal data is public domain; derived values and the schema are Quad's and are licensed for use with attribution
  ("Data: Quad, from College Scorecard and IPEDS, {publish date}").
- Common Data Set values are the colleges' own publications; the API passes them with their lineage and the user
  takes on the same citation duty.
- No reselling the bulk files as a dataset; no use for lead generation targeting students.

## Docs
`/developers`: generated from `/fields` and the endpoint table, with examples, the lineage model explained (the
same text as the Data page), and the changelog. An OpenAPI document at `/api/v1/openapi.json`.

## Files (planned)
- `app/api/v1/**/route.ts`, `lib/api/` (auth, limits, serializers, CSV), `scripts/build-bulk.mts` (run by
  `publish-data`), migration `…_api_keys.sql`, `app/developers/`, `tests/api-v1.test.mts` (auth, limits, parity:
  the API's school record equals the dataset's object; CSV column set is stable).

## Open questions
1. Should the bulk files live in Supabase Storage or on Vercel Blob? Whichever `publish-data` can write with the
   secret it already has; Supabase Storage keeps one vendor.
2. Is there demand before accounts exist? Keys could be issued by hand (a row in the table) for the first few
   users and a form on `/developers`, which is enough to learn.
