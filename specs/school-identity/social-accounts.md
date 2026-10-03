# Social Accounts (Wikidata + the college's homepage)

> Status: **planned** 2026-10-03. Part of the [identity family](README.md). Introduces the Wikidata link
> (`npm run sync-wikidata`, `data/wikidata.json`) that [short names](aliases.md) and [colors and marks](brand.md)
> also read. Research 2026-10-03: every Wikidata item with an IPEDS id queried (3,857 items) and joined to the site's
> 1,893 colleges; twenty college homepages fetched to see what their footers link to. Figures are measured unless
> marked *estimate*.

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
  SVG in `components/school/SocialIcons.tsx` (the networks' simple marks, drawn in the current text color: they are
  tiny, monochrome, and identify a link target, which is how every site shows them). Nothing when the college has
  no account.
- **Compact header**: nothing (the Website link is enough there).
- **Compare**: no row. Six icons per college in a table cell is noise.
- `/data`: Wikidata joins the source list with its retrieval date and a line that corrections belong on Wikidata.

## Keep history?
No. Accounts are replaced when they change.

## Checks (each shown to fail when broken)
- `tests/sync-wikidata.test.mts`: a fixture SPARQL CSV; duplicate-item resolution picks the matching website;
  handle validation drops a value with a space and keeps a numeric Facebook id; case-only duplicates collapse;
  disagreement with a homepage-found handle is written to the issues file; the profile URL per network.
- Lineage guard: `social.*` registered; `college-site` social values carry `url` and `retrieved`.
- Query guard: the script fails, writing nothing, if the SPARQL result has fewer than 1,500 matched colleges (a
  broken query or a Wikidata outage must not empty the file).

## Cost
Nothing. Wikidata and the homepages are free; no model is involved.

## Open questions for the owner
1. Which networks to show? Default: all six found. LinkedIn is for alumni and staff more than applicants; it could
   stay out of the hero and appear only on the Outcomes page.
2. X: show it under that name with its current mark. The handle property is still called "Twitter username" on
   Wikidata, which is only a label.

## Implementation plan
1. `scripts/sync-wikidata.mts` with the query, join, validation, `data/wikidata.json`, and the issues file. Tests.
2. `sync-data`: copy accounts into `social`; `lib/fields.ts`, `lib/types.ts`, `meta.json` source. The homepage
   footer scan in the links probe.
3. `SocialIcons.tsx` and the hero row; `/data` source entry; publish migration for `school_wikidata`.
