# CDS Cost and Debt: Next Year's Price, Graduates' Total Debt

> Status: **planned** → built 2026-10-03 (see [As built](#as-built)); the status word flips to **built** together
> with its `lib/roadmap.ts` entry's removal when the round-3 branch merges. Planned 2026-10-03. Wave 4, after [college-reported-round-3.md](../college-reported-round-3.md) (the
> records pipeline this spec's items feed into). Research 2026-09-28 (Vanderbilt CDS 2024–25); upgraded from a
> skeleton using a 2026-10-03 CDS gap inventory (19 real 2025–26 documents read item by item: Vanderbilt, Cornell,
> William & Mary, UIUC, Berkeley, Purdue, Harvard, USC, Georgia Tech, Howard, Spelman, Baylor, TCU, Loyola Chicago,
> UW–Eau Claire, Michigan, Duke, MIT, Texas A&M). Part of [data-expansion](README.md).

## Question it answers
*What will it cost next year?* (Federal prices lag a full year or more behind the CDS's own "coming year" columns.)
*How much do bachelor's graduates actually owe, counting private and institutional loans, not just federal ones?*

## Source
Every item below is on CDS sections G (Annual Expenses, describing the **coming** academic year) and H (Financial
Aid, item H4–H5 describing the class that **just graduated**). Codes are the 2025–26 template's own (`G.001`…,
`H.401`…), read identically across every 2025–26 Excel workbook and matched to Howard's PDF form-field names (the
inventory's "US News PDF Tag" column, 1,087 of 1,089 matching). Coverage below cites the inventory's 19-document
sample; "all T5" means all four 2025–26 template workbooks plus Berkeley's classic layout (complete coverage known
item by item).

### G0: net price calculator URL, "not yet final" flag
| Code | What | Coverage | Example |
|---|---|---|---|
| `G.001` | Net price calculator URL | all T5 | Vanderbilt, W&M, UIUC give working URLs; Cornell's cell is garbage (`"89*-----...31"`) |
| `G.002` | Checked when 2026–27 costs aren't final at submission | all T5 | UIUC checked (`X`); Vanderbilt, Cornell, W&M blank (final) |
| `G.003` | Approximate date final 2026–27 costs will be known | all T5 | UIUC `46096` (an Excel serial date, same pattern as W&M's C16 date `46113`, already a known trap) |

`links.price_calculator` already stores the federal NPC URL (Scorecard). `G.001` is a **cross-check**, not a
replacement: a garbage or non-URL value (Cornell's case) is stored as absent, never overwriting the federal link.
`G.002`/`G.003` are new: when checked, every G1/G5 figure from that document is provisional, and the UI must say so
(UIUC in this sample) rather than presenting next year's price as settled.

### G1: next year's tuition, fees, food & housing — first-year and undergraduate columns
| Code | What | First-year | Undergraduate |
|---|---|---|---|
| `G.101`/`G.102` | Tuition, private (one flat rate) | ✓ | ✓ |
| `G.103`–`G.106` | Tuition, public, by residency (in-district, in-state, out-of-state, nonresident) | ✓ | — |
| `G.107`–`G.110` | same, undergraduate column | — | ✓ |
| `G.111`/`G.115` | Required fees | ✓ | ✓ |
| `G.112`/`G.116` | Food and housing (on campus) | ✓ | ✓ |
| `G.113`/`G.117` | Housing only (on campus) | ✓ | ✓ |
| `G.114`/`G.118` | Food only (on-campus meal plan) | ✓ | ✓ |
| `G.119`/`G.120` | Comprehensive tuition+food+housing fee, or "other" (colleges that can't itemize) | — | — |

Present in every document checked (all T5, HA, USC $66,640, GT, SP $29,025, BU $67,756, TCU, LUC, EC, UM, DU $73,740,
MIT, TAMU). Real values from the 2025–26 template workbooks (tuition for 2026–27): Vanderbilt (private, flat)
tuition $69,822, fees $3,384, food & housing $23,690 first-year / $23,602 undergraduate, housing only $15,170 (both
columns), food only $8,520 first-year / $8,432 undergraduate — the two columns differ even at a private college with
one flat tuition rate, because food & housing is costed separately per class. William & Mary and UIUC (public, by
residency): fees $7,501 / $5,054; in-district and in-state tuition are the same figure at both ($19,734 at W&M,
$12,992 at UIUC); out-of-state $46,177 (W&M) / $33,344 (UIUC); nonresident international the same as out-of-state at
W&M, a point higher at UIUC ($34,338).

**Two columns can diverge more sharply at a differential-tuition public.** The inventory flags Michigan: first-year
tuition $66,602 vs. the undergraduate column's $68,953 — an upper-division rate, not a rounding artifact. **Decision:
the headline uses the first-year column** (the figure a prospective applicant's entering cohort will actually pay,
consistent with the site's first-year framing everywhere else: admissions, net price, the aid cohort). The
undergraduate column is stored and shown in a disclosure ("Continuing students pay $X in year 2+") whenever it
differs from the first-year column by more than 1%; most colleges' two columns are identical or within rounding, so
the disclosure is rare in practice but must never be dropped silently when it isn't.

**Purdue's workbook has three campus `G` sheets** (`PWL` West Lafayette, `PIN` Indianapolis, `PSW` Northwest) because
one CDS file covers three unit-id-distinct campuses. The extractor must match the sheet to *this* `unit_id`'s own
campus name (from `school.name` / `location.city`), not take the first `G` sheet encountered; log when a match
required disambiguation, since a silent wrong-campus read would be hard to catch later.

**Georgia Tech's PDF splits digits across cells** (`"$3 4 , 604"` for what should read `$34,604`): any numeric G/H
value from a flattened PDF must have embedded whitespace between digit groups collapsed before parsing, not just
thousands separators. This is a PDF-rendering artifact, not a data error, and applies to every section, not only G.

### U13 — G2–G4, G6: tuition policy and per-credit charges (store-only, G3/G4 shown as a caveat)
| Code | What | Coverage | Value |
|---|---|---|---|
| `G.201`/`G.202` | Credits per term covered by full-time tuition (min/max) | all T5 | Vanderbilt 12–18, Cornell 10–(no max) |
| `G.301` | Tuition and fees vary by year of study (sophomore/junior/senior) | CU No, WM No, IL Yes | — |
| `G.401` | Tuition and fees vary by undergraduate program | CU No, WM Yes, IL Yes | — |
| `G.402` | If G4 is yes: share of full-time undergraduates paying more than the `G1` rate | CU —, **WM 12.6%**, **IL 70.6%** | |
| `G.601`–`G.605` | Per-credit-hour charges (private; public in-district/in-state/out-of-state; nonresident) | VU $2,910 (private); WM $657 in-district/in-state, $1,538 out-of-state; **IL "XXXXX"** at every rate | — |

`G2` and `G6` are **store-only**: low decision value (the inventory's rating), no profile card, no Explore filter.
`G3`/`G4`/`G.402` are the exception named by the inventory's U13: differential tuition by program is common enough at
publics that **70.6% of UIUC's full-time undergraduates, and 12.6% of William & Mary's, pay more than the single
rate `G1` reports** — a real caveat on the "sticker price" shown everywhere else on the site, which has never
flagged this. When `G.402` is present and the college's `G1` tuition is shown, a footnote reads "At {college}, {X}%
of full-time undergraduates pay more than this rate because tuition varies by program" (threshold: shown whenever
`G.402` ≥ 5%, to skip near-zero noise while catching real differential-tuition policies). `G3` (varies by year) gets
no UI footnote — it's about class standing, already implicit in the first-year vs. undergraduate column split above.

### G5: next year's books, supplies, transportation, and other expenses, by residence
| Code | What | Residents | Commuters, at home | Commuters, away |
|---|---|---|---|---|
| `G.501`/`504`/`508` | Books and supplies | ✓ | ✓ | ✓ |
| `G.509` | Housing only | — | — | ✓ |
| `G.505`/`510` | Food only | — | ✓ | ✓ |
| `G.511` | Food and housing total | — | — | ✓ |
| `G.502`/`506`/`512` | Transportation | ✓ | ✓ | ✓ |
| `G.503`/`507`/`513` | Other expenses | ✓ | ✓ | ✓ |

Present in all T5. **Text in numeric cells is routine, not an error**: Vanderbilt and Cornell both answer
transportation with `"varies"` / `"Varies"` for every residence category; UIUC answers "food only, commuters at
home" with `"XXXXX"`. A non-numeric answer parses to `null` and still **publishes** (status `passed`, not `failed`)
— a college answering "varies" has reported honestly, and sending it to review would flood the queue with normal
answers. The verbatim text stays in the value's quote so a future display can say "varies" instead of showing
nothing.

### H4: the graduating class
| Code | What | Coverage | Value |
|---|---|---|---|
| `H.401` | Number who started as first-time students and received a bachelor's degree in the class named by the question itself | CU 3,606, WM 1,550, IL 7,523; all T5, HU, every PDF | — |

**The class year must be read from each document's own sentence, not assumed from the edition.** The question text
names its own class and date range (e.g. "…the 2024 undergraduate class who started… and received a bachelor's
degree between July 1, 2023 and June 30, 2024"), and the inventory found at least one 2025–26 document whose coded
answer-sheet label disagreed with what its rendered form text actually named. Extraction quotes the sentence and
takes the year from it; a document where the code-table's cohort metadata and the form's own wording disagree on the
year goes to review rather than guessing which one is right.

### H5: borrowing by those graduates — five rows, not three
**The skeleton's "federal, non-federal, any" schema was wrong.** The 2025–26 template has **five** rows — any loan,
federal, institutional, state, private — each with three columns: number, percent, and average cumulative principal.
Present in every document checked (VU's ANSWER SHEET tab is blank for H5, but its underlying `H` sheet has the real
values — the ANSWER SHEET fallback the agent's Excel reader relies on cannot be trusted alone for this item).

| Code (number / percent / avg. principal) | Row | Cornell | W&M | UIUC |
|---|---|---|---|---|
| `H.501` / `H.506` / `H.511` | A. Any loan program | 1,198 / 33.2% / $25,655 | 516 / 33% / $28,934 | 2,844 / 38% / $22,040 |
| `H.502` / `H.507` / `H.512` | B. Federal loan programs | 1,119 / 31% / $12,191 | 496 / 32% / $17,555 | 2,783 / 37% / $18,157 |
| `H.503` / `H.508` / `H.513` | C. Institutional loans | 636 / 17.6% / $4,996 | 0 / 0% / $0 | 465 / 6% / $2,850 |
| `H.504` / `H.509` / `H.514` | D. State loans | 0 / 0% / $0 | 0 / 0% / $0 | 0 / 0% / $0 |
| `H.505` / `H.510` / `H.515` | E. Private loans | 202 / 5.6% / $68,894 | 104 / 7% / $59,552 | 273 / 4% / $39,659 |

Other colleges' real "any" row (number, from the inventory's wider PDF read): Harvard 16% / $22,926; Baylor 42% /
$57,257; Loyola Chicago 58% / $42,570; UW–Eau Claire 57.9% / $26,464; Spelman 62% / $34,425; Duke 22.9% / $26,395.
These replace the skeleton's illustrative placeholder numbers.

### H6 moved
H6 (aid available to international students: types, number awarded, average, total) is **no longer part of this
spec**. It moves to [cds-financial-aid.md](cds-financial-aid.md) (`H.601`–`H.606`), which gives it a real schema; this
spec only cross-links it. The skeleton listed H6 with no extraction plan, which this correction removes.

## Ingest
Both sections sit in round 3's **`GH`** extraction group ([college-reported-round-3.md](../college-reported-round-3.md#decision-4-two-model-calls-per-document-keyed-by-template-code-quotes-cited-by-line)):
one model call per document covering G and H together, line-cited quotes, Excel read deterministically with no
model call at all (`scripts/lib/cds-xlsx.mts`, extended with a reader per item above, keyed on the stable 2025–26
codes and falling back to row-label matching for Berkeley's/Purdue's classic layout).

**Normalization before any check runs:**
- Collapse whitespace inside a digit group before parsing a dollar amount (Georgia Tech's `"$3 4 , 604"`).
- A non-numeric value in a numeric cell (`"varies"`, `"Varies"`, `"XXXXX"`) parses to `null`, keeps its verbatim
  quote, and is `passed`, not `failed`.
- Excel serial dates (`G.003`) convert the same way the sync already converts other IPEDS date cells.
- Multi-campus `G` sheets (Purdue) are matched to this record's own `unit_id` by campus name before any value is
  read.

**Checks** (added to round 3's draft, [Decision 9](../college-reported-round-3.md#decision-9-checks-for-every-item-including-deterministic-reads-publish-and-escalate-per-item)):
1. **G1 vs. federal tuition:** each reported tuition figure (the private rate, or each residency column at a public)
   is at least 95% of the matching federal tuition (`cost.tuition_in_state` / `cost.tuition_out_of_state`; the private
   rate compares to `cost.tuition_in_state`, since Scorecard stores one tuition pair regardless of control). A sticker
   price rarely falls year over year; a drop below the floor goes to review, not silently published.
2. **G1 column agreement:** first-year and undergraduate columns are each internally consistent (housing only + food
   only ≈ food and housing, within rounding, when both are given separately); a first-year vs. undergraduate gap over
   1% is flagged for the disclosure, not an error.
3. **G.402 range:** 0–100%.
4. **H4 class size:** a positive integer; the class year is the one named in the document's own sentence (above), and
   a document where the code table and the form text disagree on that year is queued for review.
5. **H5 any-loan ≥ federal:** the any-loan share and count are each at least the federal row's (any-loan is a
   superset of federal borrowers; a college reporting fewer any-loan borrowers than federal borrowers has a document
   inconsistency).
6. **H5 union bound:** any-loan's count and share are each at most federal + institutional + state + private summed
   (any-loan is a union of the four source rows, which can double-count a student borrowing from two sources, so the
   sum is a safe upper bound even though it overstates distinct borrowers).
7. **H5 average principal vs. Scorecard:** the any-loan row's average cumulative principal is within ×0.5–×2 of
   `outcomes.median_debt` (the Scorecard median, federal loans only, completers). The two numbers measure different
   things (average vs. median, all loan types vs. federal only, and different cohorts), so the tolerance is wide; it
   exists to catch a genuine extraction error (a misread decimal or a six-figure mis-scan), not to flag a real gap
   between the figures — see Display below for how that gap is explained to users, not hidden by this check.

## Store
```ts
reported.cost.next_year: {
  entering_term: string;              // "2026–27"
  not_final: boolean;                 // G.002; true means every figure below is provisional
  final_date: string | null;          // G.003, ISO date
  first_year: CdsCostColumn;
  undergraduate: CdsCostColumn;       // shown only when it differs from first_year by more than 1%
} | null

interface CdsCostColumn {
  tuition:
    | { kind: "private"; amount: number | null }
    | { kind: "public"; in_district: number | null; in_state: number | null; out_of_state: number | null; nonresident_international: number | null };
  fees: number | null;
  food_and_housing: number | null;
  housing_only: number | null;
  food_only: number | null;
}

// Store-only (G2, G3/G4, G5, G6); G.402 is the one value with a display (the differential-tuition footnote).
reported.cost.next_year_detail: {
  credits_per_term: { min: number | null; max: number | null } | null;      // G2
  tuition_varies_by_year: boolean | null;                                   // G3
  tuition_varies_by_program: boolean | null;                                // G4
  pct_paying_more: number | null;                                           // G.402
  expenses: {
    residents: { books_supplies: number | null; transportation: number | null; other: number | null };
    commuters_at_home: { books_supplies: number | null; food_only: number | null; transportation: number | null; other: number | null };
    commuters_away: { books_supplies: number | null; housing_only: number | null; food_only: number | null; food_and_housing_total: number | null; transportation: number | null; other: number | null };
  } | null;                                                                 // G5; a null leaf means a non-numeric answer (quote kept in lineage)
  per_credit_hour: { private: number | null; in_district: number | null; in_state: number | null; out_of_state: number | null; nonresident: number | null } | null;  // G6
} | null

reported.outcomes.graduating_class: { year: number; size: number } | null   // H4

reported.outcomes.graduate_debt: {
  class_year: number;         // same as graduating_class.year
  rows: Record<"any" | "federal" | "institutional" | "state" | "private", { number: number | null; share: number | null; avg_principal: number | null }>;
} | null                      // H5
```
Both live under `school.reported` ([college-reported-data.md](../college-reported-data.md)); `ReportedData` gains
`cost?: { next_year, next_year_detail }` and `outcomes?: { graduating_class, graduate_debt }` alongside the existing
`admissions` block. Every leaf carries an `extracted` lineage record (CDS edition, URL, quote, page or cell,
retrieved date) exactly like `reported.admissions.*` today; `lib/fields.ts` registers `reported.cost.next_year`,
`reported.cost.next_year_detail`, `reported.outcomes.graduating_class`, and `reported.outcomes.graduate_debt`
(source `college-site`, topics `cost`/`outcomes`, no vintage — the year lives in each value's own lineage record).

**Never used in ranks, medians, or Explore percentile comparisons** (partial coverage, self-reported): Explore gets
only a "Has next year's price" / "Has reported graduate debt" boolean filter, no sort, matching the rule
[cds-admissions.md](cds-admissions.md) and [cds-transfer.md](cds-transfer.md) already set for their own partial
fields.

## Display

### Next year's price — beside the federal figure, never replacing it
This is a **named exception to the newest-everywhere rule**
([college-reported-round-2.md](../college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere),
[data-lineage.md](../data-lineage.md) rule 3). Everywhere else on the site, a college's newer published figure *is*
the value shown — it replaces the federal number in `data/schools.json` itself. G1 cannot work that way, because it
doesn't describe a year that has happened yet: the history build's rule 1
([trends-data.md](../trends-data.md#guiding-rules)) requires each series' latest *stored* point to equal the
snapshot, and the price series is indexed by calendar year — 2026–27 isn't a history point until a 2026–27 federal
release exists to confirm it, and the figure could still change (`not_final`). So `cost.tuition_in_state` /
`cost.sticker` / `cost.breakdown` are **never overwritten** by `reported.cost.next_year`; it is shown as a clearly
labeled separate value beside them, the way `reported.outcomes.graduate_debt` sits beside the federal median debt
(below) — this is the general pattern for any CDS item that describes a *future* period, not just this one.

- **Cost topic page and overview Cost card:** directly under the current "sticker price by residency" section
  (`WhatStudentsPay`, [cost-outcomes.md](../cost-outcomes.md)), a `NextYearPriceLine`: "Next year ({entering_term},
  reported by {college}): ${first_year tuition+fees+food&housing total} before aid", with the percent change against
  this year's matching total (`cost.tuition_fees` + the food/housing and fee portions of `cost.components`, i.e. the
  same components `G1` covers — books, transportation, and other expenses are `G5`, not part of this comparison).
  When `not_final` is true: "(provisional; {college} expects final figures by {final_date})". When the undergraduate
  column differs from first-year by more than 1%, a disclosure adds "Continuing students pay ${undergraduate total}
  in later years." At a public college, the by-residency table gets an added, visually muted "{entering_term}
  (reported)" row beside the current federal row, rather than a second table.
- **Differential-tuition footnote:** directly under the tuition figure, whenever `pct_paying_more` ≥ 5%: "{X}% of
  full-time undergraduates at {college} pay more than this rate because tuition varies by program" (`G.402`, U13).
- **Full next-year estimate (disclosure):** when `next_year_detail.expenses` has every numeric component the current
  year's `cost.components` would need (books, transportation, other, for the relevant residence), an expandable "Show
  the full next-year estimate" totals G1 + G5 the same way `cost.breakdown` totals `cost.tuition_fees` +
  `cost.components` today. A non-numeric G5 leaf ("varies") is shown as prose next to the total ("transportation:
  varies"), never silently treated as $0, and the total itself is marked partial rather than computed when any
  needed component is missing or non-numeric.
- **Never in Explore, Compare's ranked rows, or any percentile**, per Store above; a "Has next year's price" filter
  only.

### Graduates' total debt — beside the federal median, a different measure named as such
The federal `outcomes.median_debt` counts only federal loans and only students who finished; H5's "any loan" row
counts every loan type a graduate used, including private and institutional loans, for the class H4 names. These are
not two readings of the same fact to reconcile into one headline — they are different, both true, measures, and the
outcomes topic page shows them side by side rather than picking a winner:

- **Outcomes topic page**, in the existing "Borrowing and repayment" card
  ([loans-and-repayment.md](loans-and-repayment.md)), directly under the federal "Median debt at graduation: $X,
  federal loans only" line: "According to {college}'s most recent Common Data Set, {any.share}% of its {class_year}
  graduating class ({graduating_class.size} students) borrowed from any source — federal, institutional, state, or
  private — averaging ${any.avg_principal} among those who did." The line names its own scope explicitly (all loan
  types, one graduating class, not the federal median-debt definition) so the two never read as a contradiction. The
  federal row (`H.502`/`507`/`512`) is read and checked (above) but not shown separately — showing both the federal
  median and H5's own federal-only row beside it would be the duplicate figure the house style forbids: one figure
  per fact, with the source and its scope in the ⓘ popover, not a second number repeating the same idea.
- **Overview outcomes card:** no change; this is topic-page detail, not headline material while coverage is partial.
- **Glossary:** new terms `next-year-price` and `cumulative-principal` (H5's "average cumulative principal
  borrowed"), each explaining why it differs from the figure beside it.
- **Never in ranks, medians, Explore percentiles, or Compare's ranked rows**; "Has reported graduate debt" filter
  only, per Store above.

## Keep history?
- **Next year's price: none.** It becomes an ordinary federal history point a year or two later (the general rule
  for forward-looking values, [data-expansion/README.md](README.md#deciding-on-history)); only the current edition
  is kept.
- **Graduate debt: series per CDS edition.** H5 has been part of the CDS for many editions, so once a college has
  two or more editions on file, `any.share` and `any.avg_principal` can chart year over year the same way
  [cds-admissions.md](cds-admissions.md) charts average GPA. **Backfill is possible**: colleges' own index pages list
  many past editions (the inventory counted 25 at Georgia Tech and TCU, 19 at Harvard, 13 at Spelman, 12 at Loyola
  Chicago, 10 at Howard), and [college-reported-round-3.md](../college-reported-round-3.md)'s open question 2 (archive
  prior editions, not just the newest) is what would make that backfill cheap — a separate decision from this spec,
  but the dependency runs through it.

## Top-level trend?
**None**, while coverage is partial and self-reported, per the README's bar. A later candidate once coverage is
broad: "Graduates owe more than federal data shows" as an Outcomes "Over time" chart line (not a hero indicator, not
a Home fact) — the same ceiling [cds-admissions.md](cds-admissions.md) sets for its own average-GPA series.

## Build
- **`lib/fields.ts`:** `reported.cost.next_year`, `reported.cost.next_year_detail`, `reported.outcomes.graduating_class`,
  `reported.outcomes.graduate_debt` (the `reported()` helper, topics `cost`/`outcomes`).
- **`lib/types.ts`:** extend `ReportedData` with `cost?: { next_year, next_year_detail }` and
  `outcomes?: { graduating_class, graduate_debt }`; the four new interfaces in Store above.
- **`lib/cds-sections.ts`** (round-3, shared): `G.001`–`G.605`, `H.401`, `H.501`–`H.515` added to the `GH` group's
  schema, each with its check from Ingest and `schema_version: 1`.
- **`scripts/lib/cds-xlsx.mts`:** a reader per item above (code lookup on the flat answer sheet, row-label lookup for
  classic/Berkeley/Purdue layouts), the digit-collapse and non-numeric-cell handling, Purdue's campus-sheet match.
- **A merge module** (parallel to how C1 merges into `school.reported.admissions` today): from `data/cds-records/` into
  `school.reported.cost.*` / `school.reported.outcomes.*` with `extracted` lineage, run by `sync-college-reported`.
- **Components:** `NextYearPriceLine` and its disclosures (Cost topic + overview card), the differential-tuition
  footnote, the full-next-year-estimate disclosure; a graduate-debt line in the existing "Borrowing and repayment"
  card (Outcomes topic page).
- **`lib/glossary.ts`:** `next-year-price`, `cumulative-principal`.
- **Explore:** two boolean filters, "Has next year's price" and "Has reported graduate debt"; no sorts.
- **Tests:** checks 1–7 above (a good fixture passes, a broken variant fails that check specifically); the
  non-numeric-cell path publishes instead of failing; the first-year/undergraduate disclosure threshold; Purdue's
  campus-sheet match (a fixture with three `G` sheets picks the right one by name); the lineage round-trip
  (`toReportedEntry` → merge → `validateSchool`) for both new blocks; a guard test (alongside
  `tests/reported-guards.test.mts`) banning `reported.cost.next_year*` and `reported.outcomes.graduate_debt` from
  `lib/metrics.ts`, `lib/compare.ts`, `lib/indicators.ts`, Explore's sort functions, and any ranking or percentile
  code, proven to fail when one of those fields is added there on purpose and reverted.

## Open questions
1. Michigan-style first-year/undergraduate divergence: is 1% the right disclosure threshold, or should it be a fixed
   dollar amount (so a $20 rounding difference at a small college doesn't trigger it while a real upper-division rate
   always does)?
2. Should the differential-tuition footnote (`G.402` ≥ 5%) also appear on Compare's "All the numbers" table, or stay
   profile-only until more colleges have it?
3. H6's new home, [cds-financial-aid.md](cds-financial-aid.md), needs to exist before this spec's H6 cross-link
   resolves to a real page.

## As built
Built 2026-10-03 on the round-3 foundation, reading the committed CDS records (`data/cds-records/<unit_id>.json`).
Live for the four 2025–26 template workbooks: Vanderbilt, Cornell, William & Mary, Illinois.

**Module:** `lib/cds/cost-and-debt.ts` (pure). `costAndDebtFromRecord(record, school)` returns the blocks, their
lineage, and `held` (what was not published and why); `applyCostAndDebt(school, record)` is the merge step;
`columnTotal`, `federalMatchingTotal`, `change`, `undergraduateDiffers`, `showsPayingMore`, `fullEstimate`,
`hasGraduateDebt` are what the pages show; `check*` are the seven checks.
- G comes only from the college's **newest** document (an older edition's "next year" has already happened); H4–H5
  from the newest document within two editions where H4 passed, so the class and its borrowing describe one class.
- Years come from each record's `years`: G `next-year` ("2026–27"), H4–H5 `graduating-class` ("Class of 2025"); the
  number in `class_year` is parsed from that label.
- **G0 holds back, rather than marking provisional:** when `G.002` is checked, `next_year` is not published and G5
  (`expenses`) and G6 (`per_credit_hour`) are null; tuition policy (G3, G4, `G.402`) still publishes. So the stored
  type has no `not_final`/`final_date` (they would always be false/null). Illinois's 2025–26 CDS is checked ("final
  by 03-15"), so Illinois shows only its differential-tuition footnote (70.6%).
- A failed check holds its block back (check 1 or 2 → `next_year`; 3 → `pct_paying_more` only; 4 → both H blocks;
  5–7 → `graduate_debt`), recorded in `held`. Two deviations, both from real data: **check 1** adds G1's required fees
  before comparing, because Scorecard's `tuition_in_state`/`_out_of_state` are tuition *and fees* (W&M's tuition-only
  $19,734 is 76% of its $25,914 federal figure; tuition + fees is 105%); **check 7**'s band is ×0.5–×3, not ×0.5–×2,
  because Vanderbilt's real any-loan average ($30,578, with private borrowers averaging $64,280) is ×2.18 its $14,000
  federal median.
- `G.001` (net price calculator URL) is not stored; `links.price_calculator` stays the federal link (Cornell's cell is
  garbage and passed the type check). `G.119`/`G.120` (comprehensive fee, other) are not stored yet.
- G5 non-numeric answers ("varies") are null leaves with the printed text in `expenses.text` (keyed
  `"residents.transportation"`), so the full estimate says "varies" and is marked partial instead of totalled.

**Store** (`lib/types.ts`): `ReportedData.cost` (`ReportedCost`: `next_year`, `next_year_detail`) and
`ReportedData.outcomes` (`ReportedOutcomes`: `graduating_class`, `graduate_debt`), with `CdsCostColumn`,
`CdsTuition`, `CdsExpenses`, `ReportedGraduateDebt` as in Store above (minus `not_final`/`final_date`, plus
`expenses.text`). Absent blocks are omitted, not null.

**Fields** (`lib/fields.ts`, source `college-site`, no vintage): `reported.cost.next_year` (cites the headline
tuition: the private rate or in-state), `…next_year.first_year.fees`, `…next_year.first_year.food_and_housing`,
`reported.cost.next_year_detail` (cites G.402, else G4, G3, or a G5/G6 item), `…next_year_detail.pct_paying_more`,
`reported.outcomes.graduating_class` (H.401), `reported.outcomes.graduate_debt` (the first passed any-loan item),
`…graduate_debt.rows.any.share` (H.506), `…rows.any.avg_principal` (H.511). Computed at render time:
`derived.next_year_price` (tuition + fees + food and housing, first-year column) and `derived.next_year_change`
(against `cost.tuition_fees` + `cost.components.room_board`; cites both the CDS and the IPEDS year).

**Merge:** `lib/reported-merge.ts#mergeReported(schools, reported, records)` strips and re-applies every college's
blocks after the admissions entries; `npm run merge-reported` and `sync-data` read `data/cds-records/` with
`readRecords`. `cost.*` and `outcomes.*` are never touched.

**Display** (quiet style, no chips; source, edition, year, and quote in the ⓘ):
- Cost topic page, under "What students pay": `components/school/NextYearPrice.tsx`, "Next year (2026–27), reported
  by {college}: $X before aid" (public: in-state and out-of-state), "up N% from {federal year}" (each year from
  lineage), the continuing-student line when the undergraduate column differs by more than 1%, a "Show the full
  next-year estimate" disclosure (G1 + G5 residents), and the differential-tuition footnote at `G.402` ≥ 5%. The
  footnote shows even when G1 is held back, since it describes tuition policy. Not built: the public by-residency
  table's extra muted row (the line names both rates instead) and the overview Cost card line.
- Outcomes topic page, after "Staying and finishing": `components/school/GraduateDebt.tsx` ("What graduates owe",
  anchor `#graduate-debt`): the federal median ("federal loans only"), then the college's all-loans sentence for its
  graduating class. The federal H5 row is read and checked but not shown.
- The ⓘ for any value from a CDS record now says "Reported by {college} in its 2025–26 Common Data Set (figures for
  2026–27)" (`Cited.document` in `lib/lineage.ts`, set from the lineage record's `edition`), instead of borrowing
  `reported.admissions.source_kind`, which would have called Illinois's CDS figures a class profile.
- Glossary: `next-year-price`, `cumulative-principal`.

**Not built:** the Explore "Has next year's price" / "Has reported graduate debt" filters (they need a reader in
`lib/dataset.ts`, which `tests/reported-guards.test.mts` and this spec's guard both ban; a helper exemption is a
separate decision); Compare rows (the spec allows none); history (none for next year's price; the graduate-debt
series waits for two editions per college); the reader work in `scripts/lib/cds-xlsx.mts` (Purdue's campus sheets,
Georgia Tech's split digits: round 3's readers track); per-item checks in round 3's `lib/cds-checks.ts`.

**Known data issue:** the 2025–26 template's code-table label for H.401 names "the 2024 undergraduate class" while
the form names 2025 (gap report). The foundation's quote comes from the code table, so the ⓘ for the class size
quotes "2024" beside "Class of 2025". The year shown is the year rule's (2025, per the coordinator and the inventory).

**Tests:** `tests/cds-cost-and-debt.test.mts`: the four real records (values, Illinois's G0 hold and its release when
the box is unchecked), checks 1–7 (a good fixture passes, a broken one fails that check; 1 and 7 also shown holding
the block back through the merge), the non-numeric-cell path, the 1% disclosure and 5% footnote thresholds, the
like-for-like change, the lineage round trip (merge → `validateSchool`, a missing record fails, re-merge idempotent,
a record removed strips its blocks, `cost.*` unchanged), and the guard: no read of `reported.cost`/`.outcomes`,
`next_year*`, `graduate_debt`, `graduating_class`, or this module in metrics, dataset, compare, field-compare,
insights, indicators, params, score-scale, newest, derive, the history modules, Home, Explore, Compare, charts,
trends, or the history build. Each guard was shown failing: a `reported?.cost?.next_year` line appended to
`lib/metrics.ts`, and the G0 hold disabled, each fail their test. `tests/merge-reported.test.mts`'s re-merge test now
passes the records too.

## Roadmap entry
- slug: cds-cost-and-debt
- summary: Next year's price before federal data has it, and graduates' total debt including private loans.
- complexity: 2 — a new source file or profile section with filters and history, but the real driver is that next
  year's price must stay apart from federal figures everywhere (ranks, comparisons, and history's latest-point rule)
  rather than replacing them, and H5's five-row schema needs its own merge and display logic.
- after: ["college-reported-round-3"]
