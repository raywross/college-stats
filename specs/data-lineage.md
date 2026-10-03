# Data Lineage & Per-Value Citations

> Status: **built** 2026-09-28 (registry, field-level lineage, validation, profile/compare citations, guards).
> Remaining: Explore/Compare baseline banner (see *Not built yet*). Replaces the topic-level attribution described in
> earlier versions of [sources-and-citations.md](sources-and-citations.md).

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
   mixed-year ratio (`lib/derive.ts#sameClassYield`). History charts stay federal.
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
- Pure module (type-only imports), so Node scripts and tests load it directly.

### Vintages: `data/meta.json`
`vintages: Record<VintageKey, string | null>`, written by the sync: `ipeds-adm` "Fall 2024", `ipeds-sfa` / `ipeds-ic`
"2023–24", `scorecard-enrollment` "Fall 2024", `scorecard-cost` "2023–24", `scorecard-latest` `null` (outcomes and
similar fields describe different cohorts; shown as "most recent release").

### Lineage record: `school.lineage`
Stored only where a value's source differs from its registry default. Keys are registered paths.
```ts
{ source: SourceKey; year?: string | null; url?: string; retrieved?: string;
  method?: "reported" | "derived" | "extracted"; quote?: string; page?: number }
```
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

The guard (`validateSchool`) requires every `admissions.*` value cited to `college-site` to be extracted or derived
with quote, URL, date, and year, `admissions.federal` to exist beside it, `admissions.year` to equal the reported
class's when applicants or admitted were replaced, any value that differs from `admissions.federal` to be cited to
the college, and `reported.admissions.year` to be newer than `admissions.federal.year` (or `admissions.year` when
nothing was replaced).

### Resolution: `lib/lineage.ts` (pure; also used by the sync and tests)
- `lineageFor(path, school, meta)` → `Cited`: source label, publisher, year, URL, retrieved date, method, `isDefault`,
  formula, input sources, quote, and `replaces` (`{ value, year }`) for a funnel value cited to the college that
  replaced an older one: the value from `admissions.federal`, the year from its lineage record (a CDS edition) or
  "Fall {federal.year}". Yield's inputs are the pair it was calculated from: enrolled and admitted when they describe
  the same class, otherwise `admissions.federal`.
- `sourcesForFields(paths, school, meta)` → distinct sources (derived values expand to inputs), for footnotes.
- App wrappers in `lib/data.ts`: `citeField(path, school?)`, `sourcesForFields(paths, school?)`,
  `sourcesForSchools(paths, schools)`.
- `yearLabel`, `shortSource` live here (not in the `"use client"` info-tip module) so server components can call them.

## Display
| Situation | Treatment | Where |
|---|---|---|
| Section values | Footnote listing each source **with its year**, built from the section's `fields` | `SourceNote`; profile `Panel` requires `fields` |
| Any metric label | The glossary ⓘ popover gains a **Source** block: "Reported in … , Fall 2024" or "Calculated: formula. From …", retrieved date | `MetricLabel` / `InfoTip` `cited` prop; `SourceTip` when there's no glossary term |
| Value from a non-default source or year | **Nothing visible next to the value** (chips and the "Figures marked like this…" line were removed 2026-10-03 at the owner's request); the ⓘ popover carries the source, the kind of document ("in its Common Data Set 2025–26", "in its class profile for the Fall 2026 class"), the year, the quote, the link, the retrieval date, and the replaced figure ("Federal data, Fall 2024: 5.8%", from `Cited.replaces`) | `SourceBlock` in `components/ui/info-tip.tsx`; `tests/reported-guards.test.mts` bans `SourceChip`, `SourceExceptions`, and `chip=` from `app/` and `components/` |
| Compare "All the numbers" | Each row has a field; a cell whose cited year differs from the row's default year gets a small muted year after the value; row ⓘ shows the default source | `TABLE_ROWS` in `app/compare/page.tsx` |
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
On a merge that changes both code and `data/**`, Vercel builds production while "Publish data" is still writing
Supabase, so the new code can prerender against the previous publish. A new source then isn't in `meta.sources` yet:
PR #36's production build crashed on `/data` that way (2026-09-30). So the app treats a missing source as
"being published": `sourceInfo()` returns a placeholder citation, history leaves the family out, and the Data page skips
the card. The workflow's revalidation, after the publish and again after the deploy, replaces those pages. Only the
app is lenient: the sync and `check:lineage` still refuse a dataset missing any source.

## Not built yet
- Superscript numbers linking values to the numbered source list (the popover links straight to the source instead).
- Lineage in the `/api/schools` payload (client components currently show only search results, which aren't cited).

Built 2026-10-02 and revised 2026-10-03: `BaselineNote` and the newest-value display
([college-reported-round-2.md](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere)).
