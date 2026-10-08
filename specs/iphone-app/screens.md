# iPhone App: Screen-by-Screen Parity Map

> Status: **planned** (2026-10-06). Third of the three iPhone app specs ([overview](README.md)); every site page and
> control, what it becomes in the app ([app.md](app.md)), and which app API call ([api.md](api.md)) feeds it. This is
> the checklist the phases in [app.md](app.md#phases) are measured against: a feature not in this file is a gap in
> the ask, so add it here first.

Conventions: **Phase** is 1 (signed out) or 2 (signed in). *Native* notes what changes because it is an app rather
than a page; blank means the site's phone layout ([mobile.md](../mobile.md)) carries over as blocks. Hover affordances
become tap everywhere and are not repeated per row.

## Shell
| Site | App | Native | API |
|---|---|---|---|
| `BottomNav`: Home · Explore · Search · Compare (lime count badge) · More | `TabView` with the same five tabs and badge | System tab bar; each tab a `NavigationStack` | — |
| Header: logo, `AccountMenu` (Sign in, or avatar menu: Your account, Household, My numbers, My list, Following) | Toolbar on Home: logo; account button opens the Account screen or Sign in | | `GET /me` for the avatar state |
| Header nav from `md` (Explore, Compare, High schools, Glossary, Data), compact search | Not needed on iPhone; iPad sidebar lists them | | |
| Search sheet (`SchoolSearch` autofocused) | Search tab: a search field focused on appearance | Keyboard "Search" key; recents; offline index fallback | `GET /search` |
| More sheet: Account, National trends, High schools, Glossary, Data, Roadmap, Release notes, Appearance | More tab as a list with the same entries plus About | | |
| `ThemeToggle` / `ThemeSegmented` Light · Dark · System | Appearance row in More (segmented) | Follows system by default | — |
| Footer: tagline, "About the data" (Scorecard and IPEDS `Term`s), build SHA | About screen: tagline, about the data, app version, build, dataset publish id, link to release notes | | `GET /meta` |
| `not-found.tsx` | "Not found" screen with a link to Explore; unknown deep links open the site in Safari | | |

## Home (phase 1)
| Site (`app/page.tsx`) | App | Native | API |
|---|---|---|---|
| Hero: count pill, "College data, decoded.", `SchoolSearch`, "Try:" chips (five colleges) | Hero with the headline, a search field that opens the Search tab, the Try chips | | `GET /home` |
| Spotlight cards (from `lg` only) | Omitted on iPhone as on the phone site; a row on iPad | | |
| Stat strip (colleges and states, applications, pooled admit rate, undergrads; InfoTips) | `stat-tiles` block, InfoTips as citation sheets | | |
| Nine lenses (most selective, within reach, big publics, small and close-knit, economic diversity, low cost/high earnings, opportunity colleges, HBCUs, R1), each a preset Explore query with count and four crests | Horizontal rail of lens cards; tap opens Explore with that query | `ScrollView(.horizontal)` with paging | |
| Admissions landscape `ScatterPlot` (400 most-applied-to), reading guide, "Filter this chart in Explore", `MultiSourceNote` | `scatter` block, tap a dot for its card, tap again to open; link to Explore chart view | | |
| "Is it worth it?" scatter with median zone; three leaderboards (earnings, aid, lowest cost) | `scatter` + three `leaderboard` blocks in a rail | | |
| What's changed: fact cards with sparkline or before/after bars, years, source, link | Rail of fact cards (`trend-line` compact) | | |
| Who stands out: hardest to get into, largest, most economically diverse | Three `leaderboard` blocks | | |
| Schools by state `StateTileMap` → `/explore?states=`; head-to-head call to action with four matchups | `tile-map` block; matchups as `links` | | |
| Learn the lingo: four glossary cards, Full glossary link | `chips`/cards to Glossary entries | | |

## Explore (phase 1; fit chips phase 2)
| Site (`app/explore/page.tsx`) | App | Native | API |
|---|---|---|---|
| Title and three summary tiles (median admit rate, median SAT midpoint, undergrads) | Header with the tiles | | `GET /explore?…` |
| Search field (`q`, 250 ms debounce) | Search field in the toolbar | | |
| `MobileFilterSheet`: button with active count, 88dvh sheet, full `FilterPanel`, sticky "Show N schools" | Filters button with count; a sheet (`.presentationDetents([.large])`) rendering the server-described panel; "Show N schools" footer updates live | Panel controls: range with histogram, chips with counts, 2×2 tiles, select, ZIP field, state list | `GET /explore/filters?…` |
| Every filter section and param, in panel order: Distance from home (`near`, `within`, "Use my home"); Acceptance rate (`minAR`,`maxAR`); SAT (`minSAT`,`maxSAT`); Test policy (`policy`); Average cost (`minCost`,`maxCost`, `fewLoans`); Graduation (`pellGap`); 10-year direction (`costTrend`,`appsTrend`,`divTrend`,`selTrend`); Type (`types`); Size (`sizes`); Student body (`balance`, `fullTime`); Draws nationally (`national`); Financial aid (`aidForms`, `intlAid`); Majors (`field`, `fieldMin`); Campus (`setting`, `research`, `designation`, `opportunity`); Religious affiliation (`faith`, `faithGroup`); LGBTQ+ (`lgbtqCenter`, `lgbtqHousing`, `lgbtqNondiscrimination`); Students per faculty (`maxRatio`); Full-time faculty (`minFullTimeFaculty`); Sports and programs (`division`, `football`, `rotc`, `ugResearch`, `studyAbroad`, `honors`); What they look at (`noLegacy`, `noEssay`, `gpaRequired`, `gpa`); Where applicants live (`byRes`, `oosEven`); Transfers (`transfers`); Greek life (`minGreek`, `greekCouncils`); Gap year (`gapYear`); Housing and policies (`liveOn`, `noFee`, `guarantee`); Region and State (`regions`, `states`) | All of them, as the panel document lists them; the app has no filter list of its own | Counts and disabled-at-zero chips come from the document | |
| Chip-only params (`minEnroll`, `maxEnroll`, `minApplicants`, `minUndergrads`, `conference`, `mySAT`, `myACT`, `minACT`, `maxACT`) | Shown as active chips when present (from lenses, trends links, fit chips) | | |
| `ActiveFilters` lime chips with labels, one per filter; Reset all (keeps sort and view) | Same chips above the results | | |
| `ExploreFitChips`: Fits my scores, Fits my preferences (signed in) | Same two chips, enabled when signed in with a profile | Phase 2 | `POST /me/fit` |
| Sort: every key in `Toolbar.tsx SORTS` (basics, cost, 10-year changes, students and outcomes, `distance` when `near`) with direction | Sort menu with the same groups and keys, from the document | | |
| View toggle: Cards · Table · Chart · Map | Segmented control | | `view=` |
| Grid view: `SchoolRow` on phones (crest, name, location and miles, SAT range, undergrads, $/yr, admit rate, compare and list icons); `SchoolCard` from `sm` (admit rate and "1 in N", tier pill, five percentile meters, 2×2 trend indicators, two standouts) | Rows on iPhone, cards on iPad, from `school-row` / `school-card` blocks | Swipe actions on a row: Compare, Add to list | |
| Table view (50 per page): every column (From home, Admit rate, by sex, Undergrads, SAT, Pell, First-gen, Out of state, Transfers, Top major, Men, Diversity, Avg cost, Aid generosity, Earnings, Grad rate, 8-yr completion, Pell gap, Borrow), sortable headers with InfoTips, inline bars, sticky first column; `changes=1` adds eight change columns | `table` block: pinned first column, horizontal scroll, tap a header to sort, inline bars; "Show 10-year changes" toggle | | `view=table&changes=1` |
| Chart view: tabs `admissions`, `value`, `sticker`; scatter of up to 600 matches with a count caption | Segmented chart tabs; `scatter` block | | `view=chart&chart=` |
| Map view: `DotMap` of every match, caption with territories and missing locations | `dot-map` block with the server's projected paths; tap a dot for its card | | `view=map` |
| Pagination (prev/next, numbers, "x–y of N") | Infinite scroll that requests the next `page`; a "Page x of y" line keeps the position shareable | Share produces the site URL with `page=` | |
| Empty state with Reset; `MultiSourceNote`, `BaselineNote`, percentile footnote | Same, as `text` and `source-note` blocks | | |

## Search (phase 1)
| Site | App | Native | API |
|---|---|---|---|
| `SchoolSearch`: typeahead (120 ms), six results, alias matches ("UGA"), Enter → Explore `?q=` | Search tab: results as rows with crest, name, city, admit rate, and the matched alias | Recent searches; offline prefix search over the index when offline | `GET /search`, `GET /schools/index` |

## College profile (phase 1; Follow and Add to list phase 2)
| Site (`app/schools/[id]/*`) | App | Native | API |
|---|---|---|---|
| Hero: brand tint, accent bar, crest, name, facts row of `Term`s (city and region, type, size tier, test policy, setting, research tier, designations) | Large-title screen with the same hero | Pull to refresh | `GET /schools/{id}` |
| Buttons: `CompareButton` (Compare / Comparing / full), `AddToListButton`, `FollowButton` (sign-in popover when signed out) | Same three; signed-out taps open the Sign in sheet with `next` back to the college | | `PUT /me/follows/{id}`, `POST /me/lists/{id}/items` |
| "Known for" `StandoutChip`s | `chips` block | | |
| `HeroIdentity`: Website, Admissions, Apply, Visit or Virtual tour, Financial aid; social icons (Instagram, YouTube, TikTok, X, Facebook, LinkedIn); `SourcesTip` | `links` block; external links open in `SFSafariViewController`; social links open the app if installed | | |
| `ProfileChanges` (what changed in the last year); `MyHighSchoolLine` (signed in) | Same blocks | | `GET /schools/{id}/changes` |
| Six topic cards (Admissions, Students, Academics, Cost, Outcomes, History), each a link with footer and `TenYearLine` | `topic-card` blocks; tap pushes the topic screen | | |
| Similar schools: four cards with reasons, compare icon, "Compare side-by-side" | `school-chips`-style cards with reasons | | |
| "Sources for this overview" `<details>` with numbered `SourceList` | Collapsible Sources section at the end of every screen | | |
| `CompactHeader` on topic pages: crest, name (to overview), city · type, Compare, `TopicPills` | Compact header with a segmented topic bar; swipe between topics | | |
| `OnThisPage` scroll-spy; on phones jumps to a folded block's "Show…" | "On this page" menu in the toolbar; selecting scrolls and unfolds | | |
| `ShowMore` folds (waffle and admissions map until lg; "Who they are"; "Borrowing and repayment"; "Who actually gets aid"; cost vs earnings map) | `fold` block: a dashed "Show …" button with the hint; content fetched with the document, hidden until tapped | | |
| **Admissions:** funnel; waffle; men and women; `ResidencyAdmissions`; yield ring and strips; wait list; early rounds; admission factors; transferring in; applying box; high-school prep; admissions map with this college focused; GPA panel; test scores: policy, `ScoreChecker` (your SAT/ACT; prefilled from the profile when signed in), score bands, who submitted, SAT-midpoint strip | Blocks in the same order; `ScoreChecker` is a native form whose result (where you fall) comes from the server given the entered scores | | `GET /schools/{id}/admissions`, `GET …/admissions?sat=&act=` for the checker |
| **Students:** race and ethnicity stacked bar and diversity strip; Pell and first-gen benchmark bars; campus size; residence; transfers; who they are (fold); campus life, services, Greek life, religious life, LGBTQ+ life | Blocks | | `GET /schools/{id}/students` |
| **Academics:** majors; top-earning majors; students per faculty and strip; class sizes histogram; faculty; spending and endowment | Blocks | | `GET /schools/{id}/academics` |
| **Cost:** what students pay with the cost waterfall; next year's price; net price by income columns; debt; loans (fold); who gets aid: generosity card, aid breakdown, CDS aid table (fold); applying for aid; international aid; external net price calculator link | Blocks | | `GET /schools/{id}/cost` |
| **Outcomes:** earnings and strip; staying and finishing rings; graduate debt; 8-year outcome measures with the all / first-time / transfer toggle; graduation by group dot plot; cost vs earnings map (fold) | Blocks; the toggle is a `controls` block bound to a query param | | `GET /schools/{id}/outcomes` |
| **Over time:** controls (10 years / All; after inflation / as reported; national median; all / in-state / out-of-state for publics); group pills (Cost, Aid, Admissions, Test scores, Students, Academics, Outcomes, Policy changes); `TrendLine`, `Dumbbell`, `StackedArea100` panels each with a *Table* toggle and `HistorySourceNote`; state in the URL | Controls as native segmented controls and toggles; group pills as a segmented bar; charts as blocks with "View as table" | Only the selected group is fetched, as the site renders only one | `GET /schools/{id}/history?group=&range=&dollars=&median=&rate=` |
| Topic previous/next (`TopicNav`) | Swipe and the topic bar | | |
| Topic 404 when the college lacks the data | The topic is absent from the bar | | |
| Citation popovers on every value (source, year, method, formula and inputs, CDS edition, quote, image credit, federal value replaced, retrieved) | Tap a value or its ⓘ → citation sheet with the same fields and a "Learn more in the glossary" link | | `Value.cited` |

## Compare (phase 1; Follow and "Save these to my list" phase 2)
| Site (`app/compare/*`) | App | Native | API |
|---|---|---|---|
| Store: `localStorage` `compareIds`, max 4, cross-tab sync | `QuadStore` compare list, max 4, synced through iCloud key-value store across the person's devices | | — |
| `CompareTray` (from `md`): crests, empty slots, "N of 4 picked", Clear, "Save these to my list", "Compare N →" | Compare tab shows the picked colleges as chips with remove; Clear; Save to my list; the overview below once two are picked | | `GET /compare?ids=` |
| `CompareHeader`: slot-colored chips with ×, FollowButtons, "Add school" picker (searches `/api/schools`), topic pills from two colleges | Sticky header with the chips and an Add school button (search sheet); topic bar from two colleges | | `GET /search?exclude=` |
| Empty state ("Pick your contenders", six matchups, Browse); one school ("Pick a rival", four similar) | Same blocks | | |
| Overview: key differences (up to six, magnitude bars, InfoTips); `RadarChart`; six `CompareTopicCards` with takeaways and flags; "All the numbers" link; sources; `BaselineNote` | Blocks; radar legend chips isolate one school on tap | | |
| Topics: admissions (funnel cards, men and women, `ScoreCompare`, policy, factors grid); students (metric cards, descriptive rows, `RaceCompare`, where first-years come from, transfers, campus chips, LGBTQ+ policy table); academics (faculty, spending and endowment, majors, `YourMajor` picker → `?major=`); cost (shared-scale cost bars, grants, sticker and tuition, `NetPriceCompare`, guarantee text table, CDS aid rows); outcomes (earnings, graduation and retention, debt, 4- and 8-year, by group); history (10-year direction table, `ThenAndNow` slope with metric control) | Blocks; `ScoreCompare` and `RaceCompare` keep a fixed per-college width and scroll inside their card, as the site does on phones; the major picker is a native picker | | `GET /compare/{topic}?ids=&major=` |
| Key differences on each topic (up to three), `OnThisPage`, source note, previous/next | Same | | |
| Table (`/compare/table`): five groups with anchors, sticky label column, sticky header from `lg`, per-cell years, Website row, **Differences only** switch | `table` block with pinned label column; "Differences only" toggle hides `same` rows | | `GET /compare/table?ids=` |
| URL as the source of truth (`?ids=`); add/remove stays on the topic | Deep link `/compare?ids=` replaces the store; share gives the URL | | |

## Glossary (phase 1)
| Site | App | Native | API |
|---|---|---|---|
| Search, category nav, entry per term (short, long, why, related chips), `#key` anchors that flash | Searchable list grouped by category; entry detail; `/glossary#key` deep link opens the entry | `.searchable` | `GET /glossary` (cached; works offline) |
| `InfoTip`, `Term`, `MetricLabel` across the site | Citation and term sheets, see the profile row above | | |

## National trends (phase 1)
| Site (`app/trends/*`) | App | Native | API |
|---|---|---|---|
| Hub: study cards (headline, sparkline, sentence), movers entry (three lists), Power Four, states tile map | Trends screen from More | | `GET /trends` |
| Six studies (men and women, test-optional, shrinking colleges, price gap, out-of-state, Pell gap): question, then/now tiles, national `TrendLine`, `SmallMultiples` with a grouping switch (region, control, size, selectivity, plus setting, division, research, designation, state, conference) and Colleges/Students views, takeaway, method, `HistorySourceNote`; study-specific charts (pandemic shading, `Dumbbell`s, `DistributionStrip`, `StateTileMap`, `GroupDotPlot`, lists of colleges) | Blocks; grouping and view switches are `controls` | Small multiples as a two-column grid on iPhone | `GET /trends/{study}?grouping=&view=` |
| Movers: `?window=10|5`, ten ranked lists with floors, "Show 25", Explore link, method | Window segmented control; lists expand in place | | `GET /trends/movers?window=` |
| Conferences: Power Four cards, table by level, realignment moves; conference page: Explore link, member crests, `DotRange`, `ConferenceOverTime` with measure switch, `MembersCompared`, realignment timeline | Blocks | | `GET /trends/conferences[/slug]` |
| States: `StateMeasureMap` with measure switch, sortable table; state page: counts, four sparkline tiles, public/private split, where first-years come from, movers for the state, public R1/R2 | Blocks; tap a tile to open the state | | `GET /trends/states[/{state}]?measure=` |

## Data page (phase 1)
| Site (`app/data/page.tsx`) | App | Native | API |
|---|---|---|---|
| Why (lag diagram); what's on the site now with `DataAgeTimeline`; release calendar with states (Estimated, Confirmed, Out now, No set date, Later than expected); federal baseline vs newest figure; college-reported checks and count; watching; sources with the CDS list and "Colors and marks" (trademark line, removal route); high schools; how we calculate | One screen of blocks with the same anchors as deep-link targets | | `GET /data` |

## Roadmap and release notes (phase 1)
| Site | App | Native | API |
|---|---|---|---|
| `/roadmap`: counts, complexity scale, groups with overview links; `/roadmap/{slug}`: summary, complexity, status, source, contents, the spec, previous/next | Lists and a reader screen rendering the server's HTML in a native text view with the site's spec typography; links to other roadmap pages stay in the app, repo links open the browser | | `GET /roadmap[/slug]` |
| `/release-notes`: by day with kind counts; `/release-notes/{slug}`: kind, date, PR link, contents, body, older/newer | Same reader | | `GET /release-notes[/slug]` |

## High schools (phase 1; "My high school" phase 2)
| Site | App | Native | API |
|---|---|---|---|
| `/high-schools`: name or city, state, public/private, up to 30 results | Search screen with the two filters | | `GET /high-schools?q=&state=&kind=` |
| `/high-schools/[id]`: header; stats vs state medians; rigor (AP, IB, dual enrollment); outcomes (graduation, college-going, mean SAT/ACT, proficiency, chronic absence, `ClassTrend`); grading (GPA scale, distribution); where graduates go (matriculation table with college links, "Fewer than 5", admitted-to list, NSC enrolled/persisted/completed); sources; every value cited | Blocks; college links push profiles | | `GET /high-schools/{id}` |

## Sign in (phase 2)
| Site (`app/login/*`, `app/auth/*`) | App | Native | API |
|---|---|---|---|
| Modes: sign in (email and password), sign up (birth year, role hint, password rules), forgot password, magic link (asks birth year for a new account); unconfirmed state with resend; `?next=` | Sign in sheet with the same four modes plus **Sign in with Apple**; `next` returns to the screen that asked | Password AutoFill, Keychain; Face ID unlock option | Supabase Auth; `POST /auth/precheck` |
| Age gate: 13+, refusal cookie for a day | Same message; refusal remembered a day | | |
| `/auth/confirm` (fragment tokens) and `/auth/callback` (`code`, `token_hash` for email, magiclink, signup, invite, email_change); failure → `/login?error=link` | Universal links complete the session in the app; failure shows the site's message | | Supabase Auth |
| Sign out (`POST /auth/signout`, local scope) | Sign out in Account | | Supabase Auth |

## Account and household (phase 2)
| Site (`app/account/*`) | App | Native | API |
|---|---|---|---|
| Profile: email (read-only), display name, birth year, role hint | Account screen form | | `GET|PATCH /me` |
| Password: set or change with confirm; `same_password`, `reauthentication_needed` | Password screen | | `POST /me/password` |
| Household summary: "N of 6 seats", home address or none, Start a household | Household section | | `GET /me/household` |
| Following link | Following screen | | |
| Who viewed your information (students): access log lines | Same list | | `GET /me` (access log) |
| Download my data (JSON) | Export → Files picker or share sheet | | `GET /me/export` |
| Delete my account: preview per managed student, type "delete", soft delete 30 days, sign out; Restore while scheduled | Same flow in two taps from Account | | `/me/delete/*`, `/me/restore` |
| Household page: create; roster with roles and view/edit; remove (guardians); leave; allow editing / view only; pending invitations with Cancel and New link; invite form (email, side, hand over a managed student, "Let them edit"); add a student without an account (name, grad year); link a managed student to their account | Household screen with every operation as a row or sheet | Invitation link shown once with Copy and Share | household routes |
| `/invite/[token]`: preview (household, inviter, side, expiry, state); Sign in prompt or Accept | Universal link → Invitation screen | | `GET /invitations/{token}`, `POST …/accept` |
| Home address: one field (address or ZIP) with optional Google suggestions, geocoded server-side with the ZIP fallback; "Colleges within 100 miles", Change, Remove | Home screen in Household; suggestions from the server | | `/me/home`, `/me/home/suggest` |

## Student profile (`/me`, phase 2)
| Site (`app/me/page.tsx`) | App | Native | API |
|---|---|---|---|
| Student picker for guardians (`?student=`), "(view only)", `GuardianBanner`, logged read | Picker in the toolbar; banner | | `GET /me/student?student=` |
| `ImportLocalProfile` (import the signed-out `localStorage` profile) | Not applicable: the app has no signed-out profile store | | |
| `CompletenessMeter` (six items) | Same | | |
| Form sections: Basics (grad year, state incl. Outside U.S., high school via `HighSchoolPicker` or free text); Academics (GPA and scale, weighted GPA, class rank, rigorous courses); Tests (SAT total, reading, math; ACT composite, English, math; superscore; test-optional plan); Plans (up to three CIP families, early-round interest); Preferences (sizes, settings, types, states or regions, max cost) | Native form with the same sections and fields; the high school picker searches the directory | Numeric keyboards, steppers | `PUT /me/student`, `GET /high-schools?q=` |
| Where the profile is read: `ScoreChecker` prefill, Compare's "You" row, fit chips, `MyHighSchoolLine` | Same, through the API's signed-in variants | | |

## Saved lists (phase 2)
| Site (`/me/list`, `/me/lists/[id]`, `/l/[token]`) | App | Native | API |
|---|---|---|---|
| Default "My list" created lazily; `/me/list` redirects | My list in the account menu opens the default list | | `GET /me/lists` |
| `ListSwitcher`, rename, delete (extra lists only), create | Lists screen; swipe to delete non-default lists | | lists routes |
| "Compare these" (first four) | Same button | | |
| "Next 30 days" deadline strip | Same block at the top | | |
| `ListBoard` by category with balance line and guidance; rows: crest, admit rate and cost (cited), distance from home, resolved deadline (CDS dates or override), pickers for category, round, status, outcome; "Enrolling here"; move up/down; remove; notes with private lock and "Added by" | Board as sections per category; row detail sheet with every control; reorder by the native drag handle in edit mode (sends up/down moves) and the arrows for VoiceOver | Swipe: remove; context menu: category | `GET /me/lists/{id}`, item routes |
| Notes: add (private or shared), delete | Notes in the row sheet | | notes routes |
| `CsvControls`: export (Scoir columns), import by pasted CSV with unmatched names | Export to Files or share sheet; import from a CSV file or the clipboard | | `export.csv`, `import` |
| `ShareToggle`: enable (token shown once), revoke | Same, with Copy and Share | | `PUT …/share` |
| Print stylesheet | Share sheet → Print or Save as PDF from the board | | |
| `/l/[token]`: name and items by category, college links, `noindex` | Universal link → shared list screen (read-only) | | `GET /share/lists/{token}` |
| View-only guardian sees the board read-only | Same | | |
| `AddToListButton` on profile, Explore row/card/table, compare tray; `SignInPrompt` when signed out | Same placements | | |

## Following and updates (phase 2)
| Site | App | Native | API |
|---|---|---|---|
| `FollowButton` (Follow / Following / On your list) on the profile hero and compare chips | Same | | `PUT|DELETE /me/follows/{id}` |
| `/me/following`: followed colleges, "On your list" vs "Followed", "Last changed", Unfollow, email updates toggle | Following screen | | `GET /me/follows`, `PUT /me/notifications` |
| `/me/updates`: every digest, newest first, rebuilt from `dataset_changes`, "Also noticed" | Updates screen | Badge on More when a new digest exists since the last visit | `GET /me/updates` |
| Digest emails, `/unsubscribe/[token]` | Unchanged: email, and the link opens the site | | — |
| Public "What changed" on profiles | In the profile overview | | |

## Signed-out memory
| Site | App |
|---|---|
| Compare list in `localStorage` | `QuadStore`, iCloud key-value sync |
| Signed-out student profile in `localStorage` ("student-profile", imported on `/me`) | Not kept; the app's profile is the account's. A signed-out `ScoreChecker` entry is used for that screen only |
| Theme in `localStorage` (next-themes) | Appearance setting |

## Server-only and out of scope for the app
`/api/revalidate`, `/api/cron/digests`, the data sync and publish scripts, the college-reported agent, and the
hooks are operations; they have no screen on the site either. The footer's build SHA becomes the About screen's
version line. Hover-only effects (card lift, logo rotation, crest × on hover in the tray) have no app equivalent and
nothing is lost: every one has a tap path on the site already.

## Parity check
`scripts/check-app-parity.mts` (planned) lists every route under `app/` and every spec in `specs/` with a status of
built, and fails when a route has no row in this file. It runs in `npm run verify` once phase 1 starts, so a page
added to the site is a page added to this map, in the same PR.
