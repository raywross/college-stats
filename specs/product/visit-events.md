# Visit Events: Tours, Sessions, and Rep Visits Near You, With Nightly Alerts

> Status: **built** 2026-10-13 on `feature/visit-events` as a **pilot on four colleges** (UF, Duke, UNC, UT Austin,
> 2,108 events on dev); see [As built](#as-built-2026-10-13). Planned the same day from the owner's decisions after the
> research in [ideas/visit-events.md](../ideas/visit-events.md). Builds on the visit links
> ([school-identity/links.md](../school-identity/links.md)), the household home
> ([home-and-distance.md](home-and-distance.md)), the student's high school ([student-profile.md](student-profile.md)),
> following and the digest job ([follow-colleges.md](follow-colleges.md)), and the planner's visit log
> ([planner/actions.md](../planner/actions.md)). Part of [product](README.md).

## Goal
*When is UF coming to my high school? When can we tour Duke, and are there seats?* Every college that runs admissions
on Slate publishes its full calendar on a public page: campus tours and information sessions, open houses, online
sessions, and the travel calendar of admissions officers visiting high schools and college fairs. Quad reads those
calendars every night for the colleges people follow, shows the upcoming events to signed-in people, and emails a
family when a college on their list adds an event within a chosen distance of home.

The travel events are the point. On 2026-10-13 UF listed 528 events: 132 campus tours, 40 campus sessions, 9 online,
and **340 visits to high schools and fairs in 18 states**, each with a public sign-up form (name, email, high school,
graduation year). A family in Marietta, Georgia can register for UF's visit to Marietta High School; nothing on UF's
own visit page tells them it exists unless they search the right ZIP on the right host. CampusBooker sells this
view; Quad gives it to the family's own list.

## Owner decisions (2026-10-13)
1. **Build it, travel events included.** Rep visits to high schools and fairs are public events people can sign up
   for, and they are the most valuable rows for a family far from campus.
2. **Signed-in only.** The events show to people with an account, never to anonymous visitors. (Signed out, a
   college page says only that events exist and invites sign-in.)
3. **Nightly refresh** of every college's calendar, recording what is new, changed, and gone.
4. **Alert emails**: a person whose list includes a college gets an email when that college adds events, with a
   switch to turn the alerts off **college by college**.
5. **Alerts are radius-limited**: only events within a distance of the family's home (or the student's high school
   when there is no home). The radius is a profile setting, **default 30 miles**.

## What the research found (summary; details in the idea file)
- **One standard endpoint per Slate host.** Besides each college's custom portal pages, every Slate host serves
  Slate's own event search: `https://<host>/register/?cmd=search&country=US` lists every public event that has a
  place, grouped by state, as plain `<li>` rows (a `?id=<guid>` link, the title, "Wednesday, October 21 at 9:00 AM",
  "Gainesville, FL"). `&zip=<zip>` gives the same rows in distance bands (25/50/100/250 miles), `&country=US-GA` one
  state. It answered on **9 of 9** Slate hosts tried (UF, FSU, Duke, Bowdoin, Drake, Augustana, Cal Lutheran,
  Blackburn, AIC, Bellin), 130 to 879 events each. No iCal, RSS, or JSON exists.
- **The portal widget adds online events and seats.** `/portal/widget/event?portal_id=…&part=…&cmd=event_list`
  (and `cmd=event_dates`, a JSON day list) backs every portal calendar. Its rows carry `data-date`, `data-online`,
  `data-location`, and an open/full flag. Online sessions appear **only** here (UF's 9, Duke's 1), never in the
  standard search. Seat counts are per-college templates (Duke: open/full per slot; UF: "23 spots available" inside
  its own table), so a reader keeps open/full where it is standard and ignores the rest.
