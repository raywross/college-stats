# Common App data

Raw inputs for the Common App section (specs/data-expansion/common-app.md). `npm run sync-common-app` writes them;
`npm run merge-common-app` applies the newest edition and the member records to `data/schools.json` as
`school.apply` and a few other fields. Nothing here is served directly.

## Files

| File | What it is |
|---|---|
| `grid/<cycle>_<updated>.pdf` | The Requirements Grid (`https://content.commonapp.org/Files/ReqGrid.pdf`) as downloaded, named by its cycle and "Updated" stamp (`2026-27_2026-09-25.pdf`). |
| `grid/<cycle>_<updated>.json` | That grid parsed (`GridEdition` in `lib/common-app/types.ts`): one row per member that takes first-year applicants, every column typed, joined to an Explore slug and, when `data/schools.json` carries the member's IPEDS id, a `unit_id`. `unmatched` lists the grid names no rule joined. One row per line. |
| `members.json` | Every member's Explore record (`MembersFile`): slug, title, member id, IPEDS id, state, alternate names, aid flags, links on the college's own site, first-year flags, and the day each was read. Nothing else from the page: no marketing text, quotes, photos, logos, phone numbers, or staff emails, and no commonapp.org URLs. |
| `name-map.json` | Grid name → Explore slug for names that match no title, normalized title, or alias. Each entry was checked by hand against the Explore record (title and state agree). |

Keep one edition per cycle after it closes; in-season refreshes may replace the earlier edition of the same cycle once
the newer one is committed.

## Refreshing

- `npm run sync-common-app`: downloads the grid. When its stamp matches the newest edition here, it stops
  ("unchanged"). Otherwise it reads the sitemap, fetches the records of members not yet in `members.json`, joins,
  checks, and writes the PDF, the edition JSON, and `members.json`. Exit 1 (and no grid files written) when a check
  fails: row count within 2% of the grid's School-type cells, dates inside the cycle (September 1 to August 31), fees
  $0–$250, codes in their vocabularies, no row read twice, no header or notes text as a row.
- `--refresh-members`: refetch every member record (once a year, in August, when membership changes), then rejoin.
- `--grid-only`: parse and join against the members already on file (no member requests).
- `--members-only`, `--limit N`, `--dry-run`: as named.
- After a run, read the printed unmatched list. Open each name's Explore record; when its title and state agree with
  the grid row, add `"Grid name": "slug"` to `name-map.json` and rerun with `--grid-only`. Never add an entry by
  name similarity alone.

## Permission and attribution

Common App agreed to this use in October 2026 (the owner's letter, specs/data-expansion/common-app.md
"Permission"). The terms we keep:

- One request per member per refresh, through `PoliteHttp` (robots.txt honored, an honest user agent, at least a
  second between requests to one host); the grid is one download.
- Attribution on every value: each displayed `apply.*` value cites source `common-app` in its ⓘ popover ("Common
  App, 2026-27 cycle, updated September 25, 2026"; the text comes from lineage, never typed).
- The site links to no commonapp.org page other than `https://www.commonapp.org`, and never re-exports these fields
  in bulk.
