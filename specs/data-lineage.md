# Data Lineage & Per-Value Citations

> Status: **built** 2026-09-28 (registry, field-level lineage, validation, profile/compare citations, guards).
> Remaining: Explore/Compare baseline banner (see *Not built yet*). Replaces the topic-level attribution described in
> earlier versions of [sources-and-citations.md](sources-and-citations.md).
>
> **Where things live, updated** ([data-platform/](data-platform/README.md), phase 4, 2026-11-01): `data/schools.json`,
> `data/meta.json`, `data/cds-records/`, and `data/college-docs.json`, named below, no longer exist; the same
> documents are now `colleges.json`, `meta.json`, and the `reported.cdsRecords`/`reported.docs` layers, composed by
> the publisher into the bundled snapshot the app reads. The rules, records, and guards described below are
> unchanged — only the file paths are.

## Why
A single profile mixes federal releases of different years (admissions fall 2024, aid 2023–24), a college's own Common
Data Set, and values we calculate. Soon it will also hold figures collected from college websites
([college-reported-data.md](college-reported-data.md)). Every number shown must trace to its source, year, and method,
and the site must say so where it's shown.

Topic-level provenance got this wrong. A CDS that supplied enrollment marked the whole "demographics" topic as CDS, so
Pell and first-gen shares (still from Scorecard) were cited to the college's CDS. Field-level lineage fixes that (a
regression test pins it).

## Rules
1. **Every stored value is registered** in `lib/fields.ts`, or the sync refuses to write.
2. **Year travels with the value.** Years come from `meta.json` `vintages` or the lineage record, never from literals
   in UI code.
3. **Every value shown is the newest its college has published**
   ([college-reported-round-2.md](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have)). The
   dataset holds the newest values, lineage says where each came from, and `admissions.federal` keeps what was
   replaced. A college's own newer class (its CDS or class profile, `school.reported`) replaces its federal or
   hand-imported CDS admissions figures in `data/schools.json` value by value (`lib/newest.ts#applyNewest`, run by
   `merge-reported` and `sync-data`), so the profile, Explore, Compare, ranks, medians, and Home all read the same
   `school.admissions`; years can differ between colleges, and each value's ⓘ says its own. Yield is never a
   mixed-year ratio (`lib/derive.ts#sameClassYield`). History charts stay federal. The same rule covers the groups in
   `lib/newest-groups.ts#NEWEST_GROUPS` (enrollment, race, retention, graduation by Pell group, from the CDS records),
   which keep what they replaced in `demographics.federal` and `outcomes.federal` beside `admissions.federal`
   ([cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md)).
4. **Derived values cite their inputs.** A value calculated from non-default inputs (yield from CDS counts) is itself
   non-default.
5. **Missing is `null`**, and has no lineage.

## Data model

### Field registry: `lib/fields.ts`
`FIELDS` maps every path to `{ label, topic, source, vintage, derived?: { formula, inputs }, computed? }`.
- `FieldPath` (its keys) types every citation in the app, so a typo or unregistered field fails `tsc`.
- Stored paths can be objects (`demographics.racial_diversity`, `aid.by_income`); a stored leaf is covered by its
  nearest registered ancestor (`registeredPathFor`).
- `derived.*` entries are computed at render time in `lib/metrics.ts` (yield, SAT midpoint, diversity index, aid
  generosity, payback). Every `METRICS` entry names its `field`.
