# College-Reported Data, Round 3: Read Every Document Once

> Status: **built** (2026-10-03; see [As built](#as-built); the full 1,893-college run and its two pilot runs are the owner's to trigger). Planned and revised the same day from the CDS inventory of 19 real 2025–26 documents. Follows
> [college-reported-round-2.md](college-reported-round-2.md) (built, PR #54) and
> [college-reported-data.md](college-reported-data.md). Changes four things:
> - Every fetched document is kept in a permanent archive and read once for **everything** in scope (766 template
>   items across CDS sections B–I, keyed by the template's own codes). A later schema change re-reads the archive,
>   not the web.
> - Code reads first. Two of the four document types (the 2025–26 Excel template and the fillable PDF form) need no
>   model at all.
> - Extraction runs through the Message Batches API at half price.
> - Discovery becomes a ladder that tries free probes before any model.
>
> The [Build order](#build-order-before-the-full-run) lists what must exist before the 1,893-college run. Not yet
> decided with the owner: see [Open questions](#open-questions-for-the-owner).

## Why
The owner is about to pay for **one** run over all 1,893 colleges and does not want to pay for it again. Two goals:
1. **The broad run costs as little as possible.**
2. **Each document's visit counts once.** Everything we will ever want from a document is extracted on that visit,
   or can be re-extracted later from an archived copy without fetching or discovering again.

Round 2 made discovery links-only and capped it. It still has these gaps:
- It reads only C1.
- It pays the full API price.
- It calls a model to find every college it has no recipe for.
- It keeps its documents only in a 7-day Actions cache.

Its readers also lose information on most real documents ([Fixed in this round](#fixed-in-this-round)). A round-2 run
over all colleges, followed by the CDS specs in [data-expansion](data-expansion/README.md), would discover and fetch
everything a second time.

## What is measured and what is not
| | Status | Number |
|---|---|---|
| Pilot (run `20261003-113224-1`, round-1 code, 50 colleges) | **Measured** | $80 logged (~$98 billed). Discovery: 35 calls, 21.9 M input tokens (~627 K per call), $47. Escalation: $33. Extraction (Haiku, C1 only): 36 calls, 183 K input tokens, **$0.20** (about 5 K tokens and $0.006 a call) |
| CDS inventory (2026-10-03): 2025–26 editions of 20 colleges | **Measured** | 19 read (6 Excel, 11 PDF, 2 HTML); UVA blocked by a Cloudflare challenge. Results in the next table |
| Round-2 discovery (links only, capped) | **Estimate, never measured** | $0.05–0.12 per college; $120–220 for all colleges |
| Hit rate by tier (answer key, hand-checked) | **Measured on a small sample** | Found a newer figure: very selective 15/15, selective 14/14, less selective 2/6, open admission 0/5 |
| Colleges by tier (`data/schools.json`, federal admit rate) | **Counted** | Very selective 59, selective 190, less selective 769, open admission (≥85% or no rate) 875 |
| Recipes on hand | **Counted** | 35 (`data/college-sources.json`) |
| Share-host links in those recipes | **Counted** | 5, and none was ever read (`processed` is empty): Box `/s/` links at Georgetown and UT Austin, Google Drive files at Pepperdine and Stanford, a Drive folder at Notre Dame |
| Everything in this spec's cost tables | **Estimate** | Basis given in each row; the first round-3 run measures them ([Decision 11](#decision-11-measure-the-model-before-the-full-run)) |

What the inventory measured:
| Finding | Detail |
|---|---|
| Template size | **1,105 items**, coded `A.001` … `J.220`. The codes are identical across colleges within the 2025–26 edition. The fillable PDF's field names match the template's "US News PDF Tag" column (1,087 of 1,089) |
| Four document types | **2025–26 Excel template** (Vanderbilt, Cornell, William & Mary, UIUC): a code table in every sheet plus an ANSWER SHEET. **Fillable PDF form** (Howard): answers only in form fields. **Flattened PDF** printed from Excel or Word (10 of 11 PDFs). **Older or custom Excel** (Berkeley, Purdue) and **HTML** (MIT, Texas A&M) |
| PDF size | 30–67 pages |
| Size of a flattened PDF body | 62–73 K characters ≈ **16–18 K tokens** (characters ÷ 4), after dropping ~8.4 K tokens of identical "Common Data Set Definitions" pages (present in 9 of 11 PDFs and in Texas A&M's page) |
| Size of an HTML CDS | MIT 57 K characters (≈ 14 K tokens). Texas A&M 106 K characters including its definitions |
| Lines after rebuilding rows by position | 1,400–1,700 per PDF body. +2% characters; +12% with x-position tags |
| Checkbox grids (C7, C8, D5, F3, H14) | Plain text loses the grid column. Rows rebuilt by y with x kept recover it in every flattened PDF tested. Single-column lists (E1, F2, F4, C16, H8) survive plain text |
| Excel beside the PDF | **None.** 0 of 9 index pages checked offer an Excel copy beside their PDF |
| Access | **Fetched with a tool user agent:** every workbook and PDF; Box `shared/static` and Google Sheets `export?format=xlsx` links download directly. **Blocked:** Texas A&M returns 404 to a tool user agent; UVA is a Cloudflare challenge; Michigan's and Baylor's index pages return 403 while their PDFs don't |
| Prior editions | Index pages list 10–25 past editions (Georgia Tech 25, TCU 25, Harvard 19, Spelman 13, Loyola 12, Howard 10) |

### API facts used (claude-api skill, model table cached 2026-06-24)
| Fact | Value |
|---|---|
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1 / $5 per M input / output tokens; 200 K context; 64 K max output; structured outputs supported; minimum cacheable prefix **4,096** tokens; PDF input up to 100 pages (200 K-context models) |
| Claude Sonnet 5 (`claude-sonnet-5`) | $2 / $10; 1 M context; 128 K output; adaptive thinking on by default (thinking billed as output); minimum cacheable prefix 1,024; new tokenizer: the same text is ~1.0–1.35× the tokens it is on Haiku 4.5 |
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 / $20; batch $2 / $10. **Not used**: nothing here needs it |
| Message Batches | **50% off all token usage**; up to 100,000 requests or 256 MB per batch; most finish within 1 hour, at most 24 hours; results kept 29 days; results arrive in any order (key by `custom_id`); structured outputs work in batches; a batch request is single-shot (no tool loop, so a `pause_turn` can't be resumed inside it); cache hits inside a batch are best-effort |
| Prompt caching | Writes 1.25× input (5-minute TTL) or 2× (1-hour); reads 0.1×; prefixes under the model's minimum silently don't cache |
| Structured outputs | `output_config.format`; every object needs `additionalProperties: false`; no numeric or string-length constraints (`minimum`, `maxLength`); a new schema compiles once and is cached 24 hours; incompatible with citations |
| Web search | $10 per 1,000 searches ($0.01 each), on top of tokens. `web_search_20260209` / `web_fetch_20260209` need Sonnet 4.6+ or Opus; older models (which the skill's wording puts Haiku 4.5 among) use the basic `web_search_20250305` |
| Web fetch | No per-call charge ("not metered"); fetched text counts as input tokens |
| Image tokens | About one token per 28×28-pixel patch (1280×720 ≈ 1,200 tokens) |
| Token counting | `messages.countTokens` (model-specific counts) |

**Where the skill is silent** (each marked "assumption" below and measured in the pilot):
- The token cost of a PDF page sent as a document block. Assumed 1,500–3,000: its text plus a page image at the patch
  rate above.
- Any limit on the size of a structured-output schema, and whether its schema counts as input tokens.
- Whether server tools (web search) run inside a batch. Assumed: not used in batches.
- Whether the batch discount applies to the per-search charge. Assumed: it doesn't.
- The maximum `custom_id` length. Assumed: 64 characters.
- Whether `countTokens` is billed.

Optional (not-required) properties in a structured-output schema do work: today's `EXTRACTION_SCHEMA.quotes` has them,
and the pilot ran with it on Haiku.

## Decision 1: one permanent archive; a document is fetched once
**Rule.** Every document we fetch (a CDS file or a class-profile page, but not index pages) is stored once in a
permanent archive. It is keyed by the sha256 of its bytes and listed in a committed manifest.

A document is fetched from a college's site only when it is new to us or its server says it changed (conditional GET).
Every later read uses the archived bytes, including re-extraction after a schema change and escalation. The archive also
keeps each PDF's rebuilt, numbered text (`<sha256>.lines.json.gz`), so quotes and re-reads never need pdf.js again.

**Manifest:** `data/college-docs.json`, one document per line, sorted by college:
```json
{ "sha256": "…", "unit_id": "166027", "url": "https://oira.harvard.edu/files/2026/07/CDS_2025-2026.pdf",
  "final_url": "…", "kind": "cds", "type": "pdf-flat", "edition": "2025-26", "edition_from": "cover",
  "retrieved": "2026-10-06", "bytes": 1482113, "pages": 34, "body_chars": 62510, "definitions_from_page": 30,
  "sections": { "C": [7, 12], "H": [21, 26] }, "archive": "gh:docs-2026-10/9f3c….pdf" }
```
- `type` is one of `xlsx-template`, `xlsx-classic`, `pdf-form`, `pdf-flat`, `pdf-scanned`, `html`, `class-profile`.
- `sections` holds the page range each section was found on, the hint for next year's edition (Decision 3).

**Where the bytes live.**
- **Size per year, estimated 0.6–1.5 GB:** ~740 CDS files a year (Decision 7 estimate) at 0.2 MB (Excel) to 3 MB
  (PDF), plus ~250 class-profile pages at ~0.15 MB and their changed versions. PDF sizes are from the owner's 0.5–3 MB
  range.
- **Prior editions, if archived too (open question 2), estimated 4–10 GB once:** about 740 colleges × 5–12 past
  editions × 0.7–1.2 MB. Index pages list 10–25 past editions.

| Option | Fits? | Cost | Against |
|---|---|---|---|
| Commit under `data/` | No | $0 | 1 GB a year of binaries in git history forever; every clone, CI checkout, and Vercel build pulls it; GitHub warns at 50 MB per file and blocks at 100 MB (GitHub's limits, not checked here) |
| Git LFS | Poorly | Free quota about 1 GB storage and 1 GB transfer a month (assumption; check GitHub's current LFS pricing), then paid | Every CI checkout that pulls LFS spends transfer; ties the archive to the app repo |
| Release assets on the main repo | **No** | $0 | The main repo is public ([roadmap.md](roadmap.md)), and we never republish colleges' documents |
| Supabase Storage, private bucket | Yes | Free plan storage is about 1 GB (assumption; check Supabase pricing), so year two needs the Pro plan (about $25/month, assumption) | Mixes pipeline state into the app's project; free projects pause when idle ([supabase.md](supabase.md)) |
| **GitHub release assets in a separate private repo** (`quad-college-docs`), one release per month (`docs-2026-10`), asset name = `<sha256>.<ext>` | **Yes** | $0 (assumption: release assets aren't billed as storage; files up to 2 GB each) | One more repo and token scope; a release has an asset-count limit (assumption: 1,000, so monthly releases) |

**Recommended: release assets in a new private repo** (open question 1).
- The workflow's `COLLEGE_REPORTED_TOKEN` gains Contents read/write on that repo.
- `.cache/college-docs/` and the Actions cache stay as a local hot cache in front of it.
- `scripts/lib/college-reported/archive.mts` hides the backend behind `put(sha, bytes)` and `get(sha)`, so moving to
  Supabase later is one file.

**Schema versions.**
- Each extraction call (Decision 4: `C` and `rest`) has a `schema_version` in `lib/cds-sections.ts`.
- A record (Decision 2) stores the version each call was read with.
- A run re-extracts a document's call only when the stored version is older than the current one. It reads the
  archived text and never fetches or discovers for it.
- Deterministic reads (template workbook, form PDF) are re-run from the archive whenever a reader changes, for $0.

## Decision 2: one wide record per document, keyed by template code, with a year per item group
**Rule.** Extraction writes one record per document: every in-scope template item, keyed by its 2025–26 code (`C.119`),
with its value, the page and line it came from, and a quote.

The record is a **staging store**. It is not merged into `data/schools.json`, so it adds no unregistered fields there.
- Each owning spec ([Extraction scope](#extraction-scope)) registers its fields in `lib/fields.ts` and adds a merge from
  records into `school.reported.*` with `extracted` lineage, exactly as C1 does today.
- C1 keeps publishing through `data/college-reported.json` unchanged.

`data/cds-records/<unit_id>.json` holds one file per college, its documents newest first:
```json
{ "unit_id": "166027", "documents": [ {
    "sha256": "…", "edition": "2025-26", "type": "pdf-flat", "url": "…", "retrieved": "2026-10-06",
    "reads": {
      "C":    { "schema_version": 1, "read_by": "claude-haiku-4-5", "mode": "batch", "batch": "msgbatch_…",
                "extracted": "2026-10-06", "pages": [7, 12], "stop": "end_turn" },
      "rest": { "schema_version": 1, "read_by": "claude-haiku-4-5", … } },
    "years": { "C1-C12": "Fall 2025", "C8": "applying for Fall 2027", "C13-C18": "Fall 2026 cycle", "G": "2026-27",
               "H-aid": "2024-25 final", "H4-H5": "class of 2025", "B4-B11": "Fall 2019 cohort",
               "B22": "Fall 2024 cohort to Fall 2025" },
    "items": {
      "C.101": { "v": 54008, "page": 7, "line": 412, "quote": "Total first-time, first-year who applied | 54008", "status": "passed" },
      "C.1101": { "v": 0.747, "page": 10, "line": 655, "quote": "…", "status": "failed",
                  "failures": [{ "check": "sums-to-100", "detail": "all-students column sums to 93.1%" }] },
      "C.1201": { "status": "blank" } } } ] }
```

**Status of each item:**
- `passed`: publishable.
- `failed`: goes to review.
- `blank`: the college left it empty or wrote a blank form ("-", "N/A", "N/Av", "XXXXX", "Yes or No"). This is known
  only from deterministic reads.
- `not-found`: a model read found no value. It may be blank or missing.
- `not-read`: a store-only item in a document type that needs a model (Decision 4).

**Years.** Items in one edition describe different years, so the record carries a year per item group, never one per
document.
- Most years follow from the edition by rule, defined per item group in `lib/cds-sections.ts`. For the 2025–26 edition:
  - C1–C12: Fall 2025.
  - C8 policy: students applying for Fall 2027.
  - C13–C18: the Fall 2026 application cycle.
  - G: 2026–27.
  - H4–H5: the class of 2025.
  - B4–B11: the Fall 2019 cohort (B5: Fall 2018).
  - B22: the Fall 2024 cohort, still enrolled in Fall 2025.
- The aid year (H1, H2, H2A, H6) is **read** from H0 (`H.101`), because it differs by college within one edition.
  Cornell says "2025-2026 Estimate", William & Mary and UIUC "2024-2025 Final", Howard "2023".
- Lineage records built from a record take the item group's year.

**Size.**
- Quotes (≤ 160 characters) are stored for items an owning spec will display. Store-only items keep value, page, and
  line, and their quotes are rebuilt from the archived lines when needed.
- Excel and form values carry their cell or field name instead of a line.
- Estimated **15–30 MB a year** in git: ~450 filled values per document × 30–60 bytes. Open question 3 asks whether the
  records belong in git.

**Validator.** `validateCdsRecords`, run by `npm run check:lineage`, requires:
- every `passed` value to have a page and line (or a cell or field) and, for owned items, a quote;
- every record's `sha256` to be in the manifest;
- an edition and a year for every item group;
- a known `schema_version`.

## Decision 3: deterministic readers first; four document types
**Rule.** Code reads everything it can, and a model reads only what code could not. The document type is decided from
the bytes, not the URL.

| Type | How it is recognized | Reader | Model? | Share of the sample |
|---|---|---|---|---|
| **2025–26 Excel template** | `PK` bytes; sheets `CDS-A` … `CDS-J` plus `ANSWER SHEET` | **Code reader.** First the per-sheet code tables (columns: code, question, answer, section, sub-section, category, group, cohort, residency, unit load, gender, value type); the ANSWER SHEET fills any code those leave empty (Vanderbilt's ANSWER SHEET section H is blank while its H sheet has 104 values). Where the visible form and the code table disagree, both are kept and the item fails `form-vs-code`: Cornell's C21 code table is wired one row off, so its "admitted" cell holds the 10,057 applications | **No** | 4 of 19 |
| **Fillable PDF form** | `%PDF`; the text layer has labels only; `page.getAnnotations()` returns filled widgets (Howard: 1,263 widgets, 759 filled; `getFieldObjects()` returned nothing) | **Field reader.** Each widget's field name is the template's "US News PDF Tag", mapped to its code through the template table (1,087 of 1,089 matched). Radio export values: `VI/I/C/NC`, `Y/N`, codes like `TFER_REQ` | **No** | 1 of 19 |
| **Flattened PDF** | `%PDF` with a text layer and no filled widgets | **Layout text** (below), then a model (Decision 4) | Yes | 10 of 19 |
| **Older or custom Excel; HTML** | Excel without code tables or an ANSWER SHEET (Berkeley, Purdue); an HTML CDS page (MIT, Texas A&M) | Excel: per-sheet text **with column letters and empty cells kept**. HTML: text with empty cells kept. Then a model, as for a flattened PDF | Yes | 4 of 19 |
| Scanned PDF | `%PDF`, under 200 characters of text, no widgets | Whole file as a document block (Decision 4) | Yes | 0 of 19 |

**The template table.** `data/reference/cds-template-2025-26.json` is built once from the official template. It lists
each of the 1,105 items:
- code, PDF tag, question, section, item (C1, C9, …), value type, and which call reads it (`C`, `rest`, or `store`);
- its year rule;
- whether a spec owns it.

Every reader and the model schema come from it. A new template edition (2026–27) gets its own table and a map from old
codes to new ones; codes are stable within an edition, not promised across editions.

**Layout text for PDFs.** This replaces plain pdf.js text order, which separates values from labels and drops grid
columns (`documents.mts:76-99`).
1. **Rebuild rows.** Group text items into rows by y (±2.5 pt), sort each row by x, and join items with " | " where
   there is a horizontal gap. Add `@x` tags so lone values and check marks can be placed under their column headers.
   This is the inventory's `layout.mts`. Example from Harvard's C7: the "Considered" header is at x=425 and "Not
   Considered" at 497, with marks at 450 and 532.
2. **Drop definitions** from the first "Common Data Set Definitions" heading on: ~8.4 K tokens of boilerplate.
3. **Number the lines** for citation (Decision 4).
4. **Take the edition from the cover or item text** ("Common Data Set 2025-2026" on the first pages, "Fall 2025 entering
   class"), never from page headers. USC and Loyola print "Common Data Set 2024-2025" in the headers of 31–32 pages of
   their 2025–26 files.
5. **Split into two parts**, `C` and the rest, at the "C1" and "D1" item markers. Section order never varied in the
   sample. If the markers aren't found, both calls get the whole body (cost below).

**Normalizing values** (in code, after any read):
- **Percents** arrive as 0.274, 27.4, "27.4%", "1%%" (UIUC F1), 63.73 (Loyola B), or "0.61" meaning 0.61% (Howard
  F1). Each item's value type decides how to read them.
- **Checked** is written "X", "x", "✔", "Yes", "Y", ☒ (Michigan; ☐ is unchecked), a private-use glyph (Spelman), or a
  radio export value.
- **Blank** is written "", "-", "N/A", "N/Av", "n/a", "Not Applicable", "XXXXX", or the template placeholder "Yes or
  No".
- **Dates** arrive as month/day cells, "11/1", "1-Nov", "Nov 1st", "11 months 1 day", or Excel serials (William &
  Mary's C16 "46113").
- **Printing artifacts:** digits split by the printer ("$3 4 , 604" at Georgia Tech) are joined within a cell. A total
  printed as "##" (Excel's overflow marks, at Loyola) is summed from its parts with `method: "derived"`.
- **Text in a numeric cell** ("varies", "$50/$75", "45-60") is kept as text with its quote, never coerced.

**Checkboxes need no vision pass.** Layout text placed every grid mark (C7, C8, D5, F3, H14) in every flattened PDF
tested, and the form reader handles fillable PDFs.
- A vision call (only the undecided pages, cut with `pdf-lib`, ~$0.002–0.006 a document) stays as a **last resort,
  off by default**. It runs only when a grid row has no mark or two marks after the layout pass, and each use is
  logged.
- Expected use is near zero. Turn it on only if the pilot shows otherwise. This answers what was open question 7.

**Excel first, but without counting on it.**
- Discovery still asks for the Excel file, and the URL guesser still tries `.xlsx` before `.pdf`. Each probe is one
  cheap request.
- No college in the sample offered Excel beside its PDF, so this spec counts no saving from it.

## Decision 4: two model calls per document, keyed by template code, quotes cited by line
**Rule.** For a flattened PDF, an older Excel file, or an HTML CDS, Haiku 4.5 makes **two calls**: one reads section C,
and one reads everything else in scope (B, D–I). Each call carries:
- the numbered layout text of its pages;
- a code-keyed structured-output schema built from the template table, with optional properties, so codes the model
  doesn't find are simply left out;
- answers that point at line ids. Our code fills in the quote.

**Store-only items are not in the model schema.** These are the items in the [Extraction scope](#extraction-scope) that
no spec owns.
- They are read for free from template workbooks and form PDFs.
- For model-read documents they are `not-read`, and can be added later from the archive (Decision 10) at a known cost.
- This keeps 339 low-value codes out of every model call. The model schema has **766 codes**: 263 in `C`, 503 in
  `rest`.

**The arithmetic that decided one, two, or five calls.** Per flattened PDF; estimates, Haiku, batch prices.
- **Document input:** the body is 16–18 K tokens; layout `@x` tags add ~12%, to ~20 K; 1,400–1,700 line ids at ~3
  tokens each add ~5 K. Total ≈ **25 K tokens**.
- **Static instructions plus the code table** (one short label per code) ≈ **12 K tokens**, split across the calls.

| | One call | **Two calls (`C`, `rest`)** | Five group calls (previous draft) |
|---|---|---|---|
| Input | ~25 K + ~12 K = ~37 K | ~25 K + ~13 K (instructions repeated once) = ~38 K | ~25 K + ~16 K = ~41 K |
| Input cost per document | ~$0.0185 | ~$0.019 | ~$0.0205 |
| Schema | One schema of 766 properties; the skill states no size limit, so it is an untested risk | 263 and 503 properties | Five of ~150 |
| `max_tokens` | ~20 K | 8 K and 16 K | ~4–6 K each |
| A truncation or failure loses | Everything | Section C or the rest, never both | One group |
| If the C/D split fails | — | +~20 K tokens (both calls get the whole body): +$0.01 | Split needed five ways |

The three designs differ by **under $0.002 a document (under $1.50 on the full run)**, so cost doesn't decide. Two calls
do, for these reasons:
- Section C carries the published C1 headline and most of the grids, and a failure in the 500-code remainder can't take
  it down.
- Each schema is a third or two-thirds of the single one.
- Splitting only at the C and D markers is the easiest split to get right.

This **reverses the five-group design** of the first draft: with documents of 16–18 K tokens instead of the assumed 45 K,
per-group page savings are negligible and the per-call overhead is not. A single call stays as an option if the pilot
shows the 766-property schema compiles and returns complete.

**Caching.** The static prefix (instructions and code table, ~6–7 K per call) is above Haiku's 4,096-token minimum, so it
is marked for caching.
- In a batch, hits are best-effort.
- If none happen, each request pays 1.25× on ~6.5 K tokens, about +$0.001 a document.
- The pilot reads the hit rate; if it is under 25%, the marker comes off.

**Cited by line.** Each value comes back as `"C.119": { "v": 4614, "lines": [412] }`, with one or two lines when label
and value sit on different lines. Code builds the quote from those lines, verbatim. Two gains:
- **Output tokens.** A filled value with a written quote is ~35 tokens; with line ids, ~15. At ~450 filled values that
  is ~16 K vs ~7 K output tokens a document. **~$0.02 saved per document** at Haiku batch prices, for ~5 K more input
  tokens of line numbers (~$0.0025).
- **No invented quotes.** Today's check 2 tests that a number appears in its quote, not that the quote is in the
  document (`lib/reported-checks.ts:56-66`). A line-cited quote is always real text. The check becomes "the number
  appears on the cited line", and a line id outside the document fails.

**Settings.**
- `max_tokens` is 8 K for `C` and 16 K for `rest` (about twice the expected output, logged). A `max_tokens` stop fails
  that call's unreturned codes only.
- No thinking on Haiku.
- Escalation (Decision 9) uses Sonnet 5 with effort `low`, thinking left adaptive and counted in its `max_tokens`.
- Structured outputs can't express ranges, so every range is a check in code (Decision 9).

**Scanned PDFs** (none in the sample) are sent whole as one document block.
- Assumed 1,500–3,000 tokens a page; 30–67 pages is 45–200 K tokens.
- Up to 100 pages and under Haiku's 200 K context they go to Haiku with both schemas in one call; above that, to
  Sonnet 5.

## Decision 5: extraction runs as a batch
**Rule.** The pipeline is offline, so every extraction call and every Haiku link-picker call goes through the Message
Batches API at half price. A run becomes phases, each resumable from committed state:

| Phase | What happens | Model calls |
|---|---|---|
| **Prepare** | Discovery ladder steps 0–1 (free, Decision 6). Fetch changed documents (conditional GET); hash; archive; manifest; detect type; deterministic reads (template workbooks, form PDFs); layout text and split for the rest. C1 from deterministic reads is published at once | None |
| **Discover** | Ladder steps 2–4 for colleges still without a document: Haiku pickers as a batch; search-only and full discovery interactively (server tools in batches are unconfirmed) | Picker batch; search calls |
| **Submit** | One extraction batch with every call (`C`, `rest`) of every new or changed model-read document whose record is older than its schema version. Batches over 200 MB are split (limit 256 MB; text requests are ~100–150 KB, scanned PDFs as base64 are the bulk). `custom_id` = `u<unit_id>-<sha8>-<call>-v<version>`, about 25 characters | Batch |
| **Collect** | Poll until `ended`; stream results; key them by `custom_id`; write records; run checks; publish passing items; queue failing ones. `errored` (server) and `expired` requests are resubmitted once in the next batch; `invalid_request` ones are queued | — |
| **Escalate** | Failing calls (Decision 9) as a second, small Sonnet 5 batch, collected the same way | Batch |

**State.** `data/college-batches.json` lists each open batch: id, phase, submission time, request count, reserved cost,
and its `custom_id`s. A run that ends with batches still open leaves them there, and the next collect picks them up
within the 29-day window.

**Workflow.**
- The `run` job does prepare, discover, and submit, then polls for up to its remaining time (`timeout-minutes: 330`;
  GitHub-hosted jobs stop at 6 hours, an assumption from GitHub's documented limit).
- Most batches finish within an hour, so a normal run ends in one job.
- If batches are still open, the job pushes its branch, opens the PR **as a draft**, and exits 0.
- A new `collect` job runs on a cron every 30 minutes and on `workflow_dispatch`. It does nothing unless a draft
  pipeline PR has open batches. Otherwise it checks out that branch, collects, escalates, runs `merge-reported`,
  commits, and marks the PR ready, where today's merge logic takes over.
- Both jobs share one concurrency group. The PR branch is the run's state, so nothing is lost between jobs.

**`--max-cost` with batches.** Batch cost is known only when results land, so the cap works by **reservation**.
- **Reserving.** Before submitting, each request's worst case is reserved: estimated input tokens at the batch input
  price, plus its `max_tokens` at the batch output price. Input is estimated as characters ÷ 3.5 × 1.2 safety margin,
  or with `countTokens` if the pilot shows that estimate is off.
- **Trimming.** A batch is trimmed, lowest priority first (Decision 7), so reserved plus already-spent stays under the
  cap. Trimmed documents stay archived and are submitted by the next run with no refetch.
- **Settling.** Collected results replace reservations with actual cost.
- **Interactive calls** keep round 2's check before each college, with an allowance per ladder step instead of a flat
  $0.50.

**Projection before spending.** After prepare, the run prints and writes a projection: documents by type × the
per-document estimate, plus discovery steps × their estimate. If the projection is over the cap, the run stops before
any model call (exit 3, "projection $X exceeds the cap $Y"), so the owner is never surprised halfway.

**Incremental writes** stay as round 2 built them: the files are written after every college in prepare and after every
collected batch.

**Saving.** Batching halves every extraction and picker token: about **$25–30** on the first full run (estimate: ~$55–60
interactive → ~$30 batched, from the table below). It also halves every later run's extraction.

## Decision 6: discovery is a ladder, cheapest first
**Rule.** A college without a working document link climbs these steps and stops at the first that finds one. Each
attempt and its cost is recorded in the recipe (`discovery.tried`).

| Step | What runs | Model | Estimated cost per college | Basis |
|---|---|---|---|---|
| 0. Known | Index pages re-scanned for a newer link; next edition guessed from the file name (round 2), `.xlsx` tried first; the owner's manual list (Decision 8) | None | $0 | HTTP only |
| 1. **Free probes** | **(a)** Sitemaps listed in the robots.txt we already fetch, including sitemap indexes, scanned for `common-data-set`, `/cds`, and class-profile patterns. **(b)** IR hosts and paths from the 35 real recipes. Hosts on the college's domain: `ir.`, `oir.`, `oira.`, `irp.`, `ira.`, `irds.`, `iris.`, `oirds.`, `opir.`, `obp.`, `oie.`, `opa.`, `apb.`, `dair.`, `abpa.`, `ir.provost.`, `ir.web.`. Paths: `/common-data-set`, `/cds`, `/institutional-research/common-data-set`, `/common-data-set-archive`. **(c)** The Scorecard website (`links.website`, present for all 1,893), then a two-hop crawl following links whose text names institutional research, facts, or data. At most ~40 requests per college, with robots.txt and the 1-second per-host gap as today | None | $0 | HTTP only |
| 2. Haiku picker | Our fetched pages reduced to their link lists (text and URL, ~3–4 K tokens). Haiku picks the CDS index or file and the class profile; our code follows and scans the links | Haiku, batch | ~$0.003–0.005 (interactive $0.005–0.01) | ~4 K in, ~200 out, 1–2 calls |
| 3. Search only | Sonnet 5 with `web_search` at most 2 times, **no `web_fetch`**, effort low; it returns candidate URLs. Our code fetches them and scans the links; a picker call if ambiguous | Sonnet (interactive) | ~$0.05–0.08 | ~12–20 K in at $2/M (system prompt and two searches' results); ≤1 K out at $10/M including thinking; 2 searches at $0.01 |
| 4. Full discovery | Round 2's links-only discovery (search and capped fetch, 4 each) | Sonnet (interactive) | ~$0.08–0.15 | Round 2's $0.05–0.12 estimate plus fetched-page tokens; never measured. The pilot measured $1.34 a call before the caps |
| 5. Manual | Owner pastes a URL or drops a file (Decision 8) | None | $0 | |

Haiku with the basic `web_search_20250305` might replace Sonnet in step 3 at about half the token cost. The pilot tries
it on 20 colleges before it is used.

**University systems** are an option, lowest priority.
- About 190 colleges have system names, counted by name in `data/schools.json`: SUNY 29, CSU 22, Penn State 21,
  Wisconsin 13, UT 12, Florida 11, UC 9, Texas A&M 8, Indiana 8, UNC 7, Minnesota 5, and others.
- Where a system office lists every campus's CDS on one page, one picker call covers the whole system.
- Which systems do this is unverified, and it is worth at most ~$5 on the first run (estimate: ~150 colleges ×
  ~$0.03). It is built only if the pilot's free probes miss system campuses.

## Decision 7: order by expected yield; a budget per tier; failures back off
**Rule.** A run takes colleges in order of expected yield:
1. by tier: very selective, selective, less selective, open admission (tiers as in `pilot.mts#tierOf`);
2. within a tier, by enrollment, largest first.

Steps 2–4 of the ladder have per-tier limits:

| Tier | Colleges | Steps allowed | Why |
|---|---|---|---|
| Very selective, selective | 249 | 0–4 (step 4 at most once a year) | 29 of 29 had a newer figure in the answer key |
| Less selective | 769 | 0–3 | 2 of 6 |
| Open admission | 875 | 0–2; step 3 only if the run's discovery budget has money left after every other tier | 0 of 5 |

Today a `--all` run spends its 100 discoveries on whichever colleges come first in `data/schools.json`, in unit-id order.
Ordering by tier spends the same money where documents exist.

**Back-off.** A college whose ladder found nothing, or whose discovery failed (timeout, refusal), records
`discovery.next_attempt`:
- the next 1 February (the start of CDS season) for very selective through less selective;
- a year later for open admission.

Today a failed discovery records nothing, so every scheduled run retries it, and colleges that keep failing spend
discovery budget every week (`pipeline.mts:494-502`). `none_found` gets the same date-based retry instead of waiting for
a manual `--rediscover`.

## Decision 8: share links, blocked hosts, and the owner's list
**Share links are resolved by rule.** Each rewrite is confirmed by fetching the first bytes (`%PDF` or `PK`), never by
working around a viewer page or bot protection.

| Link | Rewrite | When it fails |
|---|---|---|
| Google Sheets `/spreadsheets/d/<id>/…` | `/spreadsheets/d/<id>/export?format=xlsx` (a direct download: Berkeley's, verified in the inventory) | Sheet not public → manual |
| Google Drive file `/file/d/<id>/view` | `https://drive.google.com/uc?export=download&id=<id>` | Large files return an HTML confirmation page; robots.txt may disallow the path → manual |
| Google Drive folder | none | Always manual (Notre Dame) |
| Box `/s/<id>` | `/shared/static/<id>` (a direct download: UIUC's `/shared/static/….xlsx`, verified in the inventory) | Works only when the owner allowed direct download; HTML back → manual |
| SharePoint or OneDrive anonymous link | append `download=1` (assumption) | HTML back → manual |

The pilot logs why each of the five unread share links failed (robots.txt, HTML, or status), so this table is corrected
from facts before the full run.

**Blocked hosts.** The pipeline writes `data/reference/blocked-hosts.json`: host, status (401, 403, 404-to-tools, 405,
429, or a challenge), and first and last seen.
- **Blocking is per host, not per college.** Columbia's `opir.` host served its CDS while its admissions host returned
  403. Michigan's and Baylor's index pages return 403 while their PDFs don't, so next-edition guessing (step 0) still
  works there; index re-checks don't. Texas A&M answers a tool user agent with 404 and a browser with 200. UVA is a
  Cloudflare challenge.
- No discovery step spends money on a college whose only candidates are blocked hosts. Those colleges are listed in the
  PR body for the owner.
- From the pilot and the inventory, about 4–5 of 50 colleges are blocked at their main source (estimate for all
  colleges: 100–150).

**The owner's list.** `data/reference/cds-urls.json` (`{ unit_id, url, kind, note, added }`) is step 0 for those
colleges. A person finds the link in a browser, which no model can beat on price.
- For a blocked host, the person also downloads the file and runs
  `npm run archive-doc -- --college <id> --file <path> --url <original url>`.
- That puts the file in the archive and manifest exactly as a fetch would, with `retrieved` set to the day it was added.
  Extraction then proceeds from the archive.
- The pipeline never fetches a blocked host another way and never switches user agents.

## Decision 9: checks for every item, including deterministic reads; publish and escalate per item
**Rule.** Every item is checked on its own, and an item that fails never blocks another.
- **Checks run on deterministic reads too.** Colleges' own files have errors:
  - Vanderbilt typed 0.97 into B22's cohort-count cell.
  - UIUC's in-state admits exceed its in-state applicants; it swapped two C1 cells; its B2 column 3 holds only
    non-degree students; its wait-list admits are 1.
  - Cornell's C21 code table is off by one row.
  - Eau Claire reports "0%" SAT submitters alongside 23 students.
- Within C1, the seven checks of round 1 are unchanged.

**Universal checks**, on every value:
- From a model read, the number appears on its cited line(s). This replaces check 2.
- The cited line is in the document.
- The edition we filed the document under is the one its cover or item text states.
- The value fits its type: percentages 0–100 after normalizing, counts are whole and ≥ 0 (catches 0.97 in a count),
  GPA 0–5, SAT section 200–800, SAT composite 400–1600, ACT 1–36, dates valid.
- For a template workbook, the visible form and the code table agree.

**Per-item checks** are listed in the [Extraction scope](#extraction-scope). The tolerances come from the owning specs
and the inventory.

**Publishing.** An item whose checks pass is `passed` in the record, and only `passed` items reach any merge. C1
publishes through `data/college-reported.json` as today.

**Review queue.** It is keyed by college + edition + item: `ReviewItem` gains `code`, `edition`, and `sha256`. One
college can then have a failing H2 and a published C1. Today `enqueue` replaces every item of the college
(`pipeline.mts:477`); it will replace only the same key.

**Escalation.** Once per failing call, in the escalate batch: Sonnet 5 re-reads **only that call's pages** from the
archived text, for the failing codes only.
- **Escalated:** a number not on its cited line, a sum or order failure, an implausible change against a federal value,
  two sources disagreeing.
- **Never escalated** (no model can help): blocked or missing documents; `blank` items; "not newer than federal"; any
  failure in a deterministic read (the college's own file is wrong).
- If Sonnet reads the same failing figures, the item is queued as "document inconsistent", the way UCLA's stated rate
  didn't match its counts.
- Estimated cost: section C's pages ~6–8 K tokens, plus line ids and the C prefix, ~15 K × up to 1.35 for Sonnet's
  tokenizer at $1/M, plus ~4 K output at $5/M: **~$0.04 per escalation**.

**Circuit breaker** (no auto-merge). It counts check failures only, never `unreachable`, `blank`, or failures in
deterministic reads (which say the college's file is wrong, not our pipeline). It trips when any of these happens:
- more than 10% of attempted colleges fail C1 (today's rule, unchanged);
- any one item fails in more than 20% of the model-read documents that contain it, once at least 20 do (a schema or
  prompt problem in that item, not data);
- more than 25% of already-published values change in one run (today's rule).

## Decision 10: what later runs redo, and what is never redone
| | First run | Later runs |
|---|---|---|
| Discovery | Ladder for every college without a working link | Only colleges with no link, a broken index page (404 or 410), or `next_attempt` reached; starts again at step 0 |
| Index pages | Fetched and scanned | Conditional GET monthly, weekly Aug–Nov for class-profile pages. "Changed" means the **set of document links** changed, not the HTML; pages with timestamps would otherwise look new every time ([setup](college-reported-setup.md#7-reading-the-cost)). An index page that blocks us (Michigan, Baylor) falls back to next-edition guessing |
| Known documents | Fetched, archived | Conditional GET only when their index changed or a month has passed; a 304 or the same sha256 ends it |
| Next edition | — | Guessed from the file name in the college's usual publication month (from `retrieved` dates), `.xlsx` first |
| Deterministic reads | Every template workbook and form PDF | Re-run from the archive for $0 whenever a reader changes |
| Model extraction | Both calls of every model-read document | Only new sha256s, and calls whose `schema_version` went up, read from the archive |
| Escalation | Failing calls | Never repeated for the same sha256 and schema version |

**Never redone:**
- discovery for a college whose index page works;
- a fetch of an archived sha256;
- a model read of a call at the same schema version.

**A schema addition** is a new owned item, or a store-only item promoted by a new spec.
- Bump the version of the call it belongs to, then run `npm run sync-college-reported -- --reextract --call C`. This
  builds a batch from the archived text (page ranges from the manifest), with no fetch and no discovery.
- Deterministic documents pick the item up for $0.
- **Re-reading `C`** for ~590 model-read documents ≈ 590 × (~15 K input at $0.50/M + ~3 K output at $2.50/M) ≈ **$9**.
- **Re-reading `rest`** ≈ **$16**.
- **Re-reading both** ≈ **$25**. With three years of editions archived, three times that.
- A full re-run with rediscovery would cost $80–300 (this spec's first-run estimate and round 2's).
- **Backfilling prior editions** (open question 2) for history series (residency admit rates, SAT composite, retention,
  GPA, early decision) would be the same per-document cost: ~$0.035–0.05 per edition, model-read. Template workbooks
  and form PDFs cost $0.

## Decision 11: measure the model before the full run
**The run summary** (`data/reports/college-reported-run-<run>.json`) grows from three usage rows to enough to check
every number in this spec:
```ts
usage: Array<{ job: "picker" | "search" | "discovery" | "extraction" | "vision" | "escalation";
               model: string; mode: "batch" | "interactive"; call?: "C" | "rest"; calls: number;
               input_tokens: number; cache_write_tokens: number; cache_read_tokens: number; output_tokens: number;
               searches: number; cost_usd: number; reserved_usd?: number }>;
discovery: Record<"known" | "guessed" | "manual" | "probe-sitemap" | "probe-host" | "probe-crawl" | "picker" | "search" |
                  "full" | "blocked" | "none", { colleges: number; cost_usd: number }>;
documents: Record<"xlsx-template" | "xlsx-classic" | "pdf-form" | "pdf-flat" | "pdf-scanned" | "html" | "class-profile",
                  { fetched: number; unchanged: number; archived: number; model_calls: number; split_fallback: number;
                    grid_rows_undecided: number; vision: number; cost_usd: number }>;
items: Record<string, { passed: number; failed: number; blank: number; not_found: number }>;   // per template code
tiers: Record<Tier, { colleges: number; located: number; cds_found: number; published_c1: number; cost_usd: number }>;
batches: Array<{ id: string; requests: number; submitted: string; ended: string | null; succeeded: number;
                 errored: number; expired: number; reserved_usd: number; cost_usd: number }>;
projection: { full_run_usd: number; basis: string };   // per-tier and per-type cost × the full counts
```
There is also one line per model call in `data/reports/college-reported-calls-<run>.jsonl`: college, job, model, mode,
document type, call, estimated vs actual input tokens, output tokens, stop reason, and cost. It lets the token estimate
behind reservations be checked and the console's bill be matched. The pilot logged $80 against ~$98 billed; batch ids
make that reconcilable.

**The first run on round-3 code** is two runs, estimated at **$4–10** together:
- **`--pilot --rediscover --max-cost 10`.** `--rediscover` matters: 35 of the 50 pilot colleges already have recipes,
  so without it the run measures almost no discovery. With it, each college climbs the ladder from step 0, and the old
  recipe says whether the free probes found the same link.
- **`--sample 60 --tiers less,open --max-cost 5`**: a stratified random sample of the two big tiers. The pilot has
  only 20 of their 1,644 colleges.

What to read in their summaries before the full run:

| Read | Go ahead if | Otherwise |
|---|---|---|
| `discovery`: share found at steps 0–1, by tier | ≥ 40% of very selective + selective, ≥ 25% of less selective | Add probe patterns from the misses before spending on steps 3–4 |
| Cost per college at steps 2, 3, 4 | Within the step's range above | Re-estimate; tighten step 3 (one search) |
| `documents`: share of each type | Deterministic types ≥ 10% | Re-estimate extraction cost (all the arithmetic below assumes ~20%) |
| `pdf-flat` input tokens per document and output per call | ≤ 45 K in; ≤ 4 K (`C`) and ≤ 8 K (`rest`) out | Revisit the code table's size and line ids |
| `split_fallback` share | < 10% of flattened PDFs | Improve the C/D markers |
| `grid_rows_undecided` | < 2% of grid rows | Turn on the vision last resort, or improve the layout pass |
| `cache_read_tokens` share of the static prefix | ≥ 25% | Remove the cache marker |
| Estimated vs actual input tokens (calls file) | Within 20% | Use `countTokens` for reservations |
| `items`: failure share per code | < 20% each | Fix that item's label, normalization, or check |
| Howard (form PDF) and the four template workbooks | Every in-scope code read with no model call | Fix the readers before the full run |
| `batches`: time to `ended` | Under the run job's limit | Rely on the collect job |
| `projection.full_run_usd` | ≤ the planned cap | Raise the cap or narrow the tiers (open question 4) |

## Extraction scope
Filled from the CDS inventory (2026-10-03). Codes are from the 2025–26 template; years are for the 2025–26 edition.

**Column keys:**
- **Det.**: read with no model from a 2025–26 template workbook or a fillable form PDF. Yes for every row: those two
  types carry every code.
- **Model**: whether the item is in the model schema for flattened PDFs, older Excel, and HTML. "x" means the layout
  pass must place a mark or lone value by x position.
- Owning specs are in [data-expansion](data-expansion/README.md) unless linked elsewhere; several are being written now.

| Item | Codes | Owner | Det. | Model | Checks | Year it describes |
|---|---|---|---|---|---|---|
| A0–A6 general information | A.001–A.601 | store-only | yes | no | — | edition |
| B1 enrollment (level × FT/PT × first-year/other × sex) | B.101–B.178 | [cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md) | yes | yes | Parts sum to row and column totals ±1; total undergraduates within 10% of federal enrollment | Fall 2025 |
| B2 race/ethnicity (first-year, degree-seeking, all) | B.201–B.230 | [cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md) | yes | yes | Each column sums to its total ±1; column 3 total = B1 total undergraduates (UIUC fails: non-degree only) | Fall 2025 |
| B3 degrees conferred | B.301–B.309 | store-only | yes | no | — | 2024–25 |
| B4–B11 graduation by Pell / subsidized loan / neither | B.401–B.532 | [cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md) | yes | yes | Final = initial − exclusions; completers ≤ final; rate = completers ÷ final ±0.5 pt; within ±5 pts of the federal rate one cohort older | Fall 2019 cohort (B4 block), Fall 2018 (B5 block) |
| B12–B21 (programs under 4 years) | B.1201–B.2102 | store-only | yes | no | — | blank at 4-year colleges |
| B22 retention | B.2201–B.2203 | [cds-student-body-and-outcomes.md](data-expansion/cds-student-body-and-outcomes.md) | yes | yes | Cohort is a whole count (Vanderbilt typed 0.97); retained ÷ cohort = stated rate ±0.5 pt | Fall 2024 cohort, enrolled Fall 2025 |
| C1 totals, by sex and FT/PT | C.101–C.118 | [college-reported-data.md](college-reported-data.md) (built) | yes | yes | The seven C1 checks; sex rows sum to totals (UIUC swapped two cells); a total printed "##" is summed from its parts | Fall 2025 |
| C1 by residency (in-state, out-of-state, international, unknown) | C.119–C.130 | [cds-residency-admissions.md](data-expansion/cds-residency-admissions.md) | yes (cross-check the code table against the visible grid: UIUC's code cells are misfiled while its grid is consistent) | yes (x: an empty cell) | Per column admitted ≤ applied, enrolled ≤ admitted; columns sum to the C1 total ±1% (Georgia Tech is off by 1) | Fall 2025 |
| C2 wait list | C.201–C.207 | [cds-admissions.md](data-expansion/cds-admissions.md) | yes | yes | Admitted ≤ accepted a place ≤ offered | Fall 2025 |
| C3–C5 diploma, prep program, units by subject | C.301–C.524 | [cds-application-logistics.md](data-expansion/cds-application-logistics.md) | yes | yes (x: required and recommended columns) | Subject units ≤ total; lab ≤ science; recommended ≥ required | policy at the edition's date |
| C6 open admission | C.601–C.604 | store-only | yes | no | — | edition |
| C7 factors (18 + text) | C.701–C.719 | [cds-admissions.md](data-expansion/cds-admissions.md); religious row: [religious-life.md](religious-life.md) | yes (words or `VI/I/C/NC`) | yes (x) | Exactly one level per factor | Fall 2025 class |
| C8A–C8D, C8F test policy and its text | C.801–C.804, C.8D, C.8F | [cds-test-scores-and-policy.md](data-expansion/cds-test-scores-and-policy.md) | yes | yes (x) | One column per row; the "SAT or ACT" row agrees with C8F text when present | **students applying for Fall 2027** |
| C8E latest test date, C8G placement tests | C.8E01–C.8E02, C.8G01–C.8G07 | store-only | yes | no | — | edition |
| C9 submitting (% and number), percentiles (SAT composite, EBRW, Math; ACT composite and sections), score bands | C.901–C.987 | [cds-test-scores-and-policy.md](data-expansion/cds-test-scores-and-policy.md) | yes | yes (x: bands with blank columns) | 25th ≤ 50th ≤ 75th; ranges; section 75ths sum ≥ composite 75th − 20; each band column 100% ±1; number submitting ÷ C1 enrolled ≈ % submitting (Eau Claire fails); within 50 SAT points of federal | Fall 2025 |
| C10 class rank | C.1001–C.1006 | [cds-admissions.md](data-expansion/cds-admissions.md) | yes | yes | Top 10% ≤ top 25% ≤ top 50%; 0–100 | Fall 2025 |
| C11 GPA bands (submitted tests / didn't / all) | C.1101–C.1130 | [cds-admissions.md](data-expansion/cds-admissions.md) | yes | yes (x: lone values, or the "Totals" row) | Each column 100% ±1 | Fall 2025 |
| C12 average GPA, share submitting | C.1201–C.1202 | [cds-admissions.md](data-expansion/cds-admissions.md) | yes | yes | 0–5; above 4.0 sets `weighted` (William & Mary 4.34, Harvard 4.22, Georgia Tech 4.17) | Fall 2025 |
| C13 fee, waiver, online fee | C.1301–C.1305 | [cds-application-logistics.md](data-expansion/cds-application-logistics.md) | yes | yes | Fee ≥ 0; text ("$50/$75") kept as text | Fall 2026 application cycle |
| C14 closing and priority dates | C.1401–C.1405 | [cds-application-logistics.md](data-expansion/cds-application-logistics.md) | yes | yes | Valid month/day; regular closing after ED/EA closing | Fall 2026 cycle (as C13; confirm per item) |
| C15 terms other than fall | C.1501 | store-only | yes | no | — | edition |
| C16 notification | C.1601–C.1608 | [cds-application-logistics.md](data-expansion/cds-application-logistics.md) | yes | yes | Valid date (Excel serials converted) | Fall 2026 cycle |
| C17 reply date, housing deposit | C.1701–C.1712 | [cds-application-logistics.md](data-expansion/cds-application-logistics.md) | yes | yes | Reply on or after notification; deposit ≥ 0 | Fall 2026 cycle |
| C18 deferral (gap year) | C.1801–C.1802 | [cds-application-logistics.md](data-expansion/cds-application-logistics.md) | yes | yes | "Yes or No" placeholder = blank | policy at the edition's date |
| C19 early admission of high-school students | C.1901 | store-only | yes | no | — | edition |
| C21 early decision | C.2101–C.2112 | [cds-admissions.md](data-expansion/cds-admissions.md) | yes (Cornell: cross-check the form) | yes | ED admits ≤ ED applications ≤ C1 applicants; ED admits ≤ C1 admits; dates valid | counts Fall 2025; dates as printed |
| C22 early action | C.2201–C.2206 | [cds-admissions.md](data-expansion/cds-admissions.md) | yes | yes | Dates valid | as printed |
| D1–D5 transfers: enrolls, applied/admitted/enrolled by sex, terms, minimum credits, required materials | D.101–D.506 | [cds-transfer.md](data-expansion/cds-transfer.md) | yes | yes (x: D5 grid) | D2 admitted ≤ applied, enrolled ≤ admitted; total = sum by sex; enrolled within 25% of federal new transfers | Fall 2025 |
| D6–D7 minimum high-school and college GPA | D.601, D.701 | [cds-transfer.md](data-expansion/cds-transfer.md) | yes | yes | 0–5; "No minimum required" and "N/A" = blank | policy at the edition's date |
| D9 transfer dates by term | D.901–D.936 | [cds-transfer.md](data-expansion/cds-transfer.md) | yes | yes | Valid month/day | next cycle (as C14) |
| D8, D10–D22 other transfer policies | D.801, D.1001–D.2201 | store-only | yes | no | — | edition |
| E1 special programs | E.101–E.120 | [cds-academics.md](data-expansion/cds-academics.md) | yes | yes | Store "offered" only; blank ≠ no (Cornell leaves study abroad blank) | 2025–26 |
| E3 required coursework areas | E.301–E.314 | [cds-academics.md](data-expansion/cds-academics.md) | yes | yes | — | 2025–26 |
| F1 out of state, Greek, housing, age | F.101–F.116 | [greek-life.md](greek-life.md) (Greek), [residence.md](data-expansion/residence.md) (out of state), [housing-and-policies.md](data-expansion/housing-and-policies.md) (housing); age store-only | yes | yes (x: Michigan prints one column) | 0–100 after normalizing ("0.61" at Howard is 0.61%; "1%%") | Fall 2025 |
| F2 campus ministries | F.201 | [religious-life.md](religious-life.md) | yes | yes | — | 2025–26 |
| F2 other activities | F.202–F.221 | store-only | yes | no | — | 2025–26 |
| F3 ROTC | F.301–F.307 | store-only | yes | no | — | 2025–26 |
| F4 fraternity/sorority housing | F.408 | [greek-life.md](greek-life.md) | yes | yes | — | 2025–26 |
| F4 other housing types (gender-inclusive appears only as "Other" text) | F.401–F.407, F.409–F.414 | store-only | yes | no | — | 2025–26 |
| G0 net price calculator, "costs not final" flag and date | G.001–G.003 | [cds-cost-and-debt.md](data-expansion/cds-cost-and-debt.md) | yes | yes | A not-final flag (UIUC) holds G1 out of publishing | 2026–27 |
| G1 tuition, fees, food and housing (first-year and undergraduate columns) | G.101–G.120 | [cds-cost-and-debt.md](data-expansion/cds-cost-and-debt.md) | yes | yes | Tuition ≥ 95% of the latest federal tuition; first-year and undergraduate may differ (Michigan); Purdue's workbook has three campus G sheets: take the one matching the unit | 2026–27 |
| G2 credits covered by full-time tuition | G.201–G.202 | store-only | yes | no | — | 2026–27 |
| G3–G6 tuition variation, share paying more, other expenses, per-credit charges | G.301–G.605 | [cds-cost-and-debt.md](data-expansion/cds-cost-and-debt.md) | yes | yes | Share 0–100; "varies"/"XXXXX" kept as text or blank | 2026–27 |
| H0 aid year and methodology (FM/IM; formerly H3) | H.101–H.104 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes (x: the year mark sits under one of two column labels) | Aid year parses ("2024-2025 Final", "2025-2026 Estimate"; estimated this year at 6 of 14, final last year at 6, Spelman blank, Howard "2023"); at most one methodology | read from H.101 |
| H1 aid dollars by source, need and non-need | H.105–H.127 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes | Rows sum to "Total Scholarships/Grants" ±$1 K | aid year (H0) |
| H2 need-based aid, lines A–M, first-year / all full-time / part-time | H.201–H.239 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes | B ≤ A, C ≤ B, D ≤ C, E–H ≤ D; J ≥ K and K×E + L×F ≤ 1.05 × J×D (J also holds non-need grants, so "J ≈ K + L" fails valid files at William & Mary and Howard); % met 0–100 | aid year (H.101) |
| H2A non-need aid, including athletic (P/Q) | H.2A01–H.2A12 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes | Counts ≤ H2 line A; averages ≤ G1 cost of attendance | aid year (H0) |
| H4 graduates who began as first-time students | H.401 | [cds-cost-and-debt.md](data-expansion/cds-cost-and-debt.md) | yes | yes | ≤ B1 total undergraduates | class of 2025 |
| H5 borrowing: any / federal / institutional / state / private × number, %, average principal | H.501–H.515 | [cds-cost-and-debt.md](data-expansion/cds-cost-and-debt.md) | yes | yes | Each number ≤ H4; any ≥ each source; average principal ×0.5–×2 of Scorecard median debt | class of 2025 |
| H6 aid to international students | H.601–H.606 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes | Average × number ≈ total ±5%; average ≤ G1 cost of attendance | aid year (H0) |
| H7 forms for international students; H8 forms required (CSS Profile, noncustodial profile, …) | H.701–H.808 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes (x: Harvard's PDF separates the H8 marks from their labels) | FAFSA checked at a Title IV college (flag if not); CSS Profile or own form ⇒ institutional methodology, inferred only (Cornell and Vanderbilt leave the methodology blank) | next cycle |
| H9–H11 aid deadlines, notification, reply | H.901–H.1103 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes | Valid dates; reply on or after notification | next cycle |
| H12–H13 loan and grant programs offered | H.1201–H.1309 | store-only | yes | no | — | edition |
| H14 criteria for institutional aid (non-need and need) | H.1401–H.1419 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md); religious rows H.1409, H.1418: [religious-life.md](religious-life.md) | yes | yes (x: two-column grid) | Each mark in one column | aid year (H0) |
| H15 recent aid policy changes (text) | H.1501 | [cds-financial-aid.md](data-expansion/cds-financial-aid.md) | yes | yes | Kept as quoted text | edition |
| I-1 instructional faculty | I.101–I.130 | store-only | yes | no | — | Fall 2025 |
| I-2 student-to-faculty ratio | I.201–I.203 | [cds-academics.md](data-expansion/cds-academics.md) | yes | yes | Ratio = students ÷ faculty ±0.5; shown as the college's own figure, **not** gated on the federal ratio (definitions differ: Harvard 11 vs federal 7) | Fall 2025 |
| I-3 class sections and subsections by size | I.301–I.316 | [cds-academics.md](data-expansion/cds-academics.md) | yes | yes | Seven bins sum to the total ±1 | Fall 2025 |
| J degrees by field | J.101–J.220 | store-only | yes | no | Each level's column sums to 100% ±1 | 2024–25 |

**Totals:** 1,105 codes; **766 in the model schema** (263 in `C`, 503 in `rest`); 339 store-only, read only when the
document is a template workbook or form PDF.

## Build order before the full run
The owner's requirement is that every CDS ingestion idea is built **before** the 1,893-college run, so that no document
is ever visited again. What a later spec adds must come from the records and the archive.

**Must exist before the full run**, in build order:
1. **The archive and manifest** (Decision 1): the private repo, the token scope, `archive.mts`, `data/college-docs.json`,
   the archived line text, and `npm run archive-doc`.
2. **The template table** `data/reference/cds-template-2025-26.json` (1,105 codes, PDF tags, labels, value types, year
   rules, owner, which call).
3. **Deterministic readers keyed by code**: the template-workbook reader (code tables, then the ANSWER SHEET, then the
   form-vs-code cross-check) and the form-PDF reader (annotations → tags → codes).
4. **Layout-aware text** for flattened PDFs (rows by y, `@x`, definitions dropped, numbered lines, edition from the cover
   or items, C/D split). Also older Excel with column letters and empty cells, and HTML with empty cells.
5. **Value normalization** (Decision 3) and **document-type detection** from bytes.
6. **The full code-keyed model schema** for both calls, covering every owned row of the scope table, with
   `schema_version`, line citations, and `max_tokens` sizing.
7. **Records** (`data/cds-records/`) with per-item status, years per item group, and `validateCdsRecords` in
   `check:lineage`.
8. **Checks:** the universal checks, C1's seven, the form-vs-code check, and the circuit breaker. The per-item checks in
   the scope table should exist too, but they can follow without revisiting: they re-judge stored records, and any
   escalation they trigger reads the archive.
9. **Batch** submit, collect, escalate, and resubmit; reservations; the projection guard; the `collect` job and draft
   PRs.
10. **Discovery:** free probes, share-link resolvers, the blocked-host list, the owner's list, the Haiku picker,
    search-only, tier ordering and budgets, back-off.
11. **Measurement**: the run summary and calls file. Then the two pilot runs, and their go/no-go table (Decision 11).

**Can follow later from the records**, with no visit to any college's site:
- every display spec in the scope table: field registration, merges into `school.reported.*`, and UI;
- per-item checks added after the run;
- store-only items promoted to owned (from the archive; $0 for deterministic documents, ~$9–16 per call for the rest);
- history backfill from prior editions, if open question 2 archives them;
- deterministic table parsing for a repeated HTML or older-Excel format.

## Expected cost after this round
All figures are estimates from token arithmetic, the prices above, and the inventory's sizes. None is measured until
the pilot.

### Per college, by discovery path
| Path | Interactive | With batch where possible |
|---|---|---|
| Known, guessed, manual, free probe | $0 | $0 |
| Haiku picker | $0.005–0.01 | $0.003–0.005 |
| Search only (+ picker) | $0.05–0.08 | same (not batched) |
| Full Sonnet discovery | $0.08–0.15 | same |
| Pilot, round-1 code (measured) | $1.34 per discovery call; $1.60 per college overall | — |

### Per document, by type and model
Model-read documents assume ~25 K tokens of numbered layout text plus ~13 K of instructions and code table over two
calls, and ~7 K output tokens with line ids (~16 K with written quotes).

| Type | Haiku 4.5 interactive | Haiku 4.5 batch | Sonnet 5 batch (for comparison) |
|---|---|---|---|
| 2025–26 Excel template | $0 | $0 | — |
| Fillable PDF form | $0 | $0 | — |
| Flattened PDF | ~$0.07–0.10 | **~$0.035–0.05** | ~$0.08–0.11 |
| Older or custom Excel | ~$0.06–0.09 | ~$0.03–0.045 | — |
| HTML CDS (~14–18 K tokens) | ~$0.06–0.09 | ~$0.03–0.045 | — |
| + checkbox vision, last resort (expected unused) | +$0.004–0.012 | +$0.002–0.006 | — |
| Scanned PDF (none in the sample; 45–200 K tokens, assumption) | ~$0.10–0.25 | ~$0.05–0.12 | — |
| Class-profile page (5–15 K tokens) | ~$0.01 | ~$0.005 | — |
| Flattened PDF, written quotes, no batch | ~$0.12 | — | — |
| One escalated call (Sonnet 5) | ~$0.08 | ~$0.04 | — |

For comparison, the first draft of this spec assumed 45 K-token documents read in five calls at ~$0.044 a document in a
batch. Smaller documents but wider output (766 codes, ~450 filled) land at about the same per-document cost.

### The first full run (1,893 colleges)
Estimated, by tier.
- The shares reaching each ladder step and publishing a CDS are guesses anchored on the answer-key hit rates; the pilot
  replaces them.
- Document types are assumed at ~15% template workbooks, ~5% form PDFs, ~65% flattened PDFs, ~5% older Excel, ~7% HTML,
  and ~3% scanned. The sample, weighted to selective colleges, had 21% / 5% / 53% / 11% / 11% / 0%. So ~20% are read for
  $0 and ~590 of ~740 documents are model-read.

| Tier | Colleges | Reach step 2 / 3 / 4 | Discovery | CDS files (assumed share) | Extraction (batch) |
|---|---|---|---|---|---|
| Very selective + selective | 249 | 45% / 30% / 10% | ~$9 | ~224 (90%) | ~$8 |
| Less selective | 769 | 65% / 50% / — | ~$32 | ~385 (50%) | ~$13 |
| Open admission | 875 | 90% / — / — | ~$8 | ~131 (15%) | ~$4 |
| Scanned PDFs, class profiles, escalations | | | | ~22 scanned; ~250 pages; ~90 calls | ~$7 |
| **Total** | 1,893 | | **~$50** ($25–95) | ~740 | **~$32** ($20–55) |

**First full run: ~$80, range $45–150.** That total is unchanged from the first draft; its parts moved (see below).
- Recommended: `--max-cost 150` with the projection guard (Decision 5). That makes it one run in dollars; in time it may
  span the run job plus one or two collect jobs.
- The low end assumes free probes find most selective colleges and search costs $0.05. The high end assumes free probes
  find a fifth as much and search costs $0.10.

For comparison:
- Round 2 estimated **$120–220** for discovery alone, reading only C1, capped at $150, so taking two runs.
- The pilot measured **$80 for 50 colleges**.
- Round-2 code extended to this scope without these changes would cost **~$210–310**: round 2's discovery estimate plus
  ~740 documents at ~$0.12.

### Where the saving comes from (first full run, against round-2 code extended to the full scope)
| Change | Estimated saving | Basis |
|---|---|---|
| Per-tier budgets: open-admission colleges get free steps and a picker, no search | $50–95 | 875 × ($0.065–0.12 for search or full discovery − ~$0.01 picker) |
| Free probes before any model call | $26–48 | ~400 of the remaining 1,018 colleges located at $0 instead of $0.065–0.12 |
| Batch API for extraction and pickers | $25–30 | 50% of ~$55–60 |
| Search-only + picker instead of search-and-fetch Sonnet | $14–32 | ~460 colleges × $0.03–0.07 |
| Quotes cited by line | ~$11 | ~590 model-read documents × ~$0.02 (9 K fewer output tokens, 5 K more input) at batch prices |
| Deterministic template and form readers | ~$6 | ~150 documents at $0 instead of ~$0.04 |
| Definitions pages dropped | ~$2.5 | 8.4 K tokens × 590 documents × $0.50/M |
| Store-only codes kept out of the model schema | ~$3–5 | 339 codes' labels and outputs × 590 documents |
| Excel tried before PDF | ~$0 | No sibling Excel files in the sample; kept because each probe costs one request |
| The archive (later) | $80–300 per avoided re-run | A schema addition costs ~$9–25 instead |

### Steady state
| Run | Estimate | Basis |
|---|---|---|
| Monthly, Dec–Jul | **under $5** | ~90 new CDS editions a month in Feb–Aug × ~$0.04; index re-checks are HTTP only |
| Weekly, Aug–Nov | **under $2** | 20–40 changed class-profile pages × ~$0.005, plus a few CDS files |
| Rediscovery | ~$5 a year | ~5% of ~1,000 working recipes break a year × ~$0.07–0.10 |
| A schema addition | ~$9 (`C`), ~$16 (`rest`), ~$25 (both) | Decision 10 |
| A year | **~$40–70** plus schema additions | Against the budget ceiling of $1.5–3 K ([college-reported-data.md](college-reported-data.md#cost-estimates-to-be-measured-in-the-pilot)) |

## Fixed in this round
Found while reading the current code and from the inventory.

| Where | Problem | Fixed by |
|---|---|---|
| `scripts/lib/college-reported/documents.mts:101-102`, `pipeline.mts:326-335` | A fillable PDF form (Howard) has a text layer of labels only, so it passes the 200-character "not scanned" test and the model reads a form with no answers. The pilot's extraction for Howard (131520) returned all nulls | Type detection and the form-field reader (Decision 3) |
| `documents.mts:76-99` (`pdfPages`) | Content-stream order separates values from their labels (Harvard C11, Baylor C21 "Yes 11/1 12/15 566 453") and drops every grid's column (C7, C8, D5, F3, H14) | Layout text (Decision 3) |
| `documents.mts:104,110-111` (`selectPages`) | Whole documents are sent only up to 30 pages, but every CDS PDF in the sample has 30–67 pages: a wide read would get anchor pages only | The body (definitions dropped) split at C/D replaces page selection for CDS files |
| `scripts/lib/cds-xlsx.mts:204-211` (`sheetText`), sent to a model at `pipeline.mts:322-324` | Drops empty cells and column letters (a lone C11 value or a C7 "x" can't be placed), and on template workbooks puts the visible form and the embedded code table on the same line | Template workbooks never go to a model; older Excel text keeps column letters and empty cells |
| `cds-xlsx.mts:96-101` | The comment "Codes aren't stable across colleges' files" is wrong for the 2025–26 template: 1,105 identical codes across colleges, matching the PDF form's field names | Code-keyed readers and schema |
| `documents.mts:42-61` (`htmlToText`) | MIT puts each `<td>` on its own line, so empty cells vanish and the "X" column is lost | Collapse whitespace inside `<tr>` before splitting lines |
| `scripts/import-cds.mts:125-126` | Race shares take the **last** B2 column as "all undergraduates"; at UIUC 2025–26 that column holds only 1,010 non-degree students | The code reader (`B.2xx` by column meaning) plus the B2 column-3 check |
| `pipeline.mts:494-502` | A failed discovery (timeout, error) records nothing, so every scheduled run retries it; colleges that keep failing spend discovery budget every week | Decision 7 back-off |
| `pipeline.mts:605` with `scripts/sync-college-reported.mts:69` | `--all` takes colleges in `data/schools.json` order, so the discovery budget goes by unit id, not by expected yield | Decision 7 ordering |
| `pipeline.mts:527-529` | After a re-discovery, `attempt(…, { force: true })` refetches without conditional headers and re-extracts **every** source, including ones read successfully moments before | Re-read only the documents the re-discovery added or changed |
| `pipeline.mts:505-508` | `none_found` is retried only with `--rediscover`, which scheduled runs never pass: a college that starts publishing is never found | Date-based retry (Decision 7) |
| `scripts/lib/college-reported/llm.mts:108-118` | Each continuation turn of a paused discovery is a new request carrying `max_uses: 4` for search and fetch. If the cap is per request (the skill doesn't say), one discovery can run up to 8 × 4 searches | Count uses across turns; lower `max_uses` on continuations; measured in the pilot |
| `scripts/lib/college-reported/models.mts:34-36` (only a warning at `sync-college-reported.mts:62`) | A model with no price is logged at $0, so the cost cap goes blind if a model id changes; there are no batch or 1-hour-cache prices | Refuse to run with an unpriced model; batch and TTL rates in the price table |
| `llm.mts:203` | The extraction system prompt (~700 tokens) is marked for caching but is under Haiku's 4,096-token minimum (and Sonnet 5's 1,024), so it never caches | The marker moves to the ~6–7 K static prefix, which qualifies (Decision 4) |
| `llm.mts:202` | `max_tokens: 4096` for every read (UCLA's C1 read hit it) | Per-call `max_tokens` sized from the schema and logged |
| `lib/reported-checks.ts:56-66` | Check 2 tests that the number is in its quote, not that the quote is in the document: an invented quote passes | Quotes cited by line (Decision 4) |
| `pipeline.mts:292-297`, `.github/workflows/college-reported.yml` (document cache step) | Re-reads rely on the Actions cache, which is evicted when unused (about 7 days, assumption), so escalation often refetches | The archive (Decision 1) |
| `college-reported.yml` (job `run`) | No `timeout-minutes`; at the pilot's pace (80 minutes for 50 colleges) a `--all` run can't finish inside one job | Phased runs and the collect job (Decision 5) |
| `scripts/lib/college-reported/http.mts:155` | No request timeout or size cap: one hanging host stalls a worker until the job ends | 60-second timeout, 50 MB cap per document |
| `data/college-sources.json` | Superseded editions stay in recipes (UCLA's 2019–20 section H PDF, Rutgers' 2023–24 CDS) and are re-requested every run | An index scan that finds a newer edition retires the older source from the recipe; it stays in the manifest |
| Edition detection | USC and Loyola print "Common Data Set 2024-2025" in the page headers of their 2025–26 files | Edition from the cover or item text, never headers (Decision 3) |

## What did not change
- The seven C1 checks and their tolerances.
- Newest-first display ([round 2](college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere)).
- The lineage guard on `data/schools.json` and `extracted` records.
- `data/college-reported.json` as C1's published file.
- `merge-reported`, and the data PR carrying `schools.json`.
- robots.txt, the 1-second per-host gap, the honest user agent, and never getting around bot protection.
- The schedule: weekly Aug–Nov, monthly Dec–Jul.
- Exit codes 0/1/2/3.
- The PR body, release note, and auto-merge rules.
- Opus is not called.

## Open questions for the owner
1. **Archive location.** Release assets in a new private repo (recommended, $0), or a private Supabase Storage bucket
   (likely the Pro plan within a year)? The main repo is public, so its own releases are ruled out.
2. **Prior editions.** Archive the older CDS editions linked on each index page? That is HTTP only, an estimated 4–10
   GB once (index pages list 10–25 past editions), and it lets history series be extracted later without another visit.
   Extracting them would be a separate decision: ~$0.035–0.05 per model-read edition, $0 for template workbooks and form
   PDFs.
3. **Records in git.** Commit `data/cds-records/` (~15–30 MB a year, reviewable diffs), or keep records in the archive
   and commit only published values?
4. **Open-admission colleges.** Free steps and a picker only (the default; 0 of 5 had a newer figure in the answer key),
   or also the search step (about +$50 on the first run)?
5. **First full run cap.** $150 (expected ~$80), after the pilot's projection?
6. **Manual list.** Will you maintain `data/reference/cds-urls.json` and drop files for blocked hosts (estimated
   100–150 colleges)?

(The first draft's question 7, vision for checkbox pages, is answered by the inventory: layout text places every grid
mark tested, so vision is a logged last resort, off by default.)

## Implementation plan
### Code, by file
- **`data/reference/cds-template-2025-26.json`** (new, generated once from the official template by
  `scripts/build-cds-template.mts`): 1,105 codes with tag, label, section, item, value type, call (`C`, `rest`, or
  `store`), year rule, and owner.
- **`lib/cds-sections.ts`** (new, pure) loads that table and holds:
  - the two model schemas with `schema_version` and `max_tokens`;
  - the year rules, including the H0 aid-year read;
  - normalizers per value type.
- **`lib/cds-checks.ts`** (new, pure): the universal checks, the form-vs-code check, and the per-item checks from the
  scope table. Returns failures per code.
- **`lib/reported.ts`**:
  - types for `DocumentRecord`, `ItemResult`, `CallRead`, and manifest entries;
  - `Recipe.discovery` (`path`, `tried[]`, `next_attempt`);
  - `ReviewItem.code`, `.edition`, and `.sha256`;
  - new `CheckId`s and the round-3 `RunSummary`.
- **`lib/lineage.ts`**: `validateCdsRecords(records, manifest, template)`, called by `npm run check:lineage`.
- **`scripts/lib/college-reported/archive.mts`** (new): `put`/`get` by sha256 (release assets through the GitHub API;
  local cache first), the line-text sidecar, and manifest read/write.
- **`scripts/lib/college-reported/doctype.mts`** (new): detects the document type from the bytes, sheets, and widgets.
- **`scripts/lib/college-reported/form-pdf.mts`** (new): the widget reader (`page.getAnnotations()`, PDF tag → code,
  radio export values).
- **`scripts/lib/college-reported/layout.mts`** (new, from the inventory's script):
  - rows by y and `@x` tags;
  - definitions dropped;
  - numbered lines;
  - edition from the cover or items;
  - C/D split with page hints;
  - grid placement;
  - older-Excel and HTML text with empty cells (and the `htmlToText` `<tr>` fix in `documents.mts`).
- **`scripts/lib/cds-xlsx.mts`**:
  - `readTemplate(book)`: code tables, then the ANSWER SHEET, then the visible-form cross-check;
  - `classicSheetText(sheet)` with column letters and empty cells;
  - `readC1` kept for older files;
  - the wrong "codes aren't stable" comment corrected.
  
  `import-cds.mts` moves to `readTemplate` for template workbooks, which fixes the B2 last-column bug.
- **`scripts/lib/college-reported/probe.mts`** (new): sitemaps from robots.txt, IR host and path patterns, the two-hop
  crawl, share-link resolvers, and the blocked-host list.
- **`scripts/lib/college-reported/batch.mts`** (new): request building, `custom_id`s, size splitting under 200 MB,
  reservations, submit, poll, collect, resubmit-once, and `data/college-batches.json`.
- **`scripts/lib/college-reported/llm.mts`**:
  - `pickLinks()` (Haiku);
  - `searchOnly()` (Sonnet, no fetch);
  - `extractCall()` (code-keyed, line-cited, cache marker on the static prefix);
  - `discover()` kept as step 4, with uses counted across turns.
- **`scripts/lib/college-reported/models.mts`**: batch prices and cache TTL rates; an unpriced model throws; per-call
  log rows.
- **`scripts/lib/college-reported/pipeline.mts`**:
  - per-document states: located → archived → typed → deterministic or laid out → pending → extracted → checked;
  - tier ordering, budgets, and back-off;
  - review keys per code;
  - re-read only changed documents after a re-discovery;
  - retire superseded sources;
  - fetch timeout and size cap.
- **`scripts/sync-college-reported.mts`**: `--phase prepare|collect|all`, `--tiers`, `--sample N`,
  `--reextract --call C|rest`, reservation-based `--max-cost`, and the projection guard.
- **`scripts/archive-doc.mts`** (new, `npm run archive-doc`): the manual document drop.
- **`.github/workflows/college-reported.yml`**:
  - `timeout-minutes: 330`;
  - a draft PR when batches are open;
  - a new `collect` job (cron every 30 minutes; exits at once with nothing pending);
  - the archive token scope.
- **Data:** `data/college-docs.json`, `data/cds-records/`, `data/college-batches.json`,
  `data/reference/cds-template-2025-26.json`, `data/reference/blocked-hosts.json`, `data/reference/cds-urls.json`,
  `data/reports/college-reported-calls-<run>.jsonl`.
- **Specs:**
  - [college-reported-data.md](college-reported-data.md): As built.
  - [college-reported-setup.md](college-reported-setup.md): the archive repo and token, the collect job, reading the
    new summary, the manual list.
  - [data-lineage.md](data-lineage.md): the records validator and years per item group.
  - [data-expansion/README.md](data-expansion/README.md): the CDS specs now read from records.
  - [cds-admissions.md](data-expansion/cds-admissions.md): the inventory's corrections on C11 coverage, weighted C12,
    C7 extraction, and code stability.

### Tests (each guard shown to fail when broken)
The fakes are as today (a fake fetch table and a fake client), plus a fake batch API (create, retrieve, results in
shuffled order) and a fake archive (an in-memory map). Fixtures are cut from the inventory's documents: a template
workbook, a Howard-style form PDF, a flattened PDF page with a C7 grid and with header-year traps, an older Excel sheet,
and an MIT-style HTML table.

1. **Read once:** a document read in run 1 is archived and listed. Run 2 at the same schema version sends no model
   request and fetches only index pages and conditional GETs. Break: drop the version comparison, and run 2 calls the
   model.
2. **A schema bump reads only the archive:** bumping `C`'s version yields one batch request per archived model-read
   document for `C` alone, with zero document fetches and zero discovery calls. Template and form documents are re-read
   with no model call.
3. **Template workbook:** every in-scope code is read with no model call. An empty code-table cell is filled from the
   ANSWER SHEET. A Cornell-style off-by-one C21 fails `form-vs-code`. A template workbook is never sent to a model.
4. **Form PDF:** a Howard-style fixture reads every filled widget into its code with no model call. The same fixture
   without the form reader would send labels only; type detection never sends a form PDF to a model.
5. **Layout text:** a C7 mark lands under the right header. A lone C11 value keeps its column. Definitions are dropped.
   The edition comes from the cover when the headers say the year before. Split digits are joined. "##" totals are
   summed from parts. Break: use plain `pdfPages` order, and the C7 test fails.
6. **Older Excel and HTML:** column letters and empty cells survive. An MIT-style row keeps its "X" column.
7. **Line-cited quotes:** the quote is built from the cited line. A number not on its line fails; a line id past the end
   fails; a model-written quote is ignored.
8. **Years:** H1 items take the aid year from `H.101`, C8 takes "applying for Fall 2027", and G takes 2026–27. A record
   missing a group's year fails the validator.
9. **Checks on deterministic reads:** 0.97 in a count cell, in-state admits above applicants, and a B2 column-3 total
   below B1 each fail, are never escalated, and don't count toward the breaker.
10. **Batch:** results out of order are keyed by `custom_id`. `errored` and `expired` requests are resubmitted once,
    then queued. A batch over the size limit is split. Prices are batch prices.
11. **Reservation cap:** a batch whose reservation would pass the cap is trimmed in tier order, and the trimmed
    documents stay archived. The projection guard stops a run before any model call.
12. **Free probes:** a sitemap entry, an IR host pattern, and a two-hop crawl each produce a recipe with no model call.
    Share links are rewritten and confirmed by magic bytes; an HTML answer is not accepted.
13. **Blocked hosts:** a 403 host is recorded. The next run spends nothing on a college whose candidates are all blocked
    and lists it. A `cds-urls.json` entry and an `archive-doc` file are used as step 0.
14. **Order and budgets:** with a discovery budget of N, colleges are tried in tier order. Open-admission colleges reach
    step 3 only with budget left.
15. **Back-off:** a failed discovery sets `next_attempt`, and the next run doesn't retry before it. Break: remove the
    date, and it retries.
16. **Per-item publishing and queue:** a failing H2 code doesn't stop C1 publishing. The queue holds one item per
    college + edition + code, and replacing one leaves the others.
17. **Escalation scope:** an escalation request contains only the failing call's pages and codes and goes to Sonnet 5.
    A `blank` item, a blocked document, or a deterministic-read failure never escalates.
18. **Breaker:** one code failing in more than 20% of 20+ model-read documents trips it. `unreachable`, `blank`, and
    deterministic-read failures never count.
19. **Records validator:** a passed value without a line or cell, a record whose sha256 isn't in the manifest, a missing
    item-group year, or an unknown `schema_version` fails `check:lineage`.
20. **Cost guard:** an unpriced model id stops the CLI before any call.
21. **Summary:** the summary has per-job, per-model, per-mode, and per-call usage; discovery paths; documents by type;
    items by code; tiers; batches; and a projection. The calls file has one line per model call.
22. **No refetch after re-discovery:** a source read successfully earlier in the run is not fetched or extracted again
    when a re-discovery adds another.

## As built
### Foundation (2026-10-03, branch `feature/cds3-foundation`)
The shared contract the pipeline tracks and the nine display specs build on: the template table, the record shapes,
the template-workbook reader, real records for the four template workbooks, and the records validator. Nothing here
calls a model or fetches anything.

**Template table** — `data/reference/cds-template-2025-26.json`, built by `scripts/build-cds-template.mts`:
```
npm run build-cds-template -- --workbook <2025-26 template workbook.xlsx> [--workbook …]
```
- Reads each workbook's ANSWER SHEET (code, US News PDF tag, question, the template's descriptors, value type) and
  the code tables of CDS-A … CDS-J, and takes the union of codes. Built from the inventory's Vanderbilt, Cornell,
  William & Mary and Illinois workbooks: **1,105 codes**, identical in all four.
- Each item: `code`, `tag`, `question`, `section`, `item` (from the code: "C.1201" → C12, "H.2A01" → H2A, "C.8D" → C8D;
  H.101–H.104 are H0; all of J is "J"), the template's `sub`/`category`/`group`/`cohort`/`residency`/`unit`/`gender`,
  `value_type`, `call` (`C`, `rest`, `store`), `owner` (spec slug or null), `also` (other readers, e.g.
  religious-life on C.715, H.1409, H.1418), and `year_rule`.
- `call`, `owner`, and `year_rule` come from the `SCOPE` table in the script: one row per line of the Extraction scope
  table above, as code ranges in template order, plus three small per-code tables (F1's owners by column, C21's and
  D2's counts on the fall rule, H.101 on the aid-year rule).
- `value_type` normalizes the template's own column (whose "Whole Number or Round to Nearest Tenth" holds SAT scores,
  GPA-band shares and ages alike) into a closed set: `count`, `percent` (stored 0–1), `currency`, `decimal`, `gpa`,
  `sat-section`, `sat-composite`, `act`, `act-writing`, `month`, `day`, `date` (one cell, stored "--MM-DD"), `yes-no`,
  `check`, `choice`, `text`, `url`. Per-code fixes are listed in the script's `CODE_TYPE`.
- Stored compact, one item per line (~390 KB).

**Totals against the spec.** `C` matches exactly (263). The table has **497** codes in `rest` and **345** store-only,
against the spec's 503 and 339: the six F1 age codes (F.106–F.108, F.114–F.116), which the scope table marks
"age store-only" while its totals count F.101–F.116 whole. Model total: 760, not 766. `tests/cds-sections.test.mts`
pins the difference to exactly those six codes.

**Year rules as built** (record `years` keys; labels for the 2025–26 edition): `edition` "2025–26", `fall` "Fall
2025", `test-policy-cycle` "Fall 2027 applicants" (C8A–D, C8F), `next-cycle` "Fall 2026 cycle" (C13–C14, C16–C18, D9,
H7–H11), `next-year` "2026–27" (G), `aid-year` from H.101 ("2024–25 final", "2025–26 estimated"; absent when H.101
doesn't parse), `graduating-class` "Class of 2025" (H4–H5), `cohort` "Fall 2019 cohort" (B4 block), `previous-cohort`
"Fall 2018 cohort" (B5 block), `retention` "Fall 2024 cohort to Fall 2025" (B22), `prior-year` "2024–25" (B3, J).
Where an owning spec is more specific than the scope table, the owner's rule was used, and the coordinator should
confirm: C18 on `next-cycle` (Decision 2 and cds-application-logistics.md; the scope table says edition); D1, D3–D8
on `edition` and D2 counts on `fall` (cds-transfer.md; the scope table says Fall 2025 for D1–D5); C21 counts on
`fall` and C21/C22 flags and dates on `edition` (cds-admissions.md); H14 on `edition` (cds-financial-aid.md; the
scope table says aid year); H.102–H.104 on `edition`.

**`lib/cds-sections.ts`** (pure, no imports): `CdsCode`, `CDS_CODE`, `CdsSection`, `CallKey`, `CallAssignment`,
`ValueType`, `YearRule`/`ItemGroupKey`, `TemplateItem`, `TemplateFile`, `TemplateTable`, `loadTemplate` (indexes by
code and by item; refuses malformed codes, unknown enums, owned store-only items, unowned model items),
`itemOfCode`, `compareCodes`; record shapes `DocumentType`, `ItemStatus`, `ItemFailure`, `ItemResult` (adds `form`:
the visible-form value kept beside a disagreeing code-table value), `CallRead`, `DocumentRecord`, `CollegeRecord`;
manifest shapes `ManifestEntry`, `CollegeDocsFile`; `parseEdition`, `AidYear`, `parseAidYear`, `ITEM_GROUPS`,
`yearsForEdition`; normalizers `Normalized`, `normalizeValue`, `isPlaceholder`, `readMark`, `parseNumber`, `MonthDay`,
`monthDay`, `formatMonthDay`; `typeFailure` (the universal type checks, check id `type-range`); `SCHEMA_VERSIONS`
(`C`: 1, `rest`: 1), `READER_VERSIONS` (`xlsx-template`: 1, `pdf-form`: 1), `maxTokensFor`, `codesFor`,
`storeOnlyCodes`, `schemaFor`, `codeTableText`. **`lib/cds-template.ts`** loads the table for server code and scripts
(`CDS_TEMPLATE`); client components never import it.

**`lib/cds-records.ts`** (pure): `editionFallYear`, `editionLabel`, `compareDocuments`, `indexRecords`, `passedItem`,
`newestPassed` (all/any modes, `maxEditionsBack`), accessors `itemValue`, `itemNumber`, `itemShare`, `itemBoolean`,
`itemText`, `itemMonthDay` (one cell, or a split month/day pair), `itemYear`, `lineageFromItem`, and
`validateCdsRecords`. `LineageRecord` (`lib/types.ts`) gained `edition`, `cell`, `field`; `validateSchool` accepts
`method: "derived"` on `reported.*` paths cited to `college-site`, with the same quote/url/retrieved/year requirement.

**Template-workbook reader** — `scripts/lib/cds-xlsx.mts`: `isTemplateWorkbook`, `readTemplate` (code tables, then
the ANSWER SHEET for empty codes, then the visible form's C1-by-sex, residency-grid and C21 rows against the code
table), `recordFromTemplate` (every template code normalized and type-checked; `form-vs-code`, `overflow-total` and
`aid-year` failures; cells on every value; "question | value" quotes ≤ 160 characters on owned items), `quoteOf`.
The edition comes from a "Common Data Set 2025-2026" cell, else I.201's "Fall 2025", else B.2202's text, else
G.002's (Illinois edited its G.002 sentence to say 2025-2026). The respondent's name, title, office, phone and email
(A.001–A.004, A.012, A.013) are recorded `not-read`: no spec shows them and the records are public. `readC1` and the
label readers are unchanged. `scripts/import-cds.mts` still reads by label: moving it to `readTemplate` means
rewriting every block it writes to `data/overrides.json` (and the B2 last-column fix with it), which the display specs
that supersede those overrides will do.

**Records and manifest** — `scripts/cds-records-from-workbooks.mts`:
```
npm run cds-records-from-workbooks -- --workbook <file.xlsx> --unit <unit_id> --url <url> [--retrieved YYYY-MM-DD]
```
writes `data/cds-records/<unit_id>.json` (via `scripts/lib/college-reported/records.mts`: `readRecords`,
`readRecord`, `serializeRecord`, `writeRecord`, `upsertDocument`, `readManifest`, `writeManifest`, `upsertManifest`;
fixed key order, newest document first, items in template order, one per line) and upserts the
`data/college-docs.json` entry (`archive: null` until the archive exists). Run on the inventory's four template
workbooks, retrieved 2026-10-03 (~90–100 KB a record):

| College | Passed | Blank | Failed | Not read | Failures |
|---|---|---|---|---|---|
| Vanderbilt (221999) | 693 | 405 | 1 | 6 | B.2201 cohort 0.97 (`type-range`) |
| Cornell (190415) | 611 | 485 | 3 | 6 | C.2101, C.2110, C.2111 (`form-vs-code`: the C21 table is one row off; the form says 10,057 applications, 1,889 admits) |
| William & Mary (231624) | 688 | 411 | 0 | 6 | — |
| Illinois (145637) | 756 | 339 | 4 | 6 | C.120, C.121, C.122, C.125 (`form-vs-code`: residency cells misfiled; the visible grid is consistent) |

Per-item checks (sums, order, Illinois's swapped C.111/C.112) were not applied by the foundation: see [Checks](#checks-2026-10-03-branch-feature-cds3-checks) below.

**Validator** — `validateCdsRecords(records, manifest, table)` runs in `npm run check:lineage`
(`scripts/check-lineage.mts`). Each rule is broken on purpose in `tests/cds-records.test.mts`.

**State files** (empty, typed in `lib/reported.ts`): `data/college-batches.json` (`BatchesFile`, `BatchEntry`),
`data/reference/blocked-hosts.json` (`BlockedHostsFile`, `BlockedHost`, `BlockedStatus`),
`data/reference/cds-urls.json` (`CdsUrlsFile`, `CdsUrlEntry`).

**Tests:** `tests/cds-sections.test.mts` (table totals and scope, year rules, every normalizer case, type checks, the
schema), `tests/cds-xlsx-template.test.mts` (an in-memory template workbook: ANSWER SHEET fill, Cornell's off-by-one
C21, an unparseable aid year, `readC1` unchanged), `tests/cds-records.test.mts` (helpers, lineage, every validator
rule, the four committed records' real values). `tests/citation-guards.test.mts` allows the template edition in
`lib/cds-template.ts`'s import path (the table is per template edition, not a data year).

### Archive and manifest (2026-10-03, branch `feature/cds3-archive`)
Build-order step 1, except the private repo itself (the owner creates it; setup in
[college-reported-setup.md §9](college-reported-setup.md#9-archive-repo-and-token)). Nothing here calls a model.

**`scripts/lib/college-reported/archive.mts`** — `createArchive(opts?)` returns an `Archive`:
`has(sha)`, `get(sha)` → bytes or null, `put(sha, bytes, ext)` → location string for the manifest's `archive`,
`putLines(sha, lines)` / `getLines(sha)` (any JSON, gzipped as `<sha>.lines.json.gz`; the layout reader owns its
shape). All async, all keyed by the sha256 hex of the bytes; `put` refuses bytes that don't hash to the key.
- **`local`** (default): `.cache/college-docs/archive/<sha>.<ext>`; location `local:<sha>.<ext>`.
- **`github-release`** (when `COLLEGE_DOCS_REPO` is "owner/name"; token `COLLEGE_REPORTED_TOKEN`, else
  `GITHUB_TOKEN`, else it throws): one release per month `docs-YYYY-MM` (created on first use; `docs-YYYY-MM.2`, …
  past `assetLimit`, default 1,000), asset `<sha>.<ext>`; location `gh:docs-2026-10/<sha>.pdf`. It lists every
  `docs-*` release's assets once per run, so a document uploaded in any earlier month is never uploaded again; `get`
  reads the local hot cache first, downloads otherwise (checking the hash) and caches. `fetch`, `now`, `apiBase`,
  `uploadBase` are injectable; the tests run it against a fake GitHub API.
- `priorEditionLinks(links, currentEdition, max?)`: older CDS editions from an index page's `findLinks` output, one
  per edition (Excel over PDF), newest first. Groundwork for `--archive-prior` (off by default, owner decision 2);
  the pipeline doesn't call it yet.

**`lib/cds-reads.ts`** (pure; imports only `lib/cds-sections.ts`):
- `callsNeedingRead(doc, versions = SCHEMA_VERSIONS, readerVersions = READER_VERSIONS)` → `ReadKey[]`
  (`"C" | "rest" | "deterministic"`). A type with a deterministic reader (template workbook, form PDF) is due only
  `deterministic`, when its stored reader version is older; it never gets a model call. Flattened and scanned PDFs,
  older Excel and HTML are due each call that is missing or stored at an older schema version. Class-profile pages:
  nothing (round 2's profile extractor). Same versions → `[]`: this is "never a model read at the same schema version"
  and "a schema bump reads only the archive".
- `needsFetch(entry | undefined, { etag, last_modified, lastChecked, today, indexChanged })` → `{ fetch: false }` or
  `{ fetch: true, reason: "new" | "index-changed" | "monthly", conditional: { etag?, last_modified? } }`: a URL not in
  the manifest is fetched; a known one gets a conditional GET only when its index's link set changed or a calendar
  month has passed since `lastChecked` (default: the entry's `retrieved`). `addMonth` clamps the day.
- `fetchOutcome(manifest, { status, sha256? })` → `"unchanged"` (a 304, or bytes whose sha256 is already listed),
  `"new-document"`, or `"failed"`.
- Manifest lookups: `findBySha(manifest, sha)`, `documentsOf(manifest, unit_id)` (newest edition first),
  `manifestEntryFor({ sha256, unit_id, url, final_url, kind, type, edition, edition_from, retrieved, bytes, pages,
  body_chars, definitions_from_page, sections, archive })` (drops null optional fields and a `final_url` equal to
  `url`; refuses a bad sha256, unit id, date, or size). Read/write stay `readManifest`/`upsertManifest` in
  `records.mts`.

**`npm run archive-doc`** — `scripts/archive-doc.mts` over `scripts/lib/college-reported/archive-doc.mts`
(`archiveDoc(opts)`, `sniffType(bytes, { file, kind })`, `addOwnerUrl(file, entry)`):
```
npm run archive-doc -- --college <unit_id> --file <path> --url <original url>
  [--kind cds|class-profile] [--edition 2025-26] [--retrieved YYYY-MM-DD] [--add-url] [--note "…"]
```
Hashes the file, sniffs its type from the bytes, puts it in the archive (the environment's backend), and upserts its
manifest entry (`retrieved` = the day added). A `xlsx-template` is read at once with `recordFromTemplate` into
`data/cds-records/<unit_id>.json` (the same items as `cds-records-from-workbooks`); other types wait for the
pipeline. The same bytes already listed for another college are refused; re-running is a no-op. `--add-url` adds
`{ unit_id, url, kind, note, added }` to `data/reference/cds-urls.json` unless already there. `sniffType` is minimal
until the readers track's `doctype.mts` lands (TODO in the code): `%PDF` with ≥ 10 filled widgets → `pdf-form`, under
200 characters → `pdf-scanned`, else `pdf-flat` (plus page count, characters, the definitions' first page, and the
cover's "Common Data Set 2025-2026" edition); `PK` → `xlsx-template` when `isTemplateWorkbook`, else
`xlsx-classic`; anything else `html` (`class-profile` for that kind). On the inventory it typed Howard `pdf-form`,
Duke, USC, Michigan and Spelman `pdf-flat` with edition 2025-26 from the cover (USC's headers say 2024-2025), Berkeley
`xlsx-classic`, William & Mary `xlsx-template`, MIT `html`.

**Not done here:** the pipeline doesn't call any of this yet (the integration track wires `needsFetch` →
`PoliteHttp.get` → `fetchOutcome` → `archive.put` → `manifestEntryFor`/`upsertManifest`, and `callsNeedingRead` for
`--reextract`); the four committed manifest entries keep `archive: null` (their bytes are in the inventory, not an
archive; re-running `archive-doc` on them with the repo set fills it); the workflow's env lines are written in the
setup spec, not applied.

**Tests:** `tests/cds-archive.test.mts`: local round trip, idempotent put and hash refusal; the gzip sidecar; backend
choice from env; the GitHub backend through a fake API (one upload, second put a no-op, a later month finds last
month's asset, get downloads once then hits the cache, sidecar round trip, a full release opens `.2`); `needsFetch`
and `fetchOutcome` cases, including a 28-day February; `callsNeedingRead` (same versions nothing, bumped C only C,
reader bump deterministic, the committed records due nothing); `priorEditionLinks`; `archive-doc` end to end on the
inventory's `wm.xlsx` into a temp data dir (skipped when the file is missing; `CDS_INVENTORY_DOCS` points elsewhere):
output passes `validateCdsRecords`, items equal the committed record, and the record fails it once its manifest entry
is removed. Changing `<` to `<=` in `callsNeedingRead` fails the version test.

### Discovery (2026-10-03, branch `feature/cds3-discovery`)
Build order step 10, minus the two model steps (the models track's `pickLinks` and `searchOnly`) and the wiring into
`pipeline.mts`'s main loop (the integration track). Everything is injected, so the ladder runs in tests with a fake
fetch and no model.

**`scripts/lib/college-reported/probe.mts`** — the free steps, HTTP only through `PoliteHttp`:
- `knownStep(http, { school, recipe?, manual? })` (step 0): the owner's entries for the college first, used with **no
  request** (the host may be blocked; share links rewritten); then the recipe's index pages re-scanned
  (`newSourcesFromIndex`); then `guessNextEditionUrls`, accepted only by the bytes. Paths `manual`, `known`, `guessed`.
- `probeStep(http, school, { limit? })` (step 1), stopping at the first CDS: **(a)** `Sitemap:` lines from the
  robots.txt `PoliteHttp` already fetches (else `/sitemap.xml`), sitemap indexes followed page-sitemaps first,
  gzipped sitemaps unpacked, `<loc>`s matched against `SITEMAP_HIT` (CDS and class-profile patterns); a CDS file is
  taken directly, else up to three CDS pages are fetched and scanned. **(b)** `IR_HOST_PREFIXES` (the 17 hosts) ×
  `IR_PATHS` (the 4 paths) on `collegeDomain(website)`; a host that doesn't resolve costs only its robots.txt attempt,
  and a host that redirects off itself (a catch-all) is left after one request. **(c)** The Scorecard website, then a
  two-hop crawl on the college's own domain, following links by `crawlScore` (CDS 5, institutional research 3, facts
  or data 1, anything else not followed). `PROBE_LIMITS`: 40 page requests per college in all (sitemaps 8, hosts 20,
  crawl 12; robots.txt once per host on top). Every HTML page fetched is returned as `pages` (its link list) for the
  step-2 picker.
- Pages are read with `sourcesFromPage(html, url)`: `newSourcesFromIndex`'s newest CDS/class-profile file links, plus
  CDS share links (a Box or Drive link whose text names the Common Data Set), resolved when no direct file is there.
  `documents.mts` gained `newSourcesFromLinks(links, existing)` (what `newSourcesFromIndex` now calls) so sitemap
  entries use the same edition logic.
- Share links: `rewriteShareLink(url)` (pure; Sheets → `export?format=xlsx`, Drive file → `uc?export=download&id=`,
  Drive folder → manual, Box `/s/` → `/shared/static/`, SharePoint/OneDrive → `download=1`), `confirmDocument(get, url)`
  (accepts only `%PDF` → pdf or `PK` → xlsx by `magicFormat(bytes)`; HTML back, a status, or robots.txt → `manual`),
  `resolveShareLink(get, url)`. Confirmed bytes come back in `prefetched` so the first read doesn't fetch them again.
- `freeSteps(http, manual)` returns `{ known, probe }` in the ladder's shape.

**`scripts/lib/college-reported/blocked.mts`** (pure): `blockedStatusOf(status, headers, head)` (401, 403, 405, 429,
and `challenge` from the body: Cloudflare, Incapsula, PerimeterX, DataDome, Akamai; or a 503 with `cf-mitigated`),
`recordBlocked(file, observations, today)` (first/last seen, unit ids, sorted by host), `isBlockedHost` (an entry
not seen for `BLOCK_STALE_DAYS` = 365 is tried again), `onlyBlockedCandidates({ recipe, answered }, file, today)` (the
blocked hosts when every candidate host is blocked: the recipe's documents and index pages plus every host that
answered steps 0–1 with a page or a refusal; a college with no candidates is not "blocked"). `404-to-tools` can't be
detected with one honest request, so only the owner enters it.

**`scripts/lib/college-reported/discovery.mts`** — the ladder and its rules (Decisions 6, 7, 10):
- `orderColleges(schools)`: `tierOf` rank, then `demographics.undergrad_enrollment` descending, then unit id.
- `stepsFor(tier, { pass, fullWithinYear })`: very selective and selective `[0,1,2,3,4]` (step 4 dropped when one ran
  in the last 365 days, from `discovery.tried`), less selective `[0,1,2,3]`, open admission `[0,1,2]`; the `leftover`
  pass gives open admission `[3]` and everyone else nothing.
- `STEP_ESTIMATE_USD` {2: 0.01, 3: 0.08, 4: 0.15}: a paid step starts only when the run's remaining discovery budget
  covers its estimate; the actual cost is then subtracted.
- `nextAttempt(tier, today)` (the next 1 February; a year on for open admission) and `shouldRetry(recipe, today,
  { unitId, manual, brokenIndex })`: an owner's link the recipe doesn't hold → yes; else not before
  `next_attempt`; else no recipe, no sources, `none_found`, or a broken index page. `none_found` alone no longer waits
  for `--rediscover`.
- `retireSuperseded(recipe, newSources)` → `{ keep, retire }`: same-kind sources whose edition is older than the
  newest new one (UCLA's 2019–20 section H, Rutgers' 2023–24); undated sources stay. The caller moves `retire` out of
  the recipe; the manifest keeps them.
- `documentsToReadAfterRediscovery(fresh, fetchedThisRun)`: only sources this run hasn't fetched (the
  `pipeline.mts:527-529` fix, test 22).
- `ladder(college, state, deps)` → `LadderResult { recipe, path, found, spent_usd, retired, blockedHosts,
  prefetched }`. Free steps find only with a CDS; a paid step's find is any source the model returns. It stops at the
  first find; at a paid step when every candidate host is blocked (path `blocked`, nothing spent); when the budget
  can't cover the next step; or when a paid step throws (timeout, refusal), which backs off instead of climbing to a
  dearer step. Every attempt is a `discovery.tried` row (`step`, `via`, `at`, `result`, `detail`, `cost_usd`; newest 20
  kept). No find → `next_attempt` set, and `none_found` when the recipe has no sources. `state.budget` and
  `state.blocked` are updated in place.
- `discoverAll(colleges, state, deps, { manual, openAdmissionLeftover })`: `shouldRetry` filter, `orderColleges`
  order, one ladder each; then the leftover pass (step 3 for open-admission colleges still without a document while
  the budget lasts; `openAdmissionLeftover: false` gives the owner's "open admission 0–2 only"). Returns `results`,
  `listed` (blocked colleges for the PR body) and `spent_usd`. Sequential.

**`http.mts`**: `REQUEST_TIMEOUT_MS` (60 s, headers and body together, via `AbortController`) and `MAX_DOCUMENT_BYTES`
(50 MB; a `Content-Length` over it is refused unread, a streamed body is cancelled when it passes it) throw
`HttpLimitError` (`limit: "timeout" | "size"`), which `readSource` already records as `unreachable`. Bodies are
buffered inside the per-host queue, so `arrayBuffer()` on a returned Response never hangs; the final URL after
redirects is kept on `res.url`. `parseRobots` keeps `Sitemap:` lines (`sitemaps(url)`), and every refusal is kept for
`blockedSeen()`. Both limits are `HttpDeps` options for tests.

**`lib/reported.ts`**: `Recipe.discovery?: RecipeDiscovery` (`path: DiscoveryPath`, `tried: DiscoveryAttempt[]`,
`next_attempt?`), with `DiscoveryPath` = `known | guessed | manual | probe-sitemap | probe-host | probe-crawl | picker |
search | full | blocked | none`.

**Not wired yet (integration track):** calling `discoverAll`/`ladder` from `pipeline.mts` in place of
`guess`/`learn`; writing `recordBlocked(…, http.blockedSeen(), today)` to `data/reference/blocked-hosts.json` and
reading `data/reference/cds-urls.json`; the PR body's blocked list; applying `retired` to the manifest; using
`documentsToReadAfterRediscovery` at `pipeline.mts:546`; the `prefetched` bytes. Steps 2 and 3 come from the models
track; step 4 is round 2's `discover`, adapted to `PaidFind`.

**Tests:** `tests/cds-discovery.test.mts`: 12 (a sitemap index → CDS page, a CDS file in a sitemap, an IR host
pattern, a two-hop crawl, the request budget, every share-link rule, magic-byte confirmation and an HTML answer
refused, a Box link on an IR page), 13 (a 403 host recorded, nothing spent and the college listed in that run and the
next, per-host blocking, challenge bodies, the owner's list as step 0 with no request), step 0's index re-scan with a
superseded edition retired and a guess confirmed by bytes, 14 (order, per-tier steps, a small budget spent in tier
order, open admission's step 3 only in the leftover pass, a paid find's cost), 15 (dates; a failed paid step sets
`next_attempt` and doesn't climb; removing the date makes it retry), 22, and the timeout and both size-cap paths.

### Models, batches, and the collect job (2026-10-03, branch `feature/cds3-models`)
Build order steps 6 and 9 on the API side, plus the measurement types of step 11. Clean functions only: the pipeline
(`pipeline.mts`) and the CLI (`--phase`) are wired by the integration track. API facts were re-checked against the
claude-api skill on 2026-10-03 (Message Batches, structured outputs, prompt caching, pricing): batches are 50% off every
token **including cache reads and writes**; Opus 5.5's cache reads are 0.05× ($0.20/M), not 0.1×; an errored batch
result whose `error.error.type` is `invalid_request_error` is the request's own fault. Still silent, so still
assumptions: the custom_id limit (taken as `^[A-Za-z0-9_-]{1,64}$`), whether the schema counts as input tokens (the
estimate leaves it out; the calls file will tell), and whether the batch discount applies to searches (taken as no).

**Prices** — `scripts/lib/college-reported/models.mts`: `MODEL_PRICES` lists Haiku 4.5, Sonnet 5 and Opus 5.5 with
`interactive` and `batch` rates (input, output, 5-minute and 1-hour cache writes, cache reads). `costOf(model, usage,
{ mode })` splits cache writes by TTL when the response says so. An unpriced model **throws** `UnpricedModelError`
(`priceOf`, `assertPriced`); `scripts/sync-college-reported.mts` calls `assertPriced()` before anything else and exits 1
with the message, replacing round 2's warning-and-$0. `MIN_CACHE_PREFIX` holds each model's cacheable minimum (Haiku
4,096; Sonnet 5 1,024).

**Call log and summary** — `CallLog`, `UsageRow`, `RunSummaryV3` (with `CallJob`, `CallMode`, `DiscoveryPath`,
`DocumentTypeCounts`, `ItemCounts`, `ReportedTier`, `TierCounts`, `BatchSummaryRow`, `CostProjection`) in
`lib/reported.ts`. `RunSummaryV3 extends RunSummary` and only adds fields: Decision 11's `usage[]` is `usage_rows`
because round 2's `usage` record stays (the PR-body script sums it), and `addCall` keeps that record whole by counting
picker and search under `discovery` and vision under `extraction`. `ROUND3_MODELS` names the model per job (picker and
vision Haiku 4.5; search, discovery, escalation Sonnet 5; extraction Haiku 4.5). In `models.mts`: `callLogRow`,
`CallLogWriter` with `fileCallLogWriter(reportsDir, run)` (appends to `data/reports/college-reported-calls-<run>.jsonl`)
and `memoryCallLogWriter()`, `emptySummaryV3(run, started)`, `addCall(summary, row)`, `summaryCost`, and
`callRecorder(summary, writer)`, the `onCall` hook that does both.

**Model calls** — `scripts/lib/college-reported/llm.mts`:
- `buildExtractRequest(input)` → `{ params, chars, estimated_input_tokens, prefix_tokens, cached, codes }`, shared by
  interactive calls and batch requests. The system prompt is one block, the **static prefix**: `extractionInstructions
  (call)` plus `codeTableText(table, call)`, about 5.0 K estimated tokens for `C` and 10.1 K for `rest` (characters ÷
  3.5), marked `cache_control` (5-minute default; `cache: "1h" | "off"`) only when it reaches the model's minimum. The
  user turn is the document header and the numbered lines (`renderLines`: "--- Page N ---" markers, "412| text").
  Structured output is `schemaForCodes(table, call, codes)` (`schemaFor` narrowed), `max_tokens` is `maxTokensFor
  (call)`, Haiku gets no `thinking` and no `effort`. A code outside the call, or an unpriced model, throws before
  anything is sent.
- `parseExtractResponse(message, { call, codes, lines })` → `{ values: { code: { v, lines, quote } }, dropped,
  missing, truncated, stop_reason, usage }`. Codes not asked for are dropped and listed; `null`/empty values count as
  not found; quotes come from `quoteFromLines` over the cited lines, so a cited id that isn't a line gives no quote. On
  a `max_tokens` stop every whole entry before the cut is kept and only the unreturned codes are `missing`.
- `extractCall(ctx, input)` runs one interactive call and logs it; batched calls use `batch.mts`.
- `escalationInput(input)` / `escalateCall(ctx, { call, lines, failingCodes, pageRange, table, doc, mode })`: Sonnet 5,
  effort low, thinking left adaptive, only the lines on the call's pages, only the failing codes that belong to the
  call (the code table and schema shrink to them).
- `buildPickerRequest` / `parsePickerResponse` / `pickLinks(ctx, { college, links, mode })`: Haiku 4.5, links
  deduplicated and numbered, capped at ~4 K tokens; the answer is link **numbers** (`{ cds_index?, cds_file?,
  class_profile? }` as integers) mapped back to URLs, so the picker can't invent one.
- `searchOnly(ctx, school)` → `{ candidates: [{ kind, url }], none_found, searches }`: Sonnet 5, effort low,
  `web_search_20260209` only (no `web_fetch`), at most two searches **counted across `pause_turn` continuations**
  (each turn's `max_uses` is what is left), answered through a strict `save_candidates` tool. `searchOnlyParams`
  builds one turn.
- `discover()` is kept as ladder step 4 with uses counted across turns: `discoveryTools(left)` gives each continuation
  only the searches and fetches left (minimum 1, since the history holds the tool's earlier results), and once both
  are spent the loop asks for the recipe instead of resuming. It also emits call-log rows when `ctx.onCall` is set.
- `lib/cds-quotes.ts` (new, pure): `NumberedLine { id, page, text }` and `quoteFromLines(lines, ids)` (cited lines in
  order, joined with " / ", ≤ 160 characters). A minimal version: the readers track may own a fuller one with the same
  name and contract.

**Batches** — `scripts/lib/college-reported/batch.mts`, over a `BatchApi` slice that `new Anthropic().messages.batches`
fits:
- `customId({ unit_id, sha256, call, version, job })` → `u<unit_id>-<sha8>-<call>-v<version>` (escalations end in
  `-x`, pickers use call `pick`); `parseCustomId`.
- `buildRequests(docs: PendingDocument[])` (one request per call), `buildEscalationRequests`, `buildPickerRequests` →
  `BatchRequest { custom_id, params, job, unit_id, sha256, call, document_type, priority, chars,
  estimated_input_tokens, pdf_pages?, reserved_usd }`.
- `reserve(req)`: characters ÷ 3.5 × 1.2 (or pages × 3,000 × 1.2 for a scanned PDF) at the batch input price, plus
  `max_tokens` at the batch output price. A full `C` request reserves about $0.024 and `rest` about $0.047 before the
  document's own text.
- `splitBySize(requests, 200 MB, 100,000)`, `trimToCap(requests, spent, cap, priority?)` (whole documents, most
  important first; once one doesn't fit, everything after it is trimmed, so tier order is never skipped; trimmed
  documents are only returned, never touched in the archive), `openReservations(state)`.
- `submit(api, requests, state, { run, phase, now, resubmits })` (one batch per model and size chunk, entries appended
  to `BatchesFile`, which gained optional `resubmits` and `model`), `poll(api, id, { now, sleep, intervalMs, deadline })`
  (null at the deadline: the batch stays open for the collect job), `collect(api, entry, state, { now, ended, meta })`
  (results keyed by custom_id, classified `succeeded` / `errored` / `expired` / `invalid_request` / `canceled`, plus
  `absent` ids the stream never returned; succeeded results priced at batch rates into call-log rows; the entry leaves
  the state file, settling its reservation), and `resubmitOnce(collected, rebuild)` (errored, expired, canceled, and
  absent requests retried once; a second failure, an `invalid_request`, or one the archive can't rebuild is queued).
- `readBatches` / `writeBatches` / `hasOpenBatches` for `data/college-batches.json`.
- `projection({ documents, discovery, escalations, scale })` → `{ full_run_usd, run_usd, basis }` from
  `UNIT_ESTIMATES` (the high end of each range in "Expected cost"); `projectionGuard(projection, cap)` → stop with
  exit 3 and "projection $X exceeds the cap $Y" when this run's own `run_usd` is over the cap (a sample's
  `full_run_usd` is for the go/no-go table, not the guard).

**For the integration track** (what the CLI must do with these): call `projectionGuard` after prepare and before any
model call; build `PendingDocument`s from the archive's numbered lines and pass `trimToCap(buildRequests(...),
summaryCost(summary) + openReservations(state), maxCost)` to `submit`, writing `data/college-batches.json` after each
submit and collect; `poll` until `COLLEGE_REPORTED_POLL_UNTIL` (set by the workflow) and leave the rest open; on
`--phase collect`, `collect` every ended batch, parse with `parseExtractResponse`, add `collected.calls` through
`callRecorder`, push `collected.summary` into `summary.batches`, `resubmitOnce`, and submit escalations with
`buildEscalationRequests`.

**Workflow** — `.github/workflows/college-reported.yml`: `timeout-minutes: 330` on `run`; the draft PR when
`data/college-batches.json` lists open batches; the `collect` job (cron every 30 minutes and `mode: collect`); see
[college-reported-setup.md §9](college-reported-setup.md#9-batches-draft-prs-and-the-collect-job-round-3). Validated
by parsing with `js-yaml` and `bash -n` on all 22 `run:` blocks; it has not run in Actions.

**Tests:** `tests/cds-llm.test.mts` (the call's schema, codes, and `max_tokens`; no thinking on Haiku; the cache marker
on a prefix of at least 4,096 estimated tokens for both calls, and off below the minimum; unknown codes dropped and
logged; line-built quotes; a `max_tokens` cut; escalation's codes and pages on Sonnet 5; the picker's numbers;
search-only with no `web_fetch` and two searches across turns; discovery's uses across turns; test 20; batch vs
interactive and TTL prices; summary rows), `tests/cds-batch.test.mts` (custom_ids; reservations at batch prices; test
10: size split, out-of-order results keyed by custom_id at batch prices, errored and expired resubmitted once then
queued, invalid requests queued, a poll deadline; test 11: tier-order trimming of whole documents with the archive
untouched, open reservations against the cap, the projection guard stopping before any batch is created), and the
fake batch API in `tests/fixtures/fake-batch-api.mts` (create, retrieve, shuffled results, errored, expired, invalid,
and omitted entries).

### Readers (2026-10-03, branch `feature/cds3-readers`)
Build order steps 3–5 for the documents that aren't template workbooks: type detection from the bytes, the form-PDF
reader, layout-aware text, and line-cited quotes. Pure functions the pipeline and model tracks call; `pipeline.mts` and
`llm.mts` are unchanged.

**Type detection** — `scripts/lib/college-reported/doctype.mts`:
- `detectDocumentType(bytes, { sheets?, widgets?, textChars? })`: `PK` → `xlsx-template` when the sheets pass
  `isTemplateWorkbook`, else `xlsx-classic`; `%PDF` (within the first 1 KB) → `pdf-form` when any widget is filled,
  `pdf-scanned` under 200 text characters, else `pdf-flat`; anything else `html`. Missing evidence throws rather than
  guessing. `class-profile` stays the recipe's `kind`.
- `inspectPdf(bytes)` → `{ pages, textChars, widgets, filledWidgets }` (pdf.js `getAnnotations`); `widgetFilled`;
  `workbookFromBytes`; `typeOfDocument(bytes)` does all of it in one call.
- `DETERMINISTIC_TYPES` (`xlsx-template`, `pdf-form`) and `needsModel(type)`: the guard that a template workbook or a
  form is never sent to a model. `layoutDocument` refuses both types too.

**Form-PDF reader** — `scripts/lib/college-reported/form-pdf.mts`:
- `readFormWidgets(bytes)` → `FormWidget[]` (`widgetFromAnnotation`: text, checkbox "X" when on, radio with its own
  export and the group's value, choice lists); `formFields` groups radio buttons by field name (trims "ADMS_CONSIDER ").
- Field name → template `tag` → code. Radio exports go through `RADIO_WORDS` (by CDS item) to the words a template
  workbook's code table holds, so both readers give the same value: C7 `VI/I/C/NC` → "Very Important" …; C8
  `ADMS_REQ/RFS/REC/CONSIDER/NOT_USED`; D5 `TFER_REQ/REC/ROS/RFS/NREQ`; F3 `B/C/MRN_OPT`; A4, C3, C4, C13 (C.1304), C17
  (C.1712). `Y/N` and `N/A` need no entry (`normalizeValue`); a radio standing for a checkbox is "X" when anything is
  selected. The words were taken from the template workbooks' formulas (each code-table cell copies its grid header).
- `recordFromForm(widgets, opts)` mirrors `recordFromTemplate`: normalized and type-checked values with `field` and
  `page`, "question | value" quotes on owned items, `aid-year` failures, `yearsForEdition`, reads keyed
  `deterministic` (`pdf-form` v1). Codes with no tag (formula totals) or whose field isn't on the form are `not-read`;
  empty fields `blank`; the respondent `not-read`. The edition comes from `opts.edition` or the cover lines
  (`editionFromBody`). `readFormPdf(bytes, opts)` does widgets + cover + record.
- **H0's aid year (coordinator: confirm).** Howard's form exports `2024`/`2023` for its two options "2025-2026
  Estimated or 2024-2025 Final" (start years, one behind). The reader maps the higher export to the edition's estimated
  year and the lower to the prior year's final, so Howard's `2023` becomes "2024-2025 Final" and its H1/H2 figures get
  the `aid-year` label "2024–25 final". The foundation had called Howard's "2023" unparseable; any other export shape is
  kept as exported and fails `aid-year`.
- On Howard's real form (inventory copy): 1,263 widgets, 729 holding a value (the inventory's 759 counted
  whitespace-only fields); all 1,087 matching field names read; 716 passed, 362 blank, 24 not read, 3 failed
  (`type-range`: F.111, J.181, J.195 are Howard's "1.14"-style percents meaning 1.14%, the known F1/J ambiguity the
  per-column checks must settle). In scope: 558 passed, 1 failed.

**Layout text** — `scripts/lib/college-reported/layout.mts` (from the inventory's `layout.mts`):
- `rowsFromItems` (rows by y ±2.5 pt, sorted by x, a new cell on gaps > 8 pt, split digits joined per cell:
  "$3 4 , 604" → "$34,604"), `formatRow` (`@x` tags), `parseCells`, `pdfTextItems(bytes)`, `linesFromItems`,
  `pagesFromLayoutText` (the "=== Page N ===" / `@x` text format back to items; fixtures and the archive sidecar).
- `definitionsStart`/`dropDefinitions` (first "Common Data Set Definitions" heading), `repeatedLines` (running
  headers: a line on 3+ pages), `editionFromBody(lines, pages)` → `{ edition, from: "cover" | "items", conflict? }`:
  the cover on page 1 (first 40 lines for HTML and Excel), never a running header; else the item text "For the Fall
  2025 entering class" / "enrollment date in Fall 2025" by majority. B22's "Fall 2024 entering cohort" doesn't vote
  (last year's cohort). Michigan prints its edition only as a running header, so its items decide.
- `splitCD(lines)` → `{ C: [from, to], rest: [[1, c−1], [d, n]], fallback }`: line ids, 1-based; `rest` is a list of
  ranges (B before C, D–J after). On a missing marker both calls get the whole body and `fallback` is true.
  `sectionPages` gives the manifest's `sections` page hints.
- `linesFor(doc, ranges)`: "412: @78 … | @450 37,270" with unnumbered "--- Page 9 ---" markers.
- Grids: `gridColumns` (wrapped headers joined, cells within 30 pt), `placeCells` (a cell goes under the rightmost
  column starting ≤ 10 pt right of it; a leading label drops the grid's own label column; `columns` keeps the
  rightmost N), `placeGridMarks` (X, x, ✔, ☒, private-use glyphs checked; ☐ not), `isMarkGlyph`, `overflowTotal`
  (a "##" total summed from its printed parts, for `method: "derived"`).
- `layoutDocument(bytes | TextItem[][], type)` → `{ lines, pages, edition, split, definitionsFrom, pageCount,
  bodyChars, sections }` for `pdf-flat`/`pdf-scanned` (bytes or items), `xlsx-classic` (each sheet as "Sheet CDS-C"
  then `classicSheetText` lines), and `html`/`class-profile`. `split` is null only for an empty document.
- Over the inventory's 17 readable documents: every edition 2025–26 (USC, Loyola, Baylor, Duke, MIT from the cover;
  the rest from items), every C/D split found, definitions found where they exist. Known limit: Loyola's C7 headers
  "Very Important" and "Considered" print exactly 8 pt apart and join into one cell (its marks still carry `@x`).

**Older Excel and HTML** — `classicSheetText(sheet)` in `scripts/lib/cds-xlsx.mts`: one line per row, every cell
tagged with its address and empty cells kept from the sheet's first used column ("@A102 | @B102 Class rank | @C102 |
@D102 | @E102 | @F102 x"). `htmlToText` (documents.mts) now collapses whitespace, `<br>`, and `</p>`/`</div>` inside
each `<tr>` before splitting lines, so MIT's empty `<td>`s survive ("Rigor of secondary school record | | X | |").
`RESPONDENT_CODES` is now exported from cds-xlsx.mts for both deterministic readers.

**Line-cited quotes** — `lib/cds-quotes.ts` (pure): `stripLayoutTags`, `joinSplitDigits`, `lineText`, `citedLines`,
`quoteFromLines(lines, ids, around?)` (≤ 160 characters, verbatim, " / " between lines, the value kept in view),
`numbersOn`, `numberOnLines(v, lines, ids, { percent })` (thousands separators, split digits, "27.4%" for a 0.274
share; tag positions and row numbers never count), and `citeAnswer(answer, lines, pages)` → `{ citation: { line,
lines?, page?, quote } }` or `{ failure: { check: "line-cite" } }`, ignoring any quote the model wrote. The extraction
track builds item results from it.

**Tests and fixtures:** `tests/cds-form-pdf.test.mts` (types, the never-to-a-model guard, Howard's widget fixture,
a generated fillable PDF end to end, Howard's real PDF when the inventory is present), `tests/cds-layout.test.mts`
(test 5: Harvard C7 and the pdfPages-order break, Michigan ☐☒ with a wrapped header, private-use glyphs, Harvard C11's
lone column, Baylor C21, Georgia Tech's split digits, Loyola's "##", USC/Loyola/Michigan editions, definitions,
split, numbering; test 6: Berkeley's classic sheet and MIT's table), `tests/cds-quotes.test.mts` (test 7). Each guard
was broken on purpose and its test failed. Fixtures in `tests/fixtures/cds/` are cut from the inventory (60 Howard
widget rows, a few pages of layout text, one MIT table, nine Berkeley rows); `tests/helpers/tiny-pdf.mts` writes
small PDFs with positioned text and form widgets.

### Checks (2026-10-03, branch `feature/cds3-checks`)
Build order step 8: every item of every record is checked on its own, deterministic reads included, and a failure
marks exactly the codes it names. Nothing here fetches or calls a model; the checks re-judge stored records.

**`lib/cds-checks.ts`** (pure; imports `lib/cds-sections.ts`, `lib/reported.ts`, `lib/reported-checks.ts`):
- `runItemChecks(doc, ctx): ItemCheckResult` (`failures: CodedFailure[]` each with `check`, `detail`, `codes`;
  `byCode`; `derived`; `resolved`) and `applyChecks(doc, ctx): DocumentRecord`, with
  `ctx: CheckContext = { table, school?, federal?, lines?, others? }`. `school` must be `restoreFederal(school)`;
  `federal` defaults to `federalBaseline(school)` (`FederalBaseline`: the flat federal values the checks use). `lines`
  is a model-read document's archived numbered line text (line n = `lines[n - 1]`); without it the line checks skip.
  `others` are the college's other documents (C1's "sources agree", same edition).
- `applyChecks` is idempotent: it first undoes its own work (restores code-table values, drops derived totals and its
  own failures), keeps reader failures it can't recompute (`overflow-total` with no parts), then re-judges. A code
  with no value stays `blank`, whatever names it.
- **Derived totals:** a total printed "##" or left blank whose parts are present is summed (`method: "derived"`,
  quote "Sum of C.514 + … | 20", `cell` the parts' cells joined by "+", or their page and lines). Parts are never
  filled from totals. Applies to B1, B2, C1 by sex, C5, D2, H1, I-3.
- **Form vs code:** a template workbook's `form` value is tried against its group's checks; when the whole group
  (CDS item, or the C1 residency grid) passes with the form's values, they are published: `v` and `cell` from the
  form, the code table's `{ v, cell, quote }` kept in the new `ItemResult.code_table` (lib/cds-sections.ts; serialized
  by `records.mts`). Otherwise the group stays failed with `form-vs-code` and both values.
- **Universal checks:** `type-range` (`typeFailure`; text in a numeric B1/B2/B4/B5/B22/C1 cell fails too),
  `number-on-line` and `line-in-document` (model reads only, `valueOnLine` handles thousands separators, split digits,
  percents as printed, marks, month names), `edition-mismatch` (the cover's edition via `coverEdition(lines)`, and the
  year named by B.2201–B.2203, H.401 and I.201's own text against the template's), `form-vs-code`, `aid-year`.
- **Per-item checks**, one named function per group: B1, B2, B4–B11, B22, C1 (sums, FT + PT = enrolled by sex, and the
  seven round-1 checks via `runChecks`, minus `newer-than-federal`, which is the merge's rule), C1-residency (one status
  for the grid), C2, C3–C5, C7, C8, C9, C10, C11, C14, C16–C17, C21, C22, D2, D4–D7, D9, G0, G1, H0, H1, H2, H2A, H4, H5,
  H6, H7–H8, H9–H11, I-2, I-3, J. C12, C13, E, F1, G3–G6 are covered by the type checks; H14's "one column" and C3/C4's
  "one mark" are layout facts (a single value per code here).
- **New `CheckId`s** (lib/reported.ts, appended): `type-range`, `number-on-line`, `line-in-document`,
  `edition-mismatch`, `form-vs-code`, `overflow-total`, `aid-year`, `parts-sum`, `sums-to-100`, `order`,
  `ratio-matches`, `one-mark`, `inconsistent`, `valid-date`, `date-order`, `enrollment-disagrees`, `federal-disagrees`,
  `residency-funnel`, `residency-sum`, `residency-vs-federal`, `column-3-not-all-undergrads`,
  `previous-cohort-disagrees`, `not-a-url`, `out-of-range`.
- **Escalation:** `escalationFor(doc, table, { model? }): Escalation[]` (`{ call, codes, checks, pages, model }`), once
  per failing call, only model-read codes whose failures include a check in `ESCALATE` (number not on its line, sums,
  order, ratios, marks, date order, section-B and federal disagreements, C1's round-1 checks). Returns `[]` for a
  template workbook or form PDF and for a document with nothing read; skips a call the escalation model already read
  (a second failure is "document inconsistent"); never escalates `type-range`, `edition-mismatch`, `form-vs-code`,
  `aid-year`, `inconsistent`, `newer-than-federal`, or `unreachable`. Building the request is the batch track's job.
- **Breaker:** `circuitBreakerV3({ attempted, failedC1, itemFailureShares, changed, priorValues })` with
  `CIRCUIT_BREAKER_V3` (C1 > 10% of attempted colleges; any code failing in > 20% of ≥ 20 model-read documents
  containing it; > 25% of published values changed). Inputs: `itemFailureShares(docs, table)` and
  `failedC1Count(records, table)` count only model-read items that failed a check (never deterministic reads, blanks,
  `unreachable`, `newer-than-federal`, or B2 column 3, which publishes nothing). **Conflict to settle:** round 2.1
  dropped the "10% of colleges fail" trigger (`CIRCUIT_BREAKER` in lib/reported.ts, 2026-10-03: it fired on blocked
  sites and rounding); Decision 9 above reinstates it for C1. Both exist; the pipeline still calls round 2's
  `circuitBreaker`, so wiring `circuitBreakerV3` in is the batch track's (and the owner's) call.
- **Review queue:** `ReviewItem` gains optional `code`, `edition`, `sha256`, `value` (and `extraction` becomes
  optional; round-2 entries stay valid). `reviewKey`/`enqueueItems(queue, items)` (lib/reported.ts) replace only the
  same college + edition + code; the pipeline's `enqueue` now uses it. `reviewItemsFor(doc, table, { unit_id, name,
  run, queued })` makes one entry per failed item; `dropPassed(queue, unitId, doc)` removes entries whose code now
  passes. `scripts/college-reported-pr-body.mts` renders them as a per-item table (`perItemTable`: college, edition,
  item and code, value, failed checks, URL) beside the round-2 table.

**Tolerances that differ from the scope table** (the owning specs' "As built" notes say why): B4's federal cohort
±25% (not ±10%) and no federal comparison under 30 students; C9 bands vs percentiles allow one reporting step at a band
edge, and composite vs sections is the owning spec's ±50; G1 compares tuition + required fees with Scorecard's tuition
and fees; H5 compares the federal-loan row with Scorecard's median debt (×0.5–×2) and the any-loan row loosely
(×0.25–×4); H2's "M ≤ L" is dropped; G0's "not final" flag is not a failure (cds-cost-and-debt.md: provisional, shown
as such), against the scope table's "holds G1 out of publishing".

**The four records, re-checked** (`npm run check-cds-records`, which re-judges every committed record against
`restoreFederal(school)` and is a no-op on a second run; `npm run cds-records-from-workbooks` now applies the checks
too, and re-reading the four workbooks reproduces the committed records exactly):

| College | Passed | Blank | Failed | What changed |
|---|---|---|---|---|
| Vanderbilt (221999) | 693 | 405 | 1 | Nothing: B.2201's 0.97 still fails `type-range`; every other check passes |
| Cornell (190415) | 613 | 485 | 1 | C21 publishes the visible form (offered Yes, 10,057 applications, 1,889 admits; the code table's 10,057 "admits" kept in `code_table`); G.001 "89*---31" fails `not-a-url` |
| William & Mary (231624) | 689 | 410 | 0 | C.513 (recommended units, blank) summed from its subjects: 20 |
| Illinois (145637) | 745 | 339 | 15 | The residency grid publishes from the visible form (in-state 29,419 / 14,509 / 6,587; out-of-state 32,702 applicants; international 20,924); C.110–C.113 (full-/part-time by sex, swapped) fail `parts-sum`; B.221–B.230 (B2 column 3, non-degree only) fail `column-3-not-all-undergrads`; B.2203 fails `edition-mismatch` (its label says "Fall 2025 entering cohort") |

Not caught: Cornell's C21 dates are one row off too (C.2104/C.2105 11/1 is its closing date, read as notification);
with no closing date to compare, no check can tell. The display track should treat Cornell's ED notification date
with care.

**Tests:** `tests/cds-checks.test.mts` (34): the committed records are already checked and fail exactly where the
colleges' files are wrong; test 9 (Vanderbilt's 0.97, Illinois's code-table residency, its B2 column 3: each fails, is
never escalated, never counted); every universal check; a passing real record and a one-value break that fails exactly
its codes for each group; test 16 (a failing H2 never blocks C1; the queue's keys; `dropPassed`); the PR body's per-item
rows; test 17 (escalation scope on a model-read fixture with line text); test 18 (the breaker's shares, minimum, and
exclusions). `tests/cds-records.test.mts` now expects Cornell's C21 and Illinois's residency grid published from the
form.

### Pipeline and CLI (2026-10-03, branch `feature/cds3-integration`)
Build order step 9's run phases and step 11's measurement, wired over everything above: `npm run sync-college-reported`
now runs round 3 end to end. Nothing here has made a live model call; every path runs in tests over fakes.

**`scripts/lib/college-reported/phases.mts`** — `createRound3(deps)` → `{ run(state, opts) }`. `deps`: the interactive
`client`, the `batches` API (`new Anthropic().messages.batches` fits `BatchApi`), `fetch`, `now`, the `archive`, the
template `table`, the `callLog` writer, `onProgress`. `state` (`Round3State`) holds the files' contents and is updated
in place: recipes, `data/college-reported.json`, the review queue, the manifest, records by unit id (with a `dirty`
set the CLI writes), `data/college-batches.json`, blocked hosts, the owner's list, and the `RunSummaryV3`.
`onProgress` runs after every prepared college and every collected batch. Per-document states:

| State | Where | What happens |
|---|---|---|
| located | prepare (steps 0–1), discover (steps 2–4) | A college with no working link (`shouldRetry`, a broken 404/410 index page, or `--rediscover`) climbs `ladder` with `only: "free"`. A miss sets no `next_attempt` yet, because the paid steps are still to come. Colleges with a working recipe get their index pages re-scanned with `newSourcesFromIndex`; superseded editions go through `retireSuperseded`. The owner's `cds-urls.json` is step 0. Refusals are merged into `data/reference/blocked-hosts.json` (`recordBlocked`) |
| archived | `acquireSource` | `needsFetch` (manifest entry, the source's ETag/Last-Modified, the new `RecipeSource.checked` date, whether the index changed) → conditional GET → sha256 → `fetchOutcome`. A 304 or a known sha256 ends it. New bytes are stored with `archive.put` before anything reads them, and the manifest entry comes from `manifestEntryFor`. Bytes the ladder already downloaded (`prefetched`) aren't fetched again, and no URL is requested twice in one run (test 22) |
| typed | `typeOfDocument` | Decided from the bytes. A `class-profile` source keeps its kind |
| deterministic | template workbook, form PDF | `recordFromTemplate` / `readFormPdf` → `applyChecks` (federal baseline, the college's other documents) → stored, items counted, failures queued per item. C1 publishes at once |
| laid out | `pdf-flat`, `xlsx-classic`, `html` | `layoutDocument` → `archive.putLines(sha, { lines, pages, split, edition })`. The manifest gets the edition (from the cover or the items), pages, body characters, definitions page, and section pages. A C/D split fallback is counted |
| pending | submit | `callsNeedingRead` on the record document (or an empty one) gives the due calls, minus any `custom_id` already in an open batch |
| extracted | collect | `parseExtractResponse` → `itemsFromCall`: values through `normalizeValue`, located and quoted by `citeAnswer` over the archived lines (a quote the model writes is ignored), codes left out become `not-found`, store-only codes are `not-read`. `reads[call]` records the schema version, model, `batch` mode, batch id, pages, and stop reason. Aid-year items without an H.101 year fail `aid-year` |
| checked | collect | `applyChecks` with the archived lines, then `failUnlocated`: a `passed` value without a page and line, or an owned one without a quote, fails `line-in-document` and never publishes. Failing items go to the queue by college + edition + code (`reviewItemsFor` / `enqueueItems`, `dropPassed`) |

**Phases** (`--phase`, default `all`):

| Phase | Does | Model calls |
|---|---|---|
| `prepare` | Locate (steps 0–1), fetch, archive, type, run deterministic reads, lay out, publish C1 from deterministic reads, write the projection | None |
| `discover` | Ladder steps 2–4 for colleges the free steps missed (at most `--max-discoveries`, in `orderColleges` order). Step 2 is one Haiku **picker batch** over the link lists the free steps saw; the ladders wait for it at most 60 minutes (or until the polling deadline); a picker whose batch hasn't ended by then falls back to one interactive call, and the late batch is still collected (its cost counted, its answers unused). Steps 3 (`searchOnly`) and 4 (round 2's `discover`) are interactive. Every URL a model names is followed by our code (`confirmDocument` for files, `sourcesFromPage` for pages). The discovery budget is the cap minus what is spent and reserved. Found documents are fetched as in prepare | Picker batch; search and full discovery |
| `submit` | Class-profile pages keep **round 2's extractor** (interactive Haiku, `extract`, within the cap). Model-read documents: `buildRequests` for every due call, `trimToCap(requests, spent + open reservations, --max-cost)` in tier order, then `submit`. Trimmed documents stay archived for the next run | Extraction batch; class profiles |
| `collect` | Each open batch that has ended (polling until `COLLEGE_REPORTED_POLL_UNTIL` or `--poll-minutes`) goes through `collect` → records → checks → publish. Then `resubmitOnce` (requests rebuilt from the archive), `escalationFor` + `buildEscalationRequests` as an `escalate` batch (Sonnet 5, that call's pages, the failing codes), and C1 publishing for every college touched | Escalation batch |
| `all` | prepare → projection guard → discover → submit → collect | |
| `--reextract --call C\|rest` | Archive only, no fetch and no discovery: deterministic readers re-run from the archived bytes ($0), then the named call is submitted for every model-read document due it (after a `SCHEMA_VERSIONS` bump), then collect | Extraction batch |

**The projection guard.** After prepare, `projection()` counts the pending model-read documents by type, the pending
class profiles, and the colleges headed to steps 2–4 by tier (worst case: each climbs as far as its tier allows). Before
any model call, `projectionGuard(projection, cap − spent − open reservations)` either passes or stops the run with exit
3 and "projection $X exceeds the cap $Y". A `--sample` or `--pilot` run's `full_run_usd` is scaled by all colleges ÷
this run's colleges, which gives the number for the go/no-go table.

**CLI** — `scripts/sync-college-reported.mts`. `assertPriced()` runs first. Colleges come from `--pilot`, `--all`,
`--college <id>` (repeatable), `--tiers very,selective,less,open` (alone: every college in those tiers), and
`--sample N` (`sampleByTier` in pilot.mts: a stratified random sample in proportion to tier size, seeded by the run id).
`--phase collect` needs no colleges. Other flags:
- `--reextract --call C|rest`;
- `--max-cost` (default 25; 150 with `--all`);
- `--max-discoveries` (default 100);
- `--rediscover` (every college climbs from step 0 without its old recipe; the log says whether the free steps found
  the old CDS link; documents both recipes list keep their hashes);
- `--archive-prior` (off; archives older editions linked from the index pages of known recipes, unread);
- `--open-admission-search` (off: open admission gets steps 0–2 only, owner decision 4);
- `--poll-minutes N` (used when `COLLEGE_REPORTED_POLL_UNTIL` isn't set; default 90 for `all`, 0 for `collect`);
- `--dry-run`, `--run <id>`.

`ANTHROPIC_API_KEY` is required except for `--phase prepare`. The CLI writes every state file after each college and
each collected batch: recipes, `college-reported.json`, the queue, `college-docs.json`, changed
`cds-records/<unit_id>.json`, `college-batches.json`, `reference/blocked-hosts.json`, the run summary, and (through
`fileCallLogWriter`) the calls file. A later phase with the same `--run` (the collect job) continues that run's summary.

**Exit codes**:
- 0: done. Batches still open in `data/college-batches.json` (and `summary.open_batches`) are the draft-PR signal, not
  an error.
- 1: an error, including bad arguments or an unpriced model.
- 2: the circuit breaker tripped.
- 3: stopped early: the projection exceeds the cap, the key was refused, the spend limit or credit balance was reached,
  or the run was cancelled. Files keep everything finished.

**What each run redoes** (Decision 10), as built:
- Discovery runs only for `shouldRetry` colleges, broken index pages, and `--rediscover`.
- Index pages are fetched every run (not conditionally; "changed" is the set of document links).
- Known documents get a conditional GET only when their index's links changed or a month has passed since
  `RecipeSource.checked`. Class-profile pages are monthly too: the weekly Aug–Nov check isn't built.
- A model call runs only for a new sha256 or a bumped `schema_version`.
- An escalation never repeats once Sonnet 5 has read that call (`reads[call].read_by`). A second failure stays in the
  queue.
- Deterministic documents are re-read from the archive on `--reextract`, and on a reader-version bump through
  `callsNeedingRead`.

**The circuit breaker.** The run's breaker is `circuitBreakerV3` (lib/cds-checks.ts), called once at the end with:
- the colleges this run attempted;
- `failedC1Count` over their records;
- `itemFailureShares` over the documents read this run;
- changed against prior published values.

It counts only model-read check failures. It never counts `unreachable`, `blank`, `newer-than-federal`, a
deterministic read's failures, or the new `batch-failed` (a request that failed twice or was invalid; queued per call
as `C-call`/`rest-call`). **Owner conflict, implemented as round 3 says:** round 2.1 dropped the "more than 10% of
colleges fail" trigger (`CIRCUIT_BREAKER` in lib/reported.ts: it fired on blocked sites and rounding), and Decision 9
reinstates it for C1 in model reads only, where neither of those can count. If the owner keeps round 2.1's call, drop
`maxC1FailedShare` from `CIRCUIT_BREAKER_V3`. Round 2's `createPipeline` and its `circuitBreaker` stay in
`pipeline.mts` for their tests; the CLI no longer calls them.

**Measurement** (Decision 11). The summary is a `RunSummaryV3`, written after every college and every collected
batch:
- `usage_rows` by job × model × mode × call, through `callRecorder` (round 2's `usage` stays whole);
- `discovery` by path (`known` counts colleges whose working recipe needed no ladder);
- `documents` by type: fetched, unchanged, archived, model calls, split fallbacks, cost;
- `items` per code (passed, failed, blank, not found);
- `tiers`: colleges, located, CDS found, C1 published, cost;
- `batches`: one row per batch, settled when collected;
- `projection`;
- new: `blocked_colleges` (for the PR body) and `open_batches`.

The calls file has one line per model call. `grid_rows_undecided` and `vision` stay 0: layout doesn't report undecided
grid rows yet, and vision isn't wired. The PR body (`scripts/college-reported-pr-body.mts`) adds blocked colleges,
batches, the projection, and documents by type for a round-3 summary (`round3Sections`).

**Shared files changed:**
- `lib/reported.ts`: `RecipeSource.checked`, `CheckId` `batch-failed`, and `RunSummaryV3.blocked_colleges` and
  `open_batches`.
- `discovery.mts`: `LadderState.only` (`free` | `paid`), `LadderCollege.seed` (pages and answered hosts from the free
  pass), and `LadderResult.pages`/`answered`. A free-only miss sets neither `next_attempt` nor `none_found`.
- `pilot.mts`: `parseTiers`, `sampleByTier`.

**Not done, or done differently:**
- Scanned PDFs are archived and listed but not sent: whole-document reads aren't wired, and there were none in the
  sample.
- A model-read document whose edition can't be found is archived and listed but not sent.
- The paid ladder runs its own loop over the colleges the run chose instead of `discoverAll`. `discoverAll`'s
  `shouldRetry` filter can't see a broken index page that prepare found.
- The four committed template records have `archive: null`, so `--reextract` skips them until `archive-doc` is
  re-run with the archive repo set.
- `--archive-prior` doesn't read the pages the probes fetched.

**Tests:** `tests/cds-pipeline.test.mts`, over the fake fetch table, a fake client, `tests/fixtures/fake-batch-api.mts`,
an in-memory archive (`tests/fixtures/memory-archive.mts`), a generated template workbook (`tests/helpers/tiny-xlsx.mts`),
and a flattened PDF built with `tests/helpers/tiny-pdf.mts` from Loyola's layout-text fixture (its cover says 2025-2026
and its running headers 2024-2025):
- a template workbook from fetch to archive to record to published C1, with no model call;
- the flattened PDF through layout, one batch of two requests, collect, and a record with line-cited quotes, plus the
  test-21 summary and calls-file assertions;
- test 1: run 2 fetches only the index page and makes no model request; a month later there is one conditional GET
  answered 304; with the stored version made older, the call goes again;
- test 2: a `C` bump re-extracts from the archive with zero fetches, one request (`…-C-v2`), and the template re-read
  with no model;
- test 11: tier-order trimming, the trimmed document submitted next run with no refetch, and the projection guard
  (exit 3, no batch, no call);
- test 16: a failing H.201 never blocks C1, the queue holds one entry per college + edition + code, and there is one
  Sonnet escalation with only H.201;
- test 22: a picker batch adds a CDS without refetching the class profile or a failed source;
- `--phase collect` resuming an open batch;
- exits 2 (model-read C1 failure), 0 (deterministic failures never trip), 3 (key refused), and 1 (CLI arguments).

Each guard was broken on purpose and its test failed:
- the version comparison;
- the reservation cap;
- the projection guard;
- the per-run fetch set;
- the breaker;
- `needsFetch`;
- the per-item queue;
- escalation once.

### First live run (2026-10-04): what it changed
The first round-3 run on ten new colleges (runs `20261003-235404-3` and `20261004-000618-4`) found three things the fakes
could not:
- **Dated model ids.** Batch results name the snapshot (`claude-haiku-4-5-20251001`). `priceKey` in `models.mts` now
  prices a dated id as its alias; any other unknown id still stops the run (#63).
- **Structured-output limits.** The API allows at most 24 optional and 16 union-typed parameters per request (the
  structured-outputs docs, "Schema limits"). Decision 4's code-keyed schema (one optional, union-typed property per
  code: 263 and 497) was rejected as `invalid_request` on every call. `schemaFor()` is now one required list,
  `{"values": [{"code", "v", "lines"}]}`, every field one type; `v` is the printed text (read by `normalizeValue` like a
  workbook cell), and codes are checked against the call's code table in `parseExtractResponse`, as before.
  `schemaComplexity` and a test keep every schema inside `STRUCTURED_OUTPUT_LIMITS`. The schema version stays 1: no
  record ever held an answer read with the old schema.
- **Error messages.** `collect` now keeps the API's message for each errored or invalid result
  (`Collected.error_messages`), and the review queue's reason carries it. The PR body lists a failed whole call
  ("whole C call") instead of crashing on its `C-call` key.
- **Third run (`20261004-002803-5`): reads worked, checks found pipeline bugs.** Four CDS documents were read (Florida and
  UNC flattened PDFs, Michigan State's fillable form, Houston's older workbook) for $0.56 across ten colleges. Its
  failures were mostly ours, fixed after it and not published:
  - printed percents from a model or a form are always points (`normalizeValue(..., { percentPoints })`): "0.5" had
    been read as 50%, so score-band columns summed to 149–199% and every percentile-order check failed after them;
  - an H0 aid year printed without "final" or "estimated" ("2025-26", UNC) parses as `unstated` instead of failing
    all of section H;
  - `valueOnLine` strips layout tags before reading numbers, so printer-split digits ("@243 1,2 74") are found, and a
    footnoted mark ("X*") counts;
  - a paid discovery step that finds only a class profile keeps climbing toward a CDS (Boston University, UC San Diego,
    and Arizona stopped at an admissions page);
  - the PR description lists at most `PER_ITEM_ROWS` review items and is cut to GitHub's 65,536-character limit (330
    items had made the PR step fail).
- **Fourth run (`20261004-004725-6`): six CDS documents read, grid cells confused.** Washington University, Florida, UC
  San Diego, UNC, Michigan State, and Houston were read. Fixed after it, not published:
  - the code table now carries each code's row and column descriptors (`descriptorText`: category, residency, gender,
    unit), and its section heading or PDF tag where they still collide (GPA's three columns, B1's undergraduate and
    graduate rows, the B4–B5 grids, H1's need and non-need columns); a test keeps every code's description unique. The
    twelve residency cells and the C1 totals had all read "Total first-time, first-year who applied";
  - a request too long for Haiku 4.5's 200K context goes to Sonnet 5 whole (`extractionModelFor`; Houston's older
    workbook measured 201,379 tokens);
  - the instructions explain the tag words and how H.101's year is marked; a text value's digits found on its cited
    line count (the aid year read from a column heading).
  - Ohio State's robots.txt disallows its CDS PDF: an owner's-list entry (`data/reference/cds-urls.json`).
