# Stage 3, Actions: Follow, Ask, Visit, and Keep Notes

> Status: **built** 2026-10-08 on `feature/planner` ([below](#built-2026-10-08-unit-u4-on-featureplanner-actions)); planned 2026-10-07. After [model.md](model.md). Uses the built social accounts
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

## Built (2026-10-08, unit U4 on `feature/planner-actions`)
What exists:
- **Pure** `lib/planner/actions.ts`: `followUrl` (X's follow Web Intent, YouTube's `sub_confirmation`, else the
  plain profile URL), `hasFollowIntent`, `appDeepLink` (Instagram's documented `instagram://user?username=` only —
  TikTok, Facebook, and LinkedIn have none), `orderForActions` (Dream first), `actionsProgress`, `interestLine` and
  `actionsOptional` from C7 `factors.interest` (every value and null), `interviewImportanceLine` from
  `factors.interview`, `VISIT_KINDS`/`VISIT_KIND_LABELS`, `VISIT_NOTE_PROMPTS`, `hasVisitNotes`,
  `BEFORE_YOU_GO_QUESTIONS`, and `firstPastVisitOn` (the pure rule behind `visited_on`: the earliest visit date at
  or before today).
- **Generator** `lib/planner/generators/actions.ts`: `follow` and `request_info`, undated, per live college (not
  `decided`, not withdrawn) while the plan is in season (`inSeason(grade)`); `follow` only when the college has
  social accounts and none are followed yet; `write_visit_notes` once per past visit with no notes (keyed by the
  visit's id, so several separately logged visits each get their own prompt).
- **Server** `lib/planner/store-actions.ts` ("use server", the `ready(capability)` pattern): `recordFollow` (only
  the student's own account — checked against `students.user_id`, not just edit access — ticks the generated
  `follow` task when it turns one on, then regenerates), `markInfoRequested` (any editor; ticks `request_info`),
  `logVisit`/`updateVisit`/`deleteVisit` (any editor with `can_edit_item`; each recomputes `visited_on` from every
  visit on the item via `firstPastVisitOn` and regenerates), `addVisitQuestion` (appends a "before you go" question
  to the visit's own notes). A calendar download, `app/api/plan/visits/[visitId]/ics/route.ts` (session-gated by
  `can_read_item`, titles and address only, a 24-hour `VALARM`).
- **UI**: `components/planner/stages/ActionsStage.tsx` (one card per college, Dream first; the interest line with
  its ⓘ; the follow row; "Request information" (`row/actions.tsx`'s `InfoRequestButton`); the visit log; the
  interview importance line; "n of m done" per card), `FollowRow.tsx` (44 px icons; X/YouTube record on click;
  the rest open in a new tab and ask "Did you follow?" in a bottom sheet on window focus), `FollowEveryoneButton.tsx`
  (queues every college's unfollowed accounts; intents fire immediately, the rest wait for the sheet one at a
  time), `VisitForm.tsx` (one column; rating and the notes prompts only once the visit's in the past; interviewer
  fields for the Interview kind), `VisitLog.tsx` (future then past visits; "Add to calendar"; before-you-go
  questions and the drive time from home under a future visit), `components/planner/row/actions.tsx`
  (`ActionsRowControls`, the list row's follow row plus "Log a visit" in "More", shown only to an editor).
  `components/lists/TrackingRow.tsx` drops its Visited and Following chips (moved here) — a minimal, additive
  change, not a rewrite. `components/school/SocialIcons.tsx` exports `SOCIAL_GLYPHS` so `FollowRow` reuses the same
  per-network marks. Glossary: `virtual-tour`, `information-session` (`demonstrated-interest` already existed).
- **Tests** `tests/planner-actions.test.mts`: follow/intent URLs and handle shape per network, the deep link rule,
  the interest and interview lines for every C7 value and null, `hasVisitNotes`, `firstPastVisitOn`, two `icsEvent`
  shapes (timed and all-day), and the generator's three task kinds across in-season/out-of-season,
  decided/withdrawn, and followed/unfollowed, has-accounts/no-accounts, and past/future/noted-visit fixtures.

Deviations and decisions the brief didn't cover:
- **Request information isn't a one-click action with a confirm sheet.** Unlike follow, "marking done" is a plain
  checkbox beside the admissions-page link (`InfoRequestButton`): the spec only asks that marking it done set
  `info_requested_on`, and a focus-return prompt for every admissions-page visit seemed more intrusive than useful
  here (there's no network "follow" to confirm, just a form the site never sees).
- **The links probe's request-information URL (open question 2) wasn't extended.** The button opens
  `links.admissions ?? links.website` today; a follow-up to `links.md` can add a more specific URL additively
  without changing this unit's code.
- **The "family car" trip planner (open question 1) wasn't built.** `VisitLog` shows one college's visits only, as
  planned; `near-and-far.md` is still the right home for a shared multi-college trip.
- **The list row's "Log a visit" is add-only.** `RowControlProps` has no visit list to show, so the row opens
  `VisitForm` to log a new visit; editing or deleting an existing one happens in the Plan tab's Actions stage, which
  has the full log. The row's "who's going" picker is free text only there (no household roster lookup) for the
  same reason — the roster names are fetched once, server-side, for the whole Actions stage instead.
- **Unfollowing a network doesn't reopen a completed `follow` task.** Recording a follow ticks the generated task;
  if every network is later unfollowed, `regenerate()` will generate a fresh `follow` task (a new row, since the
  old one stays done), which seemed the simpler behavior than reaching back into a ticked task's `done_at`.
- **`tests/accounts.test.mts`'s `ACCOUNT_ROUTES` gained `/api/plan`** (additive, per its own comment "Account
  features add theirs here"), so the visit `.ics` route may read the session without failing the "public pages
  stay static" guard.
