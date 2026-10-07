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
| [household-hub.md](household-hub.md) | Add a parent or a student by role with only the details that role needs; everyone by name, invited people in the same roster with their link; the household page as the hub, one list per person with "updates" as a switch per college (planned 2026-10-06 from the owner's review) | Large |
| [application-plan.md](application-plan.md) | The list as a plan: suggested steps and the college's published dates per college, grouped by month, with a parent's check-in view and nudges through the digest (planned 2026-10-06) | Large |

### Planning tools
| Spec | Adds | Complexity |
|---|---|---|
| [chances-and-fit.md](chances-and-fit.md) | "Where you stand" at each college from the student's numbers; a transparent rules-based classification, never a probability | Large |
| [net-price-estimator.md](net-price-estimator.md) | What *this* family would pay: federal Student Aid Index plus each college's aid pattern, as a range, with a 4-year projection | Large |
| [award-letter-analyzer.md](award-letter-analyzer.md) | Real aid offers side by side, standardized the way the federal College Financing Plan does, with loans and 4-year totals made visible | Large |
| [early-decision-strategy.md](early-decision-strategy.md) | Early decision and early action admit rates vs regular decision, from Common Data Sets, with the caveats | Medium |

### High school context
| Spec | Adds | Complexity |
|---|---|---|
| [high-school-data.md](high-school-data.md) | A high school dataset (NCES, EDFacts, Civil Rights Data Collection, state report cards, school profiles) and high school pages | Extra large |
| [scattergrams.md](scattergrams.md) | Counselor-uploaded application outcomes from one high school, scrubbed and thresholded, drawn over the college's ranges | Large |

### Platform, measurement, and business
| Spec | Adds | Complexity |
|---|---|---|
| [telemetry.md](telemetry.md) | Product analytics with a typed event registry, privacy rules for minors, and usage reports (built 2026-10-07) | Medium |
| [commercialization.md](commercialization.md) | Free / Plus / Pro tiers, what each gates, Stripe billing, entitlements, the pricing page | Large |
| [counselor-portal.md](counselor-portal.md) | Organization accounts for counselors and consultants: caseloads, reports, scattergram uploads | Extra large |
| [data-api.md](data-api.md) | A keyed public API over the dataset, history, and lineage, with a paid tier | Medium |

## How the idea documents map
| Idea document | Where it went |
|---|---|
| Commercialization strategy: tiers, pricing, pricing page | [commercialization.md](commercialization.md) |
| Commercialization strategy: B2B counselors, data API | [counselor-portal.md](counselor-portal.md), [data-api.md](data-api.md) |
| Commercialization strategy: Niche-style high school integration | [high-school-data.md](high-school-data.md) (data), [scattergrams.md](scattergrams.md) (feeder and scattergram use) |
| Feature roadmap A: real cost and aid estimator | [net-price-estimator.md](net-price-estimator.md) |
| Feature roadmap B: localized scattergrams | [scattergrams.md](scattergrams.md) |
| Feature roadmap C: award letter evaluator | [award-letter-analyzer.md](award-letter-analyzer.md) |
| Feature roadmap D: major-level ROI | Already planned: [field-of-study.md](../data-expansion/field-of-study.md) (Scorecard Field of Study). The Pro tier gates its deeper views ([commercialization.md](commercialization.md#feature-map)) |
| Feature roadmap E: ED/EA strategy engine | [early-decision-strategy.md](early-decision-strategy.md), on top of [cds-admissions.md](../data-expansion/cds-admissions.md) |
| High school data spec: sources, pipeline, use cases A–C | [high-school-data.md](high-school-data.md) |
| High school data spec: use case D, counselor portal | [counselor-portal.md](counselor-portal.md) |

Added here beyond the documents: households with parent-only finances ([accounts.md](accounts.md)), a student
profile shared by every tool, Reach / Target / Likely classification with published rules
([chances-and-fit.md](chances-and-fit.md)), telemetry, award-letter renewability and appeal support, following
colleges with update emails ([follow-colleges.md](follow-colleges.md), added 2026-10-02), and the privacy rules for
minors' data that run through all of it.

## Build order
```
telemetry ──────────────────────────────────────────────────────────┐
accounts ─► student-profile ─► saved-lists ─► chances-and-fit        │
    │                             │                                  │
    │                             ├─► commercialization ─► counselor-portal
    │                             │
    ├─► net-price-estimator ─► award-letter-analyzer
    │
    ├─► follow-colleges (lists follow automatically; pays off once the scheduled data refresh runs)
    │
    ├─► household-hub ─► application-plan   (2026-10-06: the review of the first build, then the plan on top)
    │
high-school-data ─► scattergrams (also after saved-lists)
cds-admissions (data expansion) ─► early-decision-strategy
data-api (independent)
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
