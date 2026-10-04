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
| Data model, display | `lib/directories.ts`, `components/school/CreditedList.tsx`, `DirectoryListings.tsx` | Classification, credits, guards, `listingsFor`, `groupListings`, `citeListing`, `PolicyCheck` |

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
  never bypassed; the previous data file is kept. A successful read clears the org's records.

## Example: SSA
Secular Student Alliance "Find a Chapter" (robots.txt allows all), faith / nonreligious, tier D. 2026-10-04: 267 map
markers, 233 at colleges (high schools, law and medical schools left out); 206 matched (3 hand-checked renames),
27 to review (mostly community colleges, which the site doesn't cover); 203 colleges. Shown by `DirectoryListings`
in the students page's Campus life section.
