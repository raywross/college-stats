# iPhone App: Quad in Your Pocket

> Overview of the iPhone app specs (not a work item itself). Written 2026-10-06 from a reading of every built spec and
> the code behind it; **rewritten 2026-10-26** after the roadmap review, because the site had changed under it. Each spec
> below is a separate work item on the [roadmap](../roadmap.md).

## Why
The site already works well on a phone ([mobile.md](../mobile.md)): a tab bar, swipe rails, compact result rows, and
topic pages that fold their deep dives. What a phone browser can't give is what people expect from an app they
installed: it opens in under a second on the thing they looked at last, keeps working on a campus tour with one bar of
signal, signs in once with Face ID, puts a college's deadline on the lock screen, tells them the evening before a hard
deadline, and shares a college with a tap. Families in decision season use the site daily for a few months; that is
exactly the use an app serves better than a browser tab.

The ask is **every feature and function of the website**, not a subset.

## What changed since 2026-10-06
The first draft mapped about 60 routes: the explorer, profiles, compare, trends, the glossary, accounts, a student
profile, saved lists, and following. On 2026-10-26 the site has **86 page routes and 31 API routes**, and the center of
the product moved:
- **The plan** ([../planner/README.md](../planner/README.md), its [redesign](../planner/redesign/README.md),
  [Next steps](../planner/next-steps/README.md), [Plan v3](../planner/v3/README.md), and
  [Your record](../planner/record/README.md)): the student's list sorted by Quad's level, a season with three things to
  do now and a guide for each, a calendar with feeds and texts, offers side by side, and a parent's view that is the
  student's view word for word. This is the product's core and the reason an app exists; the first draft did not know it.
- **Quad's estimate** ([../chances/README.md](../chances/README.md)): five levels, a selectivity tier per college,
  computed on the server only. Good for the app: it never had to compute a number, and now the one it must not compute
  already lives behind an endpoint.
- **Visit events** ([../product/visit-events.md](../product/visit-events.md)): each college's tours, sessions, and
  rep visits, with nightly alert emails. The app's natural push notification.
- **The Data API and MCP server** ([../product/data-api.md](../product/data-api.md)): `lib/api/` already serializes the
  dataset with lineage for two clients. The app API becomes a second route family on it rather than a new library.
- **The admin console** ([../product/admin.md](../product/admin.md)): 17 routes for the owner and support, out of the
  app's scope.
- **The assistants** ([../product/assistants.md](../product/assistants.md)): Quad inside Claude, ChatGPT, and Gemini.
  An alternative pocket for the same data, which does not replace the plan but does change the question of how urgent
  a native app is ([open question](#open-questions)).

## The three specs
| Spec | What it covers | Complexity |
|---|---|---|
| [api.md](api.md) | The **app API**: JSON for every screen, computed by the same `lib/` code the pages use, with a citation on every value, built over the Data API's library; the planner's screens and actions are most of the signed-in surface | Large |
| [app.md](app.md) | The **app itself**: native SwiftUI, how it talks to the API and to Supabase Auth, offline behavior, deep links, push for alerts and deadlines, the design system carried over, accessibility, telemetry, in-app purchase, App Store release, and the test plan | Extra large |
| [screens.md](screens.md) | The **route-by-route parity map**: every page route of the site, the spec that describes it, its phase, and the API call that feeds it, with a check that a new route must be added in the same change | Large |

## Decisions in short
Each is argued in [app.md](app.md#decisions). Unchanged from 2026-10-06, re-checked 2026-10-26.
1. **Native SwiftUI**, not a web view and not React Native.
2. **The app never computes a number.** Every figure, level, tier, takeaway, move, and citation comes from the server.
3. **Server-described screens.** Blocks from a fixed catalog; content changes reach the app without a release.
4. **One library for the app API and the Data API**, two route families; the developer API stays keyed and separate.
5. **Supabase Auth directly from the app**, every user-data read and write through the app API with the user's token.
6. **The same URLs.** Every site URL opens in the app as a universal link; everything the app shares is a site URL.

## Build order
```
api (public endpoints) ─► app shell + screens phase 1 (everything that works signed out)
api (user endpoints)    ─► screens phase 2 (sign-in, account, household, the record, the plan with its guides,
                            calendar, offers, visit events, following, API keys)
                           ─► phase 3 (what only an app can do: push for alerts and deadlines, widgets, Spotlight,
                               Shortcuts, iPad)
```
Phase 1 alone is shippable: it is the public site with nothing gated. Phase 2 reaches parity; the plan is its bulk.

## Rules carried over from the site
- **Cite everything.** A value with no citation is a bug; the API test fails on it as `tests/citation-guards.test.mts` does.
- **No hard-coded years.** Year labels come from the API, which takes them from lineage.
- **Public data stays free and signed out.** Signing in adds memory and tools, never access to a number
  ([commercialization.md](../product/commercialization.md#what-stays-free)); the advisor gates the app exactly as the site.
- **The method stays on the server** ([chances/README.md](../chances/README.md#quads-estimate-is-proprietary)).
- **Minors.** Same age gate (13 and older), no behavioral ads, no replay, no location beyond what the person types.
- **User data lives only in Supabase**, behind the same row-level security.

## Open questions
- **Does the ask still stand as written?** With the assistants built, a family can already ask Claude or ChatGPT about
  Quad's colleges from a phone. What the assistants cannot do is the plan: the list, the season, the guides, the
  calendar, the alerts. If the app is built, phase 2 is the point and phase 1 is its prerequisite; if the owner wants a
  smaller first step, a phase-2-only app that opens the public pages on the web is not an option under Apple's review
  rules, so the choice is the whole thing or none. The owner decides before any build.
- **In-app purchase.** Apple takes its commission on digital subscriptions sold in the app
  ([commercialization.md](../product/commercialization.md#billing)); decided with the app.
