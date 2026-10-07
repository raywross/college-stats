# Telemetry: Measuring How the Site Is Used

> Status: **planned** (not built). Independent; build first so every later feature ships with its measurements.
> Part of [product](README.md). Detailed design added 2026-10-07 for the build.

## Goal
Know how the site is used and report on it: visits and where they come from, which pages and features get used,
how people move from search to profile to compare to saving, where they drop off, how fast pages are, and what
breaks. Later, conversion to sign-up and to paid tiers. All of it without tracking people across sites, without
cookies that need a banner, and without ever recording a student's numbers.

## Research (2026-10-02)
| Option | Fit |
|---|---|
| **PostHog Cloud (US)** | Product analytics (events, funnels, retention, cohorts), dashboards, feature flags, surveys; cookieless mode supported; generous free tier (1M events/month); server SDK for Node. Session replay exists but stays **off** (minors). Chosen |
| Plausible | Simple, privacy-first page analytics ($9/month); funnels and custom properties on the Business plan; no server-side events or feature flags. Fine for traffic, thin for product questions |
| Vercel Web Analytics + Speed Insights | Zero setup, cookieless, page views and Web Vitals in the Vercel dashboard; custom events limited. Keep Speed Insights for Core Web Vitals; it answers "is the site fast" better than PostHog |
| Umami / self-hosted | Full control, but another system to run; revisit if PostHog's pricing becomes a problem |

Decision: **PostHog for product events and reports, Vercel Speed Insights for performance.** Both cookieless.

