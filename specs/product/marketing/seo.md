# SEO From the Console: Findable Pages, Templates an Admin Edits, Search Numbers Beside the Data

> Status: **planned** (not built). Written 2026-11-09 for [plan.md](plan.md): search is the engine of the plan, and
> the owner asked whether SEO can be driven from the admin site. It can, for everything that is a decision rather than
> code: the words in titles and descriptions, which pages are indexed, how crawlers are treated, what a shared link
> looks like, and what Google reports back. The plumbing (sitemap, structured data, the Open Graph image) is code once
> and never touched again. Part of [product](../README.md); the console's placement is in [console.md](console.md#search).

## Today

Read from the code on 2026-11-09:

| What search engines need | What the site has |
|---|---|
| `sitemap.xml` | None. About 17,000 public pages (1,893 colleges × 8 pages, roughly 1,000 high schools, 10 trends studies, 50 state pages, conference pages, glossary, release notes, roadmap) are found only by following links from the home page |
| `robots.txt` | None, so every crawler reads everything it can reach, including `/admin` and `/account` URLs it finds in links (those pages carry `noindex` in their metadata, which only works after the crawl) |
| Titles | The college pages set the college's name; topic pages add nothing ("Harvard University · Quad" eight times). Most other pages have a title |
| Descriptions | One sentence, site-wide, from the root layout, on every page |
| Canonical URLs | None; `/compare?ids=…` and Explore's filter URLs are infinite and uncanonicalized |
| Open Graph and Twitter cards | None. A college page shared in a text or on Facebook shows no image and the site-wide sentence |
| Structured data (JSON-LD) | None |
| Core Web Vitals | Good, after the 2026-11-08 performance rounds (header first paint, lighter public pages); Speed Insights reports them |
| Internal linking | Strong: profiles link similar colleges, states, conferences, and the trends; the glossary links out |
| Content | Deep and unique: every number cited with its source and year, which is exactly what search engines now reward and what competitors (list sites with the same IPEDS rows and no citations) lack |

The last two rows are why this is cheap: the pages are already good. They need to be announced and described.

## What search can send us

The queries, by intent, and which page answers each:

