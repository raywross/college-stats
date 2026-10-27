# iPhone App: Route-by-Route Parity Map

> Status: **planned** (2026-10-06; **rewritten** 2026-10-26 after the roadmap review). Third of the three iPhone app
> specs ([overview](README.md)); every page route of the site, what it becomes in the app ([app.md](app.md)), the spec
> that describes the page, and the app API call ([api.md](api.md)) that feeds it. This is the checklist the phases are
> measured against: a route not in this file is a gap in the ask, so add it here first.

## How this map is kept
The 2026-10-06 draft listed every control of every page. Three weeks later it was wrong in a dozen places, because
pages change weekly and the map did not. So this map is kept at the **route** level, where the site's own file system
is the source of truth, and the control-level detail lives in the spec that owns the page, which the build reads. Rules:
- One row per `page.tsx` under `app/` (86 on 2026-10-26, listed below by area), plus the sheets the tab bar opens.
- Each row names the **spec** whose "as built" section describes the page; the app renders that page's blocks.
- **Phase** 1 is everything that works signed out; 2 is signed in; **out** is not in the app (the admin console).
- `scripts/check-app-parity.mts` lists every `page.tsx` and fails when a route has no row here or a row has no route. It
  runs in `npm run verify` from the first app PR, so a route added to the site is a row added to this file in the same
  change.

Conventions carried over from the site: hover becomes tap everywhere; folds (`ShowMore`) become `fold` blocks; citation
popovers become a sheet on tap; the phone layout ([mobile.md](../mobile.md)) is what the blocks follow.

## Shell
| Site | App | API |
|---|---|---|
| `BottomNav`: Explore · Search · **Plan** (renamed with the site, [advisor.md](../product/advisor.md); with the dot for a deadline or a new move) · Compare (count badge) · More | `TabView` with the same five tabs; the Plan tab's badge from the dot endpoint | `GET /api/plan/next` (built) |
| Header: logo (home), `AccountMenu` (Sign in, or avatar: Your account, Household, Your record, Plan, Following, API keys, Admin for admins) | Home is the logo's tab root on Explore; the account button opens Account or Sign in | `GET /me` |
| Header nav from `md` (Explore, Compare, High schools, Glossary, Data), compact search | Not needed on iPhone; iPad sidebar | |
| Search sheet | Search tab, field focused; recents; offline index fallback | `GET /search`, the search index |
| More sheet: Account or Sign in, National trends, High schools, Glossary, Data, Roadmap, Release notes, Appearance | More tab with the same entries plus Connect, Developers, Privacy, and About | |
| Footer: tagline, about the data, build SHA | About screen: tagline, about the data, app version, build, dataset date | `GET /meta` |
| `not-found.tsx` | Not found screen; unknown deep links open the site in Safari | |

