# Short Names and Nicknames: Searching for "UGA" (IPEDS HD + Wikidata + curated)

> Status: **built** 2026-10-04. Part of the [identity family](README.md); reads the Wikidata file that
> [social-accounts.md](social-accounts.md) introduces. Research 2026-10-03: the `IALIAS` column of `HD2025` and the
> Scorecard `school.alias` field read for all 1,893 colleges; Wikidata's other names joined by IPEDS id; the site's
> search code read. Figures are measured unless marked *estimate*. See "As built" below for the real run.

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

## As built
Built 2026-10-04 on `feature/identity-aliases`. `data/wikidata.json` (the social track's first real run, 1,719
colleges) landed on `feature/school-identity` partway through this build and is merged in; `data/aliases.json` below
is built against it.

### Real-run numbers
A real build (newest IPEDS `HD2025`, the real `data/wikidata.json`, the homepage domain of every college's
`links.website`, and the 97-entry curated file) wrote **4,062 rows covering 1,571 of 1,893 colleges**, **421 KB**
(the spec's estimate was 4,000–5,000 rows, ~250 KB — close on rows, about 70% bigger on bytes, since real alias
text runs longer than the example):

| Source | Rows |
|---|---|
| Wikidata (`skos:altLabel`) | 2,196 |
| IPEDS HD `IALIAS` | 1,123 |
| Homepage domain | 646 |
| Curated | 97 |

182 keys are shared by two or more colleges (the ambiguous cases the scorer's tie-breaking and the curated weight
pin exist for).

### The curated file: 97 entries, not ~150
Every entry was looked up in `data/schools.json` by name and its `unit_id` verified before being added (the Stanford
243744-vs-243780 warning in the brief was heeded literally). That verification work, plus deliberately leaving out
names I couldn't confidently resolve, landed the list at 97 rather than the estimated ~150 — fewer, but each one
checked. Covers: the README's own examples (UGA, Vandy, Cal, Ole Miss, Pitt, UT Austin, Georgia Tech, UNC, Penn,
USC×2); every UC campus (Cal, UCLA, UCSD, UCI, UCD, UCSB, UCSC, UCR, UC Merced); ~20 more disambiguation pairs/trios
(OSU, MSU, USF, WSU, PSU, KSU — see below); and ~55 unambiguous flagship/well-known acronyms (MIT, UIUC, UVA, UF,
NYU, TAMU, WVU, JHU, WashU, …). Format: a flat array of `{ unit_id, alias, weight? }` in
`data/aliases-curated.json`; `weight` is only set to override the curated default (4) — used once, for USC.

**Disambiguation pairs added beyond the spec's named examples** (USC and Penn were required; these were my own
calls, found while verifying — ties are left to the existing applicants tie-break, not a weight pin, except USC):
OSU (Ohio State/Oklahoma State/Oregon State), MSU (Michigan State/Mississippi State), USF (South
Florida/San Francisco — found only while checking "UH" for Houston would've collided with Hawaii), WSU (Washington
State/Wichita State), PSU (Penn State/Portland State), KSU (Kansas State/Kennesaw State — Kennesaw now has *more*
applicants than Kansas State, so this is the one I'd most want the owner's read on; see the report).

**Considered and deliberately left out** (real, named collisions where I wasn't confident picking a side, so I left
them for Wikidata/IPEDS or the owner rather than guess): bare "OU" (Oklahoma vs. Ohio University — applicant counts
are 24,893 vs. 27,486, too close to call), bare "UNO" (New Orleans vs. Nebraska-Omaha), bare "CMU" (Carnegie Mellon
vs. Central Michigan), bare "Cal Poly" (three real campuses: SLO, Pomona, Humboldt), bare "Nova" (Villanova vs. Nova
Southeastern, confirmed both exist in the dataset), bare "UW" (Washington only; Wisconsin-Madison equally claims it).

**A finding worth flagging:** "Miami" was originally curated for both the University of Miami and Miami
University-Oxford (the classic mix-up), pinning Florida first by applicants. Both rows were silently dropped by the
*"plain substring of the official name"* rule — each school's own name already contains "Miami" as a whole word, so
the rule (correctly, by its own logic) judged the alias redundant. The practical effect: today, searching "miami"
ranks **Miami University-Oxford above the University of Miami** via the plain name-prefix tier (score 3, name starts
with "Miami") vs. the word-boundary tier (score 2, "University of **Miami**") — the opposite of what the removed
curated rows intended, and independent of applicant counts (Florida has more). The curated mechanism as spec'd
*cannot* fix this (any alias that's already a substring of the name is dropped before weight is ever considered).
Flagging for the owner: leave it, or add a narrow exception so a curated entry can override the substring drop for a
specific (college, alias) pair.

### Deviations and judgment calls
- **"Plain substring of the official name," interpreted at the word level, not the character level.** A character-level
  substring check (`name.includes(alias)`) would drop "Cal" (a fragment of the single word "California") and "Pitt"
  (a fragment of "Pittsburgh") — both spec-mandated examples. `shouldDropAlias` instead checks whether the alias
  occurs as a whole word/phrase, bounded by `\b`, in a space-normalized copy of the name. Verified against both
  required examples; see `tests/aliases.test.mts`.
- **Domain label** prefers the label just before the TLD when a subdomain survives stripping (`admissions.harvard.edu`
  → `harvard`, not `admissions`), beyond the spec's own one-line description.
- **Dedupe ties** (equal weight, e.g. Wikidata and domain both weight 2): the higher-priority source wins, in the
  order curated > IPEDS > Wikidata > domain, so e.g. Wikidata's properly-cased "UGA" is kept over the domain label's
  lowercase "uga" when both exist for the same key.
- **getSchools' `q` filter** (Explore): shares `scoreSchool` with `searchSchools` for *inclusion* (so `?q=uga` lists
  the one college) and additionally pre-sorts the matched results by score/applicants before the caller's chosen
  `sortBy` is applied — a stable sort, so this ordering only shows through on ties in whatever metric Explore is
  sorted by (its default, most-applied-to, already agrees with it in every case checked). This is what "an exact
  alias match wins outright" means in Explore today; no real query in the current dataset exercises a case where it
  would conflict with a non-tied sort value.
- **IALIAS came from a one-off HD download**, not a full `sync-data` (no API key needed for just the directory file):
  a short script in the spirit of the brief's "download the newest HD zip yourself," deleted before committing; see
  the report for how to reproduce it. `HD2025` was newest available (NCES hasn't published `HD2026` yet).
- `lib/fields.ts`'s `aliases` entry already existed on the foundation commit (not added here).

### Left for the owner
- Review `data/aliases-curated.json`, especially the KSU and Miami findings above.
- Apply `supabase/migrations/20261004120000_school_aliases.sql` before `npm run publish-data` can publish aliases
  (checked, not run, per the brief).
- Decide whether to curate "ASU" for Appalachian/Alabama/Angelo/Arkansas State too — today only Arizona State is
  curated; the other four rely on whatever Wikidata/IPEDS supply (Alabama State currently has none, so it doesn't
  appear for "ASU" at all; see the report).
- The Miami substring/drop-rule tension above.
