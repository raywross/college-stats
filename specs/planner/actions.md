# Stage 3, Actions: Follow, Ask, Visit, and Keep Notes

> Status: **planned** 2026-10-07. After [model.md](model.md). Uses the built social accounts
> ([social-accounts.md](../school-identity/social-accounts.md)), official links ([links.md](../school-identity/links.md)),
> interest from CDS C7 ([cds-admissions.md](../data-expansion/cds-admissions.md)), and the home address
> ([home-and-distance.md](../product/home-and-distance.md)). Part of the [planner](README.md).

## Goal
Between building the list and applying, there are small things worth doing at every college: follow the admissions
office where it posts deadline reminders, get on its mailing list, visit (or take the virtual tour), and write down
what you thought while you still remember. This stage puts those actions on one panel per college, **does the
action for the student where a network or a college lets a site do it**, and otherwise opens the right page and
records what they did. The visit log is the family's notebook for the trip, with prompts so the notes are useful in
April.

## What the site can and can't do for them (2026-10-07)
| Action | What's possible | What the planner does |
|---|---|---|
| Follow on **X** | A documented follow Web Intent (`https://x.com/intent/follow?screen_name={handle}`) opens a follow dialog with an inline sign-in | One click: opens the intent in a popup; on return, marks the network followed |
| Subscribe on **YouTube** | `https://www.youtube.com/channel/{id}?sub_confirmation=1` opens a subscribe prompt for a signed-in viewer | One click: opens it; on return, marks it |
| Follow on **Instagram** | No follow intent. The profile URL opens the app on a phone (iOS deep link `instagram://user?username=`, Android intent); the follow button is one tap away | One tap opens the profile (app on phones); the planner asks "Did you follow?" when the tab regains focus |
| Follow on **TikTok** | No follow intent; the `@handle` URL opens the profile with a follow button; the app deep link needs a numeric id the site doesn't have | As Instagram |
| Follow on **Facebook** | The follow button was retired in 2018; page URL only | As Instagram |
| Follow on **LinkedIn** | Page URL only | As Instagram; listed last and optional |
| **Request information** | Every college has a form (usually Slate or Technolutions); fields and URLs differ and no API exists | Opens the college's admissions page (or the request-information link when the links probe finds one); the student marks it done; the planner never fills a college's form on the student's behalf |
| **Book a visit** | The visit page per college is built (1,400 of 1,893 colleges; the rest in [follow-ups.md](../school-identity/follow-ups.md)) | Opens it; the student logs the visit here with the date, and gets a calendar file |
| **Virtual tour** | The visit page usually links one; CampusReel and YouVisit host others | Opens the visit page; "virtual" is a visit kind |
| **Interview** | Offered by some colleges, often alumni-run; CDS C7 says how much it counts, not whether it's offered | A visit kind; the C7 "interview" factor shown beside it |

The networks' own APIs (X, Meta, TikTok) would allow a true follow from the site but need app review, tokens per
user, and give nothing the intent doesn't; not used ([social-accounts.md](../school-identity/social-accounts.md#what-is-not-used)).
No OAuth, no tokens, no scraping: the planner stores a date and a network name.