## Privacy
These rules are the point, not an afterthought, because many users are 13–17
([accounts.md](accounts.md#research-2026-10-02)).
- **Cookieless, no cross-site identifiers.** PostHog runs with `persistence: "memory"` for anonymous visitors
  (no cookie, no localStorage id); a visit is one session, and returning visitors aren't linked. No consent banner
  is needed for this mode under GDPR or the US state laws, and we don't ask for one.
- **Identified only when signed in,** with the opaque `auth.users.id` as the distinct id, so retention and funnels
  work for accounts. Signing out resets the id. Never the email or name as a property.
- **No personal numbers, ever.** No GPA, scores, income, assets, award amounts, high school, or list contents
  in any event. Events may carry *that* a tool was used and *which college* (`unit_id` is public data), plus
  coarse flags ("in range: yes"). A typed registry enforces this (below).
- **Autocapture off.** Only registered events are sent, so a new input field can't leak. Text masking on in case
  autocapture is ever enabled.
- **No session replay, no heatmaps, no surveys, no geolocation finer than country or region.** PostHog's GeoIP
  enrichment runs on its servers from the request's IP; the project is set to discard the client IP after
  enrichment, and identified users' events are sent with `$geoip_disable` so a signed-in minor's events carry no
  location at all. Anonymous events keep country and region for the traffic report.
- **Global Privacy Control and Do Not Track are honored.** When the browser sends either signal, nothing is
  initialized and nothing is sent, not even a page view (California treats GPC as an opt-out; honoring DNT too costs
  nothing).
- **Server-side events** for things that matter and shouldn't depend on an ad blocker: sign-up, and later
  subscription changes and API key use. Sent from Server Actions and Route Handlers with `posthog-node`.
- **Retention:** 12 months for event data (a PostHog project setting); aggregates kept in reports.
- **Ad blockers:** events are sent through a same-origin path (`/ingest/*` rewritten to PostHog in `next.config.ts`)
  so ordinary blocking doesn't silently blank the numbers; users who block it anyway are simply not counted.
- The privacy policy (`/privacy`) states all of this in plain language; the footer and the Data page's methods
  section link to it.

## Architecture
Three layers, so that app code never talks to PostHog directly and the whole thing is a no-op without a key:

```
component ──track("school_viewed", {…})──► lib/analytics.ts ──sink──► components/analytics/AnalyticsProvider.tsx ──► posthog-js ──► /ingest/* ──► PostHog
                                            (registry, types,          (client; installs the sink once posthog-js
                                             no imports of PostHog)     is loaded; page views on route change)

server action ──trackServer("signup_completed", {…}, userId)──► lib/analytics-server.ts ──► posthog-node ──► PostHog
```

- **`lib/analytics.ts`** is plain TypeScript with no PostHog import, so it runs in `node --test` and in server
  components alike. It exports the event registry (`AnalyticsEvents`, `EVENTS`), `track()`, `identify()`,
  `resetIdentity()`, the navigation-source helpers, and `installAnalyticsSink()`. `track()` validates the event
  name against the registry, drops any property not registered for that event, and does nothing when no sink is
  installed.
- **`components/analytics/AnalyticsProvider.tsx`** (client, rendered once in `app/layout.tsx` inside `<Suspense>`)
  loads `posthog-js` with a dynamic import only when `NEXT_PUBLIC_POSTHOG_KEY` is set and the browser sends no
  GPC/DNT signal, initializes it with the privacy configuration, installs the sink, captures `$pageview` on every
  pathname change (not on query-string changes: Explore's filters are their own event), derives `school_viewed` and
  `roadmap_viewed` from the path, and identifies the signed-in user from `/api/me` (which gains the opaque user id).
- **`lib/analytics-server.ts`** (`server-only`) wraps `posthog-node` with `flushAt: 1` and a flush after every
  capture (serverless functions end right after the response). Without a key it's a no-op; it never throws.
- **`next.config.ts`** rewrites `/ingest/static/*` to PostHog's asset host and `/ingest/*` to the ingestion host,
  with `skipTrailingSlashRedirect` so PostHog's paths pass through unchanged.
- **`@vercel/speed-insights`** renders in the layout; it only reports from Vercel deployments.

### Attribution of a school view
`school_viewed.from` says how someone reached a college. Two sources, combined by the provider when it sees a
`/schools/{id}` path with a new `unit_id`:
1. A component that knows the intent calls `markNextViewFrom(source)` just before navigating (the search box marks
   `search`); the provider consumes the mark on the next page view.
2. Otherwise the previous pathname decides: `/` → `home`, `/explore…` → `explore`, `/compare…` → `compare`,
   `/schools/…` (another college) → `similar`, no previous path → `direct`, anything else → `other`.
Moving between topic pages of the same college is not a new view.

## Event registry
`lib/analytics.ts` exports typed event names and property shapes; `track()` accepts only those. A test fails if a
component imports `posthog-js` or calls `posthog.capture` outside the provider, or if a registered property name
has a denied token (`gpa`, `sat`, `act`, `score`, `income`, `agi`, `asset`, `email`, `name`, `amount`, `grade`,
`address`, `zip`, `phone`, `birth`, `age`; names are split on `_` and each token compared, so `action` and
`in_range` pass and `display_name` fails).

| Event | Properties | Fired from | Why |
|---|---|---|---|
| `$pageview` | `$current_url` (PostHog adds referrer domain and UTM) | Provider, on pathname change | Traffic and entry pages |
| `search_performed` | `source`: `hero` / `header` / `tabbar`; `result_count`: `0` / `1` / `2-5` / `6+`; `picked`: bool | `SchoolSearch` when a result is picked or the query is submitted to Explore | Does search find things |
| `explore_filtered` | `filter` (the URL key changed; several joined with `+`), `view`, `active_filter_count` | `useExploreParams.update()` for any key but `view` and `page` | Which filters matter (Explore's own search box is `filter: q`) |
| `explore_view_changed` | `view`: grid / table / chart / map | `useExploreParams.update()` when `view` changes | Grid vs table vs chart vs map |
| `school_viewed` | `unit_id`, `from`: `search` / `explore` / `compare` / `home` / `similar` / `direct` / `other` | Provider, from the path (see Attribution) | Which colleges, which paths |
| `profile_card_opened` | `unit_id`, `topic`, `from`: `card` / `pill` / `anchor` | `TopicCard`'s link, `TopicPills`, `AnchorRedirect` | Which topic pages get opened from the overview, pills, or old anchors |
| `profile_block_viewed` | `unit_id`, `topic`, `block` (the section id) | `BlockViews` in `TopicPage` (IntersectionObserver at 50% visible, once per block per page view) | Which blocks of a topic page get read |
| `score_checked` | `test`: sat / act; `in_range`: bool (the score itself is never sent) | `ScoreChecker`, debounced, once per distinct entry; not for a value prefilled from the profile | Does the checker get used |
| `citation_opened` | `field` (the registered field path) | `InfoTip`, `SourceTip`, `SourcesTip`, `Term` when opened with a citation | Does lineage get read |
| `term_opened` | `term` (glossary key) | `InfoTip`, `Term` when opened | Glossary value |
| `compare_changed` | `action`: add / remove / clear; `count` (after the change) | `toggleCompare()`, `clearCompare()` in `lib/compare.ts` | Compare use |
| `compare_viewed` | `count`, `preset`: bool (the URL's colleges differed from the saved list: a link from a profile or the home page) | `CompareViewed` on `/compare`, once per set of ids | |
| `trend_group_opened` | `unit_id`, `group` | The Over-time page's group pickers (side list and phone picker), not the store | Over-time charts |
| `roadmap_viewed` | `slug` | Provider, from `/roadmap/{slug}` | Interest in planned features (a useful signal for prioritizing) |
| `signup_started` (server) | `method`: magic_link / password; `role_hint`: student / guardian / counselor / none; `has_invite`: bool | `requestMagicLink` and `signUpWithPassword` when creating an account | Accounts |
| `signup_completed` (server) | same, with the new user's id as distinct id | The auth callback and `completeSignIn`, when the email was confirmed in the last two minutes | Accounts |
| `error_shown` | `route` (the pathname), `kind`: error / not_found | `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` | Errors users see |
| `list_item_added`, `standing_viewed`, `estimate_run`, `offer_added`, `scattergram_viewed` | `unit_id` and coarse flags only | Later features, each defined in its spec and added to the registry then | |
| `subscribe_started`, `subscribe_completed`, `subscription_cancelled` (server) | `tier`, `interval` | [commercialization.md](commercialization.md) | Commercial |
| `api_request` (server) | key id, endpoint, status | [data-api.md](data-api.md) | |

Property values are strings, numbers, or booleans; never objects or arrays, never free text typed by a user (the
search query is not sent; the result-count bucket is).

## Reports
PostHog dashboards, one per question, reviewed weekly:
1. **Traffic:** visits, visitors (session-based while anonymous), top entry pages, referrers, countries, devices.
2. **Engagement:** schools viewed per visit, blocks read, compare rate, search success (`picked` share).
3. **Funnels:** search → profile → compare; profile → list; visit → sign-up; sign-up → paid.
4. **Retention:** signed-in weekly return rate by role (student, guardian, counselor).
5. **Content:** most viewed colleges, filters, glossary terms, citations, roadmap pages.
6. **Performance** (Vercel Speed Insights): LCP, INP, CLS per route, phone vs desktop.
7. **Errors:** `error_shown` by route, plus Vercel's function logs.
The insight definitions for each dashboard are in [Setup](#setup-owner). A monthly summary (numbers and one-line
observations) is written into `data/reports/usage-{month}.md` by hand from `data/reports/usage-template.md` for
now; a scheduled job could draft it from PostHog's API later.

## Environments
- Separate PostHog projects for **dev** and **production**; the key comes from `NEXT_PUBLIC_POSTHOG_KEY` and
  `NEXT_PUBLIC_POSTHOG_HOST` (default `https://us.i.posthog.com`; the first `NEXT_PUBLIC_` variables: the project
  key is a public write-only token, fine to expose). Unset → analytics code is a no-op, so CI, previews without the
  variable, and local work send nothing. The server client reads the same two variables.
- Vercel Preview deployments use the dev project; Production the production project.
- The rewrite destination is read from `NEXT_PUBLIC_POSTHOG_HOST` at build time (asset host derived by inserting
  `-assets` after the region: `us.i.posthog.com` → `us-assets.i.posthog.com`).

## Tests
`tests/analytics.test.mts`:
- Registry shape: every event has a `side`, a `why`, and a property list; event and property names are snake_case
  (`$pageview` aside); no property name has a denied token.
- `track()` without a sink does nothing and doesn't throw; with a sink it forwards the event and drops unregistered
  properties; an unregistered event name is refused.
- `navigationSourceFromPath` and `resultCountBucket` edge cases.
- No file under `app/`, `components/`, or `lib/` imports `posthog-js` or `posthog-node`, or references
  `posthog.capture` / `posthog.identify`, except `components/analytics/AnalyticsProvider.tsx` and
  `lib/analytics-server.ts`.
- `next.config.ts` rewrites `/ingest/static/:path*` and `/ingest/:path*` to PostHog hosts and sets
  `skipTrailingSlashRedirect`.
- `trackServer()` without a key resolves without a network call.
Instrumented components keep their own tests where they have them; the privacy page's copy must pass the
lineage guards (no literal data years).

## Setup (owner)
Filled in by the build: creating the two PostHog projects, the project settings that enforce the privacy rules
(discard IP, retention, replay off), the Vercel environment variables, and the insight recipes behind each
dashboard.

## Files
- `lib/analytics.ts` (registry, `track()`, `identify()`, `resetIdentity()`, `markNextViewFrom()`,
  `installAnalyticsSink()`), `components/analytics/AnalyticsProvider.tsx` (client; init, page views, derived
  events, identify), `components/analytics/TrackedLink.tsx` (a `next/link` that tracks on click, for server
  components), `components/analytics/ErrorTracker.tsx`, `lib/analytics-server.ts` (`posthog-node`),
  `next.config.ts` rewrites for `/ingest`, `app/layout.tsx` (provider + `@vercel/speed-insights`), `app/error.tsx`,
  `app/global-error.tsx`, `app/privacy/page.tsx`, `tests/analytics.test.mts`, `data/reports/usage-template.md`.

## Build order
1. **Foundation:** registry, provider, server client, rewrites, layout, error pages, `/api/me` id, tests.
2. In parallel: **discovery** instrumentation (search, Explore, compare, score checker); **profile** instrumentation
   (cards, pills, anchors, block views, citations, terms, trend groups); **accounts and privacy** (sign-up events,
   the privacy page and its links, the Setup section, the report template).
3. Mark built; the dashboards are built by hand in PostHog from the Setup recipes once production has a key.

## Decisions (2026-10-07)
1. Global Privacy Control and Do Not Track are both honored by sending nothing (open question 1: yes).
2. The monthly usage summary stays a markdown file in `data/reports/` (open question 2); an owner-only page waits
   for an admin role.
3. `search_performed.source` has no `explore` value: Explore's search box changes the `q` filter and is reported
   as `explore_filtered`, which already carries the result set's state. The spec's earlier `explore` value was
   dropped rather than sent without a result count.
4. Identified users' events disable GeoIP entirely rather than trimming it to country and region: PostHog's GeoIP
   fields can't be reduced per event, and a signed-in minor's location is worth less than the rule's simplicity.
