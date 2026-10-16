# Guide: Show a College You're Interested

> Status: **built** 2026-10-16 (PR #165). After [../now.md](../now.md) and [../connections.md](../connections.md) (which takes
> the capture panel off the list). Builds on interest and visits ([../../next-steps/interest-and-visits.md](../../next-steps/interest-and-visits.md)),
> the visit log ([../../actions.md](../../actions.md)), visit events ([../../../product/visit-events.md](../../../product/visit-events.md)),
> and the follow intents ([../../README.md](../../README.md#research-2026-10-07)). Part 4 of [plan v3](../README.md).

## Goal
The owner: "A guide to show interest. This is where we'd book tours, sign up for socials, subscribe to mailing lists,
show the events. Can we do something where if they click on something we manage in a browser tab where we can track
what they actually did? That way we can add to the calendar things like tour dates and locations or fairs that they've
signed up for. If not, should we assume that if they clicked they added it, but then send them a confirm notification
via email later that day or the next?"

For one college, the guide says whether interest counts there and why, lists the acts in the order the evidence
supports, gives each a button that opens the college's own page, and then finds out what happened.

## Tracking what they did: the honest version
A college's booking page is another origin. A browser gives a site no view into another tab: not the URL after the
click, not the form, not the confirmation page. The two things that *are* observable are the click itself and the
moment the student comes back to our tab. So the design is three layers, each catching what the one before missed:

1. **The click** records a **pending act**: which college, which act (tour, information session, open house, fair, a
   named event, information request, mailing list, follow), the URL opened, and the event when the button was an event's
   (its id, date, time, place). Shown to the student as "Pending: did you register?" on that row; shown to no one else.
2. **The return prompt.** The button opens the page in a new tab (`target="_blank"`). When our tab regains focus
   (`visibilitychange` to visible, or `focus`, with the pending act under five minutes old), a small sheet asks once:
   "Did you register for Duke's tour on Nov 3 at 10 AM?" **Yes, registered** · **Not yet** · **I picked a different
   date** (opens the visit form prefilled, date editable). Yes confirms the act; Not yet leaves it pending; the sheet
   never asks twice for the same act.
3. **The confirmation email.** Each morning (the digest's daily job), every act pending since yesterday or earlier and
   not yet asked by email gets one email per person: "Yesterday you opened Duke's tour sign-up for Nov 3. Did you
   register?" with two one-click links by token (**Yes** · **No**), and a line per other pending act. One email a day at
   most, in the digest's style, with the built unsubscribe (it is part of plan reminders). Nothing goes out while email
   is dormant ([../../next-steps/notifications.md](../../next-steps/notifications.md#rules)); the acts stay pending and
   the return prompt remains the way to confirm.

A pending act that reaches **seven days past the event's date** (or 14 days after the click, undated) **expires**:
dropped from the student's view, kept in the table as `expired`. Nothing expired ever reaches the calendar.

**What a confirmed act writes**, through the built stores:
| Act | Writes | On the calendar |
|---|---|---|
| Tour, information session, open house, fair, named event | a `plan_visits` row (kind mapped, date, time, `registered: true`, `registration_url`, the venue in the notes) via `logVisit`; `list_items.visited_on` once the date passes (built) | Yes, the visit lane, with the place; the day-before text where texts are on |
| Information request, mailing list | `list_items.info_requested_on` (today) via `markInfoRequested` | No |
| Follow | `recordFollow` for that network | No |

Confirming also ticks the college's open interest or visit move (the generator reads `hooks.interest`, built), so the
Now card goes. The owner's fallback ("assume if they clicked they added it") is **not** adopted: an assumed tour on a
family calendar is worse than a missing one, and the email catches most of what the prompt misses.

## The page
`/plan/guide/interest?college=<unit id>` (a row's interest pill, an interest or visit move, the college profile's visit
card when signed in). Without `college`, the **overview** below.

```
← Back to your plan
Show Elon you're interested
Elon says applicant interest is important (2025–26, CDS C7). What counts most, in order.

1  VISIT                                                               counts most
   Elon's next events near you (read from Elon's calendar this morning)
   ┌ Sat Nov 8 · 10:00 AM · Fall Open House · Elon, NC · 212 mi        [Register ↗] ┐
   ┌ Thu Oct 23 · 7:00 PM · Elon in Atlanta · Marietta HS · 9 mi       [Register ↗] ┐
   [All of Elon's events]   [Elon's visit page ↗]   [We already visited]
   Pending: did you register for Fall Open House, Nov 8?  [Yes] [Not yet]

2  ASK FOR INFORMATION                                                 counts
   An information request or a mailing-list sign-up puts you in Elon's system.
   [Request information ↗]   [We already did]

3  FOLLOW                                                              weakest signal
   No college says it counts a follow; do it for yourself.
   [Instagram ↗] [YouTube ↗] [TikTok ↗]   each a toggle once confirmed

Logged for Elon: visited Mar 14 (campus tour) · info requested Sep 2
```
- **The why**: the C7 line with its citation and edition; where the college says interest is **not considered**, the
  header says so ("Elon says it doesn't consider applicant interest. These are for you, not for the application.") and
  the sections stay, muted; where C7 is unknown, "Elon hasn't said whether interest counts."
- **1 Visit**: the next events within the family's radius first, then the next two on campus (`nextTwoEvents` logic,
  built, widened to four), each with **Register** (the event's `book_url`, tracked as above). **All of Elon's events**
  opens the college's events page (built, signed-in). **Elon's visit page** is the built `visitPageLink` for colleges
  without events (tracked as a tour, undated: the return prompt asks for the date). **We already visited** opens the
  visit form (built `VisitForm`). Where the college has a virtual tour and no visit page, that link.
- **2 Ask for information**: **Request information** opens the college's admissions page (`links.admissions`; a
  `links.request_info` is a discovery item for the links pipeline, [below](#open-questions)), tracked as an
  information request. **We already did** records it dated today, date editable.
- **3 Follow**: one button per account the college has, in the built order with the built intents (X's follow intent,
  YouTube's subscribe prompt, else the profile), each tracked as a follow and confirmed by the return prompt ("Following
  Elon on Instagram?"). A guardian sees state, not buttons (built rule).
- **Logged**: what the plan already records for this college, in one line.
- **Footer**: the move's Done and Skip when a move led here.

### The overview (no college)
Reached from the spring and fall "visit" moves and the people line: every college on the list where interest is at least
considered, in the move order (ED candidates first, then important / very important, then considered in the band), each
a row: name, the C7 word, what's logged, and **Show interest →** to its page. Colleges where it isn't considered are
folded under "Interest isn't considered at these 4; visit for yourself."

## The act record
```
plan_interest_acts (id uuid pk, item_id → list_items, user_id, act text check in ('tour','info_session','open_house',
  'fair','event','info_request','mailing_list','follow'), network text null, url text, event_id text null,
  event_starts_at timestamptz null, event_place text null, clicked_at timestamptz, prompted_at timestamptz null,
  emailed_at timestamptz null, status text check in ('pending','confirmed','declined','expired') default 'pending',
  resolved_at timestamptz null, resolved_via text null check in ('prompt','email','manual'),
  visit_id uuid null → plan_visits, confirm_token text unique)
```
RLS like `plan_visits` (the household's read, the actor's write). Exported and deleted with the account. The daily job's
step `interest-confirmations` selects pending acts with `emailed_at null` and `clicked_at < today`, groups by user,
sends one email, sets `emailed_at`. `/api/plan/interest/confirm?token=…&answer=yes|no` resolves by token (signed-out
safe: it writes only this act). `expireInterestActs()` runs in the same step.

## Rules
- The guide never says a visit improves the odds; it says what the college reports and what colleges log (built rule).
- An unconfirmed act never reaches the calendar, a text, a brief, or a parent's view; a confirmed one is a visit like
  any other.
- One confirmation email a day at most, never to a minor without the household's consent rule for email (the account's
  own address; the built reminder rules), never carrying a personal number.
- Follows are the student's own; a guardian confirms visits and information requests (a family visits together), never
  follows.
- Telemetry: `plan_interest_act {act, via: click|manual}`, `plan_interest_confirmed {act, via: prompt|email}`,
  `plan_interest_expired {act}`; never the college.

## Files (planned)
`lib/planner/interest-acts.ts` (pure: the act kinds, `expiresAt`, the prompt question), `lib/planner/store-interest.ts`
(record, confirm, decline, the visit write), `lib/emails/interest-confirm.ts`, the daily job's step
(`app/api/cron/daily/route.ts`), `app/api/plan/interest/confirm/route.ts`, `components/planner/guides/InterestGuide.tsx`,
`InterestOverview.tsx`, `ActButton.tsx` (opens, records, arms the return prompt), `ReturnPrompt.tsx`, migration
`…_plan_interest_acts.sql`. Reuses `NextEvents`' logic, `VisitForm`, `logVisit`, `markInfoRequested`, `recordFollow`,
`followTargets`, `visitPageLink`. Tests: `tests/planner-interest-acts.test.mts` (the state machine; expiry; a confirmed
event becomes a visit with the right kind and date; a declined one writes nothing; one email a day; the token resolves
once; the return prompt asks once per act; nothing pending reaches `nowMoves`' tick or the calendar feed).

## Open questions
1. **A request-information link per college.** The links pipeline finds visit and apply pages; an admissions
   "request information" form is a similar discovery (`links.request_info`). Recommendation: add it to the links
   pipeline as its own small data item; until then the admissions page.
2. **Should the return prompt also appear for the test-registration link** ([test-prep.md](test-prep.md))? Yes; that
   guide reuses `ActButton` with act `test_register`.
3. Should a confirmed tour send a calendar invitation (`.ics`) by email as well as appear in the feed? Recommendation:
   not now; the feed and the day-before text cover it.

## As built
- Act tracking: `plan_interest_acts` table records tours, info sessions, open houses, fairs, events, info requests, mailing lists, follows, and test registrations.
- The return prompt arms on `visibilitychange`/`focus` and asks once per act; "Not yet" leaves it pending for the next-morning email. Server cron `app/api/cron/interest-confirm/route.ts` at 13:30 UTC sends one email per person per day.
- Event times are printed in the event's timezone (from `visit_events.timezone`); no zone shows date only.
- Yes/No email links open a one-button page; a scanner's prefetch writes nothing.
- Confirmed acts write through built stores: tours/info_sessions/open_houses/fairs/events → `logVisit` + visit_id; info_request/mailing_list → `markInfoRequested`; follow → `recordFollow`; test_register → the date into `tests.registeredDates`.
- Social follows are the last option in Show interest, kept as the spec recommends.
