# The iPhone App

> Status: **planned** (2026-10-06). Second of the three iPhone app specs ([overview](README.md)). Needs the app API
> ([api.md](api.md)); its screens are mapped one by one in [screens.md](screens.md). Target: iOS 17 and later, iPhone
> first, iPad as a layout variant.

## Goal
A native iPhone app with every feature and function of the website, that feels like the site (same brand, same
words, same charts, same citations) and like an iPhone app (tab bar, native navigation, Face ID sign-in, share sheet,
offline reading, Dynamic Type, VoiceOver), and that stays in step with the site without an App Store release for
every content change.

## Research (2026-10-06)
- **App Review.** Guideline 4.2 (minimum functionality) rejects apps that are "simply a web site bundled as an app";
  a `WKWebView` wrapper of the site is the one approach that risks rejection outright. Guideline 4.8 requires Sign in
  with Apple (or an equivalent privacy-preserving login) whenever a third-party login such as Google is offered; email
  and password alone does not trigger it, but Google sign-in is on the site's backlog, so the app offers Apple from the
  start. Guideline 5.1.1(v) requires in-app account deletion for any app with account creation; the site has it.
  Privacy "nutrition labels" and a privacy manifest (`PrivacyInfo.xcprivacy`) are required; with cookieless PostHog
  and no ad SDK the labels are "Data Not Linked to You: Usage Data" plus the account fields for signed-in users.
- **Age rating.** The content is educational data; the account is 13+. Rating 4+ with the sign-up age gate, as Niche
  and BigFuture do; the age gate is the site's, not a parental gate.
- **Frameworks.** SwiftUI with the Observation framework for state, Swift Charts for line, bar, area, scatter, range,
  and rule marks (everything in the site's catalog but the waffle, ring, tile map, dot map, and radar, which are a
  few dozen lines of `Canvas` or `Path` each), SwiftData for the offline cache and the compare list, `supabase-swift`
  for auth (it supports Sign in with Apple natively, PKCE, and token refresh), `swift-openapi-generator` for the
  models. No third-party UI dependencies.
- **Comparable apps.** Niche, BigFuture (College Board), Common App, and Scoir ship native tab-bar apps with
  server-driven content and native account features; none shows citations, which stays Quad's difference.
