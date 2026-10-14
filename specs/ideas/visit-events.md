# Visit Events: Tours, Info Sessions, and Admissions Events From Each College's Own Calendar

> Status: **promoted** 2026-10-13 to [product/visit-events.md](../product/visit-events.md) (planned), after the
> desktop research below ([What the desktop research found](#what-the-desktop-research-found-2026-10-13-desktop)) and
> the owner's decisions: travel events in, signed-in only, a nightly refresh, radius-limited alert emails with a
> per-college switch. The cloud session's notes stay here as the record. Builds on the visit links in
> [links.md](../school-identity/links.md) and the planner's visit log ([actions.md](../planner/actions.md)). Part of
> [ideas](README.md).

## What the desktop research found (2026-10-13, desktop)
The six items under [Research still to do](#research-still-to-do), done from the desktop with UF (unit 134130) as the
trace and Duke (198419) as the second college. The sample pages and the 659 parsed events are in the session's
scratch; the product spec carries the conclusions.

1. **Slate coverage.** 100 of the 1,390 visit links, one hop each: 59 reach a Slate `/portal/` or `/register/` page
   (about 820 colleges extrapolated). The others: YouVisit 29 (virtual tours), a campus calendar 25, TargetX 6,
   Element451 5, VisitDays 4, other CRMs 9, plain forms 15, one 403. Slate hosts are `apply.`, `admissions.`,
   `connect.`, `go.`, `undergrad.admissions.`, `admiss.ugrad.` and the like.
2. **A Slate event portal, read.** UF's `undergrad.admissions.ufl.edu/portal/uf-campus-tour` renders its list with
   `event.js` against `/portal/widget/event?portal_id=…&part=…`: `cmd=event_dates&dtstart=&dtend=` returns JSON
   `{dates:[["2026-10-21","0"],…]}`; `cmd=event_list&date=` returns HTML items with `data-date`, `data-online`,
   `data-location`, a `/register/?id=<guid>` link, and an available/unavailable legend; `cmd=event_markers` returns
   map markers. The widget protocol worked on 6 of 6 other Slate portals; the inner markup is each college's template
   (UF prints "23 spots available" per slot, Bowdoin prints "Sign up").
   **The bigger find:** every Slate host also serves Slate's standard event search, `/register/?cmd=search` with
   `zip=`, or `country=US` / `US-GA`, listing every placed event as `<li>` rows with a `?id=` link, title,
   "Wednesday, October 21 at 9:00 AM", and city; it answered on 9 of 9 hosts (130 to 879 events each). Online
   events appear only in the widgets. The event page states the full date, timezone, venue with ZIP, and whether
   registration closed. No iCal, RSS, or JSON anywhere.
3. **CampusBooker.** A Vite single-page app on Supabase with tables `events`, `colleges`, `urls`,
   `college_fair_events` and an admin route `/api/extract-portal-ids` that takes a URL and returns Slate portal ids:
   it scrapes Slate portals, plus hand-entered fairs. Its event fields: `event_name, event_date, start_time,
   end_time, event_type, is_online, booking_page_url`. Its sitemap of 6,416 college slugs is an IPEDS list, not
   coverage. Its JS bundle cites College Scorecard, IPEDS, the CDS, and Common App as data sources.
4. **Terms.** Technolutions has no terms-of-use page (a privacy policy and a contact page; `proposals@` for
   partnerships). Every Slate host serves the same robots.txt: `gsa-crawler` and `GPTBot` disallowed, `*` allowed.
   UF's and Duke's site policies govern their own users.
5. **Common App requirements grid.** Now inside the applicant dashboard, not a public file; it belongs to
   [cycle-watch.md](cycle-watch.md), not here.
6. **Technolutions.** No partner program for data consumers; one email, when the build starts.

What the two colleges publish (2026-10-13): UF 528 events (340 rep visits and fairs in 18 states, 132 tours, 40
sessions, 9 online, 3 open houses, 4 staff rows); Duke 131 (75 tours and sessions with open/full per slot, 15 travel
evenings such as "Discover Duke - Denver", 1 online, **40 staff rows**: "Requested Group / Filled", hotel shipping,
materials pickups). UF's high-school visits carry a public registration form (name, email, high school, graduation
year), which is what moved the travel events from a question to the point of the feature.

## Question it answers
*When can we visit, and what's on?* Families plan visits around tours, information sessions, open houses, and
admitted-student days, and today each college's calendar is a separate site. A page that lists the upcoming events at
the colleges on a family's list (or near a place they'll be), with a link to book on the college's own page, turns a
dozen tabs into one view and feeds the planner's visit log.

## What we learned (2026-10-13)

### CampusBooker: the existing product
- campusbooker.com lists "college tours, virtual information sessions, college fairs, and admissions events from 800+
  universities", searchable by ZIP, city, or state, "with direct booking links to each college's official registration
  page" (its own homepage, via search results; the site itself was blocked from the cloud session).
- It does not say where its data comes from. The likely answer (an **inference**, not confirmed): it reads each
  college's public event calendar on a schedule. It takes no bookings itself, which fits reading public pages rather
  than a partnership with the colleges.
- No reviews or third-party coverage turned up, and its claim of 800+ colleges isn't verified. Not to be confused with
  CampusTours.com (virtual tours and maps).

### Where colleges publish their events
- **Slate** (Technolutions) is the admissions CRM most selective colleges use, and its event portals are public pages
  with the same structure everywhere: `https://<host>/portal/<page>`. UCLA's tour sign-up, for example, is
  `connect.admission.ucla.edu/portal/tours`. One reader could cover every Slate college.
- The rest use a handful of other visit vendors (to be identified; see research below), each with its own fixed layout.

### What our dataset already has
Measured on `data/schools.json` (1,893 colleges) on 2026-10-13:

| | Colleges |
|---|---|
| A visit link (`links.visit`, [links.md](../school-identity/links.md)) | 1,390 |
| …that is itself a Slate-style `/portal/` page | 67 (e.g. `apply.assumption.edu/portal/campus-visit`, `go.chapman.edu/portal/visit`, `admissions.calvin.edu/portal/visit`) |
| An apply link (`links.apply`) | 1,757 |
| …on a Slate-style host or `/portal/` page | 26 (e.g. `slate.admissions.arizona.edu/apply`, `slate.nebrwesleyan.edu/apply/`) |

Most visit links point at the college's own "Visit" page, which usually links on to its registration system (often a
Slate portal on another host such as `apply.`, `admissions.`, or `connect.`). So the number of Slate colleges reachable
in one hop is likely much higher than 67; measuring it is the first research step.

