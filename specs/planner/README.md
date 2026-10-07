# The Planner: From the First List to the Deposit

> Overview of the planner specs (not a work item itself). Written 2026-10-07 from the owner's brief ("help students
> get organized and stay on track, with parents able to see how they're tracking"), the built accounts, household, and
> list work, the planned planning tools, and new research. Each spec below is a separate work item on the
> [roadmap](../roadmap.md). The planner is meant to be the site's **primary paid feature**.

## Why
The site can tell a family a great deal about any college. It can't yet help them *do* the eighteen months of work
between "we should start looking" and "the deposit is paid": build a list, sort it honestly, decide who gets the one
binding early application, follow and visit the colleges, keep a hundred dates straight, apply, read the decisions,
compare the offers, and choose. Families do this today in a spreadsheet, a group chat, and a parent's memory. The
planner is that spreadsheet, filled in from what the site already knows about every college, with the parent's view
built in rather than bolted on.

Three things make it worth paying for and hard to copy:
- **It starts from data the family already trusts here.** Every date, admit rate, early-round rule, aid form, visit
  link, and social account on the plan comes from the college's own documents or the federal files, cited with its
  edition like everything else on the site. Scoir and Naviance list deadlines; neither says *why* a step matters at
  this college ("Tufts says interest is important; Harvard says it isn't considered").
- **The household already exists.** Parents and students are in one household with the privacy rules a planner
  needs: a parent sees the list and the plan and never the student's private notes; a student never sees the
  parent's finances ([accounts.md](../product/accounts.md#privacy-model)). Common App has no parent view at all.
- **One flow, start to finish.** List → rounds → actions → timeline → applications → offers → the choice, each
  stage writing facts the next one reads. The award-letter work that was planned on its own now sits where it
  belongs, at the end of that flow.

