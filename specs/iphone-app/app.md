# The iPhone App

> Status: **planned** (2026-10-06; **rewritten** 2026-10-26 after the roadmap review). Second of the three iPhone app specs
> ([overview](README.md)). Needs the app API ([api.md](api.md)); its screens are mapped route by route in
> [screens.md](screens.md). Target: iOS 17 and later, iPhone first, iPad as a layout variant. What changed in the
> rewrite: the tab bar follows the site's (Plan in the middle), the plan is phase 2's bulk, push notifications carry the
> visit alerts and deadline texts the site already sends, in-app purchase is decided with
> [commercialization.md](../product/commercialization.md), and the signed-out plan stays on the web.

## Goal
A native iPhone app with every feature and function of the website, that feels like the site (same brand, same words,
same charts, same levels, same citations) and like an iPhone app (tab bar, native navigation, Face ID sign-in, share
sheet, offline reading, push, Dynamic Type, VoiceOver), and that stays in step with the site without an App Store
release for every content change.

## Research (2026-10-06, re-checked 2026-10-26)
- **App Review.** Guideline 4.2 (minimum functionality) rejects apps that are "simply a web site bundled as an app"; a
  `WKWebView` wrapper of the site is the one approach that risks rejection outright. Guideline 4.8 requires Sign in
  with Apple whenever a third-party login such as Google is offered; email and password alone does not trigger it, but
  Google sign-in is on the site's backlog, so the app offers Apple from the start. Guideline 5.1.1(v) requires in-app
  account deletion; the site has it. Guideline 3.1.1: a digital subscription sold inside the app must use in-app
  purchase ([below](#in-app-purchase)). Privacy labels and a privacy manifest are required; with cookieless PostHog and
  no ad SDK the labels are "Data Not Linked to You: Usage Data" plus the account fields for signed-in users.
- **Age rating.** Educational data; the account is 13+. Rating 4+ with the sign-up age gate.
- **Frameworks.** SwiftUI with the Observation framework, Swift Charts for the chart blocks (a few dozen lines of
  `Canvas` each for the waffle, ring, tile map, dot map, and radar), SwiftData for the offline cache and the compare
  list, `supabase-swift` for auth (Sign in with Apple, PKCE, token refresh), `swift-openapi-generator` for the models,
  `UserNotifications` and APNs for push. No third-party UI dependencies.
- **Comparable apps.** Niche, BigFuture, Common App, and Scoir ship native tab-bar apps with server-driven content and
  native account features; none shows citations or a level with its inputs listed, which stays Quad's difference.

## Decisions
### Which kind of app
Scored the way the profile and compare redesigns were (1–5, higher is better):

| | Web view wrapper | React Native, sharing `lib/` | **Native SwiftUI, server-described screens** |
|---|---|---|---|
| Passes App Review as a real app | 1 | 5 | 5 |
| Native feel | 2 | 3 | 5 |
| Parity cost | 5: it *is* the site | 2: every page and chart is rewritten anyway, since the pages are server components and the charts are DOM SVG | 2: rewritten in Swift, but as ~50 block renderers, not ~90 pages |
| Numbers, levels, and citations identical to the site | 5 | 4 | 5: the server computes them; the app never does |
| Keeping up with site changes without a release | 5 | 2 | 4: content rides the API; a new block kind needs a release |
| Offline, widgets, push, Shortcuts | 1 | 3 | 5 |
| Team fit (one TypeScript codebase today) | 4 | 4 | 2 |
| **Total** | 23 | 23 | **28** |

The wrapper fails the one criterion that cannot be traded (review); React Native's apparent sharing is small once you
notice the pages and charts are server components and DOM SVG. Native SwiftUI wins when paired with the rule that the
shared logic lives where it already does: the server.

### The app never computes a number
Every figure, percentile, level, tier, takeaway, move, deadline, distance, and citation arrives in the API document. The
app formats nothing but dates in the person's locale and the chrome. This is the site's lineage rule applied to a
second client, and it is also how Quad's estimate stays proprietary: the method never leaves the server
([chances/README.md](../chances/README.md#quads-estimate-is-proprietary)).

### Server-described screens
A screen is a list of blocks from the catalog in [api.md](api.md#shapes). The app has one SwiftUI view per block kind
and a generic `ScreenView` that stacks them. A new section on a profile page appears in the app with no release; an
unknown kind renders a card with an "Open on the web" link. The app's own screens (tabs, Settings, sign-in forms, the
record's forms, the ED sheet, the Calendar tab's controls) are native, built from the typed definitions the blocks
carry, because they need gestures and state the block model does not.

### Supabase Auth in the app, everything else through the API
The app uses the Supabase client only for the auth session (Sign in with Apple, token refresh, the Keychain) and sends
its access token to the app API for every read and write of user data, so the server-side rules (age gate, password
rules, access logging, entitlements, geocoding, deadline resolution) run once, in `lib/`, for both clients.

### Same URLs
The app registers `applinks:` for `usequad.app`. Every site URL opens the matching screen; every share from the app is a
site URL. One route table (`Routes.swift`, generated from [screens.md](screens.md)) maps a path and query string to a
screen and its API call.

## Architecture
```
ios/
├── Quad.xcodeproj, Quad/ (app target), QuadWidgets/ (phase 3), QuadTests/, QuadUITests/
├── Packages/
│   ├── QuadAPI/        generated models (swift-openapi-generator from public/api/app/v1/openapi.json) + client, ETag cache
│   ├── QuadDesign/     tokens (colors, type, spacing, motion), Crest, Logo, chips, pills, meters, InfoTip sheet
│   ├── QuadBlocks/     one view per block kind; ScreenView; Swift Charts wrappers; Canvas charts
│   ├── QuadStore/      SwiftData: cached documents by URL + dataset date, the compare list, recents, the offline index
│   └── QuadFeatures/   Explore, Search, Plan (tabs, guides, record), Compare, More, Profile, Trends, Data, Docs,
│                       HighSchools, Account, Household, Visits, Following
```
- **State:** `@Observable` stores per feature; the compare list, theme, and recents in `QuadStore`; sessions in the
  Keychain via `supabase-swift`. No global state library.
- **Networking:** `URLSession` with `If-None-Match`; one `APIClient` that returns `(document, retrieved, fromCache)`.
  A screen and its filter panel load in parallel; a block's `Action` is posted through the same client.
- **Rendering:** `ScreenView(document)` → `ForEach(blocks) { BlockView($0) }`. Values render through `ValueText`, which
  shows `display` and attaches the citation sheet.
- **Charts:** Swift Charts for the series and bar kinds; `Canvas` for ring, waffle, radar, tile map, dot map (the server
  sends projected paths). Hover becomes tap (value card) and drag (crosshair).

## Navigation and deep links
- **Tab bar:** Explore · Search · **Plan** · Compare · More, the site's `BottomNav` exactly, with the Plan tab's dot
  (a deadline soon or a new move) and the compare count badge. Home is the Explore tab's root (the logo's destination on
  the site). More holds Account or Sign in, National trends, High schools, Glossary, Data, Roadmap, Release notes,
  Connect, Developers, Appearance, and About.
- **Stacks:** each tab is a `NavigationStack`; a college opened from any tab pushes within that tab. Topic pages are
  pushed screens with a segmented topic bar; swipe moves between topics. The plan's four tabs (Next steps, Colleges,
  Calendar, Offers) are a segmented bar under the Plan tab's title; a guardian's child switcher is in its toolbar.
- **Universal links:** `/`, `/explore`, `/schools/{id}[/{topic}|/events]`, `/compare[/{topic}]`, `/glossary#key`,
  `/trends/**`, `/data`, `/developers`, `/connect`, `/privacy`, `/roadmap/**`, `/release-notes/**`,
  `/high-schools/**`, `/login`, `/auth/confirm`, `/account/**`, `/household/**`, `/me/**`, `/plan/**`,
  `/invite/{token}`, `/l/{token}`. Auth links complete the session in the app via `supabase-swift`. `/unsubscribe/{token}`
  and `/api/plan/interest/confirm` open the site (one-click email actions). `/admin/**` opens Safari.
- **Share:** the share sheet offers the site URL with a title, and for a college a rich preview (name, city, crest).
- **Custom scheme** `quad://` for Shortcuts and widgets (phase 3), mapped to the same route table.

## Offline and caching
- **Documents** are cached by URL with the dataset date and `ETag` (SwiftData). A cached screen shows at once with a
  thin "Updated {relative time}" line when it is more than a day old; a fetch runs behind it and swaps the content in
  without moving what the person is reading.
- **The offline index** (the site's search index, ~100 KB gzipped) downloads on first launch and refreshes when the
  dataset date changes. Search works offline by name prefix; online, search goes to the server for alias matching.
- **Brand marks** (`/brand/{id}.webp`) are cached by `URLCache`, 50 MB cap.
- Nothing bulk-downloads the dataset or history. "Save for offline" on a college fetches its overview, topics, and
  history in one tap (phase 2); the plan's last-loaded tabs are kept so the list and calendar read on a campus tour.
- **Writes while offline are not queued**; the control is disabled with the reason. The plan is a shared household
  object and a conflict later is worse than a disabled button now.

## Accounts and the household
- **Methods:** Sign in with Apple (new), email and password, magic link, password reset: the site's four modes plus
  Apple. Apple sign-in creates the same Supabase user as the web.
- **Sign-up** asks the birth year and role as the site does; `POST /auth/precheck` applies the age gate and password
  rules; the database enforces them again. Under 13 is refused with the site's text, remembered for a day.
- **Sessions** live in the Keychain; Face ID or Touch ID is offered to unlock the signed-in state (an app-level lock).
- **Email links** (confirmation, magic link, reset, invitation) open the app through universal links and finish there.
- **Account, household, the record:** every operation the site has, each through its API route ([screens.md](screens.md)).
  The record's steps are native forms built from `record-step` blocks (the chip lists for majors, courses, activities
  come from the server). Export saves the JSON through the Files picker or share sheet. Delete requires typing "delete",
  as on the site, two taps from Account.
- **Guardians** see the student's plan word for word, as on the site ([planner/v3/parents.md](../planner/v3/parents.md)),
  with the child switcher; the app sends the chosen child as a header and the server logs the read as today.

## Push notifications (phase 3, designed now)
The site already sends three things families wait for: the nightly **visit alert** when a college on the plan adds an
event near home ([visit-events.md](../product/visit-events.md)), the **"your week"** reminder email, and the **text the
evening before a hard deadline** ([planner/timeline.md](../planner/timeline.md)). Each becomes an opt-in push from the
same cron routes through APNs, with the email or text staying the default; a push carries the title and a deep link,
never a number, a name beyond the college's, or a note (the built rule for texts). Opting in happens in the app's
Settings and is recorded like the text consent. The digest email stays email.

## In-app purchase
Apple takes its commission on a digital subscription sold inside the app, and the rules forbid steering to a cheaper
web price from within it. Options, decided with [commercialization.md](../product/commercialization.md#billing) when
tiers exist: (a) sell Plus and Pro through StoreKit with the same products, Apple's receipt written to the same
`subscriptions` table by a server webhook; (b) sell nothing in the app, show the tier a person has, and let the site
sell. (b) is simpler and legal; (a) is where the money is for an app-first family. Recommendation: (b) at launch, (a)
once the site's subscriptions prove out.

## Design system on iOS
- **Type:** Bricolage Grotesque (OFL, bundled) for display and headings, SF for body and UI; tabular figures in aligned
  columns. Everything scales with Dynamic Type; charts enlarge labels and drop secondary ones at the two largest sizes.
- **Color:** the site's tokens (`app/globals.css`) become an asset catalog with light and dark variants, generated by a
  script so they cannot diverge: background, foreground, card, primary, pop, coral, the six domain colors, the level
  colors (`GROUP_CLASS`), the round colors and shapes, slots, sequential and diverging, status. System appearance by
  default, with Light / Dark / System in Settings.
- **Shape and spacing:** 14 pt radius cards, pill chips, the site's phone spacing in points.
- **Motion:** the site's rise, grow, and pop-in as SwiftUI transitions; off under Reduce Motion.
- **Crests:** the site's three looks, with gradient and tint supplied by the API, so the app does no color math and the
  marks' legal rules hold ([brand.md](../school-identity/brand.md)).
- **Haptics:** a light tap on adding to the plan or compare, a success notch on Done.

## Accessibility
- VoiceOver labels on every value: "{label}, {display}, {year}" from the `Value` and its citation; charts expose an
  audio graph and a "View as table" action.
- The citation sheet is a button, not a hover; a level pill reads its level and label.
- Minimum 44 pt hit targets. Color never carries meaning alone: levels keep their words, rounds keep their shapes.

## Telemetry
PostHog's iOS SDK with the site's typed event registry ([telemetry.md](../product/telemetry.md)), the same denied
property patterns, no session replay, no autocapture, anonymous id per install reset on sign-out, country-level geo only.
Events gain `platform: ios`. No App Tracking Transparency prompt: nothing is tracked across apps.

## iPad
The same app with the site's tablet rules: a sidebar replaces the tab bar in regular width; the profile's topic bar and
"On this page" sit beside the content; the plan's tabs become a sidebar section. A layout variant, not a second design.

## Beyond parity
Not part of the ask; listed so phase 3 has a shape.
- **Push** as above. **Widgets:** the next deadline on the plan; a followed college's "what changed"; the next tour near
  home. **Spotlight** for recent colleges; **Shortcuts** ("Compare Michigan and Ohio State"); **Live Activities** for a
  decision day.

## Release
- Bundle id, App Store Connect record, TestFlight for the owner and a few families before each phase.
- Listing copy from the site's tagline and the Data page; screenshots generated by a UI test so they update with the app.
- Privacy labels and manifest as above; age rating 4+; the account deletion URL points to `/account/delete`; the privacy
  policy URL to `/privacy`.
- Each app release adds a release note of kind `feature` or `improvement`; About links to `/release-notes`.
- Minimum iOS 17; the API returns `426` when an app is too old to render the current catalog.

## Phases
| Phase | Delivers | Done when |
|---|---|---|
| 0 | [api.md](api.md) public endpoints, the OpenAPI document, the `ios/` project with `QuadAPI`, `QuadDesign`, `QuadBlocks` | Every block kind renders a fixture; parity tests pass |
| 1 | Everything that works signed out ([screens.md "Public pages"](screens.md#public-pages-phase-1)): Explore with every filter and the four views, Search, profiles and their topics and history, Compare, Glossary, Trends, Data, Developers, Connect, Privacy, Roadmap, Release notes, High schools, shared-list and invitation previews, Appearance, About, universal links, share | The phase-1 rows all checked; TestFlight build |
| 2 | Accounts and the plan: Sign in with Apple and the site's modes; Account, password, export, delete, restore; household and invitations; home address; the record and its tour; **the plan's four tabs and every guide**; the ED sheet; offers; calendar feeds and texts consent; visit events and alert settings; Following and Updates; API keys; Save for offline | The phase-2 rows all checked; the test plan's user flows pass; App Store release |
| 3 | Push, widgets, Spotlight, Shortcuts, iPad polish, in-app purchase if chosen | Each its own release note |

## Tests
- **Server:** the API tests in [api.md](api.md#tests) are the parity guarantee; they run in `npm run verify`.
- **Unit (XCTest):** every block kind against fixtures exported by the server tests; route table round trips (URL →
  screen → URL, including the plan's tabs and guides); cache invalidation on a dataset-date change; offline search.
- **Snapshot:** each block kind in light and dark at three Dynamic Type sizes; the home, a profile overview, and the
  plan's Colleges tab at iPhone and iPad sizes.
- **UI (XCUITest):** tab navigation; Explore filter → results → profile → compare → table; sign-up with the age gate
  refusal; add a college to the plan, open the ED sheet, mark a move done, open a guide, record a visit; a guardian's
  switch between children; delete account preview.
- **Accessibility audit:** `performAccessibilityAudit()` on every screen in the UI tests.
- **CI:** a macOS job in `.github/workflows/verify.yml` runs `xcodebuild test` on every PR touching `ios/` or
  `lib/api/app/`; the OpenAPI snapshot test ties the two sides together.

## Files (planned)
- `ios/**` as in [Architecture](#architecture); `ios/README.md` with setup
- `scripts/build-ios-tokens.mts`: `app/globals.css` tokens → `ios/Packages/QuadDesign/Colors.xcassets`
- `.github/workflows/verify.yml`: the macOS job
- `specs/iphone-app/*.md` gain "Built" sections per phase; `specs/mobile.md` gets a line pointing here for native

## Open questions
- **Fonts.** Bundle Geist as well as Bricolage for an exact match, or accept SF for body text. Proposal: SF.
- **The signed-out plan.** Kept on the web only (above). If families expect to try the plan before signing up in the
  app, phase 2 adds it as a device-local plan that imports on sign-in, as the site's `ImportLocalPlan` does.
- **Android.** Nothing here is iOS-only on the server side; the API and block catalog serve a Kotlin app later.
