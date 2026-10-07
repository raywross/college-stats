# App API: Screen Documents for the iPhone App

> Status: **planned** (2026-10-06). First of the three iPhone app specs ([overview](README.md)); the app
> ([app.md](app.md)) and its screens ([screens.md](screens.md)) consume it. Independent of the keyed developer API
> ([data-api.md](../product/data-api.md)), which sells raw records; this one serves rendered screens to our own client.

## Goal
Give the iPhone app a JSON document for every screen the site has, produced by the same code the pages use, so the app
shows the same numbers, the same words, and the same citations as the site, and gets them without an App Store release
when the site changes.

## What exists today
Almost nothing the site shows is available as JSON. The pages are server components that call `getData()` and render
HTML; filtering, sorting, percentiles, takeaways, map projection, and citation resolution all happen inside them.
The JSON that does exist:

| Route | Serves | Reusable by the app? |
|---|---|---|
| `GET /api/schools?q=&limit=&exclude=` and `?ids=` (`app/api/schools/route.ts`) | Typeahead and lookup: `SchoolIndexEntry` (id, name, city, state, type, acceptance, brand, matched) | Yes, as is, for search |
| `GET /api/me` | `{configured, signedIn, name, email}` from the cookie session | No: cookie-bound |
| `GET /api/high-schools?q=&state=&kind=&limit=`, `GET /api/high-schools/[id]` | `HighSchoolHit[]` | Yes, for the high school picker and directory search |
| `POST /api/revalidate`, `GET|POST /api/cron/digests` | Operations | No |

