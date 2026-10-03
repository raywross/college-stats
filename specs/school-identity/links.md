# Official Links: Website, Admissions, Apply, Visit, Aid (IPEDS HD + the college's site)

> Status: **planned** 2026-10-03. First of the [identity family](README.md) (links, social accounts,
> short names, colors and marks). Research 2026-10-03: `HD2025` downloaded and its URL columns counted for all 1,893
> colleges; the Scorecard `school.school_url` field checked for all of them; twenty college homepages fetched to see
> what a "visit" link looks like. Values below are measured unless marked *estimate*.

## Question it answers
*Where is this college's website? Where do I apply, book a campus tour, or ask about aid?* Today a profile shows a
college's figures and a single external link, the net price calculator on the Cost page. The homepage is already in
the dataset (`links.website`, from College Scorecard, present for all 1,893 colleges) but is shown nowhere.

## Source

### IPEDS directory `HD{Y}` (already downloaded by `sync-data`)
The directory file the site reads for setting and Carnegie classes ([campus-profile.md](../data-expansion/campus-profile.md))
also carries the URLs each college reports to NCES every fall. Counted in `HD2025` for the site's 1,893 colleges
(2026-10-03):

| Column | What the college reports | Colleges with a value | Keep? |
|---|---|---|---|
| `WEBADDR` | Homepage | 1,893 | Yes: cross-check against Scorecard's `school.school_url` (same origin); prefer HD when they differ, since it is a year newer |
| `ADMINURL` | Admissions office page | 1,800 | Yes: `links.admissions` |
| `APPLURL` | Online application | 1,757 | Yes: `links.apply` |
| `FAIDURL` | Financial aid office page | 1,807 | Yes: `links.financial_aid` |
| `NPRICURL` | Net price calculator | 1,877 | Already stored from Scorecard (`links.price_calculator`); HD fills the gaps |
| `VETURL` | Veterans' tuition policies | 1,454 | Yes, low priority: `links.veterans` (shown only on the Cost page) |
| `DISAURL` | Disability services | 1,893 | Yes: `links.disability_services`, beside the disability-services share from [campus-services.md](../data-expansion/campus-services.md) |
| `ATHURL` | Student-Right-to-Know athlete graduation report | 913 | No: a compliance page, not something a visitor wants |

Values are messy: some lack a scheme (`www.uah.edu/admissions`), some have spaces (`tcc.ruffalonl.com/Alabama State
University/Freshman-Students`), a few are a bare domain. `normalizeUrl()` in `sync-data` already handles the first
two for Scorecard's fields; reuse it.

### The college's own site: the visit page
No federal file lists campus tours. The Common Data Set does not either. The admissions page almost always links to
one ("Visit", "Visit campus", "Tours", "Plan your visit"), so it can be found without a model:

1. Fetch `links.admissions` (fall back to the homepage) with the college-reported crawler's HTTP client
   (`scripts/lib/college-reported/http.mts`: robots.txt, one request a second per host, a named user agent).
2. Collect the page's links (`findLinks` in `documents.mts`) on the same registrable domain.
3. Score each link's text and path: `visit` in the text or path +3; `tour` +2; `open house` or `admitted student`
   +1; `virtual` −1 (a virtual tour is a second choice, kept as `links.virtual_tour` when it is the only match);
   links in `<nav>` or `<header>` +1; links to a PDF or to a social site −∞.
