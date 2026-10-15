<!-- Research archive (specs/product/visit-events-research/README.md). Source: a sonnet research agent, 2026-10-15; four colleges reproduced. Kept verbatim apart from
     local paths; the raw pages and responses it cites were working files outside the repository and were not kept,
     except the fixtures under tests/fixtures/visit-events/. Decisions it led to are in specs/product/visit-events.md. -->

# How Element451 publishes admissions events (research, 2026-10-15)

Read-only research. All fetches used `curl` with a browser-like User-Agent
(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36`),
one request a second per host, no forms submitted, no sign-in. Raw responses are saved under
`research/element451/` (see "Where things are" at the end). Everything below is observed from those saved
responses unless marked **[inference]**.

## 1. The protocol

### 1.1 Three things Element451 serves on a client's own domain or a `451.io` subdomain

Walking each college's visit page and following its `451.io`/`.edu` links turns up one of four client-app
bundles, told apart by the chunk-folder name in the `<script src>` tags:

| bundle folder | purpose (observed) | has an events listing? |
|---|---|---|
| `event451` | the public events site (the one we want) | **yes** |
| `shell` (`<client>.shell.451.io`) | a general Angular "shell" — usually the admissions chat/portal/apply shell | no events found on it |
| `page451` (`<client>-<id>.page451.sites.451.io`) | a CMS landing page builder | no |
| `app451` (`<client>.app451.sites.451.io` or `sites-cdn.451.io/app451/...`) | the applicant-portal app | no |

A form embed (`https://embed-forms.451.io/?formId=<client>.forms.<id>&apiUrl=https%3A%2F%2F<client>.api.451.io%2Fv2%2F&accessToken=...`)
is a fifth, separate surface: a single form widget, not an events feed. Its presence on a page does not imply an
events app exists.

### 1.2 The events app (`event451`) is server-rendered — the listing call is just the page itself

`event451` is an Angular-Universal app: a `GET` of its root page returns fully-rendered HTML **and** an embedded
JSON state blob, so no separate XHR/REST call is needed to read the listing:

```
<script id="event451-state" type="application/json">{ ...full state... }</script>
```

It appears twice per page (once for the server render, once for client hydration — identical content in every
fixture we pulled). The listing page is reachable three ways, all serving the identical app:

- `https://<client>.event451.sites.451.io/` — e.g. `https://cccb.event451.sites.451.io/`
- `https://<client-subdomain>-<numeric-id>.event451.sites.451.io/` — the subdomain token does not have to equal
  the client's own token (Georgia Gwinnett's site is `ggc-35205.event451.sites.451.io`, token `ggc`)
- a custom domain the college points at the app, e.g. `https://visit.cookman.edu/` (confirmed: same
  `event451-state` blob, title "Bethune-Cookman University | Events Home")

One event's own page is `https://<site-host>/event/<guid>`, e.g.
`https://cccb.event451.sites.451.io/event/cccb.events.212835`. It is the same kind of SSR page, with a
differently-shaped state blob (`singleEventStore`, see below) — and it doubles as the booking/registration page
(a registration form keyed by `form: "<client>.field.<id>"` is embedded on it).

