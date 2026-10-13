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
- **College page**, under the official links: **Upcoming visits**: the next three on-campus events and the next
  three near the family ("Near you: Decatur High School, Mon 19 Oct, 14 miles"), each with the date, time, place,
  open/full, and a Sign up link; "All 528 events" opens the full list for that college with the kind chips (Campus
  tours · Sessions · Near you · Online · Everything) and a state filter for the travel calendar. Signed out: "UF lists
  528 upcoming events, 4 within 30 miles of Marietta. Sign in to see them" (the count by ZIP is a public figure; the
  rows are not).
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
item. Not built: the weekly re-read of unchanged event pages, the `no_events` host status, a last-attempt timestamp for
unreachable hosts (retried on Sundays for now).

**Pages** (U2): `lib/visit-events/read.ts` and `view.ts` (pure grouping, chips, wording), `store.ts`; `components/
visits/`; `/me/visits`; the block under the college page's hero; settings on `/account` beside the Updates switch
(`/me` redirects). Chips: Sessions = `info_session` + `open_house` + `other`; Near you = `travel`. "Add to calendar" is
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
