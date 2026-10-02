# Telemetry: Measuring How the Site Is Used

> Status: **planned** (not built). Independent; build first so every later feature ships with its measurements.
> Part of [product](README.md).

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
  coarse flags ("has scores: yes"). A typed registry enforces this (below).
- **Autocapture off.** Only registered events are sent, so a new input field can't leak. Text masking on in case
  autocapture is ever enabled.
- **No session replay, no heatmaps, no geolocation finer than country** (PostHog's GeoIP property set reduced to
  country and region, never city for identified users).
- **Server-side events** for things that matter and shouldn't depend on an ad blocker: sign-up, subscription
  changes, API key use. Sent from Server Actions with `posthog-node`.
- **Retention:** 12 months for event data; aggregates kept in reports.
- **Ad blockers:** events are sent through a same-origin path (`/ingest/*` rewritten to PostHog in `next.config.ts`)
  so ordinary blocking doesn't silently blank the numbers; users who block it anyway are simply not counted.
- The privacy policy states all of this in plain language, and the Data page's methods section links to it.

## Event registry
`lib/analytics.ts` exports typed event names and property shapes; `track()` accepts only those. A test fails if a
component calls `posthog.capture` directly or if a property name matches a denied pattern (`gpa`, `sat`, `act`,
`income`, `agi`, `asset`, `email`, `name`, `amount`, `grade`).

| Event | Properties | Why |
|---|---|---|
| `$pageview` (auto) | path (with ids), referrer domain, UTM | Traffic and entry pages |
| `search_performed` | source: `hero` / `header` / `explore` / `tabbar`, result_count bucket, picked: bool | Does search find things |
| `explore_filtered` | filter key, view, active_filter_count | Which filters matter |
| `explore_view_changed` | view, chart | Grid vs table vs chart |
| `school_viewed` | unit_id, from: `search` / `explore` / `compare` / `home` / `similar` / `direct` | Which colleges, which paths |
| `profile_section_viewed` | unit_id, section | Which sections get read (IntersectionObserver, once per section per view) |
| `score_checked` | test, in_range: bool (no score) | Does the checker get used |
| `citation_opened` | field path | Does lineage get read |
| `term_opened` | term | Glossary value |
| `compare_changed` | action: add / remove / clear, count | Compare use |
| `compare_viewed` | count, preset: bool | |
| `trend_group_opened` | unit_id, group | Over-time charts |
| `roadmap_viewed` | slug | Interest in planned features (a useful signal for prioritizing) |
| `signup_started`, `signup_completed` (server) | method, role_hint, has_invite | Accounts |
| `list_item_added`, `standing_viewed`, `estimate_run`, `offer_added`, `scattergram_viewed` | unit_id and coarse flags only | Later features, each defined in its spec |
| `subscribe_started`, `subscribe_completed`, `subscription_cancelled` (server) | tier, interval | Commercial |
| `api_request` (server) | key id, endpoint, status | [data-api.md](data-api.md) |
| `error_shown` | route, kind | Errors users see |

## Reports
PostHog dashboards, one per question, reviewed weekly:
1. **Traffic:** visits, visitors (session-based while anonymous), top entry pages, referrers, countries, devices.
2. **Engagement:** schools viewed per visit, sections read, compare rate, search success.
3. **Funnels:** search → profile → compare; profile → list; visit → sign-up; sign-up → paid.
4. **Retention:** signed-in weekly return rate by role (student, guardian, counselor).
5. **Content:** most viewed colleges, filters, glossary terms, roadmap pages.
6. **Performance** (Vercel Speed Insights): LCP, INP, CLS per route, phone vs desktop.
7. **Errors:** `error_shown` by route, plus Vercel's function logs.
A monthly summary (numbers and one-line observations) is written into `data/reports/usage-{month}.md` by hand for
now; a scheduled job could draft it from PostHog's API later.

## Environments
- Separate PostHog projects for **dev** and **production**; the key comes from `NEXT_PUBLIC_POSTHOG_KEY` and
  `NEXT_PUBLIC_POSTHOG_HOST` (the first `NEXT_PUBLIC_` variables: the project key is a public write-only token,
  fine to expose). Unset → analytics code is a no-op, so CI, previews without the variable, and local work send
  nothing.
- Vercel Preview deployments use the dev project; Production the production project.
- `tests/analytics.test.mts`: registry shape, denied property names, no direct `posthog.capture` outside
  `lib/analytics.ts`, no-op without a key.

## Files (planned)
- `lib/analytics.ts` (registry, `track()`, `identify()`), `components/AnalyticsProvider.tsx` (client; pageviews
  on route change), `lib/analytics-server.ts` (`posthog-node`), `next.config.ts` rewrites for `/ingest`,
  `app/layout.tsx` (provider + `@vercel/speed-insights`), `tests/analytics.test.mts`, privacy policy page.

## Open questions
1. A Do-Not-Track or Global Privacy Control signal: honor GPC by not sending events at all (cheap to do, and
   California treats GPC as an opt-out). Recommendation: yes.
2. Where should the monthly usage summary live: a private page in the app (`/admin/usage`, owner only), or the
   markdown report? Start with markdown; add the page when there's an admin role.