Everything else below is new. Server Actions (`app/*/actions.ts`, `lib/lists.ts`, `lib/follows.ts`,
`lib/home-store.ts`, …) hold the user-data logic today; the user endpoints reuse it after a small refactor
([below](#refactor-server-actions-into-lib-functions)).

## Principles
1. **Same code, same numbers.** Every endpoint is a thin route over `getData()`, `lib/dataset.ts`, `lib/metrics.ts`,
   `lib/insights.ts`, `lib/lineage.ts`, `lib/trends.ts`, and the per-page data helpers (`lib/profile-data.ts`,
   `lib/compare-*.ts`). No endpoint computes anything a page does not.
2. **A citation on every value.** Each number is a `Value` carrying its `Cited` record (from `citeField`), never a
   bare number. The guard test fails the build otherwise, as `tests/citation-guards.test.mts` does for pages.
3. **Screens are blocks.** A screen document is a list of blocks from a fixed catalog (below). The app has one renderer
   per block kind. New content in a known kind appears in the app at once; an unknown kind renders as "Open on the
   web" with the page's URL, so an old app never shows a broken screen.
4. **Versioned.** Path prefix `/api/app/v1`. Within v1, fields are only added. `X-Dataset-Publish` carries the dataset
   publish id so the app knows when its caches are stale.
5. **Cacheable.** Public endpoints: `Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600` (the same day
   the pages use for `revalidate`), `ETag`, `If-None-Match` → 304. User endpoints: `private, no-store`.
6. **No secrets in the app.** Public endpoints need no key. User endpoints take the person's Supabase access token as
   `Authorization: Bearer` and run through a Supabase client bound to that token, so row-level security decides, as it
   does for the pages. The secret key never leaves the server.
7. **Strings are the server's.** Labels, takeaways, hints, year labels, source lines, and empty-state text come from
   the server, so the app has no copy of its own to drift. The app owns only chrome strings (tab names, Settings).

## Shapes
Types live in `lib/app-api/types.ts` and are the only source for the Swift models ([generation](#openapi-and-swift-models)).

```ts
/** A displayed number. `display` is what the site would print (formatBy); `value` is for charts and sorting. */
interface Value { value: number | null; display: string; format: FormatKind; cited: Cited; delta?: Delta }
interface Delta { value: number; display: string; since: string }                  // "since fall 2014"
/** lib/lineage.ts Cited, serialized as is: key, label, publisher, year, url, method, formula, inputs, quote, replaces… */
interface Link { label: string; href: string }                                     // href is a site URL (deep-linkable) or external
interface Screen { kind: "screen"; title: string; url: string; blocks: Block[]; sources: SourceGroup[]; publish: string }
```

**Block catalog** (one kind per chart or layout element the site has, `components/charts` and the shared cards):

| Kind | Fields | Site counterpart |
|---|---|---|
| `heading` | level, text, eyebrow?, anchor | Panel h1/h2, `OnThisPage` anchors |
| `text` | markdown (bold, links, `Term` spans) | Takeaways, intros, method notes |
| `takeaway` | text, tone | `insights.ts` takeaways |
| `stat-tiles` | tiles: {label, value: Value, hint?, term?} | Stat strip, key numbers |
| `ring` | value, label, median? | `Ring` |
| `range-bar` | low, high, median?, you?, scale, label | `RangeBar`, `ScoreCompare` |
| `benchmark-bar` | value, median, label | `BenchmarkBar` |
| `funnel` | steps: {label, value} | Admissions funnel |
| `waffle` | filled, label | `Waffle` |
| `stacked-bar` | segments: {label, value, color} | `StackedBar`, `RaceCompare` |
| `distribution` | bins, pinned, label | `DistributionStrip`, `HistogramSlider` histograms |
| `trend-line` | series[], bands?, breaks?, events?, window, yearKind | `TrendLine`, `Sparkline` (compact) |
| `stacked-area` | series[] | `StackedArea100` |
| `dumbbell` | rows: {label, start, end} | `Dumbbell` |
| `slope` | rows, metrics (segmented) | `SlopeChart` (Then & now) |
| `dot-plot` | groups: {label, value} | `GroupDotPlot` |
| `dot-range` | low, median, high, mark | `DotRange` |
| `scatter` | points: {id, x, y, size, color, label}, zone?, diagonal?, focus? | `ScatterPlot` |
| `dot-map` | paths (Albers USA, from `lib/us-map.ts`), dots | `DotMap` |
| `tile-map` | tiles: {state, value, display, href}, scale | `StateTileMap`, `StateMeasureMap` |
| `waterfall` | steps | `CostBreakdown` |
| `columns` | columns: {label, paid, covered} | `NetPriceByIncome`, `NetPriceCompare` |
| `grouped-bars` | groups, series, flag | `CompareMetric`, `GroupBars` |
| `radar` | axes, series | `RadarChart` |
| `histogram` | bins | `ClassSizeHistogram` |
| `outcome-bar` | segments, toggle options | `OutcomeBar` |
| `class-trend` | points | `ClassTrend` |
| `leaderboard` | rows: {school: SchoolRef, value} | `Leaderboard` |
| `table` | columns, rows (cells are Value \| string \| Link), sticky, anchors, `same` flags | Compare table, Explore table, CDS tables |
| `school-card` / `school-row` | SchoolRef + facts, meters, indicators, standouts, distance? | `SchoolCard`, `SchoolRow` |
| `school-chips` | SchoolRef[] | Try chips, Known for, similar schools |
| `topic-card` | title, href, footer, blocks | Profile and Compare topic cards |
| `chips` | chips: {label, href?, selected?} | Standouts, filter chips |
| `links` | Link[], style | Official links, social, topic nav |
| `fold` | hint, blocks | `ShowMore` |
| `controls` | segmented/toggle definitions bound to query params | History controls, movers window, table "Differences only" |
| `source-note` | SourceGroup[] | `SourceNote`, `MultiSourceNote`, `BaselineNote`, `HistorySourceNote` |
| `web` | href | Fallback for anything not yet a block |

`SchoolRef = {id, name, city, state, type, brand: CrestBrand}` is the same shape `/api/schools` returns, so the app's
crest renderer has one input.

## Endpoints
All under `/api/app/v1`. Query strings reuse the site's (`lib/params.ts`), so a site URL maps to an API call by
prefix alone, which is how deep links resolve ([app.md](app.md#navigation-and-deep-links)).

### Public
| Endpoint | Returns | Built from |
|---|---|---|
| `GET /home` | `Screen` of the home page's sections | `app/page.tsx` sections, `history/facts.json` |
| `GET /explore?…` | `{summary, filters: FilterPanel, active: Chip[], results: {view, items \| rows \| scatter \| map}, page, total, notes}` with the site's query string, including `view`, `chart`, `changes`, `near`, `within`, `sortBy`, `sortDir`, `page` | `app/explore/page.tsx`, `FilterPanel` counts, `lib/us-map.ts` |
| `GET /explore/filters?…` | The `FilterPanel` alone (sections → controls with counts for the current query) | `FilterPanel.tsx` |
| `GET /search?q=&limit=&exclude=` | `SchoolIndexEntry[]` | Alias of `/api/schools` |
| `GET /schools/index` | Every college as `SchoolRef` + acceptance + applicants (~300 KB gzipped), for offline search | `getAllSchools` |
| `GET /schools/{id}` | The overview `Screen`: hero, identity links, what changed, topic cards, similar schools, sources | `app/schools/[id]/page.tsx` |
| `GET /schools/{id}/{topic}` | `Screen` for admissions, students, academics, cost, outcomes; 404 like the page when the college lacks the topic | the topic pages, `lib/profile-data.ts` |
| `GET /schools/{id}/history?group=&range=&dollars=&median=&rate=` | `Screen` with `controls` and the selected group's charts, plus the group list | `OverTime`, `getHistory` |
| `GET /schools/{id}/changes` | What changed in the last year | `dataset_changes` |
| `GET /compare?ids=` | Overview `Screen` (key differences, radar, topic cards) or the empty/one-school states as blocks | `app/compare/page.tsx` |
| `GET /compare/{topic}?ids=&major=` | Topic `Screen` (admissions, students, academics, cost, outcomes, history) | `CompareTopicPage` |
| `GET /compare/table?ids=` | `table` block with `same` flags per row | `CompareTable` |
| `GET /glossary` | Entries with categories and related keys | `lib/glossary.ts` |
| `GET /trends` | Hub: study cards, movers entry, Power Four, states tiles | `app/trends/page.tsx` |
| `GET /trends/{study}` | Study `Screen` with grouping options | `StudyPage`, `getTrendFile` |
| `GET /trends/movers?window=` | The ten lists | `lib/movers.ts` |
| `GET /trends/conferences`, `/trends/conferences/{slug}` | Index and conference `Screen`s | `lib/conferences.ts` |
| `GET /trends/states`, `/trends/states/{state}?measure=` | Index with the tile map and table; state `Screen` | `app/trends/states/*` |
| `GET /data` | The Data page as blocks: vintages timeline, release calendar, sources, methods | `app/data/page.tsx` |
| `GET /roadmap`, `/roadmap/{slug}`, `/release-notes`, `/release-notes/{slug}` | Index entries and rendered HTML (`lib/roadmap-render.ts`), with the table of contents | roadmap and release-notes pages |
| `GET /high-schools?q=&state=&kind=`, `/high-schools/{id}` | Directory hits; the high school `Screen` | `app/high-schools/*` |
| `GET /meta` | `{publish, sources, vintages, build}` for the About screen and cache validation | `getMeta` |
| `GET /share/lists/{token}` | The shared-list preview (name, items by category) | `list_share_preview` |
| `GET /invitations/{token}` | Invitation preview | `invitation_preview` |

### Signed in (bearer token)
| Endpoint | Does | Reuses |
|---|---|---|
| `GET /me` | Account summary: profile fields, household seat count, home, students I can see, deletion state | `getAccount`, `studentsICanSee` |
| `PATCH /me` | Display name, birth year (age gate), role hint | `updateProfile` |
| `POST /me/password` | Set or change password (`same_password`, `reauthentication_needed` surfaced) | `setPassword` |
| `GET /me/export` | The JSON export file | `ACCOUNT_EXPORTERS` |
| `GET /me/delete/preview`, `POST /me/delete`, `POST /me/restore` | Deletion flow | the RPCs |
| `GET /me/student?student=` | The student profile form definition and values, completeness, guardian banner | `/me` |
| `PUT /me/student?student=` | Save the profile | `saveStudentProfile` |
| `GET /me/household`, `POST /me/household`, roster, invitations, managed students, `can_edit`, leave, remove | Household operations one route each | `app/account/household/actions.ts` |
| `GET|PUT|DELETE /me/home` | Home address (geocoded server-side), `GET /me/home/suggest?q=` | `saveHomeAddress`, `suggestAddresses` |
| `GET /me/lists`, `POST /me/lists`, `PATCH|DELETE /me/lists/{id}` | Lists | `lib/lists.ts` |
| `GET /me/lists/{id}` | The board: items grouped by category with resolved deadlines, distances, notes, balance line, next 30 days | `/me/lists/[id]` |
| `POST /me/lists/{id}/items`, `PATCH|DELETE …/items/{unitId}` | Add; category, round, status, outcome, deadline override, enrolling, move up/down; remove | item actions |
| `POST|DELETE …/items/{unitId}/notes` | Notes | `addNote`, `deleteNote` |
| `GET …/export.csv`, `POST …/import` | CSV out and in (unmatched names returned) | `exportListCsv`, `importListCsv` |
| `PUT …/share` | Enable (returns the token once) or revoke | `setListShare` |
| `GET /me/follows`, `PUT|DELETE /me/follows/{unitId}` | Following, with "On your list" vs followed | `lib/follows.ts` |
| `PUT /me/notifications` | Email updates on/off | `setEmailUpdates` |
| `GET /me/updates` | Digest history rebuilt from `dataset_changes` | `/me/updates` |
| `POST /invitations/{token}/accept` | Accept | `accept_invitation` |
| `POST /me/fit` | The "Fits my scores" and "Fits my preferences" query strings for Explore | `ExploreFitChips` |

Sign-in, sign-up, magic link, password reset, confirmation, and sign-out go to **Supabase Auth directly** from the app
(`supabase-swift`), not through this API; the age gate and password rules run in a `POST /auth/precheck` the app calls
before `signUp`, and the `profiles` trigger and `/account` edit path enforce them again. Unsubscribe stays the site's
`/unsubscribe/{token}` route (it is reached from email).

## Auth and authorization
- The app sends `Authorization: Bearer <supabase access token>`. The route builds a Supabase client with the
  publishable key and that token as its global header (`lib/supabase-bearer.ts`), then calls the same `lib/` functions
  the Server Actions call. Row-level security is the gate, exactly as on the site; a cross-household read returns the
  same 404 the page shows.
- `getUser()` on every request, never a decoded-but-unverified token.
- Guardian reads are logged with `log_access` through `openStudentAs` as today, so "Who viewed your information"
  stays complete.
- Rate limits: a small per-token (or per-IP for public routes) limiter in Postgres, as planned for
  [data-api.md](../product/data-api.md#keys-limits-tiers), with `429` and `Retry-After`.

## Refactor Server Actions into lib functions
Each action in `app/*/actions.ts` becomes `lib/<area>.ts: fn(client, input)` with the action and the route as two thin
callers. The actions keep their signatures, so the pages do not change. Tests that cover the actions today move with
the functions. Logic that must not be duplicated and so lives only in these functions: the age gate and password
rules (`lib/password.ts`), Census geocoding and the ZIP fallback (`lib/geocode.ts`), CSV import matching, deadline
resolution against CDS dates (`lib/list-rules.ts`), access logging, invitation issue and acceptance.

## OpenAPI and Swift models
`lib/app-api/types.ts` is the single definition. `npm run build-openapi` emits `public/api/app/v1/openapi.json` from
it (`ts-to-openapi` or zod schemas, decided when built), and the app's build step runs `swift-openapi-generator` on
that file so the Swift models cannot drift from the server's. A test snapshots the document; a change is a reviewed
diff. The `Cited` and `FormatKind` types are exported from `lib/lineage.ts` and `lib/format.ts` unchanged.

## Caching and versions
- `X-Dataset-Publish` on every public response (`meta.published_at` in Supabase mode, the build id in JSON mode).
  The app keys its cache by URL and shows the cached document while revalidating; a different publish id invalidates
  the lot.
- `ETag` from a hash of the body; `If-None-Match` → `304`.
- Public responses are served through Vercel's CDN with the same one-day window the pages use, and
  `POST /api/revalidate` (already called by `publish-data`) also purges `/api/app/*`.

## Errors
`{error: {code, message, detail?}}` with the site's status codes: `400` bad query, `401` no or expired token, `403`
age gate or policy refusal (the same text the form shows), `404` unknown college, topic without data, or a row RLS
hides, `409` seat limit or duplicate, `429` limit. Messages are the ones the pages show, so the app displays them as is.

## Files (planned)
- `app/api/app/v1/**/route.ts` (one folder per endpoint above)
- `lib/app-api/types.ts` (shapes), `lib/app-api/blocks.ts` (constructors that pair a value with its `Cited`),
  `lib/app-api/screens/*.ts` (one builder per screen, shared with nothing but `lib/`), `lib/app-api/auth.ts`
  (bearer client, limits), `lib/supabase-bearer.ts`
- `scripts/build-openapi.mts`, `public/api/app/v1/openapi.json`
- `tests/app-api.test.mts`: see below. `tests/app-api-schema.test.mts`: OpenAPI snapshot
- `specs/iphone-app/api.md` (this file) gains a "Built" section; [data-lineage.md](../data-lineage.md) gets a line that
  `Value.cited` is the API's citation form

## Tests
- **Parity.** For a fixed set of colleges (Harvard, a public flagship, a small college with few fields), each
  endpoint's `Value.value`s equal the numbers the corresponding page helper returns, and each `display` equals
  `formatBy(format, value)`.
- **Citation guard.** Walk every response; every `Value` has a `Cited` with a source key in `meta.sources`; every
  year label is derived, never literal.
- **Block catalog.** Every block kind emitted is in the catalog; the catalog in the spec and in `types.ts` match.
- **Query parity.** `/explore?…` with each filter in `lib/params.ts` returns the same ids, in the same order, as
  `getSchools(parseFilters(...))`.
- **Auth.** No token → 401 on user routes; a guardian without `can_edit` gets 403 on writes and still gets 200 on
  reads, with an `access_log` row; a student cannot read another student's list (404).
- **Caching.** `ETag` round trip; `X-Dataset-Publish` present.

## Open questions
- Whether `/explore` should also serve the filter panel on every call (simpler client) or only on `/explore/filters`
  (smaller responses). Start with both and measure the panel's size with counts (expected under 20 KB).
- Whether to generate the OpenAPI document from zod schemas (runtime validation on the server too) or from the
  TypeScript types alone (no runtime cost). Prefer zod if the generated Swift is as clean.
