# Telemetry: Measuring How the Site Is Used

> Status: **built** 2026-10-07 on `feature/telemetry`: the event registry, the PostHog provider and server client,
> the `/ingest` proxy, instrumentation of search, Explore, compare, the score checker, profiles, citations, glossary
> terms, Over-time groups, sign-ups and errors, and the `/privacy` page. The dashboards are built by hand in PostHog
> from [Setup](#setup-owner) once the production project has a key. Part of [product](README.md).

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
  loads `posthog-js` with a dynamic import only when `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is set and the browser sends no
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
| `major_compared` | `field` (the public 2-digit CIP family), `count` | Compare's "Your major" form, on submit | Which fields get compared; never a student's own major |
| `trend_group_opened` | `unit_id`, `group` | The Over-time page's group pickers (side list and phone picker), not the store | Over-time charts |
| `roadmap_viewed` | `slug` | Provider, from `/roadmap/{slug}` | Interest in planned features (a useful signal for prioritizing) |
| `signup_started` (server) | `method`: magic_link / password; `role_hint`: student / guardian / counselor / none; `has_invite`: bool | `requestMagicLink` and `signUpWithPassword` when creating an account | Accounts |
| `signup_completed` (server) | same, with the new user's id as distinct id | The auth callback and `completeSignIn`, when the email was confirmed in the last two minutes | Accounts |
| `error_shown` | `route` (the pathname), `kind`: error / not_found | `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` | Errors users see |
| `plan_opened` | `tab`: colleges / scores / calendar / offers; `viewer`: student / guardian; `everyone`: bool | `PlanOpened`, once per tab shown | Planner ([planner/redesign](../planner/redesign/page.md)) |
| `plan_tab` (`tab`), `plan_switch_child` (`to`: child / everyone), `plan_signed_out_started` (`from`: numbers / college), `plan_signed_out_saved` (`has_numbers`), `plan_numbers_set` (`test`: sat / act / none, `practice`), `plan_group_changed` (`from_auto`), `plan_dream_set` (`on`), `plan_round_changed` (`from_auto`, `round`), `plan_drawer_opened` (`in_season`), `plan_ed2_offer_used` (`dream_round`: ed / rea), `plan_round_problem_shown` (`kind`), `plan_scores_opened` (`suggestion`), `plan_test_date_picked` (`test`), `plan_calendar_opened` (`everyone`, `color_by`: child / round), `plan_calendar_feed_added` (`everyone`), `plan_calendar_printed` (`everyone`) | as listed; never a score, GPA, name, or date | The redesigned Plan page's units ([planner/redesign](../planner/redesign/README.md)) | Planner |
| `course_plan_shown` (`reasons`: the reason kinds shown, comma-joined; `guardrail`: which guardrail fired, or empty), `course_plan_added` (`reason`), `course_plan_dismissed` (`reason`) | as listed; never a course name, a grade, or a score | The course plan's Next year card ([chances/course-plan](../chances/course-plan.md)) | Planner |
| `estimate_shown` (`group`: reach / target / likely / none; `label`: reach-for-everyone / guaranteed / none; `model_version`) | as listed; never a GPA, a score, a rank, a course, a state, or a major | Quad's estimate where a student sees it: the college profile's "Where you stand" card and the planner's row drawer, once per college per view ([chances/estimate](../chances/estimate.md#protecting-the-method)) | Whether estimates are seen, which groups come out, and which model version served them |
| `plan_task_ticked` | `kind` (the task kind), `source`: college / cycle / stage / own, `assignee`: student / guardian / either | `TaskRow` after a tick succeeds | Planner |
| `plan_stage_done`, `plan_nudge_sent` (`channel`), `plan_rounds_accepted` (`ed`, `ed2`: bool), `plan_offer_added`, `plan_choice_made` (`unit_id`) | as listed | The stage units, when built | Planner |
| `plan_text_consented` (server, `by_guardian`: bool), `plan_text_opted_out` (server, `via`: stop / account) | as listed | The text consent flow and the STOP webhook ([planner/timeline.md](../planner/timeline.md#texts)) | Planner |
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
- Separate PostHog projects for **dev** and **production**; the key comes from `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and
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
Done once by hand; nothing here runs in CI. Until step 2 is done the site sends nothing (no key means every call is a
no-op), so it's safe to merge first.

### 1. PostHog projects
1. Sign up at `https://us.posthog.com` (US cloud) and create one organization. Create **two projects**: `quad-dev`
   (local work and Vercel previews) and `quad-prod`. Each has its own project API key.
2. In **each** project, Settings → Project (and the sections named below):
   1. **Session replay**: off (Replay → Settings → "Record user sessions" off). Minors use the site; replay stays
      off for good.
   2. **Surveys**: off (Surveys → Settings → disable).
   3. **Autocapture**: off (Settings → Project → Autocapture: turn off "Enable autocapture", "Capture clicks and
      taps", and "Capture rageclicks"). The code also sets `autocapture: false`; this is the second lock.
   4. **Discard client IP data**: on (Settings → Project → IP data capture configuration). PostHog still derives
      country and region from the IP, then drops it.
   5. **Data retention**: 12 months (Settings → Project → Data retention, if the plan offers a choice; on the free
      plan the retention may be fixed, in which case write the actual period into `/privacy` before launch,
      since the page promises 12 months).
   6. **Group analytics**: leave off (nothing sends groups).
   7. **Cookieless / persistence**: nothing to set; the client uses `persistence: "memory"`.
3. Copy each project's **Project API key** (Settings → Project → Project API key, starts `phc_`).

### 2. Environment variables
| Where | `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | `NEXT_PUBLIC_POSTHOG_HOST` |
|---|---|---|
| `.env.local` (each developer; copied into worktrees by `.worktreeinclude`) | dev key (optional: leave unset to send nothing) | `https://us.i.posthog.com` |
| Vercel → Settings → Environment Variables → **Preview** | dev key | `https://us.i.posthog.com` |
| Vercel → same page → **Production** | prod key | `https://us.i.posthog.com` |
The host line is optional (it's the default); set it only if the project is on another region (the EU host is
`https://eu.i.posthog.com`). Both are read at build time for the `/ingest` rewrites, so **redeploy** after changing
either. Never put the key in `data/*.json` or the repo.

### 3. Vercel Speed Insights
Vercel project → **Speed Insights** tab → Enable. The `<SpeedInsights />` component in `app/layout.tsx` starts
reporting on the next production deployment; data appears after a few visits. Its free allowance depends on the Vercel plan; the tab shows
the current limit.

### 4. Build the dashboards
In PostHog, create one **dashboard** per Reports heading below, and add each **insight** as listed (New insight → the
type named → set the event, breakdown, and filter → Save → Add to dashboard). Common settings: date range "Last 30
days" unless stated; **filter out internal traffic** by adding the property filter `$host` is not `localhost` to
every insight (the dev project receives preview and local events; the prod project only gets the real site, so this
matters mostly in dev). "Unique users" counts a visitor per session while anonymous and an account once signed in.

**Traffic** (dashboard "Traffic")
1. *Visits* (Trends): event `$pageview`, math "Unique sessions", interval day.
2. *Visitors* (Trends): `$pageview`, math "Unique users", interval week.
3. *Top entry pages* (Trends, table): `$pageview`, math "Unique sessions", breakdown by the **session property**
   `$entry_pathname` (Breakdown → Session properties). PostHog's Web analytics tab shows the same as "Paths".
4. *Referrers* (Trends, table): `$pageview`, math "Unique sessions", breakdown `$referring_domain`.
5. *Countries* (Trends, world map or table): `$pageview`, "Unique sessions", breakdown `$geoip_country_code`.
   Signed-in users have no country by design, so this undercounts them.
6. *Devices* (Trends, pie): `$pageview`, "Unique sessions", breakdown `$device_type`.

**Engagement** (dashboard "Engagement")
1. *Colleges viewed per visit* (Trends): `school_viewed`, math "Total count" divided by `$pageview` "Unique
   sessions" (formula `A / B`), interval week.
2. *Blocks read* (Trends, table): `profile_block_viewed`, "Total count", breakdown `block`, filter `topic` equals
   the topic of interest, or breakdown by `topic` first.
3. *Compare rate* (Trends): formula `A / B` with A = `compare_changed` where `action` = `add` (unique sessions) and
   B = `school_viewed` (unique sessions).
4. *Search success* (Trends): `search_performed`, "Total count", breakdown `picked`; the share of `true` is the
   success rate. Second series breakdown `result_count` to see how often searches return `0`.
5. *Explore views* (Trends, bar): `explore_view_changed`, breakdown `view`.
6. *Score checker use* (Trends): `score_checked`, breakdown `in_range`.

**Funnels** (dashboard "Funnels")
1. *Search → profile → compare* (Funnel): steps `search_performed` (filter `picked` = true) → `school_viewed` →
   `compare_changed` (filter `action` = `add`); conversion window 1 day; "Unique sessions".
2. *Profile → list* (Funnel): `school_viewed` → the list-add event. That event (`list_item_added`) doesn't exist
   yet; add this insight when the feature ships (see the event table).
3. *Visit → sign-up* (Trends, not a funnel): anonymous visitors have no id that matches the server-side sign-up
   events, so a funnel would break after step one. Chart `signup_started` and `signup_completed` (both "Total count",
   interval week, breakdown `method`) beside *Visits* from the Traffic dashboard, and read completed ÷ started and
   started ÷ visits by hand.
4. *Sign-up → paid* (Funnel): `signup_completed` → `subscribe_completed`; added with
   [commercialization.md](commercialization.md).

**Retention** (dashboard "Retention")
1. *Weekly return rate by role* (Retention): cohortizing event `signup_completed`, returning event `$pageview`,
   period Week, breakdown `role_hint` (student / guardian / counselor / none). It works because `signup_completed` is
   sent with the account id as its distinct id, and signed-in page views are identified with the same id. It only
   covers accounts created since this build shipped; earlier accounts have no `signup_completed`.
2. *Signed-in return rate* (Retention): cohortizing and returning event `$pageview`, both filtered to the event
   property `$is_identified` = true (posthog-js sets it on every event after identify; if your PostHog version lacks
   it, use the cohort of people who did `signup_completed`); period Week.

**Content** (dashboard "Content")
1. *Most viewed colleges* (Trends, table): `school_viewed`, "Total count", breakdown `unit_id`, top 25 (map the id to a
   name in the monthly report from `data/schools.json`).
2. *How people reach a college* (Trends, stacked bar): `school_viewed`, breakdown `from`.
3. *Filters used* (Trends, table): `explore_filtered`, breakdown `filter`.
4. *Glossary terms* (Trends, table): `term_opened`, breakdown `term`.
5. *Citations read* (Trends, table): `citation_opened`, breakdown `field`.
6. *Topic pages opened from the overview* (Trends): `profile_card_opened`, breakdown `topic`, second breakdown
   `from`.
7. *Over-time groups* (Trends, table): `trend_group_opened`, breakdown `group`.
8. *Roadmap interest* (Trends, table): `roadmap_viewed`, breakdown `slug`.

**Performance** (no PostHog dashboard)
Vercel project → Speed Insights: view by Route, switch the device filter between Mobile and Desktop, and read LCP,
INP, CLS (the "Real Experience Score" is the headline). Copy the p75 values into the monthly report.

**Errors** (dashboard "Errors")
1. *Errors by page* (Trends, table): `error_shown`, "Total count", breakdown `route`, second breakdown `kind`.
2. *Errors over time* (Trends): `error_shown`, interval day, breakdown `kind`.
3. Outside PostHog: Vercel project → Logs, filter to level Error, for server-side failures that never reach a
   browser.

### 5. Check it works
1. Put the **dev** key in `.env.local` and run `DATA_SOURCE=json npm run dev -- -p 3000` (any free port).
2. Open the site in a browser **without** Do Not Track or Global Privacy Control and with no ad blocker. Visit the home
   page, search for a college and open it.
3. In PostHog (dev project) → Activity (live events), within about a minute you should see `$pageview` for each page and
   `school_viewed` with a `unit_id` and a `from`. Click an event and check its properties: only the fields in the event
   table above, with `$current_url` the only URL-like value.
4. Confirm there is **no `$autocapture`** event no matter how much you click, and **no person profiles** for the
   anonymous events (People → the list is empty until someone signs in; each event's distinct id is random).
5. Turn on Do Not Track (or open the site with Global Privacy Control, as Brave or Firefox with the setting on does)
   and reload: no new events, and no request to `/ingest/` in the browser's Network tab.
6. Sign in: the next events carry your account id as the distinct id, and `$geoip_country_code` is absent. Create a
   test account to see `signup_started` and, after confirming the email, `signup_completed`.
7. Stop the dev server. For production, repeat steps 3 and 4 against the prod project after the first deploy with its
   key.

## Files
- `lib/analytics.ts` (registry, `track()`, `identify()`, `resetIdentity()`, `markNextViewFrom()`,
  `installAnalyticsSink()`), `components/analytics/AnalyticsProvider.tsx` (client; init, page views, derived
  events, identify), `components/analytics/TrackedLink.tsx` (a `next/link` that tracks on click, for server
  components), `components/analytics/ErrorTracker.tsx`, `lib/analytics-server.ts` (`posthog-node`),
  `next.config.ts` rewrites for `/ingest`, `app/layout.tsx` (provider + `@vercel/speed-insights`), `app/error.tsx`,
  `app/global-error.tsx`, `app/privacy/page.tsx`, `tests/analytics.test.mts`, `data/reports/usage-template.md`.
- From the PostHog wizard install (#100, kept): `instrumentation.ts` (server-side log export to PostHog over
  OpenTelemetry, used by `app/api/revalidate/route.ts`), and the SDK's exception capture (`capture_exceptions`), now
  set in the provider's init. Its `instrumentation-client.ts` and inline `posthog.capture` calls were replaced by the
  provider and registry (decision 5).

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
5. (2026-10-08) The PostHog wizard's install (#100) reached main first, with the SDK defaults (cookie, autocapture) and
   five inline events. Reconciled in favor of this spec: one init, in the provider, with the privacy settings above; the
   wizard's events map to the registry (`search_performed`, `compare_changed`, `compare_viewed`, and a new
   `major_compared`); its exception capture and server log export stay; and the variable names it introduced
   (`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`) are the ones the code reads, since Vercel already
   has them.
