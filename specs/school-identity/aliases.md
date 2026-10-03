# Short Names and Nicknames: Searching for "UGA" (IPEDS HD + Wikidata + curated)

> Status: **planned** 2026-10-03. Part of the [identity family](README.md); reads the Wikidata file that
> [social-accounts.md](social-accounts.md) introduces. Research 2026-10-03: the `IALIAS` column of `HD2025` and the
> Scorecard `school.alias` field read for all 1,893 colleges; Wikidata's other names joined by IPEDS id; the site's
> search code read. Figures are measured unless marked *estimate*.

## Question it answers
*Why does typing "UGA" find nothing?* People call colleges by short names: UGA, Vandy, Cal, Ole Miss, Pitt, UT
Austin, Georgia Tech, UNC, Penn (not Penn State), USC (two of them). Search today
(`searchSchools` in `lib/dataset.ts`, and Explore's `q` filter) matches only the official name, city, and state.
"UGA" returns nothing; "Georgia Tech" returns nothing, because the official name is "Georgia Institute of
Technology-Main Campus".

## Source
Four sources, each stored with its name so a wrong alias can be traced and the source fixed:

| Source | Coverage (of 1,893) | What it looks like | Quality |
|---|---|---|---|
| **IPEDS HD `IALIAS`** (already downloaded; Scorecard's `school.alias` is the same column, a year older) | 882 colleges | `AAMU`; `AUM\|\|Auburn University at Montgomery\|Auburn Montgomery`; `The University of Arizona \| UArizona \| U of A \| UofA \| UA` | Reported by the college, but free-text: separators vary (`\|`, `,`, two spaces), one value is `Unull`, and University of Georgia reports none at all |
| **Wikidata other names** (`skos:altLabel`, English) | 1,354 colleges; 677 have a short all-caps one | `UGA`; `Vandy`; `The Farm`; `Leland Stanford Junior University`; also noise like `uga.edu` and former names | Community-edited, reviewable, mostly good; includes historical names, which are useful for search too |
| **Domain label** of the homepage | all 1,893 | `uga`, `gatech`, `osu`, `utexas`, `berkeley`, `vandy` is not one, `vanderbilt` is | The college's own choice of short form; almost always a real alias |
| **Curated** `data/aliases-curated.json` | starts at ~150 | `Cal` → Berkeley; `Ole Miss`; `Pitt`; `Penn` → Pennsylvania, not Penn State; `USC` → both Southern California and South Carolina | Hand-written by the owner, highest weight; the only place to put disambiguation rules |

Not used: generated initialisms. "University of Georgia" gives "UG", not "UGA"; "Boston College" and "Boston
University" both give "BU"-ish collisions. Where an initialism is real, Wikidata or IPEDS already has it.

Checked examples (2026-10-03): UGA comes only from Wikidata (IPEDS and Scorecard have no alias for 139959);
Georgia Tech comes from Scorecard/IPEDS (`Georgia Tech`) and Wikidata (`GT`, `GIT`, `GA Tech`, `GATech`);
Vanderbilt gets `Vandy` from Wikidata and `vanderbilt` from its domain.

## Ingest
In `sync-data` (HD and the domain) and `sync-wikidata` (other names), merged into one table by a shared
`lib/aliases.ts`:
1. **Split** IPEDS values on `|`, `,`, `;`, ` / `, and runs of two or more spaces; trim; drop empty, `Unull`,
   `null`, `-`, and values over 60 characters.
2. **Normalize** each alias to a search key: lower case, accents stripped, punctuation and spaces removed
   (`U of A` → `uofa`, `A.U.` → `au`, `UT-Austin` → `utaustin`). Keep the display form too.
3. **Drop** aliases equal to the official name's key, to a bare domain (`uga.edu`), to a single character, or to a
   stop word; drop an alias that is a plain substring of the official name (it adds nothing to search).
4. **Weight** by source: curated 4, IPEDS 3, Wikidata 2, domain 2. An alias shared by two or more colleges keeps
   each entry (the ranking decides the order).
5. Write `data/aliases.json`, one line per alias:
   ```json
   {"unit_id":"139959","alias":"UGA","key":"uga","source":"wikidata","weight":2}
   ```
   and publish it to Supabase as a real table, `school_aliases (unit_id, alias, key, source, weight)` with an index
   on `key`, since this is the first dataset the app queries by a value rather than by college
   ([database-architecture.md](../database-architecture.md): a typed table, not a document collection). In JSON
   mode the file is loaded into the in-memory index the same way.

A nightly check is not needed; the table rebuilds with each sync.

## Store
`data/aliases.json` as above (*estimate:* 4,000–5,000 rows; ~250 KB). Nothing is added to `School`: the dataset
loader (`lib/dataset.ts`) builds a `Map<key, {unit_id, alias, weight}[]>` next to the school index. The field
registry gets one entry, `aliases` (source `ipeds-hd` by default, per-row source in the file), so the `/data` page
can describe the table.

## Search
`searchSchools(q)` and Explore's `q` filter share one scorer in `lib/aliases.ts`:

| Match | Score |
|---|---|
| Alias key equals the query key (`uga` = `uga`) | 5 + weight |
| Official name starts with the query | 3 |
| Alias key starts with the query key, query ≥ 2 characters (`vand` → `vandy`) | 2.5 + weight ÷ 10 |
| A word of the name starts with the query (existing) | 2 |
| Name contains the query (existing) | 1 |
| City starts with the query, or state equals it (existing) | 0.5 |

Ties break by applicants (existing), so `ASU` shows Arizona State before Appalachian State, Alabama State, Angelo
State, and Arkansas State, and all five appear. `USC` shows Southern California first and South Carolina second;
the curated file can pin an order with a higher weight for one of them.

The query key is normalized the same way as alias keys, so `U of A`, `u-of-a`, and `uofa` are one query. A query
with spaces is also tried as a name prefix as today, so "Georgia Tech" still matches the name's words.

**Showing why.** When a result matched through an alias, the typeahead row shows it in small type after the name:
*Georgia Institute of Technology-Main Campus · "Georgia Tech"*. `SchoolIndexEntry` gains an optional
`matched?: string`. Explore's chip for `q` stays as it is.

## Display
- Search typeahead (home, header, Compare picker, Compare tray): alias matches ranked and labeled as above.
- Explore: the `q` filter matches aliases, so `?q=uga` lists the one college.
- Profile hero: nothing. Short names are for finding a college, not for its page. (The hero's monogram and the
  "Schools like this one" labels already use `lib/brand.ts` short names; those stay hand-picked, since the alias
  table has several per college and no single best one.)
- `/data`: a line on the table, its sources, and where to send a correction (curated file; Wikidata).

## Keep history?
No.

## Checks (each shown to fail when broken)
- `tests/aliases.test.mts`: splitting the real messy IPEDS values above; normalization (`U of A` → `uofa`,
  accents); dropping `Unull`, domains, and name substrings; the scorer's order for `uga`, `asu` (five colleges,
  Arizona State first), `vand`, `georgia tech`, and `penn` (Pennsylvania before Penn State when the curated file
  says so); the `matched` label.
- A fixture-based test that `data/aliases.json` has one row per (unit_id, key) and every unit_id exists in
  `schools.json` (run in `npm run verify`, like the lineage check).
- Supabase: the migration for `school_aliases` and a publish test like `school_details`'.

## Cost
Nothing.

## Open questions for the owner
1. Seed the curated file with a list written from general knowledge (about 150 well-known short names) that the
   owner reviews, or start empty and add from search logs once telemetry exists
   ([product/telemetry.md](../product/telemetry.md))? Default: seed and review; the list is small.
2. Should "UGA" in Explore's `q` filter match only that college, or also colleges whose name contains "uga"
   (none today, but "Augusta University" contains it)? Default: an exact alias match wins outright; substring
   matches still appear below it.

## Implementation plan
1. `lib/aliases.ts` (split, normalize, weight, score), `data/aliases-curated.json`, tests.
2. `sync-data` and `sync-wikidata` write `data/aliases.json`; the verify check; `lib/fields.ts` entry.
3. `lib/dataset.ts` index and scorer; `/api/schools` passes `matched`; the typeahead label; Explore's `q`.
4. Supabase migration and publish step for `school_aliases`.
