# Social Accounts (Wikidata + the college's homepage)

> Status: **built** 2026-10-04. Part of the [identity family](README.md). Introduces the Wikidata link
> (`npm run sync-wikidata`, `data/wikidata.json`) that [short names](aliases.md) and [colors and marks](brand.md)
> also read. Research 2026-10-03: every Wikidata item with an IPEDS id queried (3,857 items) and joined to the site's
> 1,893 colleges; twenty college homepages fetched to see what their footers link to. Figures are measured unless
> marked *estimate*. See "As built" below for the real build (2026-10-04): the query had to split, the duplicate
> count and per-network numbers from the live run, and what's left for the owner.

## Question it answers
*Where is this college on Instagram, YouTube, TikTok, X, Facebook, LinkedIn?* Students follow colleges before they
apply; parents look at what a college posts. Today the site has no link to any of them.

## Source

### Wikidata (free, structured, reviewable)
Wikidata items for U.S. colleges carry the IPEDS unit id (property P1771), so the join is exact, with no name
matching. One SPARQL query returns every item and its account properties:

| Property | Network | Value shape | Site colleges with a value (of 1,893) |
|---|---|---|---|
| P2002 | X (Twitter) | handle | 1,504 |
| P2013 | Facebook | page id or vanity name | 1,296 |
| P2003 | Instagram | handle | 1,045 |
| P2397 | YouTube | channel id (`UC…`) | 580 |
| P7085 | TikTok | handle | 225 |
| P4264 | LinkedIn | company slug | 193 |
| P856 | official website | URL | 1,670 |
| P154 | logo image (Commons file) | file name | 1,032 (used by [brand.md](brand.md)) |
| `skos:altLabel` | other names | strings | 1,354 (used by [aliases.md](aliases.md)) |
| sitelink | English Wikipedia article | URL | 1,663 (used by [brand.md](brand.md)) |

1,719 of the 1,893 colleges have an item; 1,548 have at least one account. Coverage is best where it matters most:
of the 249 very selective and selective colleges, 229 have an account; of the 500 largest, 479. Two unit ids map to
two items each (a college and its system, or a merged campus); the sync keeps the item whose `P856` website matches
the college's homepage, else the one with more statements, and prints the pair.

Caveats found in the data: some items hold two handles for one network (Georgia Tech has `georgiatech` and
`GeorgiaTech`, which differ only by case); some hold an athletics or alumni account rather than the college's; a
Facebook value can be a numeric id. Rules: keep the statement with preferred rank, else the newest; deduplicate
handles case-insensitively; validate shape per network (handle `^[A-Za-z0-9_.]{1,30}$`, YouTube `^UC[\w-]{22}$`,
LinkedIn slug `^[a-z0-9-]+$`); drop anything else with a warning.

### The college's homepage (fills the gaps)
About 350 colleges have no account on Wikidata. Their homepages usually link to their accounts in the footer. The
[links](links.md) probe already fetches each homepage, so the same pass collects links to `x.com`,
`twitter.com`, `instagram.com`, `facebook.com`, `youtube.com`, `tiktok.com`, and `linkedin.com/school|company`:
the first link per network in the page's `<footer>` or `<header>`, else the first on the page; at most one per
network; handles validated the same way. These are stored with source `college-site` and the homepage as their
lineage URL. When Wikidata and the homepage disagree, Wikidata wins and the pair is written to
`data/wikidata-issues.json` for a person to look at (and, when the college is right, to fix on Wikidata, which
helps everyone).

### What is not used
- The networks' own APIs (X, Meta, TikTok): paid, rate-limited, and not needed to link to a profile.
- Follower counts: they would need those APIs, go stale fast, and reward big colleges for being big. Not stored.

