# Campus Life: Sources We Couldn't Read

> Status: **deferred** 2026-10-04. Collects every source the religious-life, greek-life, and lgbtq-life tracks found
> but couldn't read during the 2026-10-04 build (`feature/campus-life-2`): national directories left out of
> [campus-directories.md](campus-directories.md), and pages the 25-college pilot hit during its reconnaissance. Parked
> until the owner picks a fix for a given source; each is independent, so fixes can land one at a time, alongside
> whichever feature needs that source next. Companion to
> [religious-life.md](religious-life.md), [greek-life.md](greek-life.md), and [lgbtq-life.md](lgbtq-life.md).

## How to read the tables
**Why unreadable** uses the access rules' own vocabulary: **blocked** (a Cloudflare/Akamai challenge or a WAF 403 to
every request), **login** (the content sits behind a member portal or a campus sign-in), **JS-only** (the page
loads with no data in its HTML; a browser's JavaScript builds the list), **robots** (the site's own robots.txt
disallows the page), **form POST** (the data loads only through a form submission our GET-only crawler doesn't do),
**site down** (unreachable, compromised, or redirecting to nothing), **stale** (the only directory is years out of
date), or **not checked** (recon never got to it).

**Candidate fix** picks from four kinds, consistent with the access rules (`campus-life-2-brief.md`, owner decision
1: never bypass a challenge or login automatically):
- **Hand reading** — a person (or a future session with a real browser) reads the page once and records the fact,
  same as the pilot's blocked colleges.
- **Partnership** — ask the organization for its own data or an API; needed wherever the block is a login or a
  robots disallow, since no crawler fix respects those.
- **Headless-browser renderer** — a tool that executes the page's own JavaScript and reads what it renders. This is
  only offered where the source is marked **JS-only** with no challenge or login in front of it: rendering a public
  page's own script doesn't get around anything, so it looks acceptable under the access rules. It is never offered
  for a **blocked** or **login** source — defeating a challenge or supplying credentials is exactly what decision 1
  rules out.
- **Org's own data request** — write to the organization (or search for a successor page) rather than re-crawl.

## Religious life

| Source | Would give | Why unreadable | Candidate fix |
|---|---|---|---|
| Hillel International (`hillel.org/college-tools/`, plus every per-college Hillel page, including Georgetown, Smith, and Williams in the pilot) | Community size estimates and named Jewish groups for most colleges | Blocked — Cloudflare challenge site-wide | Partnership: ask Hillel for a data feed (already on the backlog's partnership list) |
| Orthodox Christian Fellowship (`ocf.net/chapters/`) | Chapter directory | Blocked — `robots.txt` itself returns 403, so even checking permission fails | Partnership: ask OCF directly |
| InterVarsity (`intervarsity.org/chapters`) | Chapter directory, most public and many private campuses | Form POST — the list loads only via a Drupal AJAX POST with a CSRF token; the crawler contract is GET-only by design | Owner's call (flagged in religious-life.md phase 3): either extend the crawler to submit the form, which risks looking like getting around it, or ask InterVarsity for the list |
| Chi Alpha (`chialpha.com/group-locator/`) | Chapter directory | JS-only — a school-name/ZIP search widget with no bulk endpoint | Headless-browser renderer, driving the search box state by state; no challenge sits in front of it |
| Catholic Campus Ministry Association (member directory) | National directory of Catholic campus ministries | Stale — the only link is a single PDF from February 2019 | Org's own data request: ask CCMA for a current list |
| Muslim Students Association National | Chapter directory | Site down — the current site has no locator page or link in its navigation | Re-check periodically; no fix today |
| LDS Institutes of Religion (`churchofjesuschrist.org/si/institute/search`) | Institute locations by campus | Not checked — the URL this spec guessed is a general site search, not a locator | Org's own data request: ask the Church's media office for a locator feed |
| Baptist Collegiate Ministries, Hindu YUVA / Hindu Students Council, Lutheran Campus Ministry (LuMin), Wesley Foundations (UMC), Episcopal campus ministry | Chapter directories | Not checked — no single national page found; Baptist ministry in particular splits into dozens of state-convention sites | Hand research one denomination at a time, or an org's own data request to each |
| Chaplaincy/faith-life office pages: Williams (`chaplain.williams.edu`), Harvard (`chaplains.harvard.edu`), Columbia (`religiouslife.columbia.edu`), Baylor (`spirituallife.web.baylor.edu`) | Office description, named faith groups, sometimes a composition claim | Blocked — Cloudflare (Williams, Columbia, Baylor) or Akamai (Harvard) on every request | Hand reading (owner decision 1); Wheaton's `catalog.wheaton.edu` mirror read past the same wall for its Community Covenant, so check each college for a non-challenged mirror first |

## Greek life

| Source | Would give | Why unreadable | Candidate fix |
|---|---|---|---|
| 9 NIC member fraternities (Sigma Alpha Epsilon, Pi Kappa Alpha, Phi Delta Theta, Alpha Tau Omega, Beta Theta Pi, Phi Gamma Delta, Delta Tau Delta, Kappa Alpha Order, Alpha Sigma Phi) | Chapter directories | JS-only — a search form, a paginated widget (FacetWP), or a JS map with no data in the page's HTML | Headless-browser renderer, one per site; no challenge blocks any of these pages |
| 7 of the other 8 NPHC ("Divine Nine") organizations (all but Kappa Alpha Psi and Delta Sigma Theta) | Chapter directories | JS-only — a client-rendered widget with no discoverable backing data | Headless-browser renderer |
| Delta Sigma Theta (`members.dstonline.org`) | Chapter directory | Login — member-only portal, like NPC's and NIC's national-level data | Partnership: ask the sorority directly; no crawler fix respects a member login |
| Kappa Alpha Psi (`kappaalphapsi1911.com/find-a-chapter/`) | Chapter directory | Blocked — 403 to every request (bot protection), though `robots.txt` itself is permissive | Hand reading, or partnership with the fraternity |
| NAPA, NMGC (Asian-interest and multicultural Greek umbrellas) | Member-organization directories | Site down — NAPA doesn't respond (DNS/connection failure); NMGC appears compromised with spam-link injection as of 2026-10-04 | Re-check periodically; do not crawl NMGC until it's cleaned up |
| 17 of 18 NALFO member organizations (only Omega Phi Beta built) | Latino Greek chapter directories | Not checked — recon stopped once one workable format (Omega Phi Beta's HTML table) was found | Run the same per-site recon pass across NALFO's member list; likely a mix of workable and JS-only sites |
| Gamma Rho Lambda, Delta Lambda Phi (LGBTQ+ Greek organizations) | Chapter directories | JS-only — fully client-rendered page builders (GoDaddy, Wix) with nothing server-rendered to parse | Headless-browser renderer; low priority, two small organizations |
| `alpha-phi.org`, `alphasigmatau.org`, `deltazeta.org` chapter locators | NPC sorority chapter directories (outside the 26 sororities built via workable formats) | Blocked — Cloudflare challenge (Alpha Phi, Delta Zeta) or a WAF 403 (Alpha Sigma Tau) | Hand reading, or the NPC-wide partnership ask already on the backlog |
| Kappa Kappa Gamma (`kappakappagamma.org/.../chapters-and-advisory-boards/`) | NPC sorority chapter directory | Login — served only inside the "MyKappa" member portal | Partnership; member-locked by design |
| UT Austin's Sorority and Fraternity Life size/grade reports (`deanofstudents.utexas.edu/sfl/downloads/`) | Per-chapter and per-council membership counts, every term | Robots — `studentlife.utexas.edu/robots.txt` disallows `/sfl/downloads/` for every user agent | Ask UT for the files directly, or hand reading (owner decision 1); never fetch a disallowed PDF even by its exact URL |
| FSL office pages at Michigan (`fsl.umich.edu`), Harvard (`dso.college.harvard.edu/usgso-policy`), Columbia (`cc-seas.columbia.edu/reslife/fraternity_sorority`, `/panhellenic`, `/fsl/chapters`), Williams (`dean.williams.edu/student-handbook/fraternities/`), Baylor (`fsl.web.baylor.edu`) | Office description, council membership, recruitment policy | Blocked — Cloudflare (Michigan, Williams, Baylor), Akamai (Harvard), a CloudFront WAF (Columbia) | Hand reading (owner decision 1) |
| Grinnell's organizations page (`grinnell.edu/campus-life/organizations`) | Which Greek-letter and other student organizations are recognized | Login — returns "Access Denied," reading like a required campus sign-in | Hand reading needs a logged-in student, which this project doesn't have; flag to the owner rather than attempt one |

## LGBTQ+ life

| Source | Would give | Why unreadable | Candidate fix |
|---|---|---|---|
| oSTEM chapters (`ostem.org/page/chapters`) | Chapter directory | Blocked — 403 on `robots.txt` itself. The adapter is built to throw if this ever stops being true, so an unblock gets noticed | Partnership: ask oSTEM directly |
| Liberty's full "Liberty Way" conduct code | The complete text behind the Doctrinal Statement excerpt already quoted | JS-only — sits in a JavaScript-only Doctract viewer | Headless-browser renderer (no challenge in front); or ask Liberty for the document directly, since it's a conduct-code quote the second-model review (owner decision 3) would need to re-check carefully either way |
| ASU's ACD 401 policy page | The university's stated nondiscrimination/conduct policy text | JS-only — redirects to a JavaScript-only policy site | Headless-browser renderer |
| Harvard: student health plan (`huhs.harvard.edu/ship`), preferred-name policy (`registrar.fas.harvard.edu/preferred-name-policy`) | Whether the student plan covers transition care; the name-on-records policy | Blocked — Akamai "Access Denied" to every request | Hand reading (owner decision 1) |
| Baylor's Statement on Human Sexuality (`spirituallife.web.baylor.edu`) | The conduct-restriction quote for the policy checklist | Blocked — Cloudflare on every `*.web.baylor.edu` HTML page; a search-engine snippet is stored, unverified | Hand reading; do not publish the unverified snippet as a quote |
| BYU's ID-card policy (`idcenter.byu.edu/id-card-policies`) | The name-on-records / preferred-name policy | Blocked — 403 to every request | Hand reading |
| Grinnell's gender-inclusive housing policy page | Housing policy fact | Login — returns "Access Denied," reading like a required campus sign-in (found during the pilot's reconnaissance; distinct from the Greek-life organizations page above, which is in `data/directories/blocked.json`) | Same as Grinnell's Greek-life page: needs a logged-in student this project doesn't have |
| Dead former LGBTQ+ center pages: UT (`diversity.utexas.edu`), Alabama (`diversity.ua.edu`, `safezone.sa.ua.edu`), Ole Miss (`lgbtq.olemiss.edu`), Harvard (`bgltq.fas` doesn't resolve) | Whether and where each center still exists | Site down — each redirects or 404s; UT's and Harvard's closures are already sourced from news coverage instead | Search for each college's successor office by name before concluding the center is gone; UT and Harvard don't need this since news already confirms the closure |
| Wheaton's nondiscrimination, student-health-insurance, and human-sexuality pages (`www.wheaton.edu/life-at-wheaton/...`) | Nondiscrimination policy, health-plan coverage, and the conduct-restriction statement | Blocked — Cloudflare on `www.wheaton.edu` | Check `catalog.wheaton.edu` first (the mirror that worked for the Community Covenant quote); hand reading otherwise |

## What this doesn't cover
Sources that *were* readable but simply don't state a fact (no college's own page says its student health plan
covers transition care; restroom lists are rarely published at all) aren't listed here — there's nothing blocking
them, the pages just don't say it. [lgbtq-life.md](lgbtq-life.md#phase-4-as-built-pilot) already recommends asking
the Trans Policy Clearinghouse's compiler instead of re-crawling for those two.

## Sources
- `data/directories/blocked.json`: every source this build recorded as blocked, with URL, reason, and date.
- [religious-life.md#phase-3-as-built](religious-life.md#phase-3-as-built), [greek-life.md#phase-4-as-built-national-chapter-directories](greek-life.md#phase-4-as-built-national-chapter-directories),
  and [lgbtq-life.md#phase-3-as-built-national-lists-and-the-policy-checklist](lgbtq-life.md#phase-3-as-built-national-lists-and-the-policy-checklist):
  each spec's own "not built" notes on its national directories.
- The 25-college pilot's reconnaissance (2026-10-04): which of its hand-checked answer-key pages returned a block,
  and what each block looked like.
