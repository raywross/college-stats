# App API: Screen Documents for the iPhone App

> Status: **planned** (2026-10-06; **rewritten** 2026-10-26 after the roadmap review). First of the three iPhone app specs
> ([overview](README.md)); the app ([app.md](app.md)) and its screens ([screens.md](screens.md)) consume it. The first
> draft was written when almost nothing on the site existed as JSON. Since then the **Data API** shipped
> ([../product/data-api.md](../product/data-api.md), 2026-10-20): `lib/api/` serializes a college, its lineage, the
> registry, the metadata, and the national figures once for the REST routes and the MCP tools, with a routes table that
> generates the OpenAPI document and the docs page. This API is a **second route family on that library**, not a new
> one. The planner, Quad's estimate (server-only by rule), visit events, and the record also exist now and are most of
> the signed-in surface below.

## Goal
Give the iPhone app a JSON document for every screen the site has, produced by the same code the pages use, so the app
shows the same numbers, the same words, and the same citations as the site, and gets them without an App Store release
when the site changes.

## What exists today (2026-10-26)
| Route family | Serves | Reusable by the app? |
|---|---|---|
| `GET /api/v1/*` (keyed: `schools`, `schools/{id}`, `/history`, `/lineage`, `/changes`, `national`, `meta`, `fields`, `me`, `openapi.json`) | Records, not screens: `PublicSchool` (the dataset less hidden fields), lineage, history series ([data-api.md](../product/data-api.md)) | **As the base**: `lib/api/serialize.ts`, `respond.ts` (JSON, ETag, errors), `handler.ts` (auth wrapper), `routes.ts` (the table the OpenAPI document and tests read). The app needs screens built *over* these, with every value cited and formatted |
| `POST /api/mcp`, `/mcp` | The same ten tools for assistants | No: a different client |
| `POST /api/estimate` | Quad's estimate for one student at up to 20 colleges, server-side, with `likeYou` ([estimate.md](../chances/estimate.md#architecture)) | **Yes, as is**: the app sends the record and gets levels and notes; it never computes a level |
| `GET /api/plan/next`, `/levels`, `/schools`, `/list-guide` | The plan dot, levels for ids, the signed-out plan's school slice, the list guide's rail | Yes for the dot and the rail; the rest is replaced by screen documents |
| `GET /api/plan/{token}.ics`, `/api/plan/feed/{token}.ics` | Calendar feeds | Yes, unchanged (the app offers "Add to Calendar" with the webcal URL) |
| `POST /api/plan/interest/confirm` | The next-day confirmation link in email | Unchanged (email) |
| `GET /api/me` | `{configured, signedIn, name, email}` from the cookie session | No: cookie-bound; the app's `GET /app/v1/me` replaces it |
| `GET /api/high-schools?q=`, `/api/high-schools/{id}` | Directory hits | Yes, for the picker |
| `POST /api/college-view` | A view beacon | Yes, with the bearer token |
| `/api/cron/*`, `/api/sms/inbound`, `/api/revalidate` | Operations | No |
| `/search-index.json` (static) | Every college for the browser's typeahead | Yes: the app downloads it as its offline index |