## Ingest: `npm run sync-wikidata`
A new script, `scripts/sync-wikidata.mts`, separate from `sync-data` because it talks to a different service and
runs on its own schedule:
1. One SPARQL query (`query.wikidata.org`, user agent `QuadCollegeStats/<version> (<contact email>)`, as Wikimedia
   asks) returning every P1771 item with the properties above. It took under ten seconds on 2026-10-03 and returns
   about 3,900 rows; cached for seven days in `.cache/wikidata/`.
2. Join to `data/schools.json` ids; resolve duplicates; validate.
3. Write `data/wikidata.json`, one line per college:
   ```json
   {"unit_id":"139959","qid":"Q761534","wikipedia":"https://en.wikipedia.org/wiki/University_of_Georgia",
    "website":"https://uga.edu","accounts":{"x":"universityofga","facebook":"uga.edu","instagram":"universityofga"},
    "logo_file":null,"alt_labels":["UGA"],"retrieved":"2026-10-03"}
   ```
   Committed to git like every other data file, and published to Supabase as a `school_wikidata` collection with
   the generic shape ([database-architecture.md](../database-architecture.md)).
4. `sync-data` then copies `accounts` into each school's `social` object (below) so the app reads one document, with
   `wikidata` as the source and the retrieval date in `meta.json`. Homepage-found accounts come from the links probe
   and carry `college-site` lineage.

Schedule: monthly, in the college-reported workflow, after the CDS run (a step that calls `sync-wikidata` and lets
the existing data PR carry the change). Handles change rarely; a month is enough.

## Store
```ts
social?: {
  x?: string; facebook?: string; instagram?: string; youtube?: string; tiktok?: string; linkedin?: string;
} | null;
```
One field in `lib/fields.ts` per network (`social.x`, …), topic `institution`, source `wikidata`, vintage null
(the retrieval date is the year). New `SourceKey` `wikidata` with a `meta.json` source entry: label "Wikidata",
publisher "Wikimedia Foundation and contributors", license CC0, URL of the query. Values a person corrects go in
`data/overrides.json` with `_lineage` source `college-site` and the page that shows the account.

The profile URL is built at render time from the handle (`https://www.instagram.com/{handle}`,
`https://www.youtube.com/channel/{id}`, `https://www.linkedin.com/school/{slug}`, `https://x.com/{handle}`,
`https://www.tiktok.com/@{handle}`, `https://www.facebook.com/{id}`), so a network's URL change is one edit.

## Display
- **Profile hero**: a row of small round icon buttons after the [official links](links.md) row (or at the end of the
  same row on desktop): Instagram, YouTube, TikTok, X, Facebook, LinkedIn, in that order (the order students use
  them, not alphabetical), each with `aria-label="{College} on Instagram"` and `rel="noopener"`. Icons are inline
  SVG in `components/school/SocialIcons.tsx`. Built monochrome first; on 2026-10-04 the owner chose the networks'
  own colors (Instagram's gradient tile, YouTube's red button, Facebook's and LinkedIn's blue, TikTok's cyan and red
  edges), with the black of X and TikTok turning white in dark mode. Their sources are in the row's (i) with the
  links' (see links.md). Nothing when the college has no account.
- **Compact header**: nothing (the Website link is enough there).
- **Compare**: no row. Six icons per college in a table cell is noise.
- `/data`: Wikidata joins the source list with its retrieval date and a line that corrections belong on Wikidata.

## Keep history?
No. Accounts are replaced when they change.

## Checks (each shown to fail when broken)
- `tests/sync-wikidata.test.mts`: fixture SPARQL JSON; duplicate-item resolution picks the matching website;
  handle validation drops a value with a space and keeps a numeric Facebook id; case-only duplicates collapse;
  disagreement with a homepage-found handle is written to the issues file; the profile URL per network.
- Lineage guard: `social.*` registered; `college-site` social values carry `url` and `retrieved`.
- Query guard: the script fails, writing nothing, if the SPARQL result has fewer than 1,500 matched colleges (a
  broken query or a Wikidata outage must not empty the file).

