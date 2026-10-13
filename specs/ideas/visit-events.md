# Visit Events: Tours, Info Sessions, and Admissions Events From Each College's Own Calendar

> Status: **idea** (2026-10-13). Research notes from a cloud session; **more research is needed** (see
> [Research still to do](#research-still-to-do)), which the owner will do from a desktop session with fuller network
> access. Builds on the visit links in [links.md](../school-identity/links.md) and the planner's visit log
> ([actions.md](../planner/actions.md)). Part of [ideas](README.md).

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