Everything else below is new. User-data logic lives in Server Actions (`app/*/actions.ts`) and the planner's stores
(`lib/planner/store-*.ts`, each following the `ready(capability)` pattern: sign in, `allowed()`, then the write with the
caller's own session so row-level security decides). The user endpoints reuse them after the refactor
([below](#refactor-server-actions-into-lib-functions)).

## Principles
1. **Same code, same numbers.** Every endpoint is a thin route over `getData()`, `lib/dataset.ts`, `lib/metrics.ts`,
   `lib/insights.ts`, `lib/lineage.ts`, `lib/trends.ts`, the per-page data helpers, and the planner's loaders
   (`loadPlanFor`, `nowMoves`, the guides' loaders). No endpoint computes anything a page does not.
2. **A citation on every value.** Each number is a `Value` carrying its `Cited` record (from `citeField`), never a bare
   number; the guard test fails the build otherwise, as `tests/citation-guards.test.mts` does for pages.
3. **The method stays on the server.** Levels, tiers, and the estimate's notes arrive as output; the app has no copy of
   `lib/chances/*`, `lib/selectivity.ts`, or any hidden field, and the serializer strips them as `lib/api/serialize.ts`
   does today ([chances/README.md](../chances/README.md#quads-estimate-is-proprietary)).
4. **Screens are blocks.** A screen document is a list of blocks from a fixed catalog (below). The app has one renderer
   per block kind. New content in a known kind appears in the app at once; an unknown kind renders as "Open on the web"
   with the page's URL.
5. **One library, two route families.** `lib/api/routes.ts` gains a `surface: "data" | "app"` column; `/api/app/v1`
   routes use the same `respond.ts`, the same error shape, the same OpenAPI generator (a second document,
   `public/api/app/v1/openapi.json`), and the same test that every route file has a row.
6. **Versioned and cacheable.** Path prefix `/api/app/v1`; within v1 fields are only added. Public endpoints:
   `Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600`, `ETag`, `If-None-Match` → 304, and
   `X-Dataset-Retrieved` (the dataset's `retrieved` date, which the Data API already sends) so the app knows when its
   caches are stale. User endpoints: `private, no-store`.
7. **No secrets in the app.** Public endpoints need no key. User endpoints take the person's Supabase access token as
   `Authorization: Bearer` and run through a Supabase client bound to that token, so row-level security decides, as it
   does for the pages.
8. **Strings are the server's.** Labels, takeaways, the estimate's sentences, move titles, guide text, year labels,
   source lines, and empty states come from the server, so the app has no copy of its own to drift. The app owns only
   chrome strings (tab names, Settings).

## Shapes
Types live in `lib/api/app/types.ts` and are the only source for the Swift models ([generation](#openapi-and-swift-models)).

```ts
interface Value { value: number | null; display: string; format: FormatKind; cited: Cited; delta?: Delta }
interface Delta { value: number; display: string; since: string }
interface Link { label: string; href: string }                                     // a site URL (deep-linkable) or external
interface Screen { kind: "screen"; title: string; url: string; blocks: Block[]; sources: SourceGroup[]; retrieved: string }
interface Action { id: string; label: string; method: "POST" | "PATCH" | "DELETE"; path: string; body?: object; confirm?: string }
```
`Action` is new: a block that can be acted on (a move's Done and Skip, a row's trash, a pill's sheet) names the user
endpoint to call, so the app has no route table of its own for writes.

**Block catalog.** The 2026-10-06 catalog (headings, text, takeaways, stat tiles, ring, range bar, benchmark bar,
funnel, waffle, stacked bar, distribution, trend line, stacked area, dumbbell, slope, dot plot, dot range, scatter, dot
map, tile map, waterfall, columns, grouped bars, radar, histogram, outcome bar, class trend, leaderboard, table, school
card and row, school chips, topic card, chips, links, fold, controls, source note, web) stands; each maps to one
component in `components/charts` or the shared cards as before. Added for what was built since:

| Kind | Fields | Site counterpart |
|---|---|---|
| `level-pill` | level (one of five), label ("Elite: a reach for everyone", "Guaranteed for you", "Recruited"), tier | `StandingChip`, the plan row's pill ([levels.md](../chances/levels.md)) |
| `standing-card` | level-pill, stage lines, `what-went-in` (the student's entries used, the facts with their `Cited`, "not used", one prompt), caveats | `StandingCard`, `WhatWentIn` ([estimate.md](../chances/estimate.md)) |
| `plan-row` | SchoolRef, level-pill, status word, pills (ED opportunity, interest), actions (remove, open sheet) | `PlanRow` ([planner/v3/README.md](../planner/v3/README.md)) |
| `shape-line` | text, gap, action (open the Build your list guide) | `PlanNotice` ([list-shape.md](../planner/next-steps/list-shape.md)) |
| `move-card` | title, why, action (open guide), done and skip actions | Now's three cards ([now.md](../planner/v3/now.md)) |
| `guide` | the guide's blocks plus its footer actions | `/plan/guide/{slug}` |
| `record-step` | fields (typed form definitions with options, the chip lists for majors, activities, courses), values, completeness | The record's steps ([record/steps.md](../planner/record/steps.md)) |
| `season` | label, explainer (folded) | `SeasonExplainer` |
| `calendar-lane` | items by month with round colors and shapes; the visit lane | The Calendar tab ([calendar.md](../planner/redesign/calendar.md)) |
| `offers-table` | rows (College Financing Plan layout), the choice | The Offers tab ([offers.md](../planner/offers.md)) |
| `event-list` | events (kind, date, place, distance, sign-up link), mute action | `VisitCalendar`, `/me/visits` ([visit-events.md](../product/visit-events.md)) |
| `cost-curve` | the curve's points, break point, merit line, promises, the household's point | `CostCurve` ([cost-by-income.md](../product/cost-by-income.md)) |
| `apply-card` | deadlines, requirements, platform, fee | "What it takes to apply" ([common-app.md](../data-expansion/common-app.md)) |

`SchoolRef = {id, name, city, state, type, brand: CrestBrand}` is the shape the search index already carries.

## Endpoints
All under `/api/app/v1`. Query strings reuse the site's (`lib/params.ts`), so a site URL maps to an API call by prefix
alone, which is how deep links resolve ([app.md](app.md#navigation-and-deep-links)). The full route-by-route list is
the API column of [screens.md](screens.md); the shape of each family:

### Public
| Family | Returns | Built from |
|---|---|---|
| `GET /home` | The home page's sections as a `Screen` | `app/page.tsx` |
| `GET /explore?…`, `GET /explore/filters?…` | Results in the four views with the filter panel's counts; `forMe=` (the For you levels) needs the token | `app/explore/page.tsx`, `FilterPanel`, `lib/explore-fit.ts` |
| `GET /search?q=` | `SchoolIndexEntry[]` (the same matching as the browser's) | the search index |
| `GET /schools/{id}`, `/{topic}`, `/history?…`, `/changes` | The overview and the six topic screens; the estimate's card is a `standing-card` fetched with the token | the profile pages, `lib/profile-data.ts` |
| `GET /compare?ids=`, `/compare/{topic}`, `/compare/table` | The compare screens | `app/compare/*` |
| `GET /glossary`, `/data`, `/developers`, `/connect`, `/privacy` | Reader screens | the pages |
| `GET /trends`, `/trends/{study}`, `/trends/movers`, `/trends/conferences[/slug]`, `/trends/states[/state]` | The trends family, seven studies now, with the Common App block | `app/trends/*` |
| `GET /high-schools?q=`, `/high-schools/{id}` | The directory and a school's screen | `app/high-schools/*` |
| `GET /roadmap[/slug]`, `/release-notes[/slug]` | Index entries and rendered HTML | `lib/roadmap-render.ts` |
| `GET /meta` | `{retrieved, sources, vintages, build}` | `getMeta` |
| `GET /share/lists/{token}`, `/invitations/{token}` | Shared-list and invitation previews | the RPCs |

### Signed in (bearer token)
| Family | Does | Reuses |
|---|---|---|
| `GET /me`, `PATCH /me`, `POST /me/password`, `GET /me/export`, the delete and restore flow | The account | `app/account/*` actions |
| `GET /me/household` and its operations (people, roles, invitations, managed students, can-edit, leave, remove, home address) | The household ([household-hub.md](../product/household-hub.md)) | `app/account/household/actions.ts` |
| `GET /me/record?student=`, `PUT /me/record/{step}` | The record's overview and each step as a `record-step` ([record/steps.md](../planner/record/steps.md)); the majors search, the course and activity catalogs | `lib/planner/record.ts`, the intake's saves |
| `GET /plan?for=`, `GET /plan/{tab}` (`next`, `colleges`, `calendar`, `offers`) | The plan's tabs as screens, for the viewer's student or a guardian's chosen child (the `plan_child` rule) | `loadPlanFor`, `nowMoves`, the tab loaders |
| `POST /plan/moves/{id}/done`, `/skip` | Now's actions | the moves store |
| `GET /plan/guide/{slug}?college=` and each guide's actions (add a college, record an act, pick a test date, save the story, rank recommenders, add a course) | The guides | `lib/planner/list-guide-server.ts`, the guides' stores |
| `POST /plan/list`, `DELETE /plan/list/{unitId}`, the ED sheet's `PUT …/round`, status, outcome, enrolling | The list and its pills | `store-list.ts`, `store-ed.ts`, `store-actions.ts` |
| `GET /plan/offers`, offer and decision writes, the choice, the share-letter consent | Offers | `lib/planner/offers.ts`, `store-plan.ts` |
| `GET /plan/calendar`, `PUT /plan/feed` (the token, shown once), `PUT /plan/texts` (consent) | Calendar, feeds, texts | the calendar store |
| `POST /estimate` | Alias of the built `/api/estimate` with the token instead of the cookie | `lib/chances/estimate.ts` |
| `GET /me/visits`, `GET /schools/{id}/events`, `PUT /me/visits/prefs`, `PUT` and `DELETE /me/visits/mute/{unitId}` | Events, the radius and the email switch, the per-college off switch ([visit-events.md](../product/visit-events.md)) | `lib/visit-events/*` |
| `GET /me/follows`, `PUT` and `DELETE /me/follows/{unitId}`, `PUT /me/notifications`, `GET /me/updates` | Following and digests | `lib/follows.ts` |
| `GET /me/api-keys`, `POST`, `DELETE /me/api-keys/{id}` | The person's API keys ([data-api.md](../product/data-api.md)) | `lib/api/keys.ts` |
| `POST /invitations/{token}/accept` | Accept | `accept_invitation` |

Sign-in, sign-up, magic link, password reset, confirmation, and sign-out go to **Supabase Auth directly** from the app
(`supabase-swift`); the age gate and password rules run in `POST /auth/precheck` before `signUp`, and the database
enforces them again. Unsubscribe and the interest confirmation stay site routes (they are reached from email). The
**admin console** (`/admin/**`) has no app endpoints: it is a desktop tool for the owner and support.

## Auth and authorization
- `Authorization: Bearer <supabase access token>`. The route builds a Supabase client with the publishable key and that
  token as its global header (`lib/supabase-bearer.ts`), then calls the same `lib/` functions the Server Actions and
  stores call. Row-level security is the gate; a cross-household read returns the 404 the page shows.
- `getUser()` on every request, never a decoded-but-unverified token.
- Guardian reads are logged through `openStudentAs` as today; the `plan_child` choice is a header the app sends
  (`X-Plan-Child`), since the app has no cookie.
- Entitlements: every write passes through `allowed(user, capability)` exactly as the stores do, so the paid tiers
  ([commercialization.md](../product/commercialization.md)) gate the app the day they gate the site.
- Rate limits: the Data API's `TokenBuckets` per token (or per IP for public routes), `429` with `Retry-After`.

## Refactor Server Actions into lib functions
Each action in `app/*/actions.ts` becomes `lib/<area>.ts: fn(client, input)` with the action and the route as two thin
callers; the planner's stores already have this shape (`ready(capability)` returns the client and the viewer), so for
them the route is a third caller of the same function. Logic that must live only in these functions: the age gate and
password rules, geocoding, CSV matching, deadline resolution against the grid and CDS dates (`lib/list-rules.ts`,
`deadlineFor`), access logging, invitation issue and acceptance, the interest acts' tracking rules.

## OpenAPI and Swift models
`lib/api/app/types.ts` is the single definition. `lib/api/openapi.ts` (built for the Data API) emits a second document,
`public/api/app/v1/openapi.json`, from the routes table's `app` rows; the app's build step runs
`swift-openapi-generator` on it. A test snapshots the document; a change is a reviewed diff. `Cited` and `FormatKind`
are exported from `lib/lineage.ts` and `lib/format.ts` unchanged.

## Caching and versions
- `X-Dataset-Retrieved` on every public response; the app keys its cache by URL, shows the cached document while
  revalidating, and a different date invalidates the lot.
- `ETag` from a hash of the body; `If-None-Match` → `304`.
- Public responses go through Vercel's CDN with the pages' one-day window; `POST /api/revalidate` also purges
  `/api/app/*`.
- A `426` with a message when the app's declared catalog version (a header) is older than the server's required minimum.

## Errors
`{error: {code, message, detail?}}` with the Data API's codes and the site's status codes: `400` bad query, `401` no or
expired token, `403` age gate, entitlement, or policy refusal (the same text the form shows), `404` unknown college, a
topic without data, or a row RLS hides, `409` seat limit or duplicate, `429` limit.

## Files (planned)
- `app/api/app/v1/**/route.ts` (one folder per endpoint)
- `lib/api/app/types.ts`, `lib/api/app/blocks.ts` (constructors pairing a value with its `Cited`),
  `lib/api/app/screens/*.ts` (one builder per screen, shared with nothing but `lib/`), `lib/api/app/auth.ts`,
  `lib/supabase-bearer.ts`; `lib/api/routes.ts` gains the `surface` column and the app rows
- `public/api/app/v1/openapi.json`
- `tests/app-api.test.mts`, `tests/app-api-schema.test.mts`

## Tests
- **Parity.** For a fixed set of colleges, each endpoint's `Value.value`s equal the numbers the page helper returns and
  each `display` equals `formatBy(format, value)`; for a fixture student, the plan screens' moves, levels, and shape
  line equal `nowMoves`, `estimateMany`, and `shapeGaps` on the same inputs.
- **Citation guard.** Every `Value` has a `Cited` with a source key in `meta.sources`; every year label is derived.
- **Method guard.** No app route imports `lib/chances/model.ts`, `lib/selectivity.ts`, or `lib/admin/*`
  (`tests/admin-hidden.test.mts` already walks the Data API's imports; the app routes join its list), and no response
  carries a hidden field.
- **Block catalog.** Every block kind emitted is in the catalog; the catalog in this spec and in `types.ts` match.
- **Query parity.** `/explore?…` with each filter in `lib/params.ts` returns the same ids, in the same order, as the page.
- **Auth.** No token → 401 on user routes; a guardian without `can_edit` gets 403 on writes and 200 on reads, with an
  `access_log` row; a student cannot read another student's plan (404); a gated capability returns 403 with the map's
  reason.
- **Routes table.** Every `app/api/app/v1/**/route.ts` has a row and every row has its file (the Data API's test, run
  over both surfaces).

## Open questions
- Whether `/explore` should also serve the filter panel on every call or only on `/explore/filters`. Start with both and
  measure.
- Generate the OpenAPI document from zod schemas (runtime validation too) or from the TypeScript types alone. The Data
  API chose a hand-kept table and a generator; keep that, since the two documents should look alike.
- Whether the Data API's keyed `/api/v1` should also accept a bearer token so one client library serves both. Not
  needed for the app; revisit if a third client appears.
