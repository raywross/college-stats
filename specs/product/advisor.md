# The Advisor: The Plan's New Name, the Trial, and the Page That Sells It

> Status: **built**. Planned 2026-10-26; **parts 1 and 2 built 2026-10-27** on `feature/advisor` (see [As built](#as-built-2026-10-27-parts-1-and-2));
> **part 3, the trial, built 2026-11-14** with the Stripe work in [commercialization.md](commercialization.md#as-built-2026-11-14)
> (see [As built: part 3](#as-built-2026-11-14-part-3-the-trial)); it switches on when the owner connects a Stripe account and
> turns the price on. From the owner's decisions of 2026-10-26: the plan is the one paid product
> ([commercialization.md](commercialization.md)); "we should rename the 'plan' function, a play on a virtual advisor";
> "14-day trial is what I'd do, collect the credit card, then actively cancel or the charge hits; annual only"; and "a
> splashy page for when you click on it and don't have an account, something that will entice the user to sign up for a
> free trial." **Decided 2026-10-26** (owner: "I like your recommendations, let's go with them; fine to allow students 16
> and older to pay with a card"): the name is **Quad Advisor**, the tab **Advisor**, the route `/advisor`; students 16
> and older may start a trial with their own card. Three parts, in that order: the name, the trial, the page. After nothing: the plan is built
> ([../planner/README.md](../planner/README.md)); billing lands with commercialization.md, and the page can ship before
> it with the trial button pointed at sign-up. Part of [product](README.md).

## 1. The name
The tab bar's middle tab says **Plan**, the header says Plan, the account menu says Plan, and the pages say "your plan"
in 28 files. It is the right word for a list and a calendar and the wrong word for what the product became: a thing
that reads a student's record, sorts the list, says what to do this season and how, nudges a parent, and texts the
night before a deadline. The owner's phrase is **virtual advisor**.

### Decided: "Advisor" (owner, 2026-10-26)
| Where | Today | Decided |
|---|---|---|
| The product's name (pricing page, emails, the App Store) | the plan | **Quad Advisor** |
| The tab bar's middle tab, the header, the account menu | Plan | **Advisor** (to a student; since 2026-11-08 the same slot says Household to a parent and Caseload to a counselor, [role-nav.md](role-nav.md)) |
| In a sentence to the student | your plan | **your advisor** ("Your advisor has three things for this season") |
| In a sentence to a parent | Jordan's plan | **Jordan's advisor** |
| The route | `/plan`, `/plan/guide/<slug>`, `/plan/print` | **`/advisor`**, `/advisor/guide/<slug>`, `/advisor/print`; `/plan/*` redirects for good (emails, texts, and calendar feeds already carry `/plan` links) |
| The four tabs inside | Next steps · Colleges · Calendar · Offers | unchanged: these are what the advisor shows |
| The guides | the guides | unchanged |
| The record | Your record | unchanged ([../planner/record/README.md](../planner/record/README.md#the-name)) |

Why this one: it is the owner's own word; it says what the thing does; "your advisor" reads naturally in every sentence
the plan already writes ("Your advisor suggests…"); it does not collide with anything on the site (the guides are
guides, the record is the record, the portal's people are counselors); and a parent understands "your kid's advisor"
in one word, which is what a $20 purchase needs.

Alternatives considered and set aside:
| Name | For | Against |
|---|---|---|
| **Coach** ("Quad Coach", "your coach") | Active; fits "three things to do now"; friendly to a 16-year-old | Sporty; a coach drills, an advisor knows things; "your coach says apply ED" sounds pushy |
| **Mentor** | Warm; implies the long road, not one season | Soft; a mentor is a person who knows you, which Quad shouldn't claim |
| **Dean** ("Ask the Dean") | Collegiate and playful | Deans discipline; it winks instead of explaining |
| **Navigator**, **Compass**, **Pathway** | Journey words | Naviance owns "Navigator" in this market; Compass is Explore's icon; Pathway is every district's program name |
| **RA** (resident advisor) | A real campus pun | Lost on high schoolers and parents |

**How the rename is built.** One constant, `ADVISOR_LABEL` in `lib/planner/record.ts` beside `RECORD_LABEL`, with the
possessive forms the pages need (`advisorLabel(viewer)`: "Your advisor", "Jordan's advisor"); the tab bar, header, and
account menu read it; every "your plan" in `components/planner`, `lib/planner`, the emails (`lib/emails/*`), the texts,
and the guides is rewritten through it in one pass, with a test that the words "plan" and "Plan" no longer appear as the
product's name in those folders (the word stays where it means a plan of action: "the course plan", "a plan for the
essay"). Routes: `app/advisor/**` is the page tree; `app/plan/**` becomes redirects (`next.config.ts`, permanent), as
`?view=events` did; `/api/plan/*` stays, since it is not user-facing. The release note tells families the tab moved.

## 2. The trial
Owner's rule: **14 days free, card up front, annual only; cancel before the end or the charge hits.**

- **Who can start one.** A guardian, or a student **16 or older** (owner, 2026-10-26), from their own account; the
  checkout asks a student under 18 to confirm they have a parent's permission, as the Terms say. A student under 16 sees
  "Ask a parent to start your trial": the household's invitation, prefilled, carries the parent to the splash page with
  the student already attached; the trial then belongs to the parent's account and covers that student (or the whole
  family, if they pick the family price). The age comes from the birth year the account already holds.
- **One trial per student.** A student who has been covered by a trial (their own or a family's) can't be trialed again;
  the check is on the student, so a second parent can't restart it. Recorded in `subscriptions` with the student ids it
  covered.
- **Stripe Checkout**, `mode: subscription`, `trial_period_days: 14`, `payment_method_collection: "always"`,
  `trial_settings.end_behavior.missing_payment_method: "cancel"`. Two prices only, both yearly
  ([commercialization.md](commercialization.md#prices)). The checkout page says, in Quad's words above Stripe's: "Free
  for 14 days. Cancel any time before {date} and you won't be charged. After that, $20 a year."
- **During the trial** the advisor is whole: every capability in the map ([commercialization.md](commercialization.md#feature-map)),
  with a quiet line on the Advisor tab, "Trial ends {date} · Manage" (the Customer Portal).
- **Three days before the end** Stripe's `customer.subscription.trial_will_end` fires and Quad sends one email: what the
  trial covered (the number of colleges on the list, moves done), the date and the amount, one button to keep it (nothing
  to do), one link to cancel. No second reminder; the texts never carry billing.
- **At the end**, Stripe charges. Success: nothing changes on the site. Cancelled or failed after Stripe's retries: the
  plan turns read-only as [commercialization.md](commercialization.md#when-a-plan-lapses) says, with a banner and the
  button to subscribe.
- **Cancel** from `/account` (one row, "Advisor · trial ends {date} · Cancel") and from the Customer Portal; cancelling
  during the trial ends it at day 14, not at once, so the family keeps what it started.
- Telemetry (server): `trial_started {product}`, `trial_reminder_sent`, `trial_converted {product}`,
  `trial_cancelled {day}`; never an amount beyond the two list prices, never a card detail.

## 3. The page: `/advisor`, signed out
What the middle tab opens for a visitor without an account, and what a signed-in person without the advisor sees in
its place. It replaces the signed-out plan (`SignedOutPlan`, the "pitch and numbers step" of 2026-10-10): the browser-kept
plan's import on sign-in (`ImportLocalPlan`) stays for one release so existing local plans come across, then goes.

**The job.** Make a parent or a student want the 14 days. Show, don't describe: every section renders a real component
with a labeled sample student, so the page looks exactly like what they get.

| Section | What's on it |
|---|---|
| **Hero** | Eyebrow "Quad Advisor". Headline, one line, in the site's display face: *An advisor for the whole road to college, in your pocket.* One sentence under it: it reads your record, sorts your list by where you stand, tells you the three things to do this season and how, and never misses a date. Button: **Start your 14-day free trial**. Under it, small: "$20 a year after, or $30 for the whole family. Cancel before the trial ends and pay nothing." Right: a phone-sized frame showing the Advisor tab for the sample student |
| **Where you stand** | A `PlanRow` strip for the sample student: five colleges, one per level, with their pills (High reach … Safe), and the shape line "A good senior list has 12 to 15 colleges; Jordan has 5". One line: Quad's estimate reads what each college publishes about who it admits, and says who you're compared with; never a percentage ([../chances/README.md](../chances/README.md)) |
| **Three things, this season** | Three real Now cards for the sample student's season (junior spring: Build your list · Show interest at Duke · Reach your score), each with its one line of why; one line: each opens a guide made for that one job |
| **Never miss a date** | A `CalendarLane` for one month with round colors, the visit lane, and a text bubble: "Tomorrow: Wake Forest ED I application is due" |
| **For parents** | The parent's view in one frame: the season's whole list with Done and Skipped, a nudge; one line: parents see the same advisor the student does, and the family price covers every child |
| **Offers, side by side** | The `OffersTable` for two sample offers with the four-year total; one line: real offers, loans separated, the way the federal College Financing Plan does it |
| **What it reads** | Three short facts with citations: 1,893 colleges, every number with its source and year; each college's own filings (Common Data Set, Common App); your record, entered once |
| **What it never does** | No ads, no leads sold to colleges, no featured listings, no percentage chances, nothing about a minor sold or shared ([telemetry.md](telemetry.md#privacy)) |
| **Counselors** | One line: counselors and consultants use Quad free to see their students' advisors and bring their school's data; link to the portal when built, a contact until then |
| **Questions** | Trial, card, cancel, what stays free, under 16, the family price, what happens when it lapses |
| **Close** | The button again, the price line, "Already have an account? Sign in" |

**Rules.**
- Every sample is labeled "Sample: Jordan, class of 2028" in the frame's corner; the colleges and figures are real and
  cited (the components cite as they do everywhere), the student is not. One fixture file, `data/reference/sample-plan.json`,
  feeds every frame, so the page renders from the same components as the product and can't drift from it.
- The site's design rules hold ([design-system.md](../design-system.md), [mobile.md](../mobile.md)): the display face
  for headlines, violet and lime, 14 px radius cards, no sideways scroll on phones, less text ([../planner/record/less-text.md](../planner/record/less-text.md)
  applies: a title and one line per section). "Splashy" is the frames moving in with the site's rise and pop-in, not
  more words; off under Reduce Motion.
- No grades, no "best", no percentage, no made-up testimonial. If the page quotes anyone, it quotes the owner's rules.
- The button's path: signed out → sign-up (birth year, role) → under 16: "Ask a parent" (the invitation) · 16 and
  older: Stripe Checkout → back to `/advisor` with the first-time setup. Signed in, no advisor → Checkout. Signed in, lapsed → the
  read-only plan with its banner, not this page.
- Public and static (`revalidate` daily like the home page), so it ranks for the searches families type; `/advisor` is
  the canonical URL; the home page's hero gains one line linking it ("Try the advisor free for 14 days").
- Phones: the page is the middle tab's destination; the hero frame is a real phone frame on desktop and the plain
  component on phones.
- Telemetry: `advisor_page_viewed {signed_in}`, `advisor_cta_tapped {section}`; nothing else on this page.

## Build order
1. The name: the constant, the words, the routes with redirects, the release note (one PR; Small).
2. The page with the sample fixture and the button pointing at sign-up (one PR; Medium). Ship before billing: until
   Stripe exists the button starts an account and the plan as today, and the price line says "free while we're in
   preview".
3. The trial, with commercialization.md's billing (Checkout, webhooks, the reminder email, `/account`'s row).

## Files (planned)
- `lib/planner/record.ts` (`ADVISOR_LABEL`, `advisorLabel()`), `app/advisor/**` (moved from `app/plan/**`), redirects in
  `next.config.ts`, `tests/advisor-label.test.mts` (the word sweep; every `/plan` route redirects).
- `app/advisor/page.tsx` signed-out branch → `components/advisor/Splash.tsx` and its sections,
  `data/reference/sample-plan.json`, `tests/advisor-splash.test.mts` (every frame renders from the fixture; every figure
  cited; the sample label present; no percentage).
- `lib/stripe.ts` trial options, the `trial_will_end` webhook handler, `lib/emails/trial-ending.ts`, the `/account` row.

## Open questions
1. ~~The name~~ Decided 2026-10-26: Quad Advisor.
2. **Keep a browser-kept try-before-sign-up?** The old signed-out plan let a visitor build a list with no account. The
   recommendation is no: the trial is the try, and the page shows the real thing. If sign-ups fall, bring back the numbers
   step as the page's hero frame, live.
3. **The family price on a student's trial.** A parent starting a trial for one child picks student or family at
   checkout; should the page default to family when the household has two students? Recommended yes.

## As built (2026-10-27, parts 1 and 2)
Built in three units on sub-branches (`feature/advisor-routes`, `feature/advisor-words`, `feature/advisor-splash`, all
opus) from the brief in `~/Projects/college-stats/advisor-build/`, merged on `feature/advisor`. Where this section and the
plan above disagree, this section is what runs.

**The name.** `lib/planner/advisor.ts` (pure): `ADVISOR_NAME` "Quad Advisor", `ADVISOR_SHORT` "Advisor", `ADVISOR_PATH`
`/advisor`, `advisorTitle(firstName)` ("Your advisor", "Jordan's advisor"). It is its own module rather than a line in
`record.ts`, so the nav components import something tiny. `planHref()` keeps its name and returns `/advisor…`; a new
`planPrintHref({ person?, each? })` builds the print link. The page tree moved with `git mv` to `app/advisor/**`;
`next.config.ts` redirects `/plan` and `/plan/:path*` to `/advisor` for good, with the query string carried (`/plan?for=…
&tab=calendar` lands on the same tab); `/me/plan` and the household redirects go straight to `planHref`, no longer through
two hops. `proxy.ts` matches `/advisor/:path*` (and still `/plan/:path*`). The tab bar, header, and the household's pill
read `ADVISOR_SHORT` (the tab bar and header through the role item since 2026-11-08, [role-nav.md](role-nav.md)); the tab bar's sign-in line reads "Your colleges, your record, your advisor". Internal names kept
"plan": the `plan_child` cookie, `/api/plan/*`, telemetry event names, `PlanTab`, `PlanContext`, file names.
`tests/advisor-routes.test.mts` checks the names, the hrefs, both redirects (by importing the config), the matcher, that
`app/plan` is gone, and sweeps `app components lib proxy.ts` for any literal `/plan` route outside `/api/plan` (its first
run caught seven in the interest-confirm route).

**The words.** Every string a person reads in `components/**`, `app/**`, `lib/emails/**`, `lib/sms.ts`, `lib/digest.ts`,
the move catalog, the guides, the glossary's planner entries, the unsubscribe pages, and the calendar feeds says
"your advisor" / "Jordan's advisor" / "the Advisor tab" where it meant the product, and "your list" where it meant the
colleges ("On your list: ED", "Yes puts it on your list"). The SMS label is "Advisor:"; the personal calendar feed is named
"Quad Advisor", the family feed "Quad family calendar"; the glossary key `plan` stays (old links work) with the term
renamed "Advisor". Kept as plans of action: the course plan, the College Financing Plan, loan repayment plans, "the plan
for most families" (tuition), "plan to apply test-optional", and the admin fallback's "planner's tables".
`tests/advisor-words.test.mts` parses each file with the TypeScript compiler and reads only string literals, template
text, and JSX text (comments and identifiers ignored), failing on "your/the/their/my plan", "'s plan", "the planner", and
a bare "Plan" label, with an allowlist of the kept senses and a per-line `advisor-words: ok` escape; the brief's broad
"plan to / plan for" allowance was narrowed because it hid real misses. 71 files changed.

**The page.** `components/advisor/Splash.tsx` (server) and one file per section under `components/advisor/sections/`,
rendered by `app/advisor/page.tsx` for a signed-out visitor in place of the deleted `SignedOutPlan.tsx` (its local list,
`lib/planner/local-plan.ts`, and `ImportLocalPlan` stay one more release; `components/planner/NumbersForm.tsx` is now
unused). The fixture `data/reference/sample-plan.json`: Jordan, class of 2028, junior spring, home state Georgia; five
colleges with declared levels (Vanderbilt High reach, Wake Forest Reach and Dream, Clemson Target, Kennesaw State
Likely, Georgia Southern Safe); the moves are the catalog's own titles and whys ("Add a few Target schools", "Show Wake
Forest University you're interested", "Work toward your 1400"), and the test checks them against the code; the calendar
shows November with today set to the 14th so the bubble reads "Tomorrow: Wake Forest ED I application is due"; the two
offers' gifts and loans are illustrative letters over each college's published full price. Every college figure (name,
city, admit rate as "1 in N", cost, deadlines, interest factor, Common App count) is read from the dataset and cited;
"Sample: Jordan, class of 2028" sits in every frame's corner (`SampleBadge`). Real components where they take plain
data: `CalendarLane`, `OffersTable`, `CollegeChip`, `Crest`, `ListExplainer`, the `GROUP_CLASS` pills; presentational
twins with the same classes where the real one needs a `PlanContext` or a store: `SampleList` (PlanRow), `SampleNow`
(MoveCard), `SampleParent`. The hero's phone frame shows from `md` up; on phones the same cards are the third section.
Frames rise and pills pop as they scroll into view (`animation-timeline: view()` where supported, once on load
elsewhere), off under Reduce Motion. The button "Start free" opens the sign-up form (`/login?next=%2Fadvisor&mode=signup`)
and the price line reads "Free while Quad is in preview." until the trial ships; no trial or "14 days" wording anywhere.
Counselors' contact is `hello@usequad.app` (`lib/contacts.ts`, 2026-10-28; a GitHub issue link for one day before the
addresses existed). The home hero gained "Try Quad Advisor →".
Telemetry: `advisor_page_viewed { signed_in }`, `advisor_cta_tapped { section }`. The page is **dynamic**, not the spec's
daily-revalidated static page: `/advisor` reads the session first and this is its signed-out branch.
`tests/advisor-splash.test.mts` (10 tests) validates the fixture against the dataset and the catalog and renders every
section with react-dom/server.

**Not built then, by design:** part 3 (the trial, Stripe, the reminder email, `/account`'s row, the lapsed read-only state),
the 14-day and price wording that goes with it, and the "Ask a parent" path for students under 16 (nothing to ask for
until the trial exists). Built 2026-11-14, below.

## As built (2026-11-14, part 3: the trial)
Built on `feature/billing` with [commercialization.md](commercialization.md#as-built-2026-11-14), where the billing
side (the tables, the webhook, the entitlement hook, the pricing page, the admin switch, the owner's setup) is written
up, and **redrawn the same day on the owner's decisions**: no family price; a student never needs a parent; **the trial
starts when the account is created**, with a card collected whenever a student is created and charged when the trial
ends unless cancelled before then; parents and counselors free; a parent enters one card for the
household and pays for each student they add; a counselor may invite a parent. What this spec's part 2 asked for, as
it stands now:

- **Nothing changes until the owner flips the switch.** Every piece below is live code, but the splash page keeps
  "Start free" and "Free while Quad is in preview", the Advisor tab shows no line about money, and `allowed()` says yes
  to everything until Stripe's three variables are set *and* the `advisor.price_live_at` setting is on
  (`/admin/settings`, "Advisor price"). Accounts created before that moment keep the advisor free through 2027-08-31.
- **The trial starts with the record.** A trigger on `students` writes `advisor_trials` (14 days from now) for every new
  record, whichever door made it: a student's own sign-up (which already requires a password), a parent's Add a student,
  a counselor's invitation. One trial per student, by construction.
- **The card comes with the student** (owner, later on 2026-11-14: "always collect a card anytime a student is created
  … automatically charge 14 days in unless they cancel"). A parent's card is on file before they can add a student. A
  student who signs up finds the Advisor tab read-only behind one banner, "The free trial runs until Nov 28. Add a card
  to open your advisor: nothing is charged until then, and cancelling before then costs nothing.", and Stripe Checkout
  saves the card with `trial_end` at the trial's end, so the charge lands then unless they cancel from `/account`.
- **The button's path.** Once live, the splash page's buttons read "Start your 14-day free trial" with the line "14 days
  free with your card on file, then $20 a year. Cancel before the trial ends and pay nothing." and the sign-up comes back
  to `/advisor`, where the card is asked for. The Questions gain the trial, the card, cancelling, who pays, and lapsing
  (`TRIAL_QUESTIONS`).
- **Who pays.** Any student may pay for their own advisor (the 16-and-older rule and the permission checkbox are gone;
  the Terms' sentence about minors stays on the sheet and the pricing page). A guardian pays for a child: with a card on
  file, one tap on `/advisor/start` makes the subscription on the server; without one, Checkout collects the card. The
  first charge waits for the student's trial end when that is two days or more ahead (`stripeTrialEnd`); after it, the
  year starts today.
- **The household card.** A parent adding a student while the price is live is sent to `/account/billing/card` first
  (Checkout in setup mode, nothing charged), then back to Household; the student is then paid for at once: a
  subscription on the parent's customer, trialing until the student's trial ends, then charged. `/account` shows the
  card (brand, last four) with Add or Change, and each student's subscription by name.
- **A counselor's student.** The record's trial starts when it is made. When the student logs in, the Advisor tab asks
  for the card before it opens; the reminder email asks too if none has come by the last three days. The
  counselor's student page gained a **Family** panel: "Invite a parent" puts the student in a household (theirs, or a
  new one named after them) and sends the ordinary guardian invitation; the parent who accepts sees the same advisor
  and can pay ([counselor-portal.md](counselor-portal.md#inviting-a-parent-2026-11-14)).
- **During the trial**: once a card pays, whole, with the quiet line above the plan (`components/advisor/BillingLine.tsx`,
  passed to `PlanFrame` as `billing`): "Trial ends Nov 28, then the year starts · Manage". Before the card, the banner
  above and a read-only plan.
- **Three days before the end**, one email (`lib/emails/trial-ending.ts`): colleges on the list and moves done so far,
  the date and the amount; with a card on file, one button to keep it (nothing to do) and a link to cancel; without
  one, one button to add a card and the plain fact that nothing is charged otherwise. Stripe's `trial_will_end` sends
  it for a subscription; the nightly reconcile sends it for a cardless trial (`advisor_trials.reminder_sent_at`). No
  second reminder; the texts never carry billing.
- **At the end**: a card on file is charged and nothing changes on the site. No card: the advisor turns read-only (the
  list, levels, calendar, and offers stay; writes refused with "That part of the advisor isn't available on your
  account."; the Your-week emails and day-before texts skip the student) with a banner and Subscribe.
- **Cancel** from `/account` (each subscription's row: Cancel trial / Cancel / Keep it, and the Customer Portal for
  card, invoices, and receipts); cancelling during a paid-for trial sets `cancel_at_period_end`, so it ends at the
  trial's end and nothing is charged.
- **Telemetry**: `trial_started {product, price_variant}` (a card arrived during the trial), `trial_reminder_sent`,
  `trial_converted`, `trial_cancelled {day}`, `subscription_cancelled`, `subscription_renewed`, from the server
  ([telemetry.md](telemetry.md#event-registry)).
- **Tests**: `tests/billing.test.mts` (the rules, the words, both emails, the unconfigured path, the file guards);
  `tests/advisor-splash.test.mts` still renders the preview offer unchanged.
- **Already true, so nothing to build:** sign-up requires a password (`signUpWithPassword`); a student invites a parent
  into a household from the Household page ("students add guardians"); a student may be on more than one counselor's
  caseload (`org_students` is unique per organization and student).