## Why these actions, per college
The panel's reasons come from the college's own data, and the stage says plainly when an action is optional:
- **Interest** (C7 "level of applicant's interest"): *very important* or *important* → "This college says it
  considers your interest; visits, information requests, and opening its emails count" at the top of the panel;
  *considered* → the softer line; *not considered* → "This college says interest isn't considered; do these for
  yourself, not for the application" and the actions show as optional. Roughly 40–45% of colleges consider interest,
  mostly small and mid-sized privates ([README.md](README.md#research-2026-10-07)).
- **Following** is framed as *information*, not interest: "Admissions offices post deadline changes, event dates,
  and portal instructions on Instagram and TikTok first." Follower counts are never shown or stored.
- **Visiting** is framed as the student's research: the notes prompts are about them, not the college's CRM.

## Follow
- The row shows the college's accounts in the site's order (Instagram, YouTube, TikTok, X, Facebook, LinkedIn)
  with the network's colored icon ([social-accounts.md](../school-identity/social-accounts.md#display)); followed ones
  show a tick and date. One **Follow all** button runs through them in order (X and YouTube as intents; the rest open
  one at a time, each waiting for the "Did you follow?" answer).
- Storage: `followed_networks` (which) on the item and the existing `follows_social` (any), so the tracking row
  built in the hub keeps working.
- Signed out on a profile page, the same icons are plain links (built); the one-click behavior is for signed-in
  list items only, because the record is the point.
- A college with no accounts: "No accounts on record" with the Wikidata correction note from the identity spec.

## Request information
One button per college: opens the admissions page link (or the request-information URL once the links probe
collects one: a follow-up for [links.md](../school-identity/links.md), looking for `/request-info`, `/inquire`, "Join
our mailing list" in the admissions page's links). Marking done sets `info_requested_on`. The panel reminds the
student to use one email address for every college (the one on the account, or another they name once on the
profile) because colleges match interest records by email; nothing is sent by the site.

## Visits
A **visit log** per college (`plan_visits`, [model.md](model.md#tables)):

| Field | Notes |
|---|---|
| Kind | campus tour · information session · open house · virtual tour · interview · college fair · overnight · other |
| Date and time | future visits appear on the timeline and in the calendar feed; past ones in the log |
| Registered? | with the registration link if they have one; "Book on the college's visit page" opens the visit link |
| Who's going | names from the household roster, free text for others ("Grandma") |
| Rating | 1–5 after the visit, optional, the student's own ("how did it feel") |
| Notes | prompted, below |
| Distance | shown from home ([home-and-distance.md](../product/home-and-distance.md)); trips grouping is [near-and-far.md](../ideas/near-and-far.md)'s job |

**Notes prompts** (each a short field, all optional, written once and shown everywhere the visit appears):
*What stood out · What worried you · People you met (names and roles, for thank-you notes and essays) · Questions you
still have · Would you want to live here?* Plus a free field. A finished visit sets `visited_on` on the item (the
built column) so the tracking row shows it.

**Calendar**: every future visit has "Add to calendar" (an `.ics` download with the college's name, address, the
registration link, and a 24-hour alert); the timeline's subscription feed includes visits.

**Before you go** on a future visit: the questions the family hasn't answered that the site's data can't (from a
short fixed list: housing guarantee, how the major admits, merit aid timing, support services), each with "ask" to
add it to the visit's questions. The college's visit page link and the drive time from home sit under it.

**After**: a visit that has passed with no notes gets one gentle prompt in "This week" ("You visited Tufts Saturday;
write down what you thought while it's fresh") and then stops.

## Interviews
An interview is a visit kind with two extra fields: the interviewer's name and whether it was alumni or admissions.
The panel shows the C7 importance of "interview" at that college and the note that most interviews are
informational. No scheduling; the college's own process differs everywhere.

## Display
- **Stage panel**: one card per college in list order (the Dream first) with the interest line, the follow row,
  Request information, Visits (log + Book), and Interview; a count per card ("2 of 4 done"). A **Follow everyone**
  button at the top runs the follow flow across colleges that offer X or YouTube intents and queues the rest.
- **List row** "More": the same follow row and a "Log a visit" button (the tracking row's Visited and Following
  switches become these, so there is one place).
- **Timeline**: a `stage` task per college for follow and request information (no date; in season), and visits as
  dated events.
- **Parent's view**: everything read-only; a guardian with edit access can log a visit (they usually drove) and is
  shown as its creator; guardians can't mark a follow (it's the student's account).
- **Phones**: the follow row is a horizontal row of 44 px icons; "Did you follow?" is a bottom sheet; the visit form
  is one column with the notes prompts as expanding fields.
- **Glossary**: `demonstrated-interest` (exists as a term? add if not), `virtual-tour`, `information-session`.

## Rules
- The site never follows, subscribes, submits, or emails on the student's behalf. It opens the network's own flow
  and records the answer. The record is self-reported and says so on hover.
- Where a college says interest isn't considered, the panel says so and never implies the actions help the
  application.
- Visit notes are the list's; a guardian who can read the list reads them; a student who wants private thoughts
  uses a private list note (the built flag), and the visit form links to that.
- No photos (owner decision, [README.md](README.md#owner-decisions-2026-10-07)): notes and a rating are the record.

## Files (planned)
`lib/planner/actions.ts` (pure: follow URLs per network incl. intents and deep links, the interest line from C7,
visit kinds, the before-you-go questions), `components/planner/ActionsStage.tsx`, `FollowRow.tsx` (popup + focus
return), `VisitForm.tsx`, `VisitLog.tsx`, `lib/ics.ts` (shared with the timeline), `tests/planner-actions.test.mts`
(intent URLs per network and handle shape; the interest line for each C7 value and for null; a visit's `.ics`
fields; `visited_on` set by the first past visit).

## Open questions
1. Should the visit log accept a shared "family car" plan (several colleges on one trip, in order, with drive
   times)? That is [near-and-far.md](../ideas/near-and-far.md)'s trips feature; recommendation: build it there and
   link from here, so the idea has a reason to be planned.
2. The request-information URL: extend the links probe now (cheap: one more pattern over the admissions page) or wait
   for the planner build? Recommendation: now, as a small identity follow-up, so the button lands on the form.
