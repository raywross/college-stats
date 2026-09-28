# Sources & Citations

Every number on the site is attributed to a public source, at three levels:

1. **Inline** (`<SourceNote topics=[…] school?>`): a one-line "Source: IPEDS Admissions survey, Fall 2024 (ADM2024)"
   under each profile section, the Explore results, the Home charts, and Compare (`<MultiSourceNote>` combines the
   compared schools' sources). Each source links to its dataset; "About the data" links to `/sources`.
2. **Per profile** (`<SourceList>`): "Sources for this profile" at the bottom, listing every source used, with
   publisher, edition, IPEDS unit ID, and retrieval date.
3. **`/sources` page**: each dataset's description, edition, link, and coverage count; the colleges enriched from
   their own Common Data Set; "How we calculate"; update cadence; a suggested citation. Linked from the footer.

## How attribution is resolved
- `data/meta.json` (written by `npm run sync-data`) holds the retrieval date, a `SourceInfo` record per source
  (`scorecard`, `ipeds-adm`, `ipeds-sfa`, `cds`), and `defaults`: which source supplies each topic.
- Topics: `admissions`, `enrollment`, `demographics`, `cost` (Scorecard net price by income), `prices` (IPEDS IC
  sticker prices by residency), `outcomes`, `aid`.
- Sources: `scorecard`, `ipeds-adm`, `ipeds-sfa`, `ipeds-ic`, `cds`.
- A school only stores `provenance` for topics that came from somewhere else: `admissions: "scorecard"` when a
  college is missing from IPEDS ADM, or `"cds"` after a Common Data Set import. `school.cds` holds that file's
  edition and URL, so a CDS citation links to the college's own file.
- `resolveSource(topic, school?)` and `sourcesFor(topics, school?, { includeCds })` in `lib/data.ts` do the lookup.

When adding a new data field, decide its topic (or add a topic, a default in `writeMeta()` in the sync script, and
a label in `app/sources/page.tsx`), then cite it with `SourceNote` wherever it's shown.

## Common Data Set import
`npm run import-cds -- --id <IPEDS unit id> --edition 2024-25 --url <xlsx url or path>`, then `npm run sync-data`.

- Reads the official CDS Excel template with the system `unzip` (no dependencies), matching **row labels** rather
  than cell addresses: B1/B2 (undergrads, race/ethnicity), C1 (applied/admitted/enrolled), C9 (SAT/ACT percentiles,
  submission rates), H2/H2A (need-based and merit aid for full-time undergraduates).
- Writes a patch to `data/overrides.json` with `cds`, `provenance`, and the fields it found; anything it can't find
  is left out so federal data fills the gap. Re-running for the same school replaces its patch.
- PDF-only Common Data Sets aren't supported yet (planned: see [backlog.md](backlog.md)).
- Verified on Vanderbilt: output matched the hand-entered figures exactly.

## Data-year honesty
Sources have different vintages (IPEDS ADM fall 2024, IPEDS aid and prices 2023–24, Scorecard cost data 2023–24, a
college's newest CDS). The all-student average cost uses only same-year inputs (SFA + IC). When a sentence combines figures from different sources, each figure carries its own year. For
example, a profile says the net price in one sentence and "In 2023–24, 66% of first-year students received grants"
in the next.