## Public pages (phase 1)
| Route | Spec | App | API |
|---|---|---|---|
| `/` | [home.md](../home.md) | The home screen: hero and search, lenses rail, the landscape scatter, worth-it scatter and leaderboards, what's changed, who stands out, states tile map, glossary cards | `GET /home` |
| `/explore` | [search-and-filtering.md](../search-and-filtering.md); the For you levels in [planner/record/explore-levels.md](../planner/record/explore-levels.md) (phase 2) | Filters sheet from the server's panel; the four views (rows or cards, table, chart, map); sort menu; active chips; infinite scroll with a shareable page | `GET /explore`, `GET /explore/filters` |
| `/schools/[id]` | [school-profile.md](../school-profile.md) | Hero, Compare / Add to plan / Follow, Known for, identity links, What changed, the "What it takes to apply" card, topic cards, similar schools, sources | `GET /schools/{id}` |
| `/schools/[id]/admissions`, `/students`, `/academics`, `/cost`, `/outcomes` | [school-profile.md](../school-profile.md); the standing card in [chances/estimate.md](../chances/estimate.md) (phase 2); the cost curve in [product/cost-by-income.md](../product/cost-by-income.md) | Topic screens with the segmented topic bar and swipe; the standing card asks the estimate with the token | `GET /schools/{id}/{topic}`, `POST /estimate` |
| `/schools/[id]/history` | [trends-design.md](../trends-design.md) | Controls as segmented controls; one group fetched at a time; "View as table" | `GET /schools/{id}/history` |
| `/schools/[id]/events` | [product/visit-events.md](../product/visit-events.md) | Phase 2: the college's event calendar; signed out, the sign-in invitation | `GET /schools/{id}/events` |
| `/compare`, `/compare/admissions`, `/students`, `/academics`, `/cost`, `/outcomes`, `/history`, `/compare/table` | [comparison.md](../comparison.md) | Compare tab: the picked colleges as chips, the overview, topic screens, the table with Differences only | `GET /compare*` |
| `/glossary` | [glossary-and-tooltips.md](../glossary-and-tooltips.md) | Searchable list by category; `#key` deep links open the entry; cached for offline | `GET /glossary` |
| `/trends`, `/trends/men-and-women`, `/test-optional`, `/shrinking-colleges`, `/price-gap`, `/out-of-state`, `/pell-gap`, `/where-students-go` | [national-trends.md](../national-trends.md), [trends/](../trends/) | The hub with the Common App block; seven studies with grouping controls | `GET /trends*` |
| `/trends/movers`, `/trends/conferences`, `/trends/conferences/[slug]`, `/trends/states`, `/trends/states/[state]` | [trends/top-10-lists.md](../trends/top-10-lists.md), [trends/conferences.md](../trends/conferences.md), [trends/states.md](../trends/states.md) | Blocks | `GET /trends/*` |
| `/high-schools`, `/high-schools/[id]` | [product/high-school-data.md](../product/high-school-data.md) | Search with the two filters; the school screen | `GET /high-schools*` |
| `/data` | [data-page.md](../data-page.md) | One reader screen with the same anchors | `GET /data` |
| `/developers` | [product/data-api.md](../product/data-api.md) | Reader screen; keys are made in Account | `GET /developers` |
| `/connect` | [product/assistants.md](../product/assistants.md) | Reader screen with Copy for the addresses | `GET /connect` |
| `/privacy` | [product/accounts.md](../product/accounts.md), [product/telemetry.md](../product/telemetry.md) | Reader screen; also linked from App Store Connect | `GET /privacy` |
| `/roadmap`, `/roadmap/[slug]`, `/release-notes`, `/release-notes/[slug]` | [roadmap.md](../roadmap.md), [release-notes.md](../release-notes.md) | Lists and a reader rendering the server's HTML; roadmap links stay in the app, repo links open the browser | `GET /roadmap*`, `GET /release-notes*` |
| `/l/[token]` | [product/saved-lists.md](../product/saved-lists.md) | Universal link → read-only shared list | `GET /share/lists/{token}` |
| `/invite/[token]` | [product/household-hub.md](../product/household-hub.md) | Universal link → invitation screen; Accept needs sign-in | `GET /invitations/{token}`, `POST …/accept` |

## Sign in (phase 2)
| Route | Spec | App | API |
|---|---|---|---|
| `/login`, `/auth/confirm` | [product/accounts.md](../product/accounts.md) | Sign-in sheet with the site's four modes plus Sign in with Apple; `next` returns to the asking screen; universal links complete the session; the age gate's refusal remembered a day | Supabase Auth; `POST /auth/precheck` |

## Account and household (phase 2)
| Route | Spec | App | API |
|---|---|---|---|
| `/account` | [product/accounts.md](../product/accounts.md) | Account: name, birth year, role; Parents can edit; reminders; who viewed; export; the admin link for admins opens the site | `GET`, `PATCH /me` |
| `/account/password`, `/account/delete`, `/account/deleted` | accounts.md | Password; delete (type "delete", two taps from Account, guideline 5.1.1) and restore | `POST /me/password`, the delete flow |
| `/account/household` | [product/household-hub.md](../product/household-hub.md) | Household settings: people and roles, invitations, managed students, home address | household routes, `/me/home` |
| `/account/api-keys` | [product/data-api.md](../product/data-api.md) | Keys: make (shown once, Copy), revoke, usage | `/me/api-keys` |
| `/household`, `/household/[person]` | household-hub.md | The hub: everyone by name, one plan each; a person's page | `GET /me/household`, `GET /plan?for=` |
| `/household/[person]/record` | [planner/record/steps.md](../planner/record/steps.md) | The record overview ("How complete is this", Edit per section) and the tour's steps as native forms from `record-step` blocks | `GET /me/record`, `PUT /me/record/{step}` |
| `/household/[person]/numbers`, `/household/[person]/plan`, `/household/[person]/lists/[id]` | Redirects to the record and the plan (household-hub.md "Changed") | The app's route table maps them the same way | |
| `/me` | [product/student-profile.md](../product/student-profile.md) → the record | Opens the record | |
| `/me/list`, `/me/lists/[id]`, `/me/plan` | Redirects to the plan | Route table | |
| `/me/updates` | [product/follow-colleges.md](../product/follow-colleges.md) | Updates screen; badge on More when a digest is new | `GET /me/updates` |
| `/me/visits` | [product/visit-events.md](../product/visit-events.md) | Near you first, then every followed college's events with its mute switch; the radius and email switch | `GET /me/visits`, prefs and mute routes |

