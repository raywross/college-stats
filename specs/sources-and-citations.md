# Sources & Citations

> The former `/sources` page is now the `/data` tab ([data-page.md](data-page.md)); `/sources` redirects there. How
> individual values are traced and checked is in [data-lineage.md](data-lineage.md).

Every number on the site is attributed to a public source, at four levels:

1. **Per value**: the ⓘ popover on each metric label shows the value's source, year, method (reported or calculated,
   with the formula and inputs), and retrieval date. Values from a different source or year than their section carry a
   chip such as `CDS 2024-25`.
2. **Per section** (`<SourceNote fields={…} school?>`): "Sources: IPEDS Admissions survey, Fall 2024; …" under each
   profile section, built from the fields the section shows. Views with many schools (Explore, Home, Compare) use
   `<MultiSourceNote schools fields>`. "About the data" links to `/data`.
3. **Per profile** (`<SourceList>`): numbered "Sources for this profile" at the bottom, one entry per dataset or
   document with every year used, publisher, and retrieval date.
4. **`/data` page** ([data-page.md](data-page.md)): which year each dataset describes and when the next is due, plus
   each dataset's description, edition, link, and coverage count; the colleges enriched from their own Common Data
   Set; "How we calculate"; a suggested citation. In the header nav and the footer.

## How attribution is resolved
See [data-lineage.md](data-lineage.md). In short: `lib/fields.ts` registers every field with its default source and
release year; `data/meta.json` holds each source's details and each release's year (`vintages`); `school.lineage`
records only the values that came from elsewhere; `citeField` / `sourcesForFields` in `lib/data.ts` resolve them.
`school.cds` holds a college's CDS edition and URL, so CDS citations link to the college's own file.

When adding a data field: register it in `lib/fields.ts`, pass `cited={citeField(path, school)}` to its label, and add
it to its section's `fields`. `npm run verify` fails if any of that is missing.

## Common Data Set import
`npm run import-cds -- --id <IPEDS unit id> --edition 2024-25 --url <xlsx url or path>`, then `npm run sync-data`.

- Reads the official CDS Excel template with the system `unzip` (no dependencies), matching **row labels** rather
  than cell addresses: C1 (applied/admitted/enrolled), C9 (SAT/ACT percentiles, submission rates), H2/H2A (need-based
  and merit aid for full-time undergraduates). B1/B2 (undergrads, race/ethnicity) are no longer imported: they come
  from the CDS records ([cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md)).
- Writes a patch to `data/overrides.json` with `cds` and the fields it found; the sync attributes each of those
  fields to the CDS. Anything it can't find is left out so federal data fills the gap. Re-running for the same school replaces its patch.
- PDF-only Common Data Sets aren't supported yet (planned: see [backlog.md](backlog.md)).
- Verified on Vanderbilt: output matched the hand-entered figures exactly.

## Data-year honesty
Sources have different vintages (IPEDS ADM fall 2024, IPEDS aid and prices 2023–24, Scorecard cost data 2023–24, a
college's newest CDS). The all-student average cost uses only same-year inputs (SFA + IC). When a sentence combines figures from different sources, each figure carries its own year. For
example, a profile says the net price in one sentence and "In 2023–24, 66% of first-year students received grants"
in the next.