No query parameters, date filters, or paging were found or needed in practice: every fixture we pulled had
`"limit": 30` and `"total"` ≤ 30 — i.e. the one request returns every event. **[inference]** a college with
more than 30 published events would need either a found `offset`/`page` query param (none was located — see
"what's missing" below) or the private REST API (`<client>.api.451.io/v2/...`, token-gated, not explored beyond
confirming it exists and returns Element451's generic marketing splash page at its bare root).

### 1.3 `app-config.js` — the client's own token and feature tokens

Every `event451` site also serves `assets/js/app-config.js`, a small non-minified JS file:

```js
(function () { window.appConfig = {"clientName":"Central Christian College of the Bible","hostname":"cccb.event451.sites.451.io","apiUrl":"https://cccb.api.451.io/","subdom":"cccb","apiUrlRT":"https://cccb.rt.451.io/","featureToken":"emNZqgywDiLJVLIvQDHYTPwnXrt9BHSDF3SMNNVI","analyticsToken":"AkFWSORShfpkSNmdglh31e4eDI3079xLuF41et2M","site":"cccb.sites.31150","type":"event451"}})();
```

This confirms the `<client>.api.451.io` convention from the brief, and gives `featureToken`/`analyticsToken` (no
`accessToken` here — that token only showed up in the **form-embed** widget, e.g. Chowan's
`accessToken=lSu9uBVjMv03OgRnWyxS90FuTR3BpaL0hyhfzxs1`, which is a per-form credential, not a per-site one). We
did not find the JS actually issuing a plain `GET <apiUrl>v2/...events` call: grepping the downloaded
`main-*.js`/`chunk-*.js` bundles (`sites-cdn.451.io/event451/...`, ~3.3MB total for one site) for `v2/` or
`.../events` literal paths turned up only unrelated admin-permission strings (`"edit-events"`,
`"publish-events"`, etc. — these are shared bundle code for Element451's CRM/admin product, not the public
site's own fetch calls). **[inference]** the public app likely fetches these tokens via a bundled, non-literal
URL built at runtime; since the SSR page already gives us the data without needing that call, we did not pursue
it further.

### 1.4 Response shape: the listing page's `eventsListStore`

```json
{
  "items": [ /* one entry per event, see below */ ],
  "total": 3, "offset": 0, "limit": 30,
  "loading": false, "loaded": true, "hasError": false
}
```

One item (Central Christian College of the Bible, `cccb.events.212835`, trimmed):

```json
{
  "guid": "cccb.events.212835",
  "role": "parent",
  "publishing_status": "published",
  "event_type": "campus_tours",
  "content": { "title": "Campus Visit", "description": "<p>...</p>", "image": {...} },
  "privacy": "public",
  "allday": false,
  "start_date": "2026-08-24T09:30:00-05:00",
  "end_date": "2026-12-18T15:00:00-06:00",
  "timezone": "America/Chicago",
  "occurrences": {
    "first": { "event_guid": "...", "element_guid": "cccb.event_elements.1858230",
      "is_closed": false, "is_full": true, "is_open": false,
      "start_date": "2026-10-19T14:30:00+00:00", "end_date": "2026-10-19T16:30:00+00:00",
      "timezone": "America/Chicago", "attendee_limit": 1, "registrant_limit": 1,
      "attendee_count": 1, "total_registrations": 1, "start_ts": 1792420200, "end_ts": 1792427400 },
    "next": { /* same shape, the next bookable slot */ },
    "upcoming": [ /* every future bookable slot, same shape */ ]
  },
  "contact": { "department": "Admissions Department", "email": "...", "first_name": "Tina", "last_name": "Defreitas", "phone": "6602633900", "title": "Campus Visits Coordinator" },
  "location": {
    "venue_name": null, "address": "911 East Urbandale Drive", "building": "Pelfrey Hall", "room": null,
    "city": "Moberly", "zip": "65270", "state": "MO", "country": "US", "utc_offset": null,
    "geo": { "longitude": -92.427..., "latitude": 39.396... }
  },
  "categories": ["admissions"],
  "registration_status": "open",
  "close_registration_on": "-2d",
  "attendee_limit": 1
}
```

**This is a template/occurrences model, not one row per bookable slot.** A `"parent"` item (e.g. "Campus Visit")
spans a long `start_date`–`end_date` window (months) and carries an `occurrences` list of the actual bookable
time slots (`element_guid`, its own `start_date`/`end_date`/`is_open`/`is_full`/`is_closed`/counts). The
right unit for a stored row is **one occurrence**, not the parent event — this is the Element451 analogue of
Slate's widget rows (per-slot availability), not Slate's one-event-one-page model. The event detail page's
`singleEventOccurrencesStore` (`{loading, ongoing, future, range}`) is meant to hold more of these but was empty
in every fixture we pulled (small volunteer colleges, few slots) — **[inference]** it likely paginates occurrences
for high-volume tour calendars; not confirmed.

### 1.5 The event detail page: `singleEventStore`

`GET https://<site-host>/event/<guid>` embeds the same per-item shape, but under `singleEventStore.item` (plus
`singleEventQAStore` for a Q&A widget and `singleEventOccurrencesStore` as above) rather than under a list. The
item fields are identical to the listing's `items[]` shape (location, contact, occurrences, etc.) — confirmed
across three colleges. No extra fields show up only on the detail page.

### 1.6 Field mapping to the stored row

| stored column | Element451 source | notes |
|---|---|---|
| `title` | `content.title` | |
| `starts_at` / `ends_at` | an occurrence's own `start_date`/`end_date` (not the parent's) | parent's `start_date`/`end_date` is the whole campaign window, **not** one visit's time |
| `timezone` | `timezone` (item and occurrence both carry it, always matching in our fixtures) | IANA zone name already, no parsing needed (unlike Slate's "Eastern Daylight Time UTC -04:00" text) |
| `all_day` | `allday` | |
| `online` | **absence of the `location` key entirely** | confirmed: Georgia Gwinnett's two "virtual-session" items have no `location` key at all (not null) in `singleEventStore`/`eventsListStore`; every in-person item has one. `event_type` slugs sometimes say "virtual"/"online" too (client-chosen text, not reliable alone) |
| `venue` | `location.venue_name`, falling back to `location.building` | both can be present; `cccb`'s example has `venue_name: null, building: "Pelfrey Hall"` |
| `address` | `location.address` | |
| `city` / `state` / `zip` | `location.city` / `location.state` / `location.zip` | ZIP **is** present (unlike the brief's worry) |
| `lat` / `lng` | `location.geo.longitude` / `location.geo.latitude` | present on every in-person item we saw — better than Slate's map-centre fallback |
| `availability` | an occurrence's `is_open`/`is_full`/`is_closed` → `open`/`full`/`closed` | at the occurrence level, like Slate's widget legend, not a single page-level flag |
| `book_url` | `https://<site-host>/event/<guid>` | the detail page itself hosts the registration form (`form: "<client>.field.<id>"` is referenced but the form API was not probed) |
| `source_url` | the listing page URL used to discover it | |
| `kind` | **no fixed enum** — `event_type` is a free-text, per-client slug | observed values: `campus_tours`, `personal-campus-visit`, `preview-day`, `information-session`, `graduate-info-session`, `virtual-session`, `youth-events`, `registration`, `discover-usf-day`, several `cege-*-info-session` slugs, etc. Needs the same keyword-mapping approach the Slate reader would use for `kind`, not a lookup table |
| `description` | `content.description` (HTML) | |

### 1.7 What's missing / uncertain (deliverable 4's "what is missing")

- **No confirmed paging mechanism.** `limit: 30` always matched `total` in every fixture (max was 11, at
  California State San Bernardino). A busier calendar would need a confirmed `offset`/`page` query param or the
  private API; neither was found within this research's scope.
- **No confirmed date-range filter** on the listing page (no `?from=`/`?to=` tested against a live SSR response —
  not needed since every fixture returned its whole list already).
- **No reliable "online" flag field** — it's inferred from the *absence* of `location`, which is solid in our
  samples but not a documented contract.
- **`kind`/category is free text**, chosen per-client — there is no shared enum to map from, unlike Slate.
- **Occurrence pagination** (`singleEventOccurrencesStore.range`) was never populated in our samples — unknown
  shape for a college with many future slots.
- The admin/CRM REST API (`<client>.api.451.io/v2/...`) was not reverse-engineered past confirming the host
  exists and that its bare root returns Element451's own generic splash page (not client data) — we did not find
  or use a credential for it, consistent with the "never use a token for anything but reading what the public
  page itself reads" constraint, since the public page itself doesn't need it (the SSR state is enough).

## 2. Coverage across the 49/50 Element451 colleges

`non-slate-vendors.json` lists 50 colleges (not 49) whose `vendors` array contains `"Element451"` (one more than
the brief's count — likely a list that grew by one since the brief was written; all 50 were checked). Each
college's visit-page URL (from the same file) was fetched once; 451-related links were extracted and classified
by which `451.io` bundle they pointed to.

| class | count | meaning |
|---|---|---|
| `event451` (events app, listing endpoint reproduced) | 20 | visit page links (directly or via one hop) to an `event451.sites.451.io` host or a custom domain running the same app; the SSR listing call works |
| `form_only` | 4 | only an `embed-forms.451.io` widget and/or a bare `<client>.api.451.io` reference found — a registration **form**, no events feed |
| `shell_or_pages_only` | 25 | only `shell.451.io` (admissions/chat shell), `page451.sites.451.io` (CMS landing page), or `app451` (applicant-portal app) bundles found — no events app in one hop from the visit page |
| other (unreadable) | 1 | The King's University's visit page 403'd for our fetch |

Examples:

- **event451** (20): Bethune-Cookman University (`visit.cookman.edu`, custom domain), Central Christian College
  of the Bible (`cccb.event451.sites.451.io`), Chadron State College, Claflin University, Georgia Gwinnett
  College, University of St Francis, Webber International University, and 13 more.
- **form_only** (4): Bethany College, Clayton State University, Montreat College, Salem University — each only
  exposes an `embed-forms.451.io` registration form or a bare `<client>.api.451.io/` reference, with no events
  listing found on the visit page.
- **shell_or_pages_only** (25): Albany State University, Abraham Baldwin Agricultural College, Baker College,
  Briar Cliff University, Bridgewater State University, and 20 more — these link an Element451 `shell`,
  `page451`, or `app451` bundle but no `event451` events app was findable in one hop from the visit page.
  (Several of these, per the source file's own notes, actually use Slate or a campus calendar as their real
  events vendor — Element451 is just also present for admissions chat/apply.)
- **other**: The King's University (`https://www.tku.edu/admissions/visit-tku/`) returned HTTP 403 to our fetch;
  unclassified.

Full per-college matches are saved in `research/element451/link_scan.json` and the classification in
`research/element451/coverage_classes.json`.

## 3. Three (four) saved fixtures

Saved under `research/element451/fixtures/<client>/`, each with `listing.html` (the raw SSR page = "the request
that made it"), `listing-state.json` (the parsed `event451-state` JSON from it), `event-detail.html`, and
`event-detail-state.json`. `cccb` additionally has `app-config.js`.

| client | request | college |
|---|---|---|
| `cccb` | `curl -sL -A "<UA>" https://cccb.event451.sites.451.io/` and `.../event/cccb.events.212835` | Central Christian College of the Bible |
| `stfrancis` | `curl -sL -A "<UA>" https://stfrancis.event451.sites.451.io/` and `.../event/stfrancis.events.1909771` | University of St Francis |
| `webber` | `curl -sL -A "<UA>" https://webber.event451.sites.451.io/` and `.../event/webber.events.1980051` | Webber International University |
| `cookman` | `curl -sL -A "<UA>" https://visit.cookman.edu/` (listing only — custom domain, confirms the app works off-`451.io` too) | Bethune-Cookman University |

## 4. Proposed reader contract (Slate reader's terms)

```ts
// Parallel to discoverSlateHost(unitId, visitUrl, applyUrl, http, opts)
async function discoverElementSite(
  unitId: string,
  visitUrl: string | null,
  http: ReaderHttp,
): Promise<{ site: string; token: string; foundOn: string } | null>
```
- Fetch the visit page; collect links/script-srcs matching `event451\.sites\.451\.io` or any host whose fetched
  HTML contains `<script id="event451-state"`.
- A visit page that is itself such a host (custom domain, like `visit.cookman.edu`) needs no hop — same
  detection as Slate's "a link that is itself a Slate page".
- Confirm by fetching the candidate root and checking for `id="event451-state"` (parallel to
  `isSlateEventRegistration`/`confirmSlateHost`).
- `token` is `configState.client.token` from the parsed state (the client's short code, e.g. `"cccb"`) — distinct
  from the site's own hostname subdomain, which can carry a different numeric suffix.

```ts
// Parallel to parseStandardSearch / parseWidgetList
async function listElementEvents(
  site: string,       // the confirmed event451 host, e.g. "cccb.event451.sites.451.io" or "visit.cookman.edu"
  http: ReaderHttp,
): Promise<ElementEventRow[]>
```
- One `GET https://<site>/`, parse out the `event451-state` JSON, read `eventsListStore.items`.
- Flatten: for each item, emit one row **per occurrence** in `item.occurrences.upcoming` (falling back to
  `item.occurrences.first`/`next` if `upcoming` is empty), carrying the parent's title/location/description down
  to each occurrence — this is the Slate-widget-row analogue, not the Slate-search-row analogue (one event can
  be many bookable rows, like Slate's per-slot widget, not Slate's one-GUID-one-page model).
- `slateId`-equivalent: `item.guid` + occurrence's `element_guid` (both needed, since a parent can have several
  occurrences); e.g. `visitEventId` would need a two-part key or a composite id like
  `${item.guid}:${occurrence.element_guid}`.
- Map fields per the table in section 1.6.
- No pagination loop implemented/needed given `total ≤ limit` in every sample; flag (don't silently drop) if a
  future response ever has `total > items.length`.

```ts
// Parallel to parseEventPage — only needed if a reader wants the detail page's extra Q&A or to re-confirm the
// booking URL/registration form id; the listing page already has everything listed in 1.6.
function parseElementEventDetail(html: string): ElementEventPage
```
- Reads `singleEventStore.item` the same way; identical shape to a listing item, so in practice this reader may
  not be needed at all — the listing call alone is both "search" and "event page" in Slate's terms.

## 5. Risks

- **Tokens.** `featureToken`/`analyticsToken` in `app-config.js` and the form-embed's `accessToken` were not
  tested for rotation (single snapshot, 2026-10-15). **[inference]** since the reader's proposed design never
  needs any of them (the SSR listing page is public and self-contained), rotation risk is low for this design —
  but if a future design calls the private REST API directly, token rotation would be a real risk.
- **No robots.txt restriction found.** `https://element451.com/robots.txt` and
  `https://cccb.event451.sites.451.io/robots.txt` both allow all crawling (`Disallow:` empty on the client site;
  only a sitemap line on the marketing site).
- **No scraping-specific terms found.** `element451.com`'s homepage links only a privacy policy (no visible
  "terms of service" link in one hop; `/terms-of-service` 404'd). The privacy policy is the standard
  cookies/analytics boilerplate; no scraping restriction found in it. **[inference]** this is not exhaustive —
  only the homepage and privacy policy were checked, consistent with the one-hop, no-form-submission scope of
  this research.
- **Rate limits.** None observed/hit at 1 request/second across ~60 total requests to `sites-cdn.451.io`,
  `*.event451.sites.451.io`, and `element451.com`; no 429s, no CAPTCHA pages.
- **Nothing needed a login.** All data came from public GETs; the `admin_authentication`/`student_authentication`
  blocks visible in `configState` are for Element451's own admin/student portals, never touched.
- **Coverage caveat:** 25 of the 50 "Element451" colleges show no events app in one hop from their visit page —
  several of those, per the source vendor-probe notes, actually run Slate or a campus-calendar product
  (Localist/events.*.edu) for their real visit events, with Element451 present only for chat/apply. A real sync
  job should treat "no event451 app found" as "try the other listed vendor," not as "Element451 publishes no
  events for this college."

## Where things are

- `research/element451/colleges.json` — the 50 Element451 entries pulled from `non-slate-vendors.json`.
- `research/element451/fetch_visit_pages.sh`, `fetch_visit_pages.tsv`, `fetch_visit_pages.log` — the visit-page
  fetch run (49×200, 1×403) and its log.
- `research/element451/pages/<unit_id>.html` — all 50 raw visit pages.
- `research/element451/link_scan.json` — 451-related links/matches found per college.
- `research/element451/coverage_classes.json` — the four-way classification in section 2.
- `research/element451/sites/<client>/` — working fetches (root pages, event pages, JS bundles, app-config.js)
  for `cccb`, `stfrancis`, `webber`, `csusb`, `ggc`, `cookman`.
- `research/element451/fixtures/<cccb|stfrancis|webber|cookman>/` — the four clean fixture sets (section 3).
- `research/element451/element451-robots.txt`, `research/element451/event451-robots.txt` — robots.txt snapshots.
- `research/element451/*.py`, `extract_state.py`, `classify.py`, `inspect*.py` — the small one-off scripts used
  to parse the SSR state blobs and build the classification (kept for reproducibility).