## The plan (phase 2)
| Route | Spec | App | API |
|---|---|---|---|
| `/plan` (Next steps) | [planner/v3/now.md](../planner/v3/now.md), [planner/record/ranking.md](../planner/record/ranking.md), [planner/v3/parents.md](../planner/v3/parents.md) | The season, up to three `move-card`s with Done and Skip, the folded Done and skipped line; a guardian sees the student's view with the child switcher | `GET /plan/next`, `POST /plan/moves/{id}/done`, `/skip` |
| `/plan?tab=colleges` | [planner/redesign/list.md](../planner/redesign/list.md), [planner/next-steps/list-shape.md](../planner/next-steps/list-shape.md), [planner/next-steps/ed-opportunities.md](../planner/next-steps/ed-opportunities.md), [planner/v3/connections.md](../planner/v3/connections.md) | `plan-row`s by level (heart, crest, name, pill, status word, trash), the shape line, the ED sheet as a native sheet, the interest pill opening the guide; the add box searches the index | `GET /plan/colleges`, list and ED routes |
| `/plan?tab=calendar` | [planner/redesign/calendar.md](../planner/redesign/calendar.md) | `calendar-lane`s by month with the visit lane; Add to Calendar with the feed URL; texts consent; print → share sheet | `GET /plan/calendar`, `PUT /plan/feed`, `PUT /plan/texts` |
| `/plan?tab=offers` | [planner/offers.md](../planner/offers.md), [planner/applications.md](../planner/applications.md) | Applications by status, the `offers-table`, the choice, the share-letter question | `GET /plan/offers`, offer routes |
| `/plan/guide/[slug]` (list-size, interest, test-prep, story, ap-choices, recommenders, ed) | [planner/v3/guides/](../planner/v3/guides/), [planner/next-steps/ed-opportunities.md](../planner/next-steps/ed-opportunities.md) | One screen per guide from the `guide` block, with the move's Done and Skip in the footer and each guide's own actions (the list guide's rail with one-tap add; the interest guide's acts and the college's events; the test guide's dates; the story field; the recommenders list; the course picker) | `GET /plan/guide/{slug}` and its actions |
| `/plan/print` | calendar.md "Feed, print, share" | Share sheet → Print or Save as PDF from the Calendar tab | `GET /plan/calendar` |
| Signed out `/plan` | [planner/redesign/build-plan.md](../planner/redesign/build-plan.md) (the signed-out plan) | Not kept in the app: the app's plan is the account's; a signed-out visitor sees the sign-in invitation with the site's words | |

## Out of the app
| Route | Why |
|---|---|
| `/admin`, `/admin/people`, `/admin/people/[user]`, `/admin/people/[user]/views`, `/admin/households`, `/admin/households/[id]`, `/admin/students/[id]`, `/admin/high-schools/[id]`, `/admin/colleges`, `/admin/colleges/[unit]`, `/admin/colleges/[unit]/views`, `/admin/health`, `/admin/health/files`, `/admin/operations`, `/admin/selectivity`, `/admin/settings`, `/admin/log`, `/admin/admins`, `/admin/mfa` | The admin console ([product/admin.md](../product/admin.md)) is a desktop tool for the owner and support, behind MFA; the Account screen's admin link opens it in Safari |
| `/api/revalidate`, `/api/cron/*`, `/api/sms/inbound`, the data sync and publish scripts, the agents | Operations with no screen on the site either |
| `/unsubscribe/[token]`, `/api/plan/interest/confirm` | Reached from email; open the site |

## Signed-out memory
| Site | App |
|---|---|
| Compare list in `localStorage` | `QuadStore`, iCloud key-value sync |
| The browser-kept profile for the signed-out standing card and plan | Not kept; a signed-out `ScoreChecker` entry is used for that screen only |
| Theme in `localStorage` | Appearance setting |

## What is not lost
Hover-only effects (card lift, logo rotation) have no app equivalent and nothing is lost: every one has a tap path on the
site already. Server Actions become API calls one for one ([api.md](api.md#refactor-server-actions-into-lib-functions)).
The one thing the app does not carry is the signed-out plan: the plan in the app belongs to the account, and the site
keeps the signed-out version for people who have not signed up.
