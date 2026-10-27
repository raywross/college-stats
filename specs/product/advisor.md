# The Advisor: The Plan's New Name, the Trial, and the Page That Sells It

> Status: **planned** 2026-10-26 from the owner's decisions that day: the plan is the one paid product
> ([commercialization.md](commercialization.md)); "we should rename the 'plan' function, a play on a virtual advisor";
> "14-day trial is what I'd do, collect the credit card, then actively cancel or the charge hits; annual only"; and "a
> splashy page for when you click on it and don't have an account, something that will entice the user to sign up for a
> free trial." Three parts, in that order: the name, the trial, the page. After nothing: the plan is built
> ([../planner/README.md](../planner/README.md)); billing lands with commercialization.md, and the page can ship before
> it with the trial button pointed at sign-up. Part of [product](README.md).

## 1. The name
The tab bar's middle tab says **Plan**, the header says Plan, the account menu says Plan, and the pages say "your plan"
in 28 files. It is the right word for a list and a calendar and the wrong word for what the product became: a thing
that reads a student's record, sorts the list, says what to do this season and how, nudges a parent, and texts the
night before a deadline. The owner's phrase is **virtual advisor**.

### Recommendation: "Advisor"
| Where | Today | Recommended |
|---|---|---|
| The product's name (pricing page, emails, the App Store) | the plan | **Quad Advisor** |
| The tab bar's middle tab, the header, the account menu | Plan | **Advisor** |
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

Alternatives considered, for the owner's pick:
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

- **Who can start one.** A guardian, or a student 18 or older, from their own account. A student under 18 sees "Ask a
  parent to start your trial": the household's invitation, prefilled, carries the parent to the splash page with the
  student already attached; the trial then belongs to the parent's account and covers that student (or the whole
  family, if they pick the family price). Minors don't enter cards.
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
| **Questions** | Trial, card, cancel, what stays free, under 18, the family price, what happens when it lapses |
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
- The button's path: signed out → sign-up (birth year, role) → under 18: "Ask a parent" (the invitation) · 18+: Stripe
  Checkout → back to `/advisor` with the first-time setup. Signed in, no advisor → Checkout. Signed in, lapsed → the
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
1. **The name**: Advisor (recommended), Coach, Mentor, or another. One constant either way.
2. **Keep a browser-kept try-before-sign-up?** The old signed-out plan let a visitor build a list with no account. The
   recommendation is no: the trial is the try, and the page shows the real thing. If sign-ups fall, bring back the numbers
   step as the page's hero frame, live.
3. **The family price on a student's trial.** A parent starting a trial for one child picks student or family at
   checkout; should the page default to family when the household has two students? Recommended yes.