- **Cross-platform options considered** in [Decisions](#decisions).

## Decisions
### Which kind of app
Scored the way the profile and compare redesigns were (1–5, higher is better):

| | Web view wrapper (Capacitor / WKWebView) | React Native (Expo), sharing `lib/` | **Native SwiftUI, server-described screens** |
|---|---|---|---|
| Passes App Review as a real app | 1 | 5 | 5 |
| Native feel (navigation, gestures, type, accessibility) | 2 | 3 | 5 |
| Parity cost (every site feature) | 5: it *is* the site | 2: every page and chart is rewritten in RN anyway, since the pages are Next server components and the charts are DOM SVG | 2: rewritten in Swift, but as ~40 block renderers, not ~60 pages |
| Keeping numbers and citations identical to the site | 5 | 4: shares `lib/metrics`, `lib/lineage` as TypeScript | 5: the server computes them; the app never does |
| Keeping up with site changes without a release | 5 | 2 | 4: content changes ride the API; a new block kind needs a release |
| Offline, widgets, Shortcuts, Spotlight, push | 1 | 3 | 5 |
| Team fit (one TypeScript codebase today) | 4 | 4 | 2: a Swift codebase and an Xcode toolchain |
| **Total** | 23 | 23 | **28** |

The wrapper fails the one criterion that cannot be traded (review), and React Native's apparent sharing is small
once you notice the site's pages and charts are server components and DOM SVG that it cannot reuse. Native SwiftUI
wins when paired with the rule that moves the shared logic to where it already lives: the server.

### The app never computes a number
Every figure, percentile, tier, takeaway, standout, "1 in N", distance, deadline, and citation arrives in the API
document. The app formats nothing but dates in the person's locale and the chrome. This is the site's lineage rule
([data-lineage.md](../data-lineage.md)) applied to a second client: one implementation, one place to fix. It also
means a college whose data changes shows the change in both clients at the same moment.

### Server-described screens
A screen is a list of blocks from the catalog in [api.md](api.md#shapes). The app has one SwiftUI view per block
kind and a generic `ScreenView` that stacks them with the site's spacing. Consequences:
- A new section on a profile page (say, a new CDS table) appears in the app with no release.
- An unknown kind renders a card with the block's title and an "Open on the web" link, never a crash.
- The app's own screens (tabs, Settings, sign-in forms, the list board's editing controls) are native and not
  server-described, because they need gestures and state the block model does not carry.

### Supabase Auth in the app, everything else through the API
The site's rule is that the browser never talks to Supabase ([supabase.md](../supabase.md#keys)). The app keeps the
spirit: it uses the Supabase client only for the auth session (so Sign in with Apple, token refresh, and the Keychain
work natively) and sends its access token to the app API for every read and write of user data. The server-side
rules the site has (age gate, password rules, access logging, geocoding, CSV matching, deadline resolution) run once,
in `lib/`, for both clients ([api.md](api.md#refactor-server-actions-into-lib-functions)).

### Same URLs
The app registers `applinks:` for the site's domain. Every site URL opens the matching screen; every share from the
app is a site URL. One route table (`Routes.swift`, generated from the same list `screens.md` keeps) maps a path and
query string to a screen and its API call, which is the same path under `/api/app/v1`.

## Architecture
```
ios/
├── Quad.xcodeproj, Quad/ (app target), QuadWidgets/ (phase 3), QuadTests/, QuadUITests/
├── Packages/
│   ├── QuadAPI/        generated models (swift-openapi-generator from public/api/app/v1/openapi.json) + client, ETag cache
│   ├── QuadDesign/     tokens (colors, type, spacing, motion), Crest, Logo, chips, meters, InfoTip sheet
│   ├── QuadBlocks/     one view per block kind; ScreenView; Swift Charts wrappers; Canvas charts (ring, waffle, maps, radar)
│   ├── QuadStore/      SwiftData: cached documents by URL + publish id, the compare list, recents, the offline index
│   └── QuadFeatures/   Home, Explore, Search, Compare, More, Profile, Trends, Data, Docs, HighSchools, Account, Me, Lists, Following
```
- **State:** `@Observable` stores per feature; the compare list, theme, and recents in `QuadStore`; sessions in the
  Keychain via `supabase-swift`. No global state library.
- **Networking:** `URLSession` with `If-None-Match`; one `APIClient` that returns `(document, publish, fromCache)`.
  Requests for a screen and its filter panel run in parallel.
- **Rendering:** `ScreenView(document)` → `ForEach(blocks) { BlockView($0) }`. Values render through `ValueText`,
  which shows `display` and attaches the citation sheet.
- **Charts:** Swift Charts for `trend-line`, `stacked-area`, `dumbbell`, `slope`, `dot-plot`, `dot-range`, `scatter`,
  `distribution`, `histogram`, `grouped-bars`, `columns`, `class-trend`, `range-bar`, `benchmark-bar`. `Canvas` for
  `ring`, `waffle`, `radar`, `tile-map`, `dot-map` (the server sends projected paths, so the app draws, never projects).
  Hover becomes tap (shows the value card) and drag (crosshair) with a pinned state; the site's "tap to pin" already
  exists for touch.

## Navigation and deep links
- **Tab bar:** Home · Explore · Search · Compare · More, the site's `BottomNav` exactly, with the compare count badge.
  More holds Account (or Sign in), National trends, High schools, Glossary, Data, Roadmap, Release notes, Appearance,
  and About (build, publish id, the footer's "About the data").
- **Stacks:** each tab is a `NavigationStack`; a college opened from any tab pushes within that tab. Topic pages are
  pushed screens with a segmented topic bar (the site's pill row) under the title, and swipe left/right moves between
  topics, as the site's previous/next links do.
- **Universal links:** `/`, `/explore`, `/schools/{id}[/{topic}]`, `/compare[/{topic}]`, `/glossary#key`,
  `/trends/**`, `/data`, `/roadmap/**`, `/release-notes/**`, `/high-schools/**`, `/login`, `/auth/confirm`,
  `/account/**`, `/me/**`, `/invite/{token}`, `/l/{token}`. Auth links (`/auth/confirm` with tokens in the fragment,
  `/auth/callback?code=`) complete the session in the app via `supabase-swift`; the site keeps working for people
  without the app. `/unsubscribe/{token}` opens the site, since it is a one-click email action.
- **Share:** the share sheet offers the site URL with a title, and for a college a rich preview (name, city, crest).
- **Custom scheme** `quad://` for Shortcuts and widgets (phase 3), mapped to the same route table.

## Offline and caching
- **Documents** are cached by URL with their publish id and `ETag` (SwiftData). A cached screen shows at once with a
  thin "Updated {relative time}" line when it is more than a day old; a fetch runs behind it and swaps the content
  in without moving what the person is reading (the site's rule against layout shift).
- **The offline index** (`/schools/index`, ~300 KB) downloads on first launch and refreshes when the publish id
  changes. Search works offline over it by name prefix only; online, search goes to the server for alias matching
  ("UGA"), and results say when they came from the device.
- **Brand marks** (`/brand/{id}.webp`, 192 px) are cached by `URLCache`, 50 MB cap.
- Nothing bulk-downloads the dataset (16.7 MB) or history (26 MB): a reader's real need is "what I looked at last",
  which the document cache covers. "Save for offline" on a college fetches its overview, six topics, and history
  group documents in one tap (phase 2).
- Writes while offline are not queued; the control is disabled with the reason. Lists are a shared household object
  and a conflict later is worse than a disabled button now.

## Accounts
- **Methods:** Sign in with Apple (new; the accounts spec planned it "when there is a native app"), email and
  password, magic link, password reset: the site's four `LoginForm` modes plus Apple. Apple sign-in creates the same
  Supabase user as the web; if the person later signs in on the web with the same email, it is one account.
- **Sign-up** asks the birth year and role hint as the site does; `POST /auth/precheck` applies the age gate and
  password rules with the site's messages; the database triggers enforce them again. Under 13 is refused with the
  site's text and the app remembers the refusal for a day, as the `quad_age_gate` cookie does.
- **Sessions** live in the Keychain; Face ID or Touch ID is offered to unlock the app's signed-in state after the
  first sign-in (an app-level lock, optional, not a Supabase feature).
- **Email links** (confirmation, magic link, reset, invitation) open the app through universal links and finish there.
- **Account page, password, export, delete, restore, household, invitations, home address:** every operation the site
  has, each through its API route ([screens.md](screens.md#account-and-household-phase-2)). Export saves the JSON through the
  Files picker or the share sheet. Delete requires typing "delete", as on the site, and is reachable from Account in
  two taps (guideline 5.1.1).
- **Guardians** see the same student picker and banner, and their reads are logged by the server as today.

## Design system on iOS
- **Type:** Bricolage Grotesque (OFL, bundled) for display and headings, the system font (SF) for body and UI
  instead of Geist, since SF is what Dynamic Type and iOS controls expect; tabular figures only in aligned columns,
  as the site does. All text scales with Dynamic Type up to the accessibility sizes; charts enlarge their labels and
  drop secondary ones at the two largest sizes.
- **Color:** the site's tokens (`app/globals.css`) become an asset catalog with light and dark variants, generated
  by a script from the CSS so they cannot diverge: background, foreground, card, primary (violet), pop (lime), coral,
  the six domain colors, slots `s1–s4`, `demo-1..7`, `seq`, `div`, status. The app follows the system appearance by
  default, with Light / Dark / System in Settings like the site's `ThemeSegmented`.
- **Shape and spacing:** 14 pt radius cards, pill chips, the site's phone spacing (`p-4` cards, `space-y-14`
  sections) in points.
- **Motion:** the site's rise, grow, and pop-in as SwiftUI transitions; off under Reduce Motion. No hover lift (no
  hover), no logo rotation.
- **Crests:** the site's three looks (mark on a white tile, monogram on the brand gradient, monogram on the hashed
  tint) with the gradient and tint supplied in `brand` by the API, so the app does no color math and the legal
  rules for marks ([brand.md](../school-identity/brand.md)) hold: tile size only, never in the app's own branding or
  icon, and a removed mark disappears at the next publish.
- **Haptics:** a light tap on adding to compare or a list, a success notch on sign-in. Nothing else.

## Accessibility
- VoiceOver labels on every value: "{label}, {display}, {year}" from the `Value` and its citation; charts expose their
  data as an audio graph (Swift Charts' `accessibilityChartDescriptor`) and a "View as table" action, mirroring the
  site's *Table* toggle on history charts.
- The citation sheet is a button, not a hover; InfoTips are buttons with "Learn more in the glossary".
- Minimum 44 pt hit targets; the site's `after:-inset-2.5` enlargement becomes real padding.
- Color never carries meaning alone: the status colors keep their icons, slot colors keep their labels, the
  tile and dot maps have a table alternative.

## Telemetry
PostHog's iOS SDK with the same typed event registry as the site ([telemetry.md](../product/telemetry.md)), the same
denied property patterns (`gpa`, `sat`, `act`, …), no session replay, no autocapture, anonymous id per install reset
on sign-out, country-level geo only. Events gain `platform: ios`. App Tracking Transparency is not needed because
nothing is tracked across apps; the privacy manifest declares no tracking domains.

## iPad
The same app with the site's tablet rules: a sidebar replaces the tab bar in regular width, the profile's topic bar
and "On this page" sit beside the content as on the desktop site, and compare's table gets the sticky header the site
shows from `lg`. Not a separate design; a layout variant of the block renderers.

## Beyond parity
Not part of the ask; listed so phase 3 has a shape and so phase 1 and 2 decisions do not block them.
- **Widgets:** next deadline on my list; a followed college's "what changed"; a college of the day.
- **Push** for the digest the site emails ([follow-colleges.md](../product/follow-colleges.md)), opt-in, same cadence,
  through APNs from the cron route; the email stays the default.
- **Spotlight** indexing of recent colleges; **Shortcuts** ("Compare Michigan and Ohio State"); **Live Activities**
  for a decision day on the list.

## Release
- Bundle id, App Store Connect record, TestFlight for the owner and a few families before each phase.
- Listing copy from the site's tagline and the Data page's "why" section; screenshots from the simulator at the
  required sizes, generated by a UI test so they update with the app.
- Privacy labels and manifest as above; age rating 4+; the account deletion URL in App Store Connect points to the
  site's `/account/delete`.
- The app's version follows the site's release notes: each app release adds a note of kind `feature` or
  `improvement` and the app's About screen links to `/release-notes`.
- Minimum iOS 17; the API returns `426` with a message when an app version is too old to render the current catalog.

## Phases
| Phase | Delivers | Done when |
|---|---|---|
| 0 | [api.md](api.md) public endpoints, OpenAPI document, the `ios/` project with `QuadAPI`, `QuadDesign`, `QuadBlocks` | Every block kind renders a fixture; parity tests pass |
| 1 | Everything that works signed out: Home, Explore (four views, every filter), Search, profile (overview, six topics, history), Compare (overview, seven topics, table), Glossary, Trends (hub, six studies, movers, conferences, states), Data, Roadmap, Release notes, High schools, Appearance, About, universal links, share | The [screens.md](screens.md) checklist for phase 1 is all checked; TestFlight build |
| 2 | Accounts: Sign in with Apple, email and password, magic link, reset; Account, password, export, delete, restore; household and invitations; home address; student profile; saved lists with every control, CSV, share links; Following, Updates, email toggle; fit chips; Save for offline | Checklist phase 2; parity of user flows with the site verified by the test plan below; App Store release |
| 3 | [Beyond parity](#beyond-parity) items the owner picks | Each its own release note |

## Tests
- **Server:** the API tests in [api.md](api.md#tests) are the parity guarantee; they run in `npm run verify`.
- **Unit (XCTest, in `QuadTests`):** every block kind against fixtures exported by the server tests
  (`tests/fixtures/app-api/*.json`), so a renderer is tested against real documents; route table round trips (URL →
  screen → URL); cache invalidation on a publish change; the offline search's prefix matching.
- **Snapshot:** each block kind in light and dark at three Dynamic Type sizes; the home and a profile overview at
  iPhone 15 and iPad sizes.
- **UI (XCUITest):** tab navigation; Explore filter → results → profile → compare → table; sign-up with the age gate
  refusal; add to list, change category, add a note, share, revoke; guardian view-only; delete account preview.
- **Accessibility audit:** `XCUIApplication.performAccessibilityAudit()` on every screen in the UI tests.
- **CI:** a macOS job in `.github/workflows/verify.yml` runs `xcodebuild test` for the packages on every PR that
  touches `ios/` or `lib/app-api/`; the OpenAPI snapshot test ties the two sides together.

## Files (planned)
- `ios/**` as in [Architecture](#architecture); `ios/README.md` with setup (Xcode version, `make generate` for the
  models and the color catalog)
- `scripts/build-ios-tokens.mts`: `app/globals.css` tokens → `ios/Packages/QuadDesign/Colors.xcassets`
- `.github/workflows/verify.yml`: the macOS job
- `specs/iphone-app/*.md` gain "Built" sections per phase; `specs/mobile.md` gets a line pointing here for native
- Release notes per phase

## Open questions
- **Domain.** Universal links need the final domain ([backlog](../backlog.md#platform), "Formal release"); the app
  can ship to TestFlight on the Vercel domain and switch the associated domain before the App Store release.
- **Fonts.** Bundle Geist as well as Bricolage for an exact match, or accept SF for body text. Proposal above: SF.
- **The developer API.** Whether `/api/app/v1` later becomes the keyed `/api/v1`'s "screens" tier, or stays private.
  Keep it private; it changes with the app.
- **Android.** Nothing here is iOS-only on the server side; the API and block catalog serve a Kotlin app later.