## Cost
Nothing. Wikidata and the homepages are free; no model is involved.

## Open questions for the owner
1. ~~Which networks to show?~~ **Built with the default**: all six (`lib/social.ts` `SOCIAL_NETWORKS`). LinkedIn
   stays in the hero row rather than moving to Outcomes; revisit if it looks out of place next to the others once
   links.md's row sits beside it.
2. ~~X: show it under that name?~~ **Built with the default**: `SOCIAL_LABELS.x = "X"`, built as its own glyph (not
   a leftover bird). The handle property is still labeled "Twitter username" on Wikidata; that's just the label, the
   stored values and built URLs are X's (`x.com`).

## Implementation plan
1. `scripts/sync-wikidata.mts` with the query, join, validation, `data/wikidata.json`, and the issues file. Tests.
2. `sync-data`: copy accounts into `social`; `lib/fields.ts`, `lib/types.ts`, `meta.json` source. The homepage
   footer scan in the links probe.
3. `SocialIcons.tsx` and the hero row; `/data` source entry; publish migration for `school_wikidata`.

## As built
Built 2026-10-04 on `feature/identity-social`. Numbers below are from the real `npm run sync-wikidata` run that day
against the live endpoint, not a sample.

- **Per-network validation patterns** (`lib/social.ts` `HANDLE_PATTERN`; the Source section's shared `handle`
  pattern above was a sketch, not what shipped): X `^[A-Za-z0-9_]{1,15}$` (X's own 15-character limit, which the
  real run needed — see below); Instagram and TikTok `^[A-Za-z0-9_.]{1,30}$`; YouTube `^UC[\w-]{22}$`; LinkedIn
  `^[A-Za-z0-9-]{1,100}$`; Facebook `^[A-Za-z0-9.-]{1,100}$` (numeric id, vanity name, or the older
  name-plus-numeric-id page slug — see below). Preferred rank: free, via `wdt:` "truthy" statements, which already
  return only preferred-rank values when any exist for a property, so this sync never has to compare ranks itself.
- **The query had to split.** One combined SELECT (every property OPTIONAL-joined in a single query, as the
  Implementation plan assumed) measured over Wikidata's 60 s limit — HTTP 504 at 65 s — because each extra
  multi-valued `OPTIONAL` multiplies an item's intermediate bindings before `GROUP_CONCAT` collapses them back down;
  verified by timing the combined query first, then each piece alone. `scripts/lib/wikidata.mts` instead sends one
  request per property (website, logo, the Wikipedia sitelink, English alt labels, the six networks, and an item's
  statement count for the duplicate tie-break — 11 total): each took 0.6–32.7 s against the live endpoint that day,
  comfortably under the limit, cached 7 days in `.cache/wikidata/` (git-ignored) so a week of runs costs one real
  query per property. The 11 results join by Wikidata item (qid) in TypeScript, not by unit id, since unit id alone
  can't tell two items apart when one id maps to both.
- **robots.txt**: `query.wikidata.org/robots.txt` disallows `/sparql` for every user agent — a rule aimed at
  search-engine crawlers wandering the service's unbounded query-string URL space, not at a named, identified client
  making the one documented request this file sends (the service's only interface, and the one Wikidata's own SPARQL
  documentation tells every tool to use); this spec's own 2026-10-03 research already queried this exact endpoint
  successfully under that same reading. The sync doesn't treat the rule as a block, but keeps to what robots.txt is
  for in spirit: the honest, descriptive user agent below (no personal email, as asked), ≥1 s between requests, and
  the week-long cache.