### Slate.org is not a data source
Asked whether a Slate.org account would give us this data (it doesn't):
- **Slate.org** is Technolutions' free portal for **high school counselors**: track their own students' applications
  and decisions at Slate colleges, upload transcripts and recommendations, and keep lists. Accounts are verified
  counselors at a real school (an admin at the school approves them, or Technolutions checks a staff directory, school
  profile, or business card).
- **Start.edu** is its student-facing partner, built with NACAC: a college search where students build lists and
  signal interest to colleges.
- Neither offers college-wide figures, an export, or an API, as far as their help pages say. Quad isn't a counseling
  office, so an account obtained to collect data would misrepresent us and likely break their terms.
- A data partnership with Technolutions is a separate question worth one email (below).

### A related lead: deadlines and requirements
Common App publishes a yearly **requirements grid** for its member colleges (deadlines, fees, test policy,
recommendations). It's a possible bulk source for [cycle-watch.md](cycle-watch.md) and the application logistics the
CDS doesn't cover; not yet examined.

## Data (sketch)
A `visit_events` table rebuilt on a schedule, one row per college × event:

| Field | From |
|---|---|
| `unit_id`, `title`, `kind` (tour, info session, open house, admitted students, virtual, fair) | the portal's event list; `kind` from the title |
| `starts_at`, `ends_at`, `timezone`, `location` (on campus, virtual, or a city for travel events) | the event page |
| `seats_left` or `full` | where the portal shows it |
| `book_url` | the event's own page on the college's site (always link out; never take a booking) |
| lineage: `source_url`, `retrieved` | the page read, per [data-lineage.md](../data-lineage.md) |

Events change daily, so this is the site's first data that goes stale in days rather than months: it can't wait for
the monthly data release. It probably belongs in Supabase (like the change log), refreshed by its own workflow, with
the date read shown on every row.

## Display (sketch)
- **College page:** "Upcoming visits" under the visit link: the next few events with dates and a Book link.
- **Planner:** on each college in the list, the next events; booking one offers to add it to the visit log
  ([actions.md](../planner/actions.md)), and a past one prompts the visit notes.
- **A trip view** with [near-and-far.md](near-and-far.md): the colleges on the list near each other, with events on
  the same days.
- **Search by place and date**, CampusBooker's main view, is the least important for Quad: families start from their
  list.

## Open questions
1. **Terms of use.** Do colleges' sites or Slate's terms limit automated reading of event pages? Reading public pages
   to link back is common, but check before building. A polite rate (one read per college per day) and an honest
   user agent are a given.
2. **How many colleges** have a readable event calendar, and on which systems? (Research step 1.)
3. **Freshness.** How often do events change, and how stale can a listing be before it misleads? Should full events
   show at all?
4. **Partnership instead of scraping.** Would Technolutions (or the other vendors) share event feeds with a free,
   ad-free site? One email answers it.
5. **Scope.** Campus visits only, or also college fairs and regional travel ("Duke is in Denver on March 3")? The
   travel events are what a family far from campus most wants.

## Research still to do
The cloud session couldn't reach campusbooker.com, slate.org, technolutions.com, or knowledge.technolutions.net
(blocked by its network), so these wait for a desktop session:
1. **Measure Slate coverage.** For each of the 1,390 visit links, follow one hop and record whether the page links to
   a `/portal/` page (and on which host). Also look for other vendors' hosts and record the most common ones.
2. **Read a Slate event portal.** Pick five Slate colleges and check what a portal's event list shows without
   signing in: titles, dates, times, seats, and whether there's an iCal or JSON feed behind it. Note the page
   structure that a reader would rely on.
3. **CampusBooker in detail.** Its about/FAQ page, which colleges and event kinds it covers, how fresh its listings
   are, and its link patterns (which vendors its Book links point to). Whether it says anything about its sources or
   terms.
4. **Terms.** Slate's and two or three colleges' website terms on automated access.
5. **Common App requirements grid.** Find the current edition, its format (PDF or spreadsheet), the fields, and its
   terms of use.
6. **Technolutions.** Whether they offer event feeds or a data partnership; whom to email.

Then decide: planned (with a complexity and a place in the build order), or dropped.
