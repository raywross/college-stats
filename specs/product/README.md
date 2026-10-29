# Product: Accounts, Planning Tools, High School Context, and the Business

> Overview of the product specs (not a work item itself). Written 2026-10-02 from three idea documents in
> [ideas/](ideas/) (a commercialization strategy, a feature roadmap, and a high school data pipeline), the existing
> specs, and new research. Each spec below is a separate work item on the [roadmap](../roadmap.md).

## Why
Today the site is a public explorer of federal data: every number is cited, nothing is personalized, and nothing is
remembered between visits except the compare list in `localStorage`. The idea documents push in one direction: turn
the explorer into a **planning tool for one family** (a student's list, their chances, what *they* would pay) and
pay for it with subscriptions, counselor accounts, and an API. Two things are foundational and were asked for
explicitly: **login with households** (a parent sees each child's work; a child never sees the parent's finances)
and **usage telemetry** so the site's use can be reported on.

The site's rules stay: federal data is the baseline, every figure is cited with its year, nothing is graded, and the
public data stays free ([commercialization.md](commercialization.md#what-stays-free)).

## Themes and specs

### Accounts and households
| Spec | Adds | Complexity |
|---|---|---|
| [accounts.md](accounts.md) | Login, households (guardians and students), who can see what, account deletion | Large |
| [student-profile.md](student-profile.md) | A student's own numbers (GPA, scores, major, state, preferences) that every tool reads | Medium |
| [saved-lists.md](saved-lists.md) | Saved colleges with Reach / Target / Likely, status, notes, deadlines, sharing, export | Medium |
| [follow-colleges.md](follow-colleges.md) | Follow colleges (lists follow automatically) and get one email per data release summarizing what changed, with years; a public "What changed" panel on profiles | Large |
| [home-and-distance.md](home-and-distance.md) | A home address on the account, Explore's "Distance from home" filter with a nearest-first sort, and the distance to every college on a saved list, for students and guardians alike (built 2026-10-05) | Medium |
| [visit-events.md](visit-events.md) | Every event a Slate or Element451 college publishes (campus tours, sessions, online, and rep visits to high schools and fairs), read nightly behind guards and a weekly discovery, shown to signed-in people on the college page's Event calendar, `/me/visits`, and the planner, with a nightly email when a college on your list adds an event within a radius of home (default 30 miles) and a per-college off switch (built 2026-10-13 to 15 in three rounds; the TargetX reader is built but off by decision). The research behind it is kept in [visit-events-research/](visit-events-research/README.md) | Extra large |
| [household-hub.md](household-hub.md) | Add a parent or a student by role with only the details that role needs; everyone by name, invited people in the same roster with their link; the household page as the hub, one list per person with "updates" as a switch per college (built 2026-10-06 from the owner's review) | Large |

The application plan written on 2026-10-06 became the timeline stage of the **planner** on 2026-10-07
([planner/README.md](../planner/README.md)): six stages from the first list to the deposit, in their own section of
the roadmap, with the award-letter analyzer as the last stage.

### Planning tools
| Spec | Adds | Complexity |
|---|---|---|
| [chances-and-fit.md](chances-and-fit.md) | *Built as [the chances specs](../chances/README.md)* (2026-10-11/12; marked built 2026-10-26): "Where you stand" on five levels from Quad's estimate, the chip and card, Compare's row, Explore's For you levels, and the fit chips; the rules here became the open baseline | Large |
| [cost-by-income.md](cost-by-income.md) | *Built 2026-10-10* (estimates gated until the pilot): cost as a curve over family income: published prices to $110K, a calibrated estimate above, where need-based aid ends for each college, and what merit aid can still do; replaces the average-first cost display | Large |
| [net-price-estimator.md](net-price-estimator.md) | *Rewritten 2026-10-26:* the family's own numbers on the built cost curve: the Student Aid Index and Pell as versioned tables, a range per college, the "what we can pay" line, a four-year total | Large |
| [early-decision-strategy.md](early-decision-strategy.md) | *Built in pieces* (marked 2026-10-26): the measures in `lib/early.ts`, the profile's "Applying early", Compare's rows, the Common App Explore filters, and ED opportunities on the plan | Medium |
| [../planner/offers.md](../planner/offers.md) | Real aid offers side by side, standardized the way the federal College Financing Plan does, with loans and 4-year totals made visible; moved into the planner on 2026-10-07 as its decisions-and-offers stage | Large |

### Essays
| Spec | Adds | Complexity |
|---|---|---|
| [essays/README.md](essays/README.md) | *Planned 2026-10-28:* the overview: Quad is the workspace up to the button, the student's own words always, the platform is the signature | — |
| [essays/prompts.md](essays/prompts.md) | Every supplemental essay and short-answer prompt a college publishes, quoted and cited, on the apply card and counted across the plan | Medium |
| [essays/workspace.md](essays/workspace.md) | The editor (plain text, phones first, autosave, versions, counts), reuse across colleges, Word and Google Docs round trips, parents and advisors reading and commenting, the package per college | Large |
| [essays/reviewer.md](essays/reviewer.md) | A reader's notes on demand, never a rewrite, from a cited guidance corpus the owner reviews; a guard and an eval | Large |

### High school context
| Spec | Adds | Complexity |
|---|---|---|
| [high-school-data.md](high-school-data.md) | A high school dataset (NCES, EDFacts, Civil Rights Data Collection, state report cards, school profiles) and high school pages | Extra large |
| [scattergrams.md](scattergrams.md) | *Folded 2026-10-26 into the [counselor portal](counselor-portal.md#scattergrams)*: counselor-uploaded outcomes from one high school, scrubbed and thresholded, drawn beside Quad's estimate; the self-reported half is built as [calibration](../chances/calibration.md) | Large |

### Platform, measurement, and business
| Spec | Adds | Complexity |
|---|---|---|
| [telemetry.md](telemetry.md) | Product analytics with a typed event registry, privacy rules for minors, and usage reports (built 2026-10-07) | Medium |
| [commercialization.md](commercialization.md) | *Redrawn 2026-10-26 (owner):* the advisor, the plan as the one paid product at $20 a year per student or $30 a family; everything else free, counselors included; the entitlement map behind the planner's capability hook; Stripe billing; the pricing page | Large |
| [advisor.md](advisor.md) | *Parts 1 and 2 built 2026-10-27; the trial planned:* the plan renamed Quad Advisor (the tab Advisor, `/advisor`), the 14-day trial with the card up front and the yearly charge after, and the signed-out splash page that shows the real thing over a sample student | Medium |
| [counselor-portal.md](counselor-portal.md) | *Revised 2026-10-26, free by the owner's decision:* organization accounts for counselors and consultants: caseloads over students' plans, reports, and scattergram uploads as the last phase; the families buy the advisor | Extra large |
| [data-api.md](data-api.md) | *Built 2026-10-20:* a keyed API and an MCP server over the dataset, history, and lineage, for people with an account (keys on `/account/api-keys`, docs on `/developers`); bulk downloads and the paid tier wait for billing | Medium |
| [assistants.md](assistants.md) | *Built 2026-10-20:* Quad in ChatGPT, Claude, and Gemini: the same MCP server without a key at `/mcp` for the assistants' connector menus, a downloadable skill file, and the `/connect` page with the steps for each | Medium |
| [data-steward.md](data-steward.md) | *Planned 2026-10-13, revised 2026-10-26*: an agent that turns the review queue into a few causes, proves each against the colleges' documents, and opens fixes for the owner to approve; Operations becomes Issues, Proposals, To do (the documents a person has to fetch), Decisions, and Audits | Large |
| [admin.md](admin.md) | *Built 2026-10-13* ([console pages](admin-console-ui.md)): the admin console: people and households (search, details, email, password reset, deactivate, delete, link and unlink), the hidden selectivity index and a student's hidden odds, each college's data health by when its data was received, and reruns and data approvals through a GitHub App | Large |
| [admin-health-views.md](admin-health-views.md) | *Built 2026-10-19:* the Health page's two views: the facts the admission estimate reads (each with its source, the year it describes, when it was published and collected, and a status by age), and every file we read with its year, publish date, and health | Medium |

## How the idea documents map
| Idea document | Where it went |
|---|---|
| Commercialization strategy: tiers, pricing, pricing page | [commercialization.md](commercialization.md) |
| Commercialization strategy: B2B counselors, data API | [counselor-portal.md](counselor-portal.md) (free since the owner's 2026-10-26 decision), [data-api.md](data-api.md) (built, free with an account) |
| Commercialization strategy: Niche-style high school integration | [high-school-data.md](high-school-data.md) (data), [scattergrams.md](scattergrams.md) (feeder and scattergram use) |
| Feature roadmap A: real cost and aid estimator | [net-price-estimator.md](net-price-estimator.md) |
| Feature roadmap B: localized scattergrams | [scattergrams.md](scattergrams.md) |
| Feature roadmap C: award letter evaluator | [../planner/offers.md](../planner/offers.md) (the planner's last stage, since 2026-10-07) |
| Feature roadmap D: major-level ROI | Already planned: [field-of-study.md](../data-expansion/field-of-study.md) (Scorecard Field of Study). The Pro tier gates its deeper views ([commercialization.md](commercialization.md#feature-map)) |
| Feature roadmap E: ED/EA strategy engine | [early-decision-strategy.md](early-decision-strategy.md) (built in pieces: `lib/early.ts`, the profile block, the Common App filters, ED opportunities on the plan) |
| High school data spec: sources, pipeline, use cases A–C | [high-school-data.md](high-school-data.md) |
| High school data spec: use case D, counselor portal | [counselor-portal.md](counselor-portal.md) |

Added here beyond the documents: households with parent-only finances ([accounts.md](accounts.md)), a student
profile shared by every tool (now the record), Quad's estimate on five levels
([../chances/README.md](../chances/README.md), which grew out of [chances-and-fit.md](chances-and-fit.md)), telemetry, award-letter renewability and appeal support, following
colleges with update emails ([follow-colleges.md](follow-colleges.md), added 2026-10-02), and the privacy rules for
minors' data that run through all of it.

## Build order
What is left, after the roadmap review of 2026-10-26 (everything else in this file is built):
```
advisor (the name and the page first) ─► launch-database ─► commercialization (the trial's billing) ─► counselor-portal (scattergrams as its last phase)
cost-by-income's pilot ─► net-price-estimator
data-steward (after the archive repo; independent of the rest)
```
Telemetry first: it is small, and every later feature's success is measured with it. Accounts next: the planning
tools are only worth building once a family can keep their work. Following colleges is the first thing to build on
accounts: it needs no personal numbers, gives people a reason to sign up, and pays off as soon as the scheduled data
refresh publishes releases on its own. Within the planning tools, the net price
estimator comes before the award-letter analyzer because the analyzer reuses its cost-of-attendance, loan, and
projection code. The high school dataset is the biggest item and can proceed in parallel; scattergrams need both it
and accounts.

## Shared rules for user data
These apply to every spec here and are enforced in the database (row-level security), not only in the UI.
- **Nothing about a person leaves the server unless they're allowed to see it.** Each table has an owner; guardians
  see their students' academic data; students never see guardians' financial inputs
  ([accounts.md](accounts.md#privacy-model)).
- **Minors.** Nobody under 13 may hold an account (the Supabase and PostHog terms both exclude under-13s, and
  COPPA applies). Students 13–17 may; a guardian link is optional. No behavioral advertising, no selling data, no
  session replay, no profiling beyond the features the user asked for ([telemetry.md](telemetry.md#privacy)).
- **User data lives only in Supabase** (new migrations, applied to dev before prod), never in `data/*.json`
  ([supabase.md](../supabase.md)). The JSON dataset remains the public, reviewed source for college data.
- **Estimates are ranges with their inputs shown**, in the same spirit as citations: "estimated from your AGI of
  $X and this college's 2023–24 net price by income". Never a bare number that looks like a quote from the college.
- **Export and delete.** Every account can download its data and delete itself; deleting a household's guardian
  never deletes a student's own data.