- **The event page** (`/register/?id=<guid>`) states the full date with year and timezone ("Wednesday, October 28,
  2026 at 6:30 PM until 7:30 PM Eastern Daylight Time UTC −04:00"), the venue with a street address and ZIP, a
  description, and whether registration has closed. The standard search omits the year; the event page is the
  source of truth for a new event's fields.
- **Coverage.** Of a 100-college sample of the 1,390 visit links, **59** reach a Slate `/portal/` or `/register/`
  page in one hop (about 820 colleges when extrapolated). The rest: YouVisit virtual tours (29, not registration),
  a general campus calendar (25), TargetX, Element451, VisitDays, and other CRMs (24), a plain request form (15).
  Those colleges keep their visit link and get no events in the first build.
- **Noise.** Colleges leave staff rows public. Duke's search is 30% logistics: "Requested Group / Filled" ×24,
  "CO (Denver) - Hotel Shipping", "NC DUML Materials pick up". UF has "No Activity". A title filter drops them.
- **Terms.** Technolutions publishes no terms of use; every Slate host serves the same robots.txt (disallows
  `gsa-crawler` and `GPTBot`, allows everyone else). Colleges' own policies govern their users, not readers of public
  pages. The site reads through `PoliteHttp` (robots honored, one request a second per host, an honest user agent)
  and links out for every booking; it never submits a form. A partnership email to Technolutions goes out when the
  build starts (open question 5).

## Model

### Public data (Supabase, read by signed-in people)
Events are the site's first data that changes daily, so they live in Supabase next to the change log
([serving-architecture.md](../serving-architecture.md)), refreshed by their own job, never in `data/schools.json`.

```
slate_hosts        (unit_id pk, host, found_on url, portal_parts json, status: active | unreachable | no_events,
                    first_seen, last_read, last_error)
visit_events       (id pk = host || ':' || slate_id, unit_id, host, slate_id uuid, title, kind, starts_at timestamptz,
                    ends_at timestamptz null, timezone text, all_day bool, online bool,
                    venue text null, address text null, city text null, state text null, zip text null,
                    lat double null, lng double null, availability: open | full | closed | null,
                    book_url, source_url, description text null, title_hash,
                    first_seen timestamptz, last_seen timestamptz, removed_at timestamptz null, changed_at timestamptz)
visit_event_sync   (id, ran_at, hosts_read, events_new, events_changed, events_removed, pages_fetched, errors json)
```
- `kind` from the title and place, in this order: `staff` (shipping, materials, pickup, "Requested Group / Filled",
  "No Activity", "Request a … Appointment"; never shown), `online` (the widget's `data-online`, or virtual/online in
  the title), `open_house` (open house, preview day, admitted), `tour` (a title with "tour" and no high school or
  fair), `travel` (high school, HS, HSV, fair, college night, NACAC and the state ACACs, school, academy, prep,
  "Discover Duke"-style named evenings, or any event away from the campus city), `info_session` (session, workshop,
  chat, "campus visit"), else `other`. The planner's `plan_visits.kind` maps from it (`tour → campus_tour`,
  `travel → fair`, the rest by name).
- `lat`/`lng`: the event page's ZIP through the checked-in ZCTA table ([home-and-distance.md](home-and-distance.md)),
  so no third-party call per event; an address with no ZIP falls back to the city's ZCTA when the city is unique in
  the state, else null (shown, never alerted). Online events have no place.
- `availability`: `open`/`full` from the widget's legend where the college exposes it; `closed` when the event page
  says the registration deadline passed; null otherwise. Full and closed events stay visible, greyed, since UF's own
  advice is "check back in case spots open up".
- A row's `id` is the Slate host plus Slate's event GUID, so the same event found through the standard search and
  through a portal widget is one row, and a nightly run upserts rather than rebuilds. An event missing from two
  consecutive reads gets `removed_at` (one missed read can be a host hiccup). `changed_at` moves when the title,
  start, venue, or availability changes.
- RLS: `authenticated` reads `visit_events` rows that aren't `staff` and aren't past; `anon` reads nothing. Only
  the secret key writes. A signed-out college page learns only a count, through a server call.
- Lineage ([data-lineage.md](../data-lineage.md)): every row keeps `source_url` and `last_seen`; the display says
  "Read from UF's event calendar this morning" with the time, never a bare list.