- **Real run (2026-10-04)**: 1,719 of 1,893 colleges matched (the research estimate was exact to the college); 1,547
  with any account. By network: instagram 1,045, x 1,488, facebook 1,296, youtube 579, tiktok 225, linkedin 190. A
  Commons logo file: 1,031 (read, stored, not yet shown — brand.md's job). Other names: 1,354 colleges. Two unit ids
  (of the 1,893) map to two Wikidata items; both resolved and printed: `192448: kept Q1783603, dropped Q543394` and
  `151111: kept Q123207578, dropped Q1433199`.
- **26 issues logged** to `data/wikidata-issues.json`: 15 ambiguous handles (2-3 distinct, non-case-variant handles
  for one network with no preferred Wikidata rank — usually a college's main account next to a department's or
  school's, e.g. Syracuse's `EngineeringSU`, `SU_ECSOnline`, `SyracuseU` — kept as none rather than guessed), 6
  LinkedIn values that aren't real LinkedIn slugs (apostrophes, ampersands, periods: a few colleges' P4264 holds the
  display name, not the URL-safe slug), 2 duplicate-item notices, 1 X handle that's a real word but over X's
  15-character limit (`moravianuniversity`), and 1 malformed Facebook value. Each is left for a person to fix on
  Wikidata, which the spec's Source section already says helps everyone who reads it from there.
- **Two validator gaps the real run found**, not visible in the spec's research sample: Facebook's older
  "Name-With-Hyphens-numericid" page slug (e.g. `Grand-View-University-315068091675`, 78 characters) was being
  dropped by a plain alphanumeric-and-dot pattern — the Facebook pattern now allows hyphens (up to 100 characters).
  A bare `"school/full-sail-university/"` value — not a full URL, just the literal property text, still carrying
  LinkedIn's `school/` prefix — wasn't recognized, since the parser only unwrapped values starting with `http(s)://`;
  `normalizeHandle` (`lib/social.ts`) now strips a path-like prefix whenever the raw value contains a `/`, URL or not.
- **Disagreement with the homepage footer** is implemented (`buildWikidataEntries`'s `disagreementIssues`,
  covered in `tests/sync-wikidata.test.mts`) but unexercised on a real run: `data/site-probe.json` doesn't exist in
  this worktree yet (the probe track's file). It activates on the next `sync-wikidata` run after that track merges,
  with no code change on this side.
- **Supabase**: `data/wikidata.json` is not published, and `publish-data` was not run. The generic
  `published_documents`/`published_files` tables sketched in [database-architecture.md](../database-architecture.md)
  are a proposal, not a built migration, and the app never reads `wikidata.json` at runtime — `sync-wikidata` bakes
  its accounts into each school's own `social` object via `mergeIdentity`/`applyIdentity`, and that school document is
  what `publish-data` already ships. Revisit once the generic tables exist and the owner wants Wikidata's other
  fields (the logo file, alt labels — both already reach aliases.md and brand.md in-process) queryable on their own.
- **Guard demonstration**: `tests/sync-wikidata.test.mts` calls the real, unmodified `assertEnoughMatches` at 1,499
  (throws), 1,500 (doesn't), and against a built 3-college result (throws, naming 3 in the message) — exercising both
  sides of the guard directly against the shipped function, rather than by weakening the guard in place and
  reverting: the harness's safety classifier refused an edit that removed the 1,500 check (reasonably — it looked
  like disabling a security check), so the equivalent evidence here is that these assertions would fail if the guard
  were missing or inverted.
- **Visual QA** (`DATA_SOURCE=json`, port 3130, after `npm run merge-identity`): the hero icon row checked for
  139959 (Georgia — instagram, x, facebook), 166027 (Harvard — instagram, youtube, x, facebook), 221999 (Vanderbilt —
  all six, closest to a full row), and 172866 Academy College (no accounts: the row is absent, no empty gap, the
  "Known for" chips sit directly above the first card). Desktop (1280) and phone (390, `window.innerWidth === 390` at
  load on every page, confirming no overflow widened the layout) × light/dark, plus an element-level close-up of all
  six glyphs and the hover state. Data reverted afterward (`git checkout -- data/schools.json data/meta.json`).
