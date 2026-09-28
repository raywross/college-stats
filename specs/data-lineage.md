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
3. **Federal data is the comparison baseline** ([college-reported-data.md](college-reported-data.md#display)). *Today*
   the 8 CDS overrides still replace federal values in `schools.json` (same fall 2024 class, different source); the
   chips make that visible. Separate `school.reported` values arrive with the ingestion agent.
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

### Resolution: `lib/lineage.ts` (pure; also used by the sync and tests)
- `lineageFor(path, school, meta)` → `Cited`: source label, publisher, year, URL, retrieved date, method, `isDefault`,
  formula, input sources, quote.
- `sourcesForFields(paths, school, meta)` → distinct sources (derived values expand to inputs), for footnotes.
- App wrappers in `lib/data.ts`: `citeField(path, school?)`, `sourcesForFields(paths, school?)`,
  `sourcesForSchools(paths, schools)`.
- `yearLabel`, `shortSource` live here (not in the `"use client"` info-tip module) so server components can call them.

## Display
| Situation | Treatment | Where |
|---|---|---|
| Section values | Footnote listing each source **with its year**, built from the section's `fields` | `SourceNote`; profile `Panel` requires `fields` |
| Any metric label | The glossary ⓘ popover gains a **Source** block: "Reported in … , Fall 2024" or "Calculated: formula. From …", retrieved date | `MetricLabel` / `InfoTip` `cited` prop; `SourceTip` when there's no glossary term |
| Value from a non-default source or year | Visible chip, e.g. `CDS 2024-25`, next to the label | `SourceChip` (automatic in `MetricLabel`) |
| Section containing such values | One line under the takeaway: "Figures marked [chip] come from {college} Common Data Set, 2024-25. Everything else here is federal data." | `SourceExceptions` in the profile |
| Values that always share a source (the funnel) | One chip on the group heading, not per row | `MetricLabel chip={false}` |
| Compare "All the numbers" | Each row has a field; per-school cells get chips; row ⓘ shows the default source | `TABLE_ROWS` in `app/compare/page.tsx` |
| Many schools (Explore, Home, Compare) | Union of sources; more than 3 CDS files collapse to "Common Data Sets from N colleges" | `MultiSourceNote` |
| Bottom of profile | Numbered list, one entry per dataset/document with every year used | `SourceList` |

## Enforcement
Each guard below was verified by breaking the rule on purpose and confirming the check fails (2026-09-28).

| Guard | Catches | Runs in |
|---|---|---|
| `FieldPath` types on `SourceNote`, `MultiSourceNote`, `Panel.fields` (required), `Tile.field` (required), `MetricDef.field` (required), Compare `TABLE_ROWS` (`satisfies`) | Typos, unregistered fields, a tile/metric/section with no citation | `tsc` |
| `validateLineage` (registry + every school) | Stored field not in the registry; lineage for a missing value or an unregistered/computed field; CDS lineage without a `cds` record, or a `cds` record nothing cites; `extracted` without quote/url/date/year; a release without a year; derived inputs that don't exist; circular derivations | Sync (before writing), `npm run check:lineage`, `npm test` |
| `lineageForPatch` | Overrides with no source, the retired `provenance` key, unregistered fields | Sync, `npm test` |
| `tests/citation-guards.test.mts` | Hard-coded data years in `app/` or `components/` ("Fall 2024", "2023–24"); reading `meta.sources` / `vintages` / `.edition` directly outside `app/sources/page.tsx`; any return of `provenance` / `topics=` | `npm test` |
| `tests/lineage.test.mts` | Resolution behavior: defaults, CDS vs federal fields at a CDS school, derived inputs and non-default propagation, de-duplication | `npm test` |
| `npm run verify` | typecheck + lint + tests + lineage check | Locally before committing; CI (`.github/workflows/verify.yml`, also runs `next build`) |

### When you change things
- **New stored field:** add it to `lib/fields.ts` (source, vintage or formula), then show it with a `cited` label and
  add it to its section's `fields`.
- **New derived metric:** add a `derived.*` entry with `formula` and `inputs`; give its `METRICS` entry that `field`.
- **New source** (e.g. `college-site`): add to `SourceKey`, `meta.sources` (sync), `SOURCE_VINTAGE` in `lib/lineage.ts`,
  and `shortSource`.
- **New release year:** nothing in UI code; the sync updates `vintages`.

## Not built yet
- **Explore/Compare baseline banner** ("Comparisons use federal data…") and a separate `school.reported` block: arrive
  with [college-reported-data.md](college-reported-data.md), when college-reported values stop replacing federal ones.
- Superscript numbers linking values to the numbered source list (the popover links straight to the source instead).
- Lineage in the `/api/schools` payload (client components currently show only search results, which aren't cited).