- `hidden: true` marks a field computed for Quad's method and never shown or cited on a public page (`selectivity.band`,
  `derived.selectivity_score*`). `HIDDEN_FIELDS` lists them; the admin college page shows each with its value and
  lineage ([admin.md](product/admin.md#as-built-colleges-high-schools-hidden-values-the-standing-panel-2026-10-13)), the
  Data page leaves them out, and `tests/admin-hidden.test.mts` fails when one has no value or a public file names one.
- Pure module (type-only imports), so Node scripts and tests load it directly.

### Vintages: `data/meta.json`
`vintages: Record<VintageKey, string | null>`, written by the sync: `ipeds-adm` "Fall 2024", `ipeds-sfa` / `ipeds-ic`
"2023–24", `scorecard-enrollment` "Fall 2024", `scorecard-cost` "2023–24", `scorecard-latest` `null` (outcomes and
similar fields describe different cohorts; shown as "most recent release").

### Lineage record: `school.lineage`
Stored only where a value's source differs from its registry default. Keys are registered paths.
```ts
{ source: SourceKey; year?: string | null; url?: string; retrieved?: string;
  method?: "reported" | "derived" | "extracted"; quote?: string; page?: number;
  edition?: string; cell?: string; field?: string }
```
Round 3 (2026-10-03, [college-reported-round-3.md](college-reported-round-3.md#as-built)) added the last three for values
read from a college's Common Data Set: `edition` ("2025–26", the document; the value's own `year` comes from its item
group, e.g. "Fall 2025" or "2024–25 final"), and where the value sits when it isn't a PDF page: a workbook `cell`
("CDS-C!AC17") or a fillable-PDF form `field`. `lineageFromItem` in `lib/cds-records.ts` builds these records.
Missing parts fall back to the source's defaults in `meta.json`. The sync writes them for Scorecard admission-rate
fallbacks and for every value an override sets ([data-sync.md](data-sync.md#overrides)).

Newest figures (`applyNewest`) write records too:
- each replaced `admissions.{applicants,admitted,enrolled,acceptance_rate}`: a copy of its `reported.admissions.*`
  record (`source: "college-site"`, `method: "extracted"`, year, URL, retrieved date, quote); a rate calculated from
  the college's two counts gets `method: "derived"` with both quotes;
- `admissions.year`, when applicants or admitted were replaced: the `reported.admissions.entering_term` record;
- a previous rate kept beside newer counts: `{ source: <previous source>, method: "derived", year: <previous year> }`,
  so the ⓘ says it's calculated from the previous class's counts;
- `admissions.federal`, only when the replaced funnel was a hand-imported CDS override: that override's record, so
  "replaces" names the CDS edition (none means IPEDS ADM, the field's default).

The guard (`validateSchool`) requires every stored `reported.*` value to cite `college-site` with method `extracted` or
`derived` (a value computed from the college's printed figures; since round 3), each with quote, URL, date, and year;
every `admissions.*` value cited to `college-site` to be extracted or derived
with quote, URL, date, and year (for the test policy and SAT/ACT blocks, `admissions.federal_tests` keeps the replaced
block and every non-null value inside a replaced block must be the college's: `lib/cds/test-blocks.ts#validateTests`,
[cds-test-scores-and-policy.md](data-expansion/cds-test-scores-and-policy.md)), `admissions.federal` to exist beside it, `admissions.year` to equal the reported
class's when applicants or admitted were replaced, any value that differs from `admissions.federal` to be cited to
the college, and `reported.admissions.year` to be newer than `admissions.federal.year` (or `admissions.year` when
nothing was replaced).

### Resolution: `lib/lineage.ts` (pure; also used by the sync and tests)
- `lineageFor(path, school, meta)` → `Cited`: source label, publisher, year, URL, retrieved date, method, `isDefault`,
  formula, input sources, quote, and `replaces` (`{ value, year }`) for a funnel value cited to the college that
  replaced an older one: the value from `admissions.federal`, the year from its lineage record (a CDS edition) or
  "Fall {federal.year}". Yield's inputs are the pair it was calculated from: enrolled and admitted when they describe
  the same class, otherwise `admissions.federal`.
- `sourcesForFields(paths, school, meta)` → distinct sources (derived values expand to inputs), for footnotes. A
  per-college source (college-site, state law, directories) with no lineage record at the school cites nothing; a
  **present-only** source with a vintage (`PRESENT_ONLY`: `common-app`) cites nothing where the school has no value
  (absent or null), so a college that isn't a Common App member never lists Common App.
- App wrappers in `lib/data.ts`: `citeField(path, school?)`, `sourcesForFields(paths, school?)`,
  `sourcesForSchools(paths, schools)`.
- `yearLabel`, `shortSource` live here (not in the `"use client"` info-tip module) so server components can call them.

## Display
| Situation | Treatment | Where |
|---|---|---|
| Section values | Footnote listing each source **with its year**, built from the section's `fields` | `SourceNote`; profile `Panel` requires `fields` |
| Any metric label | The glossary ⓘ popover gains a **Source** block: "Reported in … , Fall 2024" or "Calculated: formula. From …", retrieved date | `MetricLabel` / `InfoTip` `cited` prop; `SourceTip` when there's no glossary term |
| Value from a non-default source or year | **Nothing visible next to the value** (chips and the "Figures marked like this…" line were removed 2026-10-03 at the owner's request); the ⓘ popover carries the source, the kind of document ("in its Common Data Set 2025–26", "in its class profile for the Fall 2026 class"), the year, the quote, the link, the retrieval date, and the replaced figure ("Federal data, Fall 2024: 5.8%", from `Cited.replaces`) | `SourceBlock` in `components/ui/info-tip.tsx`; `tests/reported-guards.test.mts` bans `SourceChip`, `SourceExceptions`, and `chip=` from `app/` and `components/` |
| Compare "All the numbers" | Each row has a field; a cell whose cited year differs from the row's default year gets a small muted year after the value; row ⓘ shows the default source | `TABLE_GROUPS` in `lib/compare-topics.ts`, rendered by `app/compare/table/page.tsx` |
| Many schools (Explore, Home, Compare) | Union of sources; more than 3 CDS files collapse to "Common Data Sets from N colleges" | `MultiSourceNote` |
| Explore and Compare, near `MultiSourceNote` | Quiet note: figures are the newest each college has published, years can differ between colleges, each value's ⓘ shows its source and year | `BaselineNote` (revised 2026-10-03) |
| Bottom of profile | Numbered list, one entry per dataset/document with every year used | `SourceList` |
| `college-site` value, newer than federal (college-reported-round-2.md) | **Is** the value, in every view: `applyNewest` writes it into `school.admissions` with its lineage and keeps the replaced funnel in `admissions.federal`; nothing resolves at render time | `lib/newest.ts`, run by `merge-reported` and `sync-data` |
| `college-site` value that's newer but not a full funnel (e.g. applicants only) | A line under the federal funnel: "Fall 2026: 46,618 applied · reported by the college", each present number cited | `PartialReportedLine` (`components/profile/ReportedAdmissions.tsx`) |

## Enforcement
Each guard below was verified by breaking the rule on purpose and confirming the check fails (2026-09-28).

| Guard | Catches | Runs in |
|---|---|---|
| `FieldPath` types on `SourceNote`, `MultiSourceNote`, `Panel.fields` (required), `Tile.field` (required), `MetricDef.field` (required), Compare `TABLE_ROWS` (`satisfies`) | Typos, unregistered fields, a tile/metric/section with no citation | `tsc` |
| `validateLineage` (registry + every school) | Stored field not in the registry; lineage for a missing value or an unregistered/computed field; CDS lineage without a `cds` record, or a `cds` record nothing cites; `extracted` without quote/url/date/year; a release without a year; derived inputs that don't exist; circular derivations | Sync (before writing), `npm run check:lineage`, `npm test` |
| `validateRegistry` source check | A dataset missing any `SourceKey` in `meta.sources` (the type is `Partial`, so this check is what requires them) | Sync, `npm run check:lineage`, `npm test` |
| `DatasetMeta.sources` is `Partial` | Code that reads a source without handling "not published yet" (use `sourceInfo()`) | `tsc` |
| `lineageForPatch` | Overrides with no source, the retired `provenance` key, unregistered fields | Sync, `npm test` |
| `validateCdsRecords` (`lib/cds-records.ts`) | CDS records (`data/cds-records/`): a passed value without a page and line, cell, or field; an owned item without a quote (≤ 160 characters); a document not in `data/college-docs.json` (or listed for another college); an item group with a passed value but no year; an unknown schema or reader version; an unknown code or status; a failed item that doesn't say why | `npm run check:lineage`, `npm test` (`tests/cds-records.test.mts`, each rule broken on purpose) |
| `checkDirectoryRows` + summary checks (`lib/directories.ts`, `lib/detail.ts`, [campus-directories.md](campus-directories.md)) | A national-directory listing without its organization's credit (publisher, list URL, date read, tier); a tier C estimate without fact and quote; `school.directories` without a `directory` lineage record, disagreeing with its listings, or with no table behind it | `npm run check:lineage`, `npm test` (`tests/directories.test.mts`) |
| `tests/citation-guards.test.mts` | Hard-coded data years in `app/` or `components/` ("Fall 2024", "2023–24"); reading `meta.sources` / `vintages` / `.edition` directly outside `app/data/page.tsx`; any return of `provenance` / `topics=` | `npm test` |
| `tests/lineage.test.mts` | Resolution behavior: defaults, CDS vs federal fields at a CDS school, derived inputs and non-default propagation, de-duplication; every field still cites when any one source is missing from meta | `npm test` |
| `npm run verify` | typecheck + lint + tests + lineage check | Locally before committing; CI (`.github/workflows/verify.yml`, also runs `next build`) |

### When you change things
- **New stored field:** add it to `lib/fields.ts` (source, vintage or formula), then show it with a `cited` label and
  add it to its section's `fields`.
- **New derived metric:** add a `derived.*` entry with `formula` and `inputs`; give its `METRICS` entry that `field`.
- **New source** (e.g. `college-site`): add to `SourceKey`, `meta.sources` (sync), `SOURCE_VINTAGE` in `lib/lineage.ts`,
  and `shortSource`.
- **New release year:** nothing in UI code; the sync updates `vintages`.

### Code ahead of data
> **Retired** ([data-platform/](data-platform/README.md), phase 4, 2026-11-01): this race was specific to the git +
> publish-data design. There is no `data/**` to merge and no separate "Publish data" run any more; a build fetches
> the already-composed snapshot, so a new source is in `meta.sources` whenever the snapshot that carries its values
> is. Kept for the record.

On a merge that changes both code and `data/**`, Vercel builds production while "Publish data" is still writing
Supabase, so the new code can prerender against the previous publish. A new source then isn't in `meta.sources` yet:
PR #36's production build crashed on `/data` that way (2026-09-30). So the app treats a missing source as
"being published": `sourceInfo()` returns a placeholder citation, history leaves the family out, and the Data page skips
the card. The workflow's revalidation, after the publish and again after the deploy, replaces those pages. Only the
app is lenient: the sync and `check:lineage` still refuse a dataset missing any source. One exception: a source a
later merge adds (`MERGED_LATER` in `lib/lineage.ts`: `common-app`, written by `npm run merge-common-app`) may be
absent together with all its vintages; once meta has any of them, or any school holds a value from it, the source and
every vintage are required.

## Admin edits: the `quad-edit` source and the `edited` method (2026-10-31)
An admin's edit, saved from the console's field editor (`specs/data-platform/change-sets.md` "As built, phase 3"),
is a lineage record like any other, with two reserved values: source `quad-edit`, method `"edited"`. The record
carries:
- `source: "quad-edit"`, `method: "edited"`;
- `retrieved`: the day the edit was saved (not a release date; an edit has no year — `citesYear` returns false for
  this source, so the citation never prints "most recent release" either);
- `note?`: the editor's optional note, shown under the citation.

There is no `year` on an edited record: `yearLabel`/`citesYear` are only ever asked about other sources' records.
`validateSchool` (`lib/lineage.ts`) requires `retrieved` on every `edited` record (there is nothing else to date it
by) and requires that method `edited` and source `quad-edit` always go together — one without the other fails the
guard.

The record is cited "Edited by Quad on {Month D, YYYY}." plus the note, via `editedOn()`/`citationText()`
(`lib/lineage.ts`) and the ⓘ popover's `SourceBlock` (`components/ui/info-tip.tsx`), which special-cases
`isEditedSource()` before any of the usual "Reported in …"/"Calculated: …" wording. A section's source line
(`SourceLine`/`SourceItem`, `components/sources/SourceNote.tsx`) reads "Edited by Quad" with no year, linked to
`/data#edits`; the profile's bottom source list adds "Some values edited by Quad" once, rather than listing the edit
among the numbered datasets (an edit has no publisher or year to group other citations under). Until the next
publish writes `meta.sources["quad-edit"]`, `sourceInfo()` falls back to `quadEditSource()` (`lib/data-platform/
edits.ts`) so a brand-new edit still cites correctly.

## Not built yet
- Superscript numbers linking values to the numbered source list (the popover links straight to the source instead).
- Lineage in the `/api/schools` payload (client components currently show only search results, which aren't cited).

Built 2026-10-02 and revised 2026-10-03: `BaselineNote` and the newest-value display
([college-reported-round-2.md](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere)).
