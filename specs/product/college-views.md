# College views

Owner, 2026-10-13: "track when someone looks at a college along with who… a simple table." Each time someone opens a
college's profile page, Quad keeps one row: the college, the page, when, and the account if they're signed in. The
admin console reads it both ways: what a person is looking at, and who is looking at a college, each drilling down to
the individual times. The data is kept for later uses too (interest signals, popular colleges, recommendations).

## What is recorded

| Column | |
|---|---|
| `unit_id` | The college (six digits; the route also checks the dataset has it) |
| `user_id` | The signed-in account, from the session, never from the request; null when signed out |
| `page` | `overview` or a topic page (`admissions`, `students`, `academics`, `cost`, `outcomes`, `history`) |
| `viewed_at` | When |

- **Signed out** views keep no user, cookie, address, or browser id. They count; they can't be tied to anyone.
- **Repeats.** The browser sends a page once per tab per 10 minutes (sessionStorage), and the database folds a
  signed-in person's repeat of the same page within 10 minutes. Signed-out repeats in a new tab count again.
- **Not recorded**: a browser privacy signal (Global Privacy Control or Do Not Track, checked in the browser and again
  from the `Sec-GPC`/`DNT` headers), obvious bots, unknown colleges, the admin console.
- **Kept** with no expiry for now. When an account is purged its rows become signed-out rows (`on delete set null`), so
  college counts don't change.

## How it is recorded

`components/profile/ViewBeacon.tsx` on the overview and every topic page (via `TopicPage`) posts `{ unit, page }` to
`/api/college-view` after the page loads; the profile pages stay static. The route calls `record_college_view()` with
the visitor's session (or none), which validates, folds repeats, and inserts. The route always answers 204.

## Who can read it

- **Admins in the console** (`admin_reads()`), through `admin_user_college_views`, `admin_college_viewers`,
  `admin_college_views_daily`, and `admin_college_view_times` (migration `20261013140000_college_views.sql`).
- **The person**, their own rows only, in their account download (`college_views` in `lib/account-export.ts`).
- Nobody else. The privacy page says so ("If you sign in": College pages you open).
- **Students are told.** Which colleges a student opens is their information: when the console shows a person who has
  their own student record, it writes `admin_log_access(student, 'college views')`, so their "Who viewed your
  information" shows Quad support, as the student page does.

## In the console

- **A person** (`/admin/people/[user]`, "Colleges viewed"): views and colleges, a 30-day chart of views per day, and
  the top eight colleges as bars; each opens `/admin/people/[user]/views?unit=…` (every time and page).
  "All" opens `/admin/people/[user]/views` (every college with views, first, last).
- **A college** (`/admin/colleges/[unit]`, "Who's looking"): views, signed-in people, signed-out views, a 30-day chart
  (signed in and signed out stacked), and the top eight viewers, signed-out visitors as one row; each opens that
  person's times for the college, or `/admin/colleges/[unit]/views?signed_out=1`. "All" lists every viewer.
- Charts use the compare slots `--s1` (signed in) and `--s2` (signed out), validated as a pair in both themes; each has
  a legend, a per-day hover label, and a hidden table for screen readers (`components/admin/ViewCharts.tsx`).

- **Colleges** (`/admin/colleges`, owner 2026-10-13): with no search, "Most viewed" lists the top ten colleges by views
  over 7 days, 30 days (default), or all time (`?views=7|30|all`, `admin_top_viewed_colleges(days, limit)`), each with
  its signed-in people and signed-out views, linking to the college's "Who's looking".

## Later

- Views as an interest signal in the planner.
- Rate limiting signed-out posts if the table is abused.