| Intent | Example queries | Page |
|---|---|---|
| A college's numbers | "{college} acceptance rate", "{college} SAT range", "{college} tuition", "{college} early decision acceptance rate" | `/schools/{id}` and its admissions and cost pages |
| Is it a reach | "is {college} a reach school", "{college} chances" | the college page with the signed-out estimate card |
| Two colleges | "{college} vs {college}" | a canonical compare page for popular pairs ([below](#content-program)) |
| A high school | "{high school} college acceptances", "where do {high school} students go to college" | `/high-schools/{id}` |
| A trend | "colleges that are shrinking", "test optional colleges 2027", "out of state students at {flagship}" | `/trends/*` and the state pages |
| A term | "what is yield rate", "demonstrated interest meaning", "REA vs ED" | `/glossary#{term}` |
| The product | "college planning app for parents", "college list builder", "college application calendar" | `/advisor`, `/for/parents` |
| Counselors | "college counseling software free", "caseload management independent educational consultant" | `/for/counselors` |

The first two rows are the volume: every college's name is searched thousands of times a month in season, and the
college's own site rarely answers "acceptance rate" plainly. Our page does, with the year and the source.

## Built in code, once

These are not admin decisions. They are built in wave 1 ([console.md](console.md#build-plan)) and tested.

- **`app/sitemap.ts`:** a sitemap index with one file per family (colleges, college topic pages, high schools, trends
  and states and conferences, the rest), each under 50,000 URLs, `lastModified` from the snapshot's publish date for
  data pages and the release note's date for the rest. Regenerated on each publish (`/api/revalidate` already runs
  then). Excludes anything signed in, `/go/*`, `/l/*`, `/compare?…`, Explore's filtered URLs, and `/admin`.
- **`app/robots.ts`:** `Allow: /` with `Disallow` for `/admin`, `/account`, `/household`, `/org`, `/advisor/` (the
  signed-in plan; the splash page at `/advisor` itself stays allowed), `/api`, `/go`, `/l`, `/auth`, `/login`,
  `/join`, `/invite`, `/unsubscribe`, `/me`, `/compare?` and `/explore?`; `Sitemap:` line. The per-crawler rules
  come from the console ([Crawlers](#crawlers)), so the file is rendered from settings, with a safe default when the
  settings table is unreadable (allow everything the list above allows, block the rest).
- **Metadata from templates:** every public page's `generateMetadata` fills a **template** for its page type with the
  page's facts ([Templates](#templates)); the template text is the admin's, the facts are the data's. Titles under 60
  characters and descriptions under 155 are enforced by truncation at a word with a test on the longest college name.
  `alternates.canonical` on every public page: the college page's canonical is itself; `/compare` with ids and Explore
  with filters point at their bare paths; `/schools/{id}?…` strips the query.
- **Open Graph and Twitter cards:** `opengraph-image.tsx` for the college page family (the crest on the college's
  colors from [school-identity/brand.md](../../school-identity/brand.md), the name, and three facts: admit rate, net
  price, graduation rate, each with its year), for trends studies (the study's headline chart as an image), and a
  site default (the wordmark and tagline). Rendered on demand with `next/og`, cached by the CDN. `og:title` and
  `og:description` from the same templates; `twitter:card: summary_large_image`.
- **Structured data (JSON-LD),** one script per page, from `lib/seo/structured-data.ts` (pure, tested against the
  schema.org types): `CollegeOrUniversity` on a college page (name, address, URL, the official website; no ratings,
  since we publish none), `BreadcrumbList` everywhere, `Dataset` on `/data` and each trends study (with the sources
  as `isBasedOn`, which is what the citations already say), `FAQPage` on `/pricing` and the three landing pages from
  their Questions sections, `Organization` and `WebSite` with `SearchAction` on the home page, `Article` on each
  release note. Nothing about a student, ever.
- **IndexNow:** on each snapshot publish and each release-note merge, ping IndexNow (Bing, Yandex, and the engines that
  share it) with the changed URLs (`lib/seo/indexnow.ts`, key file served at `/{key}.txt`). Google has no equivalent;
  the sitemap's `lastModified` does that job.
- **The `/for/*` landing pages** and `/pricing` are static, indexable, and carry the `FAQPage` data.

## The Search screen in the console

Growth › Search ([console.md](console.md#search)). Five panels on one screen, each with its help entry ([console.md](console.md#help-entries)), and a settings screen for
the templates.

### Templates

A table of **page types** with an editable title template and description template each, stored in `seo_templates`
(one row per page type: `school`, `school-admissions`, `school-cost`, `school-outcomes`, `school-academics`,
`school-students`, `school-history`, `school-events`, `high-school`, `trend`, `state`, `conference`, `glossary`,
`release-note`, `home`, `explore`, `compare`, `landing-parents`, `landing-students`, `landing-counselors`, `pricing`,
`data`, `roadmap`). Placeholders in braces are filled from the page's data: `{name}`, `{short_name}`, `{city}`,
`{state}`, `{admit_rate}`, `{admit_year}`, `{net_price}`, `{sat_range}`, `{grad_rate}`, `{undergrads}`, `{setting}`,
`{control}` (public or private), `{term}`, `{study_title}`, `{state_name}`. The set is fixed per page type
(`lib/seo/placeholders.ts`, tested), and a placeholder whose value is missing for a college drops its clause: the
template is written as clauses separated by ` · ` or `. `, and an empty clause disappears, so "Admit rate 4% (2024)"
vanishes for a college that reports none rather than reading "Admit rate  ()".

The editor shows the template, the character count, and a **live preview** for three real pages of that type (a long
name, a short one, one with missing values), rendered through the same function the pages use. Saving writes the row,
logs the change, and revalidates the family's pages (a tag per page type). The defaults ship in the migration and are
reasonable on their own; the owner edits them in the console from then on and never in code.

A **per-page override** (`seo_overrides`: path, title, description, `noindex`, note) for the rare page that needs its
own words or must leave the index (a college that asked, a test page). A college's override is edited from its console
page under Data › Colleges as well as here.

### Crawlers

The `robots.txt` policy as switches, stored in `app_settings` under `seo.crawlers`: a row per known crawler group
with Allow / Block and the paths it applies to. Groups: search engines (Googlebot, Bingbot, DuckDuckBot, Applebot;
always allowed on public pages), **AI crawlers that train** (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended,
CCBot, Bytespider, meta-externalagent), **AI crawlers that answer** (ChatGPT-User, PerplexityBot, Claude-SearchBot),
SEO tools (AhrefsBot, SemrushBot, MJ12bot; blocked by default, they cost bandwidth and give nothing), and
"everything else". The default is the plan's ([plan.md](plan.md#owner-decisions), decision 2): answer-bots allowed on
public data pages so an assistant's answer can cite Quad, training bots the owner's call, tools blocked. The panel
shows the rendered `robots.txt` beneath the switches, and a warning if any switch would block Googlebot.

### Search performance

Google Search Console's **Search Analytics API**, pulled daily by the `search-console-pull` job (06:30 UTC, a Vercel
cron route in the jobs registry) with a Google service account added to the Search Console property as a restricted
user (`GOOGLE_SEARCH_CONSOLE_CREDENTIALS`, the service account's JSON, and `SEARCH_CONSOLE_SITE_URL`). Two queries per
day for the day three days back (Google's data lag): by page and by query, each with clicks, impressions, CTR, and
average position, upserted into `seo_daily`. Bing Webmaster Tools has an equivalent API and is a later unit.

The panel shows: clicks and impressions this week against last; the top 20 pages and the top 20 queries by clicks with
their position; **rising queries** (impressions up 50% week over week with position worse than 10: the pages to
improve); and **pages with impressions and no clicks** (title and description work). A page in the table links to its
override editor. The Steward reads the same table in its weekly audit ([below](#the-stewards-seo-audit)).

### Indexing

What the engines have taken: the sitemap files with their URL counts and when each was last fetched (Search Console's
Sitemaps API, pulled with the same job); the property's index coverage counts (indexed, excluded by `noindex`,
crawled but not indexed, discovered but not crawled) with the day; the last IndexNow ping and its response. A "Submit
sitemap" button for a new file; a "Ping IndexNow" button for a URL pasted in.

### Sharing

A preview of how a page looks when shared: paste a path, see the Open Graph image, title, and description that the
page emits (the console fetches the page's own metadata through the same functions; no third-party debugger needed).
The same panel lists the share buttons the site shows ([console.md](console.md#sharing)) and their `share_created`
counts for the week.

## The Steward's SEO audit

A weekly job (`seo-audit`, Sundays 05:00 UTC, in the jobs registry with expectations like every job) that checks and
files **findings** in the Steward's inbox ([admin-redesign.md](../admin-redesign.md)), one per issue with a
recommendation and, where it can, a proposed fix the admin approves:

| Check | Finding | Proposed fix |
|---|---|---|
| A template renders a title over 60 or a description over 155 characters for more than 5% of its pages | "The college-cost title overflows for 212 colleges" | A shorter template, shown in the proposal |
| A page type's pages have impressions and a CTR under a third of the site's median | "Admissions pages are seen and not clicked" | Flagged for the owner, with the five worst |
| Internal links to a path that 404s (sampled from the sitemap, 500 pages a week) | "17 links to a retired page" | The redirect, if the target is known (a merged college) |
| Sitemap URL count differs from the dataset's count | "The sitemap lists 1,891 colleges; the snapshot has 1,893" | Regenerate |
| A page emits no JSON-LD or a type that fails validation | "Trend pages lost their Dataset markup" | Flagged (a code regression) |
| Core Web Vitals (Speed Insights API) worsened past the thresholds for a route | "LCP on /schools/{id}/cost rose to 3.1 s" | Flagged |
| Search Console reports a manual action or a security issue | "Search Console: manual action" | Flagged, red |
| A crawler blocked by the switches is still hitting the site hard (from Vercel's logs, when available) | informational | |

Findings that need only words (a template) are proposals the admin accepts on the spot; everything else is a to-do
with the page linked.

## Content program

The plan's search volume comes from pages that already exist. Three additions, each a page type with a template above,
and the rule that every page carries real, cited data (no page exists to rank; a page exists because it answers
something):

1. **Canonical compare pages** for popular pairs: `/compare/{id}-vs-{id}` for the top 500 pairs by `compare_viewed`
   and by shared applicants (the Common App overlap where we have it), each a static page rendering the compare
   overview for that pair, with a `BreadcrumbList` and the two crests in the Open Graph image. Generated from a list the
   console shows and the owner can add to; the ad-hoc `/compare?ids=` keeps working and points its canonical at the
   static pair page when one exists.
2. **Question pages** on a college's own page, not separate URLs: each topic page gains a short "Questions" block
   whose headings are the queries people type ("Is {name} test-optional for fall 2027?", "What is {name}'s early
   decision acceptance rate?") answered from the data with the citation, marked up as `FAQPage`. The questions come
   from a fixed list per topic (`lib/seo/questions.ts`) and render only when the answer exists; nothing about Quad's
   estimate is asked or answered there ([../../chances/README.md](../../chances/README.md)). No new thin pages, and the blocks are useful to a reader.
3. **The guides** ([../../ideas/guides.md](../../ideas/guides.md)) when built: evergreen pages on list size, ED and EA,
   demonstrated interest, drawn from the advisor's guides with the product's frames as illustrations. Each is an
   indexable page with `Article` markup and a path to the trial.

Not done: paid links, guest posts, "best colleges for X" ranking lists (we publish no rankings), or AI-written filler.

## Files (planned)

- Code: `app/sitemap.ts`, `app/robots.ts`, `app/**/opengraph-image.tsx` (college family, trends, default),
  `lib/seo/templates.ts` (fill, clause dropping, truncation; reads `seo_templates` with a cached, defaulted read),
  `lib/seo/placeholders.ts`, `lib/seo/structured-data.ts`, `lib/seo/indexnow.ts`, `lib/seo/search-console.ts`,
  `lib/seo/questions.ts`, `app/compare/[pair]/page.tsx`, `app/api/cron/search-console-pull/route.ts`,
  `app/api/cron/seo-audit/route.ts`, `lib/steward/seo-checks.ts`.
- Console: `app/admin/growth/search/page.tsx`, `app/admin/growth/search/templates/page.tsx` and its actions,
  `lib/admin/seo-*.ts`, help entries in `lib/admin/help.ts`.
- Data: migration `…_seo_tables.sql` (`seo_templates` with defaults, `seo_overrides`, `seo_daily`, `seo_pairs`);
  `app_settings` rows `seo.crawlers`, `seo.dashboards`.
- Env: `GOOGLE_SEARCH_CONSOLE_CREDENTIALS`, `SEARCH_CONSOLE_SITE_URL`, `INDEXNOW_KEY`.
- Tests: `tests/seo-templates.test.mts` (every placeholder of every page type fills from a fixture college; a missing
  value drops its clause; the longest name stays under the limits; an override wins), `tests/sitemap.test.mts` (every
  public route family appears; nothing signed in does; counts match the fixture snapshot), `tests/robots.test.mts`
  (the rendered file from each switch state; Googlebot never blocked; the safe default when settings are unreadable),
  `tests/structured-data.test.mts` (each type validates; no student field can appear), `tests/seo-audit.test.mts`
  (each check against fixtures files the right finding), and the jobs registry tests.

## Owner steps

1. Verify `usequad.app` in Google Search Console (DNS record) and Bing Webmaster Tools; add the service account as a
   restricted user; set the three environment variables with `npm run vercel-env`.
2. Decide the crawler switches' first state ([plan.md](plan.md#owner-decisions), decision 2).
3. Read the default templates in the console after wave 1 and change the words.

## Open questions

1. **Dynamic Open Graph images at scale:** 1,893 × 8 images rendered on demand are fine under the CDN; if the render
   cost shows in the function bill, pre-render the college family at publish time into Storage instead.
2. **Bing Webmaster API** as a second source for the Search performance panel: later, once Google's is useful.
3. **Hreflang and Spanish pages:** not in this plan; a Spanish-language `/es/` version of the landing pages and the
   glossary would be a real draw for many families and is noted for a later spec.