4. Keep the best link when its score is ≥ 3, with the anchor text as the lineage quote. Otherwise `links.visit` is
   null and the college goes on a list for the Haiku picker (the round-3 discovery ladder's step 2,
   [college-reported-round-3.md](../college-reported-round-3.md#decision-6-discovery-is-a-ladder-cheapest-first)):
   the link list in, one URL or "none" out, about $0.003 a college. *Estimate:* the heuristic finds the page for
   three in four colleges; the picker for most of the rest; a few hundred stay null until a person adds them.

The probe runs as a step of `npm run sync-data -- --links` (off by default, since it is ~2,000 requests and takes
about 40 minutes at one request a second per host; the hosts are all different, so it parallelizes to a few minutes),
and in the college-reported workflow's monthly run. It never runs on Vercel.

## Ingest
- `sync-data` reads the seven columns from the `HD{Y}` rows it already keeps, normalizes them, and stores them under
  `links`. The homepage: HD `WEBADDR` when present, else Scorecard; when the two differ by more than scheme or
  `www.`, keep HD and print the pair as a warning (the first run will show how often they differ).
- `--links` adds the visit probe and a **liveness check**: a `HEAD` (then `GET` on 405) of every stored link, at most
  one per host per second. A link that answers 404, 410, or a DNS failure twice in a row (two runs) becomes null,
  with the old value kept in `data/link-issues.json` for review; 403, 429, and timeouts keep the link (many college
  sites block bots but work in browsers; Princeton's homepage answered 403 to the probe on 2026-10-03). Redirects
  are followed and the final URL stored when it stays on the college's domain.
- Overrides: `data/overrides.json` can set any `links.*` value with a `_lineage` of source `college-site`, for the
  colleges whose visit page nobody could find.

## Store
```ts
links: {
  website: string | null;              // existing
  price_calculator: string | null;     // existing
  admissions: string | null;
  apply: string | null;
  financial_aid: string | null;
  visit: string | null;                // found on the college's site; lineage carries the page it was found on and the link text
  virtual_tour: string | null;
  veterans: string | null;
  disability_services: string | null;
}
```
Register each in `lib/fields.ts` with source `ipeds-hd`, topic `institution`, vintage `ipeds-hd` (the HD edition is
the year the college reported the link). `links.visit` and `links.virtual_tour` use source `college-site` and a
per-value lineage record `{ url: <page it was found on>, retrieved, method: "extracted", quote: <link text> }`, like
every other college-site value, so the ⓘ popover can say "Found on the college's admissions page, 2026-10-12".

Supabase: the `links` object is part of the school document, so `publish-data` needs no schema change.

## Display
- **Profile hero** (`app/schools/[id]/page.tsx`): a row of outlined pill links under the chips, in this order:
  **Website · Admissions · Apply · Visit · Financial aid**. Each is an `<a target="_blank" rel="noopener">` with the
  external-link icon and the college's domain as its `title`. Missing links are left out, never shown disabled. On
  phones the row scrolls sideways like the "Known for" chips. The row's `SourceNote` lists the HD edition and, when
  present, the college's site for the visit link.
- **Compact header** (topic pages): one "Website" icon link at the right of the name, so a visitor on any topic page
  can reach the college in one tap. Nothing else; the band is already full on phones.
- **Cost page and Cost card**: "Financial aid office" next to the existing net price calculator link; "Veterans'
  benefits" under it when present.
- **Students page**: "Disability services" beside the disability-services share.
- **Explore cards and rows**: no links (they would compete with the card's own link to the profile).
- **Compare**: a "Website" row at the end of the table, one link per college.
- **Saved lists** ([product/saved-lists.md](../product/saved-lists.md)), when built: Apply and Visit links beside each
  saved college, since that is where a family acts on them.

Links open the college's site, so they carry no figure and need no year in the text; the ⓘ popover still shows where
each came from.

## Keep history?
No. A link is replaced when it changes. `data/link-issues.json` keeps the last broken value for a person to look at.

## Checks (each shown to fail when broken)
- `tests/links.test.mts`: normalization (scheme added, spaces encoded, trailing junk dropped); HD beats Scorecard
  only on a real difference; the visit scorer picks "Visit campus" over "Virtual tour" and rejects a PDF; the
  liveness rule nulls a link only after two failures and never on 403 or 429.
- Lineage guards: every `links.*` field registered; `college-site` values carry `url` and `retrieved`
  (`validateLineage`, existing).
- A fixture HD file with the seven columns, so `sync-data`'s reader is covered without the network.

## Cost
HD columns: nothing. The visit probe and liveness check: HTTP only, no model. The Haiku picker for colleges the
heuristic misses: *estimate* 500 colleges × $0.003 ≈ $1.50, once; later runs only for colleges still without a link.

## Open questions for the owner
1. Show the Apply link at all? It sends a student to an application portal (often Common App) and is the one link a
   college might prefer visitors reach through its own admissions page. Default: show it; it is what the college
   reported to NCES as its application address.
2. Run the visit probe inside the monthly college-reported run (same crawler, same robots rules, one more page per
   college) or as its own job? Default: inside, after the CDS discovery, so a college's site is visited in one pass.

## Implementation plan
1. `scripts/sync-data.mts`: read the HD columns, normalize, store; warn on homepage disagreements. `lib/fields.ts`
   and `lib/types.ts` entries. Fixture and tests. Ships the hero links row with Website, Admissions, Apply, Financial
   aid (one PR).
2. `scripts/lib/links-probe.mts`: the visit scorer and liveness check behind `--links`, reusing the crawler's HTTP
   client and link finder; `data/link-issues.json`; the Haiku picker queue. Second PR, with the Visit link.
3. Compact header, Cost, Students, Compare placements; the `/data` page's source description for HD gains "and the
   links each college reports".
