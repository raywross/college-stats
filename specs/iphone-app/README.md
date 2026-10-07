# iPhone App: Quad in Your Pocket

> Overview of the iPhone app specs (not a work item itself). Written 2026-10-06 from a reading of every built spec and
> the code behind it. Each spec below is a separate work item on the [roadmap](../roadmap.md).

## Why
The site already works well on a phone ([mobile.md](../mobile.md)): a tab bar, swipe rails, compact result rows, and
topic pages that fold their deep dives. What a phone browser can't give is what people expect from an app they
installed: it opens in under a second on the thing they looked at last, keeps working on a campus tour with one bar of
signal, signs in once with Face ID, puts a college's deadline on the lock screen, and shares a college with a tap.
Families in decision season use the site daily for a few months; that is exactly the use an app serves better than a
browser tab.

The ask is **every feature and function of the website**, not a subset. The site has about 60 routes: home, Explore
with four views, a profile overview plus six topic pages, a compare overview plus seven topic pages, the glossary, the
Data page, national trends with six studies, movers, conferences and states, high schools, roadmap, release notes,
sign-in, account and household, the student profile, saved lists, following and updates. The app gets all of them.

## The three specs
| Spec | What it covers | Complexity |
|---|---|---|
| [api.md](api.md) | The **app API**: JSON for every screen, computed by the same `lib/` code the pages use, with a citation on every value. Today almost everything the site shows exists only as HTML, so this comes first | Large |
| [app.md](app.md) | The **app itself**: native SwiftUI, how it talks to the API and to Supabase Auth, offline behavior, deep links, the design system carried over, accessibility, telemetry, App Store release, and the test plan | Extra large |
| [screens.md](screens.md) | The **screen-by-screen parity map**: every page and control of the site, what it becomes on iOS, and which API call feeds it, so nothing is dropped by accident | Large |

## Decisions in short
Each is argued in [app.md](app.md#decisions).
1. **Native SwiftUI**, not a web view and not React Native. Apple rejects apps that only wrap a site; a native app is
   the whole point of the ask.
2. **The app never computes a number.** Every figure, percentile, takeaway, standout, and citation comes from the
   server, which runs the same `lib/` functions the site does. The app renders, navigates, caches, and shares. That
   keeps the site's rule that every value traces to its source and year, with one implementation.
3. **Server-described screens.** The API returns each screen as a list of typed blocks (stat tiles, a funnel, a range
   bar, a trend line, a table…) from a fixed catalog the app knows how to draw. Content changes on the site reach the
   app without an App Store release; only a new block kind needs one.
4. **One API for the app, shared code with the pages.** `app/api/app/v1/*` returns typed screen documents from
   `getData()`; the developer API ([data-api.md](../product/data-api.md)) stays a separate, keyed product.
5. **Supabase Auth directly from the app** (Sign in with Apple, email and password, magic link), and **every user-data
   read and write through the app API** with the user's token, so the server-side rules the site already has (age
   gate, password rules, access logging, geocoding, deadlines) are not written twice.
6. **The same URLs.** Every site URL opens in the app as a universal link, and everything the app shares is a site
   URL, so a recipient without the app lands on the same page.

## Build order
```
api (read-only endpoints) ─► app shell + screens phase 1 (everything that works signed out)
api (user endpoints)      ─► screens phase 2 (sign-in, account, household, student profile, lists, following, updates)
                              ─► phase 3 (what only an app can do: widgets, Spotlight, Shortcuts, push for digests, iPad)
```
Phase 1 alone is shippable: it is the public site with nothing gated. Phase 2 reaches parity. Phase 3 is listed in
[app.md](app.md#beyond-parity) and is not part of the parity ask.

## Rules carried over from the site
- **Cite everything.** A value with no citation is a bug; the API test fails on it the way `tests/citation-guards.test.mts` does for the pages.
- **No hard-coded years.** Year labels come from the API, which takes them from lineage.
- **Public data stays free and signed out.** Signing in adds memory and tools, never access to a number ([commercialization.md](../product/commercialization.md#what-stays-free)).
- **Minors.** Same age gate (13 and older), no behavioral ads, no replay, no location beyond what the person types ([telemetry.md](../product/telemetry.md#privacy)). The App Store age rating follows from that.
- **User data lives only in Supabase**, behind the same row-level security.
