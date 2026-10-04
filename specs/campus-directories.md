# Campus Directories (national lists of chapters and groups)

> Status: **built** 2026-10-04 (infrastructure, branch `feature/campus-life-2-infra`): adapter contract, polite crawler,
> matcher, runner, merge, lineage guards, shared display, and one example adapter (Secular Student Alliance). The
> per-organization adapters belong to [religious-life.md](religious-life.md#scaling-turn-the-crawl-around),
> [greek-life.md](greek-life.md#scaling), and [lgbtq-life.md](lgbtq-life.md#scaling).

## The pieces
| Piece | File | Does |
|---|---|---|
| Contract | `scripts/lib/directories/contract.mts` | `DirectoryAdapter`, `RawEntry`, `CrawlContext`, `Blocked`, `HttpError`, `defineAdapter` |
| Registry | `scripts/lib/directories/registry.mts` | Every file in `adapters/` is one adapter, keyed by file name; nothing to register by hand |
| Crawler | `scripts/lib/directories/context.mts` | `ctx.fetchText` / `fetchJson`: robots.txt and Crawl-delay obeyed, ≥ 2 s per host, UA `college-stats-research/0.1`, cache in `.cache/directories/` (30 days), challenges / 401 / 403 / 429 / login redirects throw `Blocked` |
| Matcher | `scripts/lib/directories/matcher.mts` | Campus text → IPEDS unit ids with a confidence; below 0.85 → review |
| Runner | `npm run sync-directories -- [--org k] [--domain d] [--refresh] [--dry-run]` | Writes `data/directories/<org>.json`, `unmatched/<org>.json`, `blocked.json` |
| Merge | `npm run merge-directories` (also run by `sync-data`) | `directories` table in each college's detail file + `school.directories` summary + source kinds in `meta.json` |
| Data model, display | `lib/directories.ts`, `lib/organizations.ts`, `lib/campus-view.ts`, `components/school/CampusListing.tsx`, `CreditedList.tsx`, `DirectoryListings.tsx` | Classification, credits, guards, `listingsFor`, `groupListings`, `citeListing`, `PolicyCheck` |

## Contract
```ts
type DirectoryAdapter = {
  key: string; organization: string; publisher: string; listUrl: string; // https
  tier: "B" | "C" | "D";                          // religious-life.md#source-tiers
  crawl(ctx: CrawlContext): Promise<RawEntry[]>;  // read the list; never match, write, or retry past a refusal
} & ( { domain: "faith"; tradition: Tradition } | { domain: "greek"; council: Council }
    | { domain: "lgbtq"; kind: "center" | "group" } | { domain: "lgbtq"; kind: "policy"; policy: PolicyKey } );
interface RawEntry { campus: string; campuses?: string[]; city?: string; state?: string; name?: string;
  url?: string; status?: string; fact?: string; quote?: string /* ≤ 160 chars */; tier?: "B" | "C" | "D" }
```
`Tradition`, `Council`, and `PolicyKey` are the keys of `TRADITIONS`, `COUNCILS`, and `POLICY_KEYS` in `lib/directories.ts`
(policy keys = lgbtq-life.md's data model). One classification per adapter: a list that mixes kinds is split into
one adapter per kind, so each credit stays exact.

## How to add an adapter
1. Create `scripts/lib/directories/adapters/<key>.mts` with `export default defineAdapter({...})` (copy `ssa.mts`).
   Check robots.txt and the site's terms first; a site whose terms forbid automated access: `throw new Blocked(url, "terms")`.
2. In `crawl`, fetch only through `ctx.fetchText` / `ctx.fetchJson`, parse the list, and return one entry per campus
   (city and state when the list has them; `campuses` when one chapter names several colleges). Export the parser and
   test it on a short HTML string in your track's test file.
3. `npm run sync-directories -- --org <key>`; read `data/directories/unmatched/<key>.json`. Fix parsing, or add a
   hand-checked answer to `data/directories/matches.json` (`"campus|ST": ["unit id"]`, with a reason in `_why`).
4. `npm run merge-directories`, then `npm run verify`. Commit the code, then the data separately.

## Matching
Normalizes case, accents, punctuation, "&"/and, Saint/St., Mount/Mt., "The", "at", "in", "campus", "Main Campus",
SUNY/CUNY spellings, Penn State, and common abbreviations (UT, UC…, USC, UNC, UMass, LSU, BYU, MIT, NYU, Ole Miss, Cal
State, Virginia/Georgia Tech). Rules, strongest first: hand-checked (1.00); exact name (1.00, 0.95 without a state);
the college's own web domain in the entry's link (0.95); IPEDS `IALIAS` from the cached HD file (0.95 / 0.90); name +
listed city (0.90); a system's flagship (`FLAGSHIPS`, 0.90); the name starts exactly one college's name (0.85). Close
spellings count only within a known state with a clear winner. The state, when given, must agree; two equally good
candidates are ambiguous. Named consortia (`CONSORTIA`), parenthesized lists ("Boston Area (BU, Northeastern)") and
`campuses` map to every college with `multi`; a bare area ("Denver Area") goes to review. Word order matters, so
"Miami University" never matches "University of Miami".

## Where listings live, and why
Measured on the SSA run: a listing is ~80 bytes (~140 with a chapter link), a credit ~225. At ~30 listings from ~20
lists per college that is ~7–9 KB per college, 13–16 MB over 1,893 colleges: data/schools.json (13.3 MB, loaded whole
on every server) would double, against the ~2 MB budget. So listings live in the college's detail file
(`data/detail/schools/{id}.json`, read only by that college's pages, ~7 KB today), and `school.directories` keeps a
summary of group keys per domain (~140 bytes; ≤ 0.7 MB if every college had every kind) for filters and "has
anything" checks.

## Lineage and display (owner decisions 2026-10-04)
- **Credit (decision 4):** every listing names its organization; the table's `credits` hold publisher, list URL,
  date read, tier, and classification. Shown as a labeled tier in each item's ⓘ ("Listed by X in its list, read
  2026-10-04. This is a national organization's list of its campus chapters, not confirmed by the college."), never
  as a plain fact. Tier C items show "X estimates …".
- **Sources:** `directory` (tiers B, D), `org-estimate` (C), `policy-page` (A: `PolicyCheck` with page URL, date
  checked, quote, and `verified_by` required for every "no" and conduct restriction, per decision 3).
- **Guards:** `checkDirectoryRows` (a listing without a credit, a credit without list URL, date, or publisher, tier C
  without fact and quote, quotes over 160 characters, unused credits, unsorted rows); the summary must cite
  `directory` with a date and equal what the listings say; a summary without a table fails `check:lineage`. Each was
  broken on purpose in `tests/directories.test.mts`.
- **Blocked lists (decision 1):** recorded in `data/directories/blocked.json` (org, URL, reason, first and last seen),
  never bypassed; the previous data file is kept. A successful read clears the org's records. **Not the same as
  "no server-rendered data"** (greek-life.md phase 4, 2026-10-04): a site that answers 200 with permissive
  robots.txt but renders its chapter list entirely client-side (Gamma Rho Lambda's page-builder site, Delta Lambda
  Phi's Wix site) has nothing for `Blocked` to catch — the adapter was simply never written, so it isn't in
  `blocked.json` either. Both outcomes mean "no adapter yet," but only a genuine refusal (403, a challenge, robots
  disallow) belongs in `blocked.json`.

## Display (redesign 2026-10-04)
Owner feedback on PR #73: "it all reads like a footnote … these are important data points for many applicants." The
three blocks now lead with facts in the profile's own language (display numbers, icon-labeled values, cards, chips,
check marks) and keep provenance in the ⓘ, with at most one short credit line per section.
- **Organizations:** `lib/organizations.ts` reads `data/directories/organizations.json` (`{ updated, organizations:
  { <adapter key>: { name, website, letters, colors, wikidata, logo: { file, source, license, attribution } | null } } }`,
  built by the directory runner) at request time; missing file or entry degrades gracefully. Logos are the
  organization's own (owner decision 2026-10-04, license "Organization's own logo (used to identify it)") or a free
  Commons file, shown in a light tile so mixed shapes and dark marks read in dark mode; the attribution goes in the
  listing's ⓘ (`Cited.image`), never on the page. Fallbacks: Greek letters (the file's, else spelled from the name,
  "Sigma Phi Epsilon" → ΣΦΕ) on the org's first color or the neutral surface; a tradition icon for faith groups; for
  the website, the home page of the org's own chapter-list site (only when the org publishes the list itself).
  Contract checked by `organizationsProblems` (tests/campus-view.test.mts, on a fixture and on the real file once it
  exists).
- **Pieces:** `components/school/CampusListing.tsx` (`OrgBadge`, `ListingCard`, `FactChip`, `SubHead`, `OutLink`),
  view models in `lib/campus-view.ts` (`greekView` joins the college's council counts with the lists' chapters;
  `faithView`; `listingView`).
- **Greek:** headline display number (all chapters when the college counts every council; listed chapters when only
  the lists speak; else the number of councils — a college count is never added to a list count), CDS participation
  bars, recruitment and housing as chips, then one row per council (count as a display number) that opens (native
  `<details>`) to its chapters with badge, organization linked to its site, and chapter name linked to its page.
- **Faith:** the college's facts as labeled values (affiliation, faith office, admission, scholarships, ministries),
  then "Faith communities" as cards with the tradition as a kicker, then the college's own composition as bars.
- **LGBTQ+:** support on campus as cards, the policy checklist with check marks (a minus only for a "no" the college's
  own page states; absence is never shown), one credit line per list, the conduct quote, the state law as a callout,
  then the another-gender counts. `CreditedList`/`DirectoryListings` remain for any future domain without its own block.

## Example: SSA
Secular Student Alliance "Find a Chapter" (robots.txt allows all), faith / nonreligious, tier D. 2026-10-04: 267 map
markers, 233 at colleges (high schools, law and medical schools left out); 206 matched (3 hand-checked renames),
27 to review (mostly community colleges, which the site doesn't cover); 203 colleges. Shown by `DirectoryListings`
in the students page's Campus life section.

## Faith adapters (religious-life.md phase 3, 2026-10-04)
Six more adapters — Chabad on Campus (an open JSON API behind an HTML page that 403s), Reformed University
Fellowship, FOCUS, The Navigators, CCCU (a membership list, not a chapter directory — see below), plus two
confirmed-blocked recorders (Hillel International, Orthodox Christian Fellowship). Per-organization coverage,
match rates, and what wasn't built (InterVarsity's AJAX-only list, Chi Alpha's search-only locator, CCMA's stale
PDF, and the several organizations with no locator found) are in
[religious-life.md#phase-3-as-built](religious-life.md#phase-3-as-built).

**A membership list isn't a chapter list:** CCCU's own list says which colleges are its voting members, not which
colleges have a CCCU student group (there isn't one). `applyCccuMembership` (merge.mts) reads its file separately
from `directoryDetails`/`chapterFiles` and writes `school.religion.cccu_member` instead of a `directories` listing,
so a membership fact never shows up as a "Faith communities" chapter. Any future membership-only list (as opposed to
a chapter or center list) should follow the same pattern: still a normal adapter and `data/directories/<org>.json`
file, but excluded from `chapterFiles` and read by its own merge step.

## Placeholder entries (owner feedback 2026-10-04)
UT Austin's Panhellenic chapters used to end with "Sigma Delta Tau — Coming Soon!", a chapter the sorority hasn't
installed yet. The runner (`scripts/lib/directories/run.mts`, `isPlaceholder`) drops any entry whose `name`,
`status`, or `fact` matches "coming soon", "TBA"/"TBD", "new chapter", "future chapter", "interest group", or
"expansion" before it's matched, so it never reaches a college's page; `sync-directories`'s per-org summary line
reports how many were dropped. A chartered **colony** (pre-national-recognition, but installed and operating) is a
real chapter, not a placeholder, and is kept.

## Organizations (data/directories/organizations.json)
One entry per adapter key (the contract is in this file's intro and validated by `organizationProblems` in
`lib/directories.ts`, exercised on the real file in `tests/directories.test.mts`): display name, the organization's
own home page, Greek letters for a Greek-letter organization, official colors when a reliable source states them,
a Wikidata id, and a logo. The Clearinghouse/Consortium-style credits (Trans Policy Clearinghouse, the LGBT Campus
Consortium) use the list's own home page as `website`.

**Logo source (owner decision 2026-10-04, replacing this file's original Wikimedia-Commons-first rule):** take the
logo the organization publishes on its own site (header/brand logo, or a press/brand page), obeying robots.txt and
our research User-Agent, never bypassing a block — "it'll look nicer and it's worth the risk" was the owner's
reasoning for preferring the org's own mark over a Commons lookup. `logo.source` is the page it was taken from,
`logo.license` is `"Organization's own logo (used to identify it)"`, and `logo.attribution` is `"© <Organization>"`.
A Wikimedia Commons free image (via the org's Wikidata item, P154 logo image or P94 coat of arms) is still the
fallback where the org's own site gives nothing usable, keeping Commons' own license and attribution. Where neither
exists, `logo: null` and the display falls back to a Greek-letter badge (Greek orgs) or a tradition icon (faith
orgs). Every committed file is ≤ 30 KB, square-ish (padded on a transparent canvas when the source lockup is wide or
tall, never stretched), under `public/org-logos/<key>.svg|png`.

2026-10-04 build: 38 organizations (one per adapter key), 18 with a logo from the organization's own site. The other
20 have `logo: null`: 7 because the site returns a Cloudflare/WAF challenge to every request (same organizations
already in `blocked.json` for their chapter list: Alpha Phi, Chabad on Campus, Delta Zeta, Hillel International,
Kappa Alpha Psi, Orthodox Christian Fellowship, oSTEM), and the rest because the only logo found on the org's site
either wasn't usable as a standalone mark (white-on-transparent art meant for a dark header background — CCCU, Sigma
Kappa; an inline SVG styled by the page's own CSS, not renderable standalone — RUF) or no confident logo candidate
was found at all (The Navigators, Omega Phi Beta, Phi Sigma Sigma). `colors` is `[]` everywhere: none of these
organizations' Wikidata items carry P462 (color), and scraping an arbitrary site's CSS for "the" brand color risked
picking up an incidental UI color rather than an official one, so it was left for a future pass with a firmer
source.

**Logo legibility (owner fix 2026-10-04):** a logo's `logo` object carries two optional fields, measured once from
the committed file (a small sharp script, not stored) and validated by `organizationProblems`/`organizationsProblems`
alongside the rest: `aspect` (the trimmed content's width/height) and `tone` (`"light"` when the artwork is
light-on-transparent and would vanish on a light tile, omitted/`"dark"` otherwise). Display
(`lib/organizations.ts` `orgBadge`, `components/school/CampusListing.tsx` `OrgBadge`) uses `aspect` to pick a wide,
fixed-height tile for a wordmark (`aspect >= 1.8`, `WORDMARK_ASPECT`) instead of squashing it into the square tile a
mark/crest gets, capping the tile's width at 4.5× its height so one very wide lockup can't blow out a row; `tone`
puts a light logo on a dark tile instead of the usual light one. When no tile size keeps a logo legible (Sigma Nu's
thin serif wordmark plus tagline line, at the small size chapter lists use), `logo.logo_display: "badge"` with a
`logo_display_reason` skips the image and falls back to the Greek-letter badge; `logo` itself stays populated so the
ⓘ credit is unaffected.