## The journey
The planner is one page per student (the **Plan** tab beside List and Numbers on
`/household/[person]`, [model.md](model.md#where-it-lives)) that walks six stages. A family can jump around; the
stages are a map, not a gate. Stage 0, the student's numbers, is already built ([student-profile.md](../product/student-profile.md)).

| Stage | Spec | The student does | The site does | Complexity |
|---|---|---|---|---|
| 1 | [list-building.md](list-building.md) | Builds the list, picks a **Dream**, sorts | Suggests Reach / Target / Likely from the numbers with the rule shown; balance line; sort by what matters | Medium |
| 2 | [early-rounds.md](early-rounds.md) | Ranks the list and chooses who gets ED I, ED II, EA, REA | Shows which rounds each college offers and when, the early-round advantage with its caveats, the conflicts between rounds, and the money question; proposes a plan the student edits | Large |
| 3 | [actions.md](actions.md) | Follows the admissions office, requests information, books and logs visits, keeps notes | One click where a network allows it, a visit log with prompts and a calendar file, and says where interest is counted | Medium |
| 4 | [timeline.md](timeline.md) | Works through dated tasks, adds their own | Generates the tasks from the college's dates, the cycle's dates, and the stage the student is in; month and college views; calendar feed; reminders | Large |
| 5 | [applications.md](applications.md) | Marks what's submitted and complete, handles deferrals and wait lists | Lists what each college needs (fee, waiver, test policy, aid forms), tracks the portal, generates the follow-ups | Medium |
| 6 | [offers.md](offers.md) | Records decisions, enters offers in a short form, shares the letter if willing, compares, **chooses** | Puts offers in one layout with four-year totals, sets them beside the estimate and the college's outcomes, turns the choice into deposit and withdrawal tasks, and collects shared letters for a reader built later | Large |
| all | [parents.md](parents.md) | A parent checks in, nudges, and takes the parent's tasks | A summary per student, the same plan read-only, a nudge that doesn't nag, a weekly email, the stuck signals | Medium |
| — | [model.md](model.md) | | The shared model: stages, tasks, visits, offers, the Plan tab, the cycle year, entitlements | Large |

## Research (2026-10-07)
- **The season in numbers.** Common App's 2025–26 end-of-season report: 1.53 million first-year applicants and
  10.8 million applications across 1,146 members, 7.06 applications each, up 6%; through December 1 (the early
  rounds), 1.16 million applicants, up 4%, with growth fastest at colleges admitting 25–49%. The Princeton Review's
  2025 College Hopes & Worries survey (9,317 respondents, a quarter of them parents): 73% report high stress about
  applications. The planner's job is to take the stress out of *remembering*, which is the part software can do.
- **Early rounds are where the plan matters most.** For the class of 2030, early decision admit rates ran two to
  six times the regular rate at selective colleges (Brown 14.8% ED against 3.5% RD; Dartmouth about 4.6×; Vanderbilt
  about 14% against 3%; Northwestern about 20% against 6.5%; from the colleges' announcements compiled by IvyWise,
  Oriel Admissions, and Dewey Smart). About 30 colleges offer **ED II** with January 1–15 deadlines and mid-February
  decisions, after ED I results arrive, so a student gets one more binding try; Washington University reported 27%
  across its two binding rounds against 9.3% outside them. The caveats the site's
  [early-decision strategy](../product/early-decision-strategy.md) already states still hold: hooked applicants are
  concentrated in early pools, ED is binding, and an early application doesn't turn a Reach into a Target.
- **Demonstrated interest.** Roughly 40–45% of colleges consider it, concentrated at small and mid-sized private
  colleges managing yield; the most selective mostly don't (Harvard, Princeton, Yale, Columbia, MIT, Caltech, UCLA say
  "not considered"). It is disclosed per college in CDS C7, which the site stores
  ([cds-admissions.md](../data-expansion/cds-admissions.md)), so the planner can say per college whether a visit,
  a follow, or an information request counts, instead of telling everyone to do everything.
- **One-click actions, honestly.** X documents a follow Web Intent (`x.com/intent/follow?screen_name=`) with an
  inline sign-in; YouTube's `?sub_confirmation=1` opens a subscribe prompt for a signed-in viewer. Instagram, TikTok,
  Facebook (its follow button was retired in 2018), and LinkedIn offer no follow intent: the best available is
  opening the profile, in the app on a phone, with a follow button one tap away. The planner does the real one-click
  where it exists and the one-tap-then-confirm elsewhere, and never pretends otherwise ([actions.md](actions.md#follow)).
- **Reminders work when they're concrete.** Castleman and Page's randomized trials (Dallas, Philadelphia, Boston;
  4,882 graduates) sent texts about specific, dated tasks (file the FAFSA, take the placement test, register for
  orientation) and raised fall enrollment 3.1 points (68.0% against 64.9%), 5.7 points for the lowest-income
  students; messaging parents as well as students did not measurably add to messaging students alone. The lesson the
  planner takes: one task, one date, one link, a few at a time; parents get visibility and a way to help, not a
  second stream of the same reminders ([parents.md](parents.md#nudges)).
- **May 1 isn't the end.** Since NACAC's 2019 consent decree with the Department of Justice removed the rules that
  made May 1 final, colleges may recruit students who have deposited elsewhere, and wait lists move through the
  summer. The plan therefore has a real "committed" step with deposit and withdrawal tasks, and a summer list
  (orientation, housing, final transcript, aid verification), rather than ending at the decision.
- **Comparable tools.** Scoir (parents see the list, suggest colleges, see upcoming visits), Naviance (structured
  tasks for transcripts and recommendations, counselor-driven), Common App (each college's requirements and
  deadlines once added; no parent accounts), College Kickstart (balance grades, an early-admission engine, an action
  plan; no family accounts), Appily (deadline management, scholarships, virtual tours). None combines a family
  account, a cited reason per step, the early-round decision with its money question, and offers at the end.

## What exists, what moves, what's new
| Already built | Used by |
|---|---|
| Accounts, households, the hub with a page per person ([household-hub.md](../product/household-hub.md)) | every stage |
| One list per person with category, status, outcome, round, deadline, notes, visited, follows social ([saved-lists.md](../product/saved-lists.md)) | stages 1, 3, 5 extend it |
| The student's numbers ([student-profile.md](../product/student-profile.md)) | stage 1's suggestions, stage 2's standing |
| College dates, early rounds, aid forms, fee and waiver, test policy, interest ([cds-admissions.md](../data-expansion/cds-admissions.md), [cds-application-logistics.md](../data-expansion/cds-application-logistics.md), [cds-financial-aid.md](../data-expansion/cds-financial-aid.md), [cds-test-scores-and-policy.md](../data-expansion/cds-test-scores-and-policy.md)) | stages 2, 4, 5 |
| Links to each college's admissions and visit pages and its social accounts ([links.md](../school-identity/links.md), [social-accounts.md](../school-identity/social-accounts.md)) | stage 3 |
| The digest and its daily job ([follow-colleges.md](../product/follow-colleges.md)) | stage 4's reminders |
| Home address and distance ([home-and-distance.md](../product/home-and-distance.md)) | stage 1's sort, stage 3's visits |

| Moved here | From | What changed |
|---|---|---|
| [timeline.md](timeline.md) | `product/application-plan.md` (planned 2026-10-06) | Becomes stage 4: tasks have an assignee (student or parent), the cycle file gains windows and the summer list, the plan knows the student's grade, and there is a calendar feed. The suggested steps split out into stages 2, 3, and 5 |
| [offers.md](offers.md) | `product/award-letter-analyzer.md` (planned 2026-10-02) | Becomes stage 6: decision entry first, the form before any upload (with a share-your-letter step that collects the set a reader is built on later), "compare my admits", the choice and what it generates, the summer list, and the opt-in outcome share |

New: [model.md](model.md), [list-building.md](list-building.md), [early-rounds.md](early-rounds.md),
[actions.md](actions.md), [applications.md](applications.md), [parents.md](parents.md).
[early-decision-strategy.md](../product/early-decision-strategy.md) stays in the planning tools as the data and the
profile section; stage 2 is the planner built on it. [chances-and-fit.md](../product/chances-and-fit.md) stays too;
stage 1 reads its standing when it exists and uses the admit rate alone until then.

## Decisions in short
Each is argued in its spec.
1. **One list, seen through six lenses.** The planner adds columns and tables around `list_items`; it never copies
   the list. Ticking "applied" on the timeline, in the applications stage, and on the list row are one fact.
2. **Dream is a flag, not a category.** A Dream can be a Reach or a Target; it is the college the student would
   choose over all others today, one per list, and it is what stage 2 looks at first.
3. **Rounds are proposed, never assigned.** The site shows availability, dates, advantage, conflicts, and the money
   question, proposes a plan, and the student edits it. No sentence says "apply ED here".
4. **Tasks are generated, idempotent, and owned by a person.** Each task has a source (the college's date, the
   cycle, the stage, the family), an assignee (student, parent, either), and a key, so regenerating after a data
   publish moves a date without losing a tick. Parent tasks (FAFSA, CSS Profile, deposits) show on the parent's own page.
5. **Do the action where the network allows; record it everywhere.** A real follow intent on X and YouTube; a
   deep link plus "did you follow?" elsewhere. What's stored is the fact and the date, never a token or a login.
6. **Offers start as a form; letters are read later.** The family enters each offer in the College Financing Plan
   layout and is asked whether they'd share the letter itself. The shared letters become the set that a later
   upload-and-read path is built and measured on; until then nothing is extracted by a model.
7. **Parents see, nudge, and own their tasks; they don't grade.** No scores, no "behind", no comparisons between
   siblings. A nudge is one line about one task, rate-limited, and the student sees who sent it.
8. **Reminders reach the phone.** Email and text, each with its own switch, texts with explicit consent; one task,
   one date, one link.
9. **The commercial model comes after the build.** The planner is meant to be the primary paid feature, but these
   specs name no tier and gate nothing; once the stages exist the owner draws the paid line in
   [commercialization.md](../product/commercialization.md) and the stages pick it up through one hook
   ([model.md](model.md#entitlements)).

## Owner decisions (2026-10-07)
From the owner's review of the first draft:
- **No commercial model in the specs.** Decide tiers once things are built; the tier table that was here is gone.
- **Texts are in scope.** Reminders and nudges by SMS as well as email ([timeline.md](timeline.md#texts)).
- **No photos** on visits.
- **Letters: form first.** The owner has no letters to pilot a reader on; the form is the first release and asks
  families whether they'd share the letter, which builds the set for the reader later ([offers.md](offers.md#letters)).
- **Common App screenshot import**: later, not this pass.
- **Twilio** is the text provider ([timeline.md](timeline.md#texts)); number registration starts before the
  timeline unit is built.
- **Thirty shared letters** across several colleges, admission letters included, is the threshold for building the
  letter reader as its own roadmap item ([offers.md](offers.md#letters)).

## Build order
```
model ──► list-building ──► early-rounds (after early-decision-strategy for the advantage data)
   │           │
   │           ├──► actions
   │           └──► timeline ──► applications ──► offers (after net-price-estimator for the four-year math)
   │                    │
   └────────────────────┴──► parents
```
The model first: tables, the stage machine, the Plan tab's frame, and entitlement hooks. Then the list stage, which
is small and makes the tab useful on day one. Early rounds and actions are independent of each other; the timeline
needs the rounds (its dates follow the chosen round) and feeds applications and offers. Parents last, because it is
a view over everything else, though its summary line should ship with the model so the hub shows the planner from
the first release. Build with the `build-roadmap-section` skill, one unit per spec.

## Shared rules
In addition to the [product rules for user data](../product/README.md#shared-rules-for-user-data):
- **Every date names its source and edition**; a date a person typed says "your date". No invented dates: a college
  that hasn't published one gets "the college hasn't published this; add your own".
- **Nothing in the planner is a verdict.** Categories are the student's choice with the site's suggestion beside it;
  rounds are proposed; standing is a classification with reasons; offers are compared on facts. No composite score,
  no letter grade, no probability ([ideas/README.md](../ideas/README.md)).
- **Interpret a step only where the college's data allows it.** "Interest is considered here" comes from C7; where
  the college says it isn't, the step is optional and says why.
- **A parent sees what the privacy model allows and nothing more**: lists, plans, tasks, visits, offers; never
  private notes, hooks, or the finances of another guardian.
- **Minors and messaging.** Reminders go to the account's email and, with explicit consent (a guardian's for a
  student under 18), by text to the phone on the household record. No reminder or text carries a personal number
  (GPA, scores, income, award amounts): "Michigan: essay due Nov 1".
- **Telemetry** records that a stage was used and which college, never the content
  ([telemetry.md](../product/telemetry.md#privacy)).

## Open questions for the owner
None at the overview level as of 2026-10-07; each spec keeps its own small ones. The two that were here (the text
provider, the letter threshold) were decided the same day and are recorded above.