### People's data
```
visit_alert_prefs  (user_id pk, email_visit_alerts bool default true, radius_miles int default 30
                    check in (10, 25, 30, 50, 100, 250), measure_from: auto | home | high_school default auto,
                    include_online bool default false, updated)
visit_alert_mutes  (user_id, unit_id, created)                      -- the per-college off switch
visit_alerts       (id, user_id, sent_at, event_ids text[], college_count, provider_message_id)
```
- `visit_alert_prefs` is created by the same trigger that creates `notification_prefs` on a first follow, and
  reuses that table's `unsubscribe_token`; the one-click unsubscribe for these emails sets `email_visit_alerts =
  false` and leaves data-update digests alone (and vice versa).
- **Whose list, whose radius.** "A college on their list" means the user's `follows` rows (lists follow
  automatically; the household hub's per-college Updates switch already lives there). The radius is measured from
  the **household home** when one is set; otherwise from the **student's high school** (`high_schools.data.lat/lng`
  via `student_profiles.basics.highSchoolId`; for a guardian, each student in the household in turn); otherwise no
  radius exists and the person gets no alerts, only the pages. `measure_from` lets a family override `auto` either
  way, and the profile shows which point is in use ("Measuring 30 miles from home in Marietta, GA").
- Guardians get alerts for the colleges they follow, like digests; the student's follows stay the student's.
- Deleted with the account ([accounts.md](accounts.md)); exported with it ([account-export](accounts.md)).

## What is stored, what is read in detail, and what is shown (owner, 2026-10-14)
The full read of all 795 Slate hosts (350,406 upcoming events, 2026-10-14) showed that a Slate database exposes more
than its admissions calendar: 19% of the rows are one-on-one appointment slots (interviews, counselor and coach
meetings, meals, individual counselors' calendars with bare first names) and some are staff logistics. UNC's 734
"Admissions Drop-In" rows are an internal calendar; nothing on UNC's site offers them. The rules:

| Kind | Stored | Read in detail (the event page) | Shown, counted, alerted |
|---|---|---|---|
| `travel` (rep visits, fairs, named evenings in a city) | yes, from the listing | **yes**: the venue's address and ZIP place it for the radius | yes |
| `info_session`, `open_house` on campus | yes | no: the campus's own coordinates and zone | yes |
| `info_session`, `open_house` in another city | yes | yes (a venue) | yes |
| `tour` | yes | no: the campus's own coordinates and zone (the sign-up link needs nothing from the page) | yes |
| `online` | yes | no: no place; the campus state's zone | yes (pages; alerts only when a person asks for online) |
| `other` (appointments, interviews, meetings, meals, bare names) | yes, from the listing, for later | **never** | **never** |
| `staff` (shipping, pickups, filled group slots, non-admissions and graduate events) | yes, from the listing, for later | **never** | **never** |

Enforced in three places that must agree: `lib/visit-events/types.ts` `SHOWN_KINDS` (pages, alerts, the planner),
the database's read policy and `visit_event_count()` (`20261014100000_visit_events_shown_kinds.sql`), and
`pagePolicy()` in `scripts/lib/visit-events/sync.mts` (which rows get their page). A night's read is therefore one
search per host, the portal widgets, and an event page only for the shown kinds away from campus; kinds are
recomputed from the titles every night, so a rule change reclassifies without re-reading. Why keep the hidden rows at
all: the listing is already in hand, the rows cost nothing to keep, and they may be useful later (an "interview
offered" signal, say); keeping them also lets `check:visit-events` watch each host's share of accidental rows.

## Keeping it running (round 2, 2026-10-15)
The owner's condition for the feature: it must maintain itself, never a one-time pull. The nightly read is already
idempotent and self-correcting (new rows appear, changed rows update, a row missing from two reads is removed, kinds
are recomputed from titles each night). Four things would still let it rot, each with its fix:

1. **A collapse.** If Technolutions changed the search page's markup, every host would parse to zero rows the same
   night, and two nights later the table would have emptied itself. Guards: a host whose search page says
   "returned N event(s)" with N > 0 but parses to no rows, or whose page no longer says it at all, is a **collapsed**
   host: an error, no misses counted (`slate_hosts.failures` moves, `hosts_collapsed` on the run). A **run-level
   guard** withholds all miss-marking when more than 20% of the hosts read tonight failed or collapsed
   (`visit_event_sync.misses_withheld`); new and changed rows still write.
2. **New Slate adopters are never found.** A **weekly discovery** (Sundays, the same workflow) tries every college with
   a visit or apply link that isn't in `slate_hosts` yet. Discovery widens its candidates: any admissions-style
   subdomain linked from the visit page or apply page (`apply.`, `admission(s).`, `connect.`, `engage.`, `go.`,
   `visit.`, `discover.`, `enroll.`, `begin.`, `join.`, …), confirmed only by answering the standard search. The
   2026-10-14 measurement found 13 of 14 such missed hosts answering (Amherst 86 events, Emerson 396, Union 398,
   UMass Dartmouth 1,148); about 40 to 95 colleges.
3. **Nobody sees it break.** The admin console's Health area gains a **Visit events** card: the last runs
   (`visit_event_sync`: when, hosts read / failed / collapsed, new / changed / removed, misses withheld, the data
   check's failures and warnings), hosts by status, and a red state when the last run failed, withheld misses, or is
   older than 36 hours. The check script writes its summary onto the run it follows (`check_summary`,
   `check_failures`, `check_warnings`).
4. **Host bookkeeping.** `last_attempt` (tried) beside `last_read` (answered); unreachable hosts are retried every
   seven days from their last attempt; a host whose search has answered with zero rows for 30 days (`zero_since`)
   becomes `no_events` and is retried monthly; `search_total` keeps the search's own count for the card.

**Built 2026-10-15** on `feature/visit-events-upkeep` as three units. Guards (`scripts/lib/visit-events/sync.mts`):
`CollapsedSearchError` when a Slate results page says "returned N event(s)" with N > 0 but no rows parse, or no longer
says it; a collapsed host counts as a failure and its misses are never counted; `runSync` writes every host's misses
in one step after the pool and withholds them all when more than 20% of the hosts tried failed or collapsed
(`misses_withheld`); `check:visit-events -- --record` writes `check_failures`, `check_warnings`, and a `check_summary`
(`{checked_at, hosts, events, failing, warned, listed: [{host, unit_id, events, failures, warnings}], omitted}`, at
most 50 hosts, failing first) onto the night's run. Host bookkeeping (`scripts/lib/visit-events/hosts.mts`, pure):
`afterRead` / `afterFailure` keep `last_attempt`, `last_read`, `search_total`, `zero_since`; `dueHosts` reads active
hosts nightly, unreachable ones seven days after their last attempt (or at once with `--retry-unreachable`),
`no_events` ones monthly, `off` never; a host becomes `no_events` thirty days after its search first came back
empty (widget rows count as rows, so a host with online sessions only never does). Discovery
(`scripts/lib/visit-events/discover.mts`): candidate hosts also come from any admissions-style subdomain linked (or
quoted in a script) on the visit and apply pages, own domain first, ranked after portal/register links, each confirmed
by the standard search; the first dev run found **59 more hosts** (58 read, 29,731 events; Juilliard, St. Olaf,
Elmira, Gallaudet, UMass Dartmouth, Wofford among them), taking dev to 852 active hosts. Admin
(`lib/admin/visit-events.ts`, `components/admin/VisitEventsCard.tsx`): the card on `/admin/health#visit-events` and a
tile on the console landing page (red when the newest run failed, withheld misses, has check failures, or is older
than 36 hours; amber on warnings); Operations can dispatch the workflow (target, units, discover). Known gaps: a
college whose discovery finds nothing has no row to record the attempt on, so it is retried every Sunday (a
`discovery_attempts` record would fix it); two hosts were set `off` by hand on dev (Trinity College of Nursing had
Augustana's host, Kansas State a graduate Slate); `www.amherst.edu` challenges our user agent, so Amherst stays
unfound until the WAF is addressed; the search times out (30 s) on a few large hosts under a pool of 24.

Left for later: a self-hosted runner or small VM for the crawl once the repository goes private (about 30 hours of
Actions a month); the Technolutions partnership email (the owner's).

## Round 3: TargetX and Element451 (2026-10-15)
> Status of this section: **planned** 2026-10-15 (owner: "put a spec together for the TargetX and Element451
> schools, then implement and test"). The protocol subsections are filled from the research in
> `visit-events-build/research/{targetx,element451}.md`.

**Why these two.** Of the 984 colleges without a Slate host, the visit page links TargetX (Salesforce) at 149 and
Element451 at 49 ([what the rest run](#keeping-it-running-round-2-2026-10-15): campus-wide calendars, virtual
tours, plain forms, or nothing). They are the only other systems with enough colleges to be worth a reader each, and
both publish events on public pages a reader can call.

**One table, one pipeline, one reader per vendor.** `slate_hosts` gains `vendor` (`slate` | `targetx` |
`element451`) and `config` (what the reader needs beyond the host: a TargetX site's path and flavour, an
Element451 site's API base and the public tokens its own pages carry) in `20261015120000_visit_events_vendors.sql`.
`syncHost` dispatches by vendor to `readSite(hostRow, deps) → HostRead` (`scripts/lib/visit-events/readers/
{slate,targetx,element451}.mts`; the Slate one is today's `readHost`); everything after the read is shared: the row
shape, `kindOf`, `pagePolicy`'s idea (detail only for shown kinds away from campus, where a vendor has a detail call
at all), `diffEvents`, the collapse and run-level guards, the host bookkeeping, the check, the admin card. A vendor
reader throws `CollapsedSearchError` when its listing answers but not in the shape it knows, so a vendor-wide change
is a collapse like Slate's and never a mass cancellation. Discovery gains a step per vendor (`discover-targetx.mts`,
`discover-element451.mts`) run after the Slate step for colleges still without a row; each confirms a candidate
site by a successful listing call before writing it.

**Rules carried over.** Every listing row is stored; only the five shown kinds appear; staff and appointment rows
are kept hidden; one request a second per host through `PoliteHttp`, an honest user agent, robots honored, no form
ever submitted, no token used for anything but the read the public page itself makes. A reader whose source needs a
login, a session, or a token that isn't on a public page is not built.

**Pilot before `--all`.** Each reader runs for a month on a dozen colleges (`status` `active` for those, the rest
discovered but `off`) with the check's staff share, located share, and collapse count watched on the admin card;
then the rest are switched on.

### TargetX: the protocol
Research 2026-10-15 (`visit-events-build/research/targetx.md`, four colleges reproduced). Of the 151 colleges whose
visit page links TargetX or Salesforce, about **67** run the legacy TargetX Events site, about **7** a second TargetX
product (ERx Events), about **10** a Lightning (Experience Cloud) site, 2 a third-party package, and about **65** use
TargetX only to apply or chat: no events. Two flavours are read; the Lightning one is recorded as a known gap
(nothing is server-rendered and the component code loads from hashed paths; it needs a browser, which this reader
never is).

**Legacy events site** (`https://<org>.my.salesforce-sites.com/<site>`, usually `events`; the `#/calendar` fragment is
client-side). The page embeds a Visualforce remoting descriptor (`RemotingProviderImpl`: `vid`, and per method a
`csrf` and an `authorization` JWT). The read is **two remoting calls the page itself makes**, `POST
…/<site>/apexremote` with `Content-Type: application/json` and `Referer`/`Origin` set to the site's own origin
(without them Salesforce answers 402 "unable to determine from which page the request originated"): `initialize`
(the org's settings: `Search_Days__c`, `Use_Location_Lookup__c`, `SingleEventRegistrationURL__c`, `Org_Time_Zone__c`)
then `getFutureEvents` with `[{}, <Use_Location_Lookup__c>, "", []]`, which returns every future event in the org's
own window; there is no paging and no detail call (an event's page filters the same list client-side). Tokens are
minted per page load: the reader fetches the page and calls within the same run, never caching them. The response
may come in Salesforce's reference-compressed form (`{"s": id, "v": …}` / `{"r": id}`, `ref: true` in the envelope);
the reader resolves both shapes. This is a read, not a form: it posts nothing a person would enter, and it is the same
request the public page makes for any visitor.

Fields (`result[i].oe`, every field optional since null fields are dropped): `Id` (the event id; `book_url` =
`<SingleEventRegistrationURL__c>?eid=<Id>`), `Name`, `…Start_Date_Time__c` / `…End_Date_Time__c` (epoch
milliseconds, UTC), `…Time_Zone__c` (IANA), `…type__c` (free text: "Campus Tour", "College Fair"…), `…Description__c`,
`…Slots_Available__c` (a number or "Unlimited"), `…Waiting_List__c`, `…Cancelled__c`, `…Registration_Deadline__c`,
and the place: `…Location_Lookup__r` with `City`, `State`, `Street`, `Postal_Code` fields read **by suffix** (the
namespace prefix varies by org) when the org uses the lookup, else `…Location__c` as venue text. No coordinates and no
online flag exist: the ZIP, when present, places the event through the ZCTA table; a row with venue text only and no
city, or a city equal to the campus city, takes the campus's coordinates; an away row with no ZIP stays unlocated
(shown, never alerted); online comes from `kindOf` on the type and title. A cancelled event is stored as `closed`.

**ERx Events site** (`https://<org>.my.salesforce-sites.com/EventListing`): the whole list is server-rendered into
the page as a JavaScript string literal (`var a = '[…]'`), so the read is one GET, a regex, a tolerant one-layer
unescape (an unknown backslash escape is dropped, and one unparseable event is skipped rather than failing the page),
and `JSON.parse`. Fields: `Id`, `Name`, `ERx_Events__StartDateTime__c` (ISO, UTC), `…Campaign_Time_Zone__c` (the IANA
zone is the parenthesised suffix), `…Location__c` (venue text only; no address fields exist in this flavour),
`…Event_URL__c` (the booking URL), `…Event_Description__c` (HTML), `…OnlineGuestEnabled__c` (online), the
registration counts and caps for availability, `…RSVP_Date__c`. The end time is only a display string, so `ends_at`
is null. Rows are placed by the campus rule above.

**Discovery:** from the visit page, links on `*.my.salesforce-sites.com`, `*.my.site.com`, or `*.force.com`; a
candidate is a legacy site when its page carries a `TargetX_Eventsb` remoting descriptor, an ERx site when its page
carries `var a = '[` with `ERx_Events__` fields, and unreadable (recorded with `config.flavour: "lightning"`, status
`off`) when it is a `/s/` Lightning site. `config` keeps `{ site, flavour }`.

**Collapse:** a legacy page with no remoting descriptor, a `getFutureEvents` answer with no `result` array, or an ERx
page with no `var a = '[` literal is a collapsed site. **Risks:** tokens are page-scoped (handled by fetching per
run); Referer/Origin are mandatory; per-org differences are real in three fixtures (namespace prefix, whether
locations are filled, reference compression), so every field is optional; Salesforce WAFs rate-limit anonymous
traffic, so the per-host second stays; the ~67 / ~7 split is from link patterns, confirmed on four colleges only,
which is what the pilot is for.

### Element451: the protocol
Research 2026-10-15 (`visit-events-build/research/element451.md`, fixtures from four colleges). Element451 serves
several apps; only **`event451`** lists events. It is a server-rendered Angular app: `GET https://<site>/` returns
the full listing in `<script id="event451-state" type="application/json">` (the blob appears twice, identical), so
one request per site, no API call, no token. Sites: `https://<client>.event451.sites.451.io/`, a differently
prefixed subdomain (`ggc-35205.event451.sites.451.io`), or a custom domain running the same app
(`visit.cookman.edu`). Of the 50 colleges whose visit page links Element451, **20** have a reachable `event451`
listing; 4 have only an embedded form; 25 link only the chat shell, a landing page, or the applicant portal (several
of those use Slate or a campus calendar for events); 1 refused the fetch.

- **Discovery:** from the visit page, any link or script on an `event451.sites.451.io` host, or a linked host whose
  page contains `id="event451-state"` (a custom domain); the visit page may itself be the site. Confirmed by the
  blob's presence. `config` keeps `{ site, client }` (`configState.client.token`, e.g. `cccb`).
- **Listing:** `eventsListStore.items[]`. Each item is a template (a "parent" spanning months) with
  `occurrences.upcoming[]`, the actual bookable slots, each with its own `start_date`, `end_date`, `timezone`
  (IANA already), `is_open` / `is_full` / `is_closed`, and counts. **One stored row per occurrence**, the parent's
  title, description, and location carried down; `slate_id` = `${item.guid}:${occurrence.element_guid}` (the
  column becomes text in `20261015130000`). `total ≤ limit (30)` in every fixture; a response with `total >
  items.length` is logged as a warning, never silently dropped, since no paging parameter was found.
- **Fields:** `content.title`; `location.{venue_name|building, address, city, state, zip, geo.latitude/longitude}`
  (coordinates and ZIP on every in-person item: better than Slate's page read); **online = the `location` key is
  absent** (confirmed on Georgia Gwinnett's virtual sessions; `event_type` slugs are client-chosen and only a hint);
  `availability` from the occurrence's flags; `book_url` = `https://<site>/event/<item.guid>` (the detail page is
  the registration page); `kind` from the title and `event_type` through `kindOf` (no fixed enum: `campus_tours`,
  `preview-day`, `virtual-session`, `information-session`… are per-client text).
- **No detail read is needed**: the listing carries everything the row needs, so `pagePolicy` is "listing" for every
  Element451 row and the per-night cost is one request per site.
- **Collapse:** a page without the `event451-state` blob, or a blob without `eventsListStore`, is a collapsed site.
- **Risks:** the online inference is undocumented; occurrence paging (`singleEventOccurrencesStore.range`) was empty
  in every fixture and may matter for a busy tour calendar; robots.txt on `element451.com` and the client sites
  disallow nothing; no login anywhere.

### Units
1. **Element451 reader** (`scripts/lib/visit-events/readers/element451.mts`, `discover-element451.mts`; the
   `readSite` dispatch seam in `sync.mts`; the vendor step in the CLI's discovery; `tests/
   visit-events-element451.test.mts`): parse the state blob, one row per occurrence, discovery and confirmation, a
   collapse on a blob-less page; then the pilot run on the 20 colleges with a listing.
2. **TargetX reader** (`readers/targetx.mts` with both flavours, `discover-targetx.mts`, its `readSite` case, its
   discovery step, `tests/visit-events-targetx.test.mts`): the descriptor parser, the two remoting calls with the
   origin headers, the reference resolver, the ERx literal parser and unescaper, the place rule, availability; then
   the pilot run on a dozen legacy colleges and the ERx ones.
3. **Pilot QA**: the check and the admin card over the new hosts (staff share, located share, collapses), a
   signed-in look at two Element451 and two TargetX colleges' calendars and `/me/visits`, and the kind mix of the new
   rows reviewed against the five-kind rule.

## The nightly job

### Discovery (once, then monthly in the identity refresh)
For each of the 1,390 colleges with a visit link, the site probe ([links.md](../school-identity/links.md), `PoliteHttp`)
follows one hop and records the first `https://<host>/portal/…` or `/register/…` link on a host that answers
`/register/?cmd=search&country=US` with Slate's "Event Registration" page; the host, the page it was found on, and
every `/portal/widget/event?portal_id=…&part=…` found on the linked portal pages go into `slate_hosts`. A college
whose link is itself a Slate page (67 today) needs no hop. The apply link (`links.apply`, 26 Slate hosts) is the
fallback when the visit page gives nothing. Expected: about 820 hosts.

### Reading (every night, GitHub Actions, like the college-reported workflows)
`npm run sync-visit-events`, after midnight Eastern, in `.github/workflows/visit-events.yml` with the production
Supabase secret:
1. For each active host: `GET /register/?cmd=search&country=US` (one page; UF's is 56 KB), then each portal widget's
   `cmd=event_list` (the online events; paginate while `page=` changes the rows, never more than five pages).
2. For each event id not yet in `visit_events`, `GET /register/?id=<guid>` for the year, timezone, venue, ZIP, and
   description. Known events are refreshed from the search rows alone (title, availability); their event page is
   re-read only when the row changed or once a week.
3. Upsert; mark missing rows; write `visit_event_sync`.
Budget: 820 searches + about 200 widget calls + new event pages. The first run reads every event page (UF alone has
500; across all hosts perhaps 150,000, at one request a second per host in parallel across hosts, a few hours);
later nights read a few thousand. A host that fails three nights running is `unreachable` and tried weekly; a host
whose search returns no rows for a month is `no_events`. The data-health page of the admin console
([admin.md](admin.md)) shows the last run and the hosts in each state.

### Alerting (every night after the read, `/api/cron/visit-alerts`, Vercel Cron, 13:00 UTC like the digest)
For every user with `email_visit_alerts` on and a measuring point: the events with `first_seen` in the last 24 hours
(or `changed_at`, when the change is a new date or venue) at followed, unmuted colleges, within `radius_miles` of
the point, not staff, not past, not online unless `include_online`. At least one such event: **one email**, grouped by
college. No email for events outside the radius, but the email's footer counts them ("UF also added 41 events
farther away; see them on your visits page"). Recorded in `visit_alerts` only once sent; a user gets at most one
alert a night; the first night after someone turns alerts on (or sets a home) sends nothing about the backlog, only
a line in the next alert ("Since you joined, 12 events near you are already listed").

The email: the subject names the nearest event ("UF is visiting Marietta High School on Oct 19"); each block has
the college's crest and name, then each event as a line with the day, time, venue, town, and distance ("Mon 19 Oct ·
11:40 am · Decatur High School, Decatur, GA · 14 miles"), a **Sign up** link to the college's page, and "Add to
calendar" (the planner's `.ics`); the footer has the per-college "Stop alerts for UF" link (one click, by token,
inserts a mute), the radius with a link to change it, and one-click unsubscribe (`List-Unsubscribe-Post`). Built
pure in `lib/emails/visit-alert.ts` like `lib/digest.ts`, with the HTML and plain-text bodies from one template.

## Display (signed in)
- **College page**: an **Event calendar** button in the hero, to the right of the social bar, with the count of
  upcoming events (owner, 2026-10-13: the calendar shows only when asked for, never as the first thing on the page).
  It opens the same page with `?view=events`: the college's header stays, and the stats below are replaced by the
  calendar: a "Back to the college" link, the next three on-campus events and the next three near the family ("Near
  you: Decatur High School, Mon 19 Oct, 14 miles"), each with the date, time, place, open/full, and a Sign up link,
  then the whole calendar with the kind chips (Campus tours · Sessions · Near you · Online · Everything) and a state
  filter for the travel calendar. The button turns into "Back to the college" while the view is open. Signed out, the
  button (and a direct `?view=events` link) goes to the sign-up form (`/login?mode=signup`) and returns to the
  calendar afterwards; the count is the one public figure.
- **`/me/visits`**: every upcoming event at the colleges on the person's lists, nearest first, then by date; a
  **Near you** section at the top with the radius control; per college, the alert switch (the same mute as the email
  footer). Guardians see the same for the colleges they follow.
- **Planner** ([planner/actions.md](../planner/actions.md)): the list row's "Book a visit" shows the next two events;
  "I registered" on an event writes a `plan_visits` row (kind mapped, date, time, `registration_url` = the event's
  page) so the timeline, the calendar feed, and the after-visit notes prompt all follow. An event that passed with a
  registration logged prompts the notes as today.
- **Profile (`/me`)**: "Visit alerts" with the radius (10 to 250 miles, default 30), measure from (auto / home /
  high school, with the point in use shown), include online sessions (off), and the muted colleges list.
- **Phones**: the event line is one row with the Sign up button at the right; the college filter chips scroll.

Everything shows the read time ("read this morning at 3:10") and nothing claims seats or dates the college didn't.

## Privacy and telemetry
Events are public data about colleges; which person was emailed which event is theirs (`visit_alerts`, own-row RLS,
deleted and exported with the account). Distances are computed on the server from the home or high school point and
never sent to analytics. Telemetry ([telemetry.md](telemetry.md)) gains `visit_events_viewed` (surface: profile / me /
planner; kind filter), `visit_signup_clicked` (unit_id, kind, near: bool), `visit_alert_sent` (server; college_count,
event_count), `visit_alert_muted` (unit_id), and `visit_radius_changed` (miles). Success: share of signed-in people
with a measuring point who open a visit alert, sign-up clicks per alert, and a mute rate under 10% per college.

## Checks
- `tests/visit-events.test.mts`: the standard-search parser on saved UF, Duke, and Bowdoin pages (row count, ids,
  the "no year" dates placed in the current cycle until the event page is read); the widget parser (online flag,
  legend); the event-page parser (full date, timezone, ZIP, closed registration); the kind rules on the 659 UF and
  Duke titles from the research (every staff row caught, no tour mis-tagged travel); dedupe across sources; the
  removed-after-two-misses rule; the radius and measuring-point rules; one email per user per night; the mute and
  unsubscribe tokens; and the rendered email's text body.
- `npm run check:visit-events` after each sync: hosts read, the share of new events with a ZIP (target 95%), staff
  share per host (a host above 40% is listed for a new title pattern), duplicate titles at one time and place, dates
  more than 18 months out, and any row with `starts_at` before `first_seen` by more than a day.

## Pilot
Two weeks on UF, Duke, and the 20 other Slate colleges from the research sample, dev Supabase, alerts to the owner's
address only: measure the nightly change rate (how many new events a night, to size the emails), the geocode share,
the noise patterns a filter misses, and whether the standard search ever drops a live event. Then all hosts, with
alerts to everyone.

## Open questions
1. **Online sessions in alerts.** They have no distance. Default off in the alert, on the pages; is that right, or
   should a family far from every campus get them by default?
2. **One switch or two per college.** The household hub already has an Updates switch per college for data digests.
   This spec adds a separate mute for visit alerts, so a family can keep data updates and stop visit mail. Merge
   them if that is one switch too many.
3. **Registration deadlines.** The event page says when registration closed, not when it will close. Alert again a
   few days before an event the family hasn't registered for (per the planner's log)? Default: no; the planner's
   day-before reminder covers a logged visit.
4. **The 40% not on Slate.** Nothing in the first build. TargetX and Element451 each have fixed portals too; worth
   a reader each once Slate is live and measured.
5. **Technolutions.** Send the partnership email (`proposals@technolutions.com`) when the build starts; a feed
   would replace the reader and remove the terms question.
6. **Guardians' measuring point.** A guardian with no home set and two students at different high schools gets
   each student's radius in turn; is one email per guardian per night still right, with both students' events?

## Implementation plan
1. **Discovery and the reader** (`scripts/lib/visit-events/`: `discover.mts`, `slate-search.mts`, `slate-widget.mts`,
   `event-page.mts`, `kinds.mts`; the migration for `slate_hosts`, `visit_events`, `visit_event_sync`; the sync
   script and workflow; `check:visit-events`). Pure parsers with the research pages as fixtures.
2. **Pages** (`app/me/visits/`, the college page block, `components/visits/`, the signed-out count; `lib/visits.ts`
   for distance and the measuring point; the profile settings and the mutes migration).
3. **Alerts** (`lib/emails/visit-alert.ts`, `app/api/cron/visit-alerts/route.ts`, the `vercel.json` entry, the
   per-college mute and unsubscribe routes, `visit_alerts`).
4. **Planner tie-in** ("I registered" → `plan_visits`; the list row's next events).
5. **Pilot**, then every host, with the admin data-health rows.

Complexity: extra large (a new pipeline with its own nightly job, checks, emails, and a pilot).

## As built (2026-10-13)
Built the day it was planned, on `feature/visit-events`, as five units with the build-roadmap-section method (the
brief and prompts are in the owner's `visit-events-build/` folder, outside the repo). A **pilot on four colleges**:
UF (527 live events), Duke (153), UNC (819), UT Austin (609) on the dev project; `--all` discovery over the 1,390 visit
links has not been run yet.

**Reader** (`scripts/lib/visit-events/`, `npm run sync-visit-events`, `npm run check:visit-events`; U1):
`parseStandardSearch`, `findWidgetServices`/`parseWidgetList`, `parseEventPage`, `discoverSlateHost` (one hop from the
visit link, then the apply link; weaker links on the host such as `/status` are accepted and every host is confirmed by
its standard search), `syncHost` with a pure diff, `store.mts` writing in batches of 500. Dates in
`lib/visit-events/dates.ts`: a search date lands in the twelve months starting yesterday (the printed weekday breaks a
tie), the event page confirms year and zone, and until then the state's usual zone is assumed. No-ZIP events (UF's
campus ZIP 32611 has no ZCTA) take the event page's own map centre. `moved_at` is set for a start, venue, address, or
city change on a confirmed row; title and availability changes move only `changed_at`. "closed" from the event page
outranks the widget's "full". UT's widget nests a placeholder item inside each real one; the parser reads the outer
item. Not built in the first round: the weekly re-read of unchanged event pages. The `no_events` status, the
last-attempt timestamp, and the retry rules came in round 2 (below).

**Pages** (U2, then the owner's review): `lib/visit-events/read.ts` and `view.ts` (pure grouping, chips, wording),
`store.ts`; `components/visits/`; `/me/visits`; settings on `/account` beside the Updates switch (`/me` redirects).
The first build put an "Upcoming visits" block under the hero; the owner's review the same day replaced it with the
**Event calendar** button (`EventCalendarButton`, a `trailing` slot in `HeroIdentity`) and the `?view=events` view
(`VisitCalendar`, rendered by `app/schools/[id]/page.tsx` in place of the stats). `/login` gained `?mode=signup`,
which opens the form on "Create an account". Chips: Sessions = `info_session` + `open_house` + `other`; Near you = `travel`. "Add to calendar" is
a client-side `.ics` from `lib/ics.ts`. No React render test (the repo's only pattern compiles `.tsx` by hand).

**Alerts** (U3): `lib/visit-events/alerts.ts` (`selectAlerts`), `lib/emails/visit-alert.ts`, `/api/cron/visit-alerts`
(13:00 UTC; `?dry=1` returns the rendered messages without sending), `/unsubscribe/<token>/visits[/<unit>]` (GET
confirms, POST acts, RFC 8058 one-click). Besides the spec: a host's own first night never alerts (its whole calendar
is new that night); people without a prefs row get the defaults; the first-night rule for a home applies only when the
home is the measuring point; a college with nothing near is left out of the email entirely. Not built: the "Since you
joined, N events near you" line. The account export gains a `visit_alerts` section.

**Planner** (U4): `components/visits/NextEvents.tsx` under the row's Log a visit button, fed by a server action
(`lib/planner/visit-feed.ts`) because the row is a client tree; "I registered" prefills `VisitForm` (kind via
`planVisitKind`, date and time in the event's zone, `registration_url`). `RowDrawer`'s older "We visited" flow is
untouched.

**Second migration** (`20261013190000_visit_events_moved.sql`): `visit_events.moved_at`, `visit_alert_prefs.created`
(the first-night rule reads it, so a radius change skips nothing), admin read policies on the three alert tables.

**Workflow** `.github/workflows/visit-events.yml`: 07:00 UTC, target `dev` during the pilot (`DEV_SUPABASE_*`
repository secrets), `prod` by dispatch or by changing `SCHEDULE_TARGET`; skips cleanly without secrets.

**Open from the build:** UNC's stored visit link is a video-tours page (discovery coped; the links data could be
corrected); UT's `/portal/campus_walking_tour` widget times out every run (logged, harmless); Duke's `/portal/
group-tours` adds staff rows (29% staff share there, all hidden); the Vercel Preview environment has no `CRON_SECRET`,
so the alert route can be exercised on a preview only by hand with a bearer token set for the deployment.
