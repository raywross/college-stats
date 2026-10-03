# CDS Transfer Admissions

> Status: **built** (2026-10-03; see [As built](#as-built): the per-edition history series and the checks' review-queue
> wiring wait on other work). Wave 4. Captured by [college-reported-round-3.md](../college-reported-round-3.md)'s
> single run (section D joins model group `DEF`, alongside E and F); no separate agent or model call of its own.
> Research 2026-10-03: a 19-document, item-by-item Common Data Set inventory (2025–26 editions of Vanderbilt, Cornell,
> William & Mary, UIUC, Berkeley, Purdue, Harvard, USC, Georgia Tech, Howard, Spelman, Baylor, TCU, Loyola Chicago,
> UW–Eau Claire, Michigan, Duke, MIT, Texas A&M). Replaces the 2026-09-28 skeleton (see
> [Corrections to the skeleton](#corrections-to-the-skeleton)). Part of [data-expansion](README.md).

## Question it answers
*Can I transfer in, and what are my chances? What do I need to apply, and when?* No federal file has transfer
applicants or admits; IPEDS only counts transfer students once enrolled
([transfers.md](transfers.md), `demographics.transfer_in.count`, from `EF{Y}A`). The Common Data Set is the only
source for a transfer admission funnel, deadlines, and requirements.

## Source: CDS section D (items by template code)
Coverage is quoted from the 19-document inventory. "T5" = the four 2025–26 template workbooks (Vanderbilt, Cornell,
William & Mary, UIUC) plus Howard's fillable PDF form, where every item was read by code with complete coverage
known; other colleges were checked item by item where named.

| Code | Question | Coverage | Read deterministically? | Model needed? |
|---|---|---|---|---|
| **D1** | Enrolls transfer students; grants advanced standing for work completed elsewhere | all T5; **UIUC leaves D1 blank while D2 is filled** | Excel code table / form field, yes | No |
| **D2** | Transfer applicants, admitted, enrolled — men, women, unknown, and a **total row** | **all 19 documents read**, e.g. Harvard 2,042 / 13 / 12, USC 10,827 / 2,929 / 1,544, UW–Eau Claire 750 / 565 / 372, Duke 1,812 / 157 / 92, MIT 1,713 / 35 / 31, Texas A&M 6,622 / 3,417 / 3,074 | Yes — a clean `Total \| a \| b \| c` row in every format tested, PDF included | No |
| **D3** | Terms a transfer student may enter (checkbox list) | all T5 | Yes — single-column checklists ("X On a rolling basis"-style rows) survive plain PDF text | No |
| **D4** | Minimum number of credits to apply as a transfer | low: Vanderbilt 12, Howard 15 (2 of 19 seen) | Yes | No |
| **D5** | Required-materials grid: high school transcript, college transcript(s), essay, interview, standardized test scores, statement of good standing from prior institution — each **required / recommended / not required** | all T5 | **Layout pass** (x/y-aware text, same fix as C7): plain PDF text drops this 3-way grid's column exactly as it drops C7's; Howard's fillable PDF stores the answer as the radio code `TFER_REQ`, read with no model | Vision pass only on a row the layout pass leaves undecided (same two-pass plan as C7, round-3 Decision 3.5) |
| **D6** | Minimum high school GPA for transfer admission | low: Howard 3.0; mostly blank | Yes | No |
| **D7** | Minimum college GPA for transfer admission (4.0 scale) | low: Howard 2.5; Cornell "No minimum required"; UIUC "N/A"; mostly blank | Yes | No |
| D8 | Other requirements for transfer admission (free text) | Cornell, UIUC | Yes (stored verbatim, not parsed) | No |
| **D9** | Priority date, closing date, notification date (or rolling), reply-by date, for each of up to 4 terms — 36 month/day cells | Cornell, William & Mary, UIUC, Howard confirmed (4 of 19); not separately re-checked at the 14 other documents in this sample | Yes, when the college fills the date grid; a college that writes deadlines as free text (as Vanderbilt does for C14–C18) would need a model — not observed for D9 in this sample | Only for free-text dates |
| D10 | Open-admission policy applies to transfer applicants | all | Yes | No |
| D11 | Other requirements for transfer admission (a second free-text field) | Cornell, UIUC | Yes (stored verbatim) | No |
| D12–D17 | Lowest transferable grade; maximum/minimum transferable credits; credits required to earn a degree here; residency requirement after transfer | Cornell, William & Mary, UIUC, Howard | Mostly yes; some values are free text, not numbers ("45-60", "No Limit, but…") | No (text stored as text) |
| D18–D22 | Credit granted for military training, ACE/CLEP/DSST exams, other standardized exams | William & Mary, Cornell, Howard (partial) | Yes | No |

The inventory's corrections to the existing skeleton (its section 4) flag two things this spec fixes: D2's men/women/
unknown breakdown and total row were present in every document read but absent from the old schema, and D5 was
"listed [by the old skeleton] with no schema" even though it's a standard grid in every document checked.

## Years
- **D1, D3–D8, D10–D22** describe institutional policy, not one entering class; the lineage year is the CDS
  **edition** itself (e.g. "2025–26"), the same convention as other non-cohort D/E/F items.
- **D2** describes the same entering class as the document's C1 (the fall the edition's first-year class entered,
  e.g. Fall 2025 for a 2025–26 edition). It carries the same lineage year as `reported.admissions.year` when both
  come from the same document visit, which they always do under round-3's one-document-one-visit rule.
- **D9** likely describes the *next* transfer application cycle, by analogy with C13's application fee (stated for
  "the fall 2026 cycle" in a 2025–26 edition) and C14–C18's forward-dated deadlines — one cycle ahead of the
  entering class D2 reports. This isn't independently confirmed for D9 in the inventory; see
  [Open questions](#open-questions-for-the-owner).

## Checks
Per round-3 Decision 9, every item is checked on its own; one item's failure sends only that item to the review
queue and never blocks another.

- **D1 consistency.** D1 "No" together with `D2.applicants.total > 0` is a document inconsistency → review (a
  college can't say it doesn't enroll transfers while reporting transfer applicants). D1 blank with `D2` filled
  (UIUC's pattern) is **not** a failure: `enrolls_transfers` is set `true`, inferred from D2, and the record notes
  the inference so the ⓘ tooltip can say so.
- **D2 arithmetic.** For each of applicants, admitted, enrolled: men + women + unknown = the total row, within ±1
  (rounding). Funnel order: enrolled ≤ admitted ≤ applicants, for the total and for each sex column.
- **D2 agreement with the federal count.** `enrolled.total` within 25% of `demographics.transfer_in.count`
  ([transfers.md](transfers.md), IPEDS `EF{Y}A`, same fall), otherwise review. This is round-3 Decision 9's own
  example tolerance for this item. It is a plausibility check, not a replacement — see [Store](#store).
- **D5 one mark per row.** Each of the 5 materials gets exactly one of required/recommended/not required. Zero or
  more than one mark on a row after the layout pass leaves the row undecided (round-3 Decision 3: vision is a logged last resort, off by default);
  still undecided after vision → review as "document inconsistent."
- **D9 dates.** Each month/day pair is a valid calendar date. Within a term: closing date on or after priority date;
  reply date on or after notification date. A term marked "rolling" skips the notification-date check for that term.
- **D4, D6, D7 ranges.** Credits 0–200; GPA 0–5. A college-stated GPA above 4.0 gets the same `weighted: true` flag
  cds-admissions.md's C12 check uses, never compared across colleges as if unweighted (D6/D7 coverage is thin enough
  that this mostly matters for future backfill, not today's display).
- **D12–D22, D8, D11.** No numeric check; stored as extracted text with its quote, not parsed beyond what's needed
  to display it verbatim.

## Store
```ts
reported.transfer: {
  enrolls_transfers: boolean | null;       // D1, or inferred true when D1 is blank and D2 has applicants
  advanced_standing: boolean | null;       // D1's second checkbox
  applicants: { men: number | null; women: number | null; unknown: number | null; total: number } | null;   // D2
  admitted: { men: number | null; women: number | null; unknown: number | null; total: number } | null;     // D2
  enrolled: { men: number | null; women: number | null; unknown: number | null; total: number } | null;     // D2
  admit_rate: number | null;               // derived: admitted.total ÷ applicants.total, admitted ≥ 10
  terms: ("fall" | "spring" | "summer")[]; // D3 (confirm whether a "winter" option exists in the live template before build)
  min_credits: number | null;              // D4
  required_materials: {
    transcript: "required" | "recommended" | "not_required" | null;
    essay: "required" | "recommended" | "not_required" | null;
    interview: "required" | "recommended" | "not_required" | null;
    standardized_tests: "required" | "recommended" | "not_required" | null;
    statement_of_good_standing: "required" | "recommended" | "not_required" | null;
  } | null;                                // D5
  min_hs_gpa: number | null;               // D6
  min_college_gpa: number | null;          // D7
  dates: Partial<Record<"fall" | "winter" | "spring" | "summer", {
    priority: { month: number; day: number } | null;
    closing: { month: number; day: number } | null;
    notification: { month: number; day: number } | "rolling" | null;
    reply: { month: number; day: number } | null;
  }>> | null;                              // D9
} | null
```
Registered in `lib/fields.ts` as `reported.transfer.enrolls_transfers`, `.applicants`, `.admitted`, `.enrolled`,
`.admit_rate` (method `derived`, inputs `applicants`/`admitted`), `.terms`, `.min_credits`, `.required_materials`,
`.min_hs_gpa`, `.min_college_gpa`, `.dates` — each `source: "college-site"`, `method: "extracted"` (or `derived` for
the rate), with a quote, URL, retrieved date, and the item's own year per [Years](#years). Nested leaves (the sex
breakdown inside `applicants`/`admitted`/`enrolled`, each material inside `required_materials`) are covered by their
registered parent, as `data-lineage.md` allows.

**Store-only, not registered here: D8, D10–D22.** Per round-3's "a document's visit counts once" contract, these are
extracted into the per-document record (`data/cds-records/<unit_id>.json`, group `DEF`) on the one big run, with
their quotes, so a later spec can merge them into `school.reported.transfer` and register fields with **no re-fetch
and no re-discovery** — only a schema-version bump and a re-extraction from the archive (round-3 Decision 10). They
are mostly free text or low-yield policy fields the inventory's unit U14 found not worth a UI today.

**Newest-everywhere does not apply.** D2 answers a different question (an admission funnel: who applied, got in, and
enrolled as a transfer) than `demographics.transfer_in.count` (a headcount: how many transfer students sat in a
classroom this fall, from any admission path). D2 is a new field, additive to the profile, not a replacement of the
federal count — it's checked against that count for plausibility only (see [Checks](#checks)), and both values stay
on the site, each cited to its own source and year.

**Partial coverage → never in ranks, medians, or Explore percentile comparisons.** Every `reported.transfer.*` value
is self-reported and will cover only the colleges whose CDS the round-3 run locates and reads successfully — likely
well under all 1,893. It's shown on the profile and in Compare, and is available in Explore only as a boolean (see
[Display](#display)), exactly like `cds-academics.md`'s class sizes and `cds-admissions.md`'s GPA bands.

## Display
- **Profile, Admissions topic page** ([school-profile.md](../school-profile.md)): a "Transferring in" card, shown
  only when `enrolls_transfers` is known (true or false) or `admit_rate` is available:
  - The transfer admit rate beside the first-year admit rate already on the page ("14% of transfer applicants were
    admitted, vs. 6% of first-year applicants"), each independently cited (the first-year rate to
    `admissions.acceptance_rate`/`newestAdmissions`, the transfer rate to `reported.transfer.admit_rate`) so the two
    years can differ without implying one ratio.
  - Terms transfers may enter, minimum credits to apply, and the required-materials grid as a short checklist
    (required/recommended/not required per material), each cited with `citeField`. No chip, no banner — the ⓘ
    popover on the card's headline carries the source, edition, quote, and retrieval date, as
    [college-reported-round-2.md](../college-reported-round-2.md) sets for every reported value.
  - A college with `enrolls_transfers: false` shows a one-line "Does not enroll transfer students" fact instead of
    the funnel.
  - Minimum GPA (D6/D7) appears only when present; it's blank at most colleges and the card doesn't show an empty
    row for it.
- **Compare** ([comparison.md](../comparison.md)): a "Transfer admit rate" row, blank (not zero) for a college
  without data, same quiet treatment as `cds-academics.md`'s "Classes under 20 students" row.
- **Explore**: an **"Admits transfers"** boolean filter — true when `reported.transfer.enrolls_transfers` is known
  true, or, for a college round-3 hasn't read yet, when the federal `demographics.transfer_in.count > 0` (a college
  enrolling transfer students almost certainly admits them, even without a read CDS). No sort or range filter on the
  admit rate while coverage is partial, matching `cds-admissions.md`'s "Has GPA data"-only rule.
- **Glossary**: new terms `transfer-admission` (the CDS funnel: applicants, admitted, enrolled, distinct from
  `transfer-in`'s headcount) and `advanced-standing`; both link to the existing `transfer-in` entry.

## Keep history?
**Series per CDS edition** for the transfer admit rate, once 2+ editions exist for a college (same rule as
`cds-admissions.md`'s GPA and early-decision series). No backfill of past editions in phase 1, though index pages at
several inventoried colleges (Georgia Tech 25 past PDFs, TCU 25, Harvard 19) make it possible later. The federal
`transfer_in_count`/`transfer_in_share` series ([transfers.md](transfers.md)) is unaffected and keeps its own history.

## Top-level trend?
**None.** Useful at the college level only — the same conclusion the 2026-09-28 skeleton reached, unchanged by this
upgrade.

## Corrections to the skeleton
From the inventory's section 4, applied in this version:
1. **D2 gains the sex breakdown and total row.** The skeleton's `reported.transfer` had only flat
   `applicants`/`admitted`/`enrolled` numbers; all 19 documents read actually print men/women/unknown rows plus a
   total, so the store now keeps the breakdown (the total is what's displayed; the breakdown is kept for a future
   by-sex view and for the arithmetic check).
2. **D5 (required materials) is now in scope with a schema.** The skeleton listed D5 in its source table but "the
   schema omits" it (inventory's words); it's a full grid here, with the same checkbox-column handling as C7.
3. **D6/D7 minimum GPA stay optional**, confirmed low-yield (blank at all but Howard in this sample; Cornell and
   UIUC explicitly say no minimum), so the profile card only shows them when present.
4. The skeleton's check "transfer enrollment is within 25% of the federal count... (Vanderbilt fall 2024: 359)" is
   kept, now sourced to `demographics.transfer_in.count` ([transfers.md](transfers.md)) by its real field name
   rather than a direct `DRVEF`/`EFUGTRN` reference, since that spec already built the reader.

## Build
- `lib/fields.ts`: the `reported.transfer.*` registrations in [Store](#store).
- `lib/cds-sections.ts`: D1–D22 item definitions and their checks, added to model group `DEF` (round-3 Decision 4);
  D5's two-pass checkbox handling reuses the layout/vision code C7 needs (round-3 Decision 3.5).
- A merge step (alongside the existing `reportedToPatch`/`mergeReported` path, [college-reported-round-2.md](../college-reported-round-2.md)
  Decision 5) that copies `passed` D items from `data/cds-records/<unit_id>.json` into `school.reported.transfer`
  with `extracted` lineage; run by `merge-reported.mts` and `sync-data`, same as admissions.
- `components/profile/TransferringInCard.tsx` on the admissions topic page; a small required-materials checklist
  component (shared shape with a future C7 factors component, since both are "label → one of N levels" grids).
- `lib/params.ts`/Explore: the `transfers=1` filter param and its fallback to the federal count.
- `lib/comparison.ts` (or wherever Compare's "All the numbers" rows are declared): the transfer admit rate row.
- `lib/glossary.ts`: `transfer-admission`, `advanced-standing`.
- Tests: D2 arithmetic (men + women + unknown = total) failing when broken; the 25%-of-federal agreement check
  failing on a planted mismatch; D1-inferred-from-D2 (UIUC's pattern) not flagged as an error; D5's one-mark-per-row
  check catching zero and double marks; a guard (alongside `tests/reported-guards.test.mts`'s existing import ban)
  that `reported.transfer.*` never reaches `rankOf`, a percentile, or a median.

## Open questions for the owner
1. **D9's year.** Is the application-dates grid for the *next* transfer cycle (one year ahead of D2's entering
   class), as C13–C18 are for first-year admission, or for the same cycle D2 describes? Not independently confirmed
   in the inventory for section D specifically.
2. **D3's exact term options.** The inventory confirms a checkbox list but not whether the live 2025–26 template
   offers a "winter" term alongside fall/spring/summer; worth a quick look at one template workbook before the
   schema is finalized.
3. **D5 PDF coverage beyond the template set.** The inventory's item matrix confirms D5 in all T5 (the 4 template
   workbooks plus Howard's form) but doesn't separately list PDF coverage counts the way D2 does; it's a standard
   CDS item expected in every edition, but worth confirming during the pilot rather than assuming.

## As built
Built 2026-10-03 on the round-3 foundation. Real data: Vanderbilt 221999, Cornell 190415, William & Mary 231624, and
Illinois 145637 have a `reported.transfer` block in `data/schools.json` (transfer acceptance rates 26%, 12%, 46%, 43%;
all four pass every check; Vanderbilt's and Cornell's enrolled totals are just inside the 25% limit, 24.2% and 24.3% above the federal count).

**Record → block** (`lib/cds/transfer.ts`, pure). `transferFromRecord(record, { federalCount })` reads the newest
document with any passed section-D item and returns the block, one lineage record per stored field, and an outcome
(`failures`, `inferredEnrolls`). `mergeTransfer(school, record)` is idempotent and removes a previous block;
`lib/reported-merge.ts#mergeReported` calls it after `mergeResidency`, so `npm run merge-reported` and `sync-data` carry
it. Only **passed** items are read. Each group is checked on its own and a failure drops only that group, listed in
`outcome.failures` (the review-queue wiring belongs to `lib/cds-checks.ts`):
- `transfer-d1-consistency`: D1 "No" with D2 applicants drops D1. D1 blank with D2 applicants sets `enrolls_transfers:
  true` with a `derived` lineage record cited to D.204 whose quote reads "D1 left blank; inferred from D2: 6,639 transfer
  applicants" (Illinois), so the ⓘ says it was inferred.
- `transfer-d2-sum` (±1, rows printing only a total skip it), `transfer-d2-funnel` (total and each sex), and
  `transfer-d2-vs-federal` (25% of `demographics.transfer_in.count`; skipped without a federal count). Any D2 failure
  drops applicants, admitted, enrolled, and the rate. The federal count is IPEDS's newest fall, which can be a year
  behind the edition (today Fall 2024 against the 2025–26 editions' Fall 2025); the tolerance applies as written.
- `transfer-d5-mark`: per row, exactly one level. A blank row in an answered grid is "zero marks"; a value naming two
  levels is "more than one mark"; either leaves that row null. The layout/vision passes are the readers' work.
- `transfer-d9-date` and `transfer-d9-order` per term. The order checks allow a window across the new year (a
  December priority date before a March closing date) up to 240 days; a rolling term skips notification-vs-reply.
- `transfer-range`: D4 credits 0–200; D6/D7 must be on a 4.0 scale. A GPA over 4.0 is not stored (held for review)
  rather than stored with a `weighted` flag; no college in the sample states one.
- **Years:** D2 and the rate use `years.fall` ("Fall 2025"); D9 uses `years["next-cycle"]` ("Fall 2026 cycle", the
  template's year rule, answering open question 1 provisionally); the rest use `years.edition` ("2025–26").
- **Quotes:** workbook cells get generated quotes that say which row a number is in ("Transfer applicants, total:
  7,381"; the rate: "Transfer applicants: 7,381; admitted: 864"; the materials and dates list each row, clipped at 160).

**Corrections to the Store schema** (from the live 2025–26 template; open question 2 answered):
- D3 has four options, **winter** included: `terms: ("fall" | "winter" | "spring" | "summer")[] | null` (null, not `[]`,
  when none is checked).
- D5 has **six** rows, two transcripts: `high_school_transcript` and `college_transcript` replace `transcript`. Each
  row keeps the template's five marks: `required`, `required_some`, `recommended`, `recommended_some`, `not_required`
  (Cornell's interview is "Required of Some", William & Mary's high school transcript "Recommended of Some"); folding
  them into three would overstate the requirement.
- `min_credits_unit` (D.403, e.g. "Credit(s)") is stored beside `min_credits` and registered, and
  `advanced_standing` is registered too (every stored leaf must be). D4's minimum is dropped when D.401 says no minimum.
- "No minimum required" in D6/D7 (Cornell) is text, stored as null: the card shows no row.
- Types: `ReportedTransfer`, `TransferCounts`, `TransferTerm`, `TransferRequirement`, `TransferMaterials`,
  `TransferTermDates` in `lib/types.ts`; 13 `reported.transfer.*` fields in `lib/fields.ts`.

**Display** (`lib/cds/transfer-display.ts`, pure: `transferCard`, `compareTransferAdmitRate`, `admitsTransfers`,
`TRANSFER_FILTER`, labels):
- Admissions page: `components/school/TransferringInCard.tsx` below "What they look at", "On this page" id `transfer`
  ("Transferring in", listed only when the card shows). The transfer rate and the first-year rate are separate cited
  labels ("12% of transfer applicants were admitted" · "vs. 8.4% of first-year applicants"), then applied/admitted/
  enrolled, terms, minimum credits, minimum GPAs when present, advanced standing, dates per term, and the materials as a
  checklist (`components/school/RequirementChecklist.tsx`, a generic label → level list for a future C7 grid). A
  college with `enrolls_transfers: false` gets "Does not enroll transfer students". The fields are in `TOPIC_FIELDS.admissions`.
- Compare: "Transfer acceptance rate" after the federal transfer rows, blank (–) without data.
- Explore: "Admits transfer students" (`transfers=1`) in its own "Transfer students" section and the active-filter
  chips: the CDS answer when known, else `demographics.transfer_in.count > 0`.
- Glossary: `transfer-admission` and `advanced-standing`, both related to `transfer-in`.
- Not yet: the per-edition history series (one edition per college today); the ⓘ says "on its own site" rather than
  "in its Common Data Set" for colleges without a `reported.admissions` block, because `lineageFor` takes `sourceKind`
  from that block (shared with the residency rows).

**Tests** (`tests/cds-transfer.test.mts`): the four real records' values and years; D2 sum and funnel; the planted 25%
mismatch; Illinois's inference not flagged and D1 "No" with applicants flagged; D5 zero and double marks; D9 dates and
order; merge idempotence and lineage validation; the card, Compare, and filter (with its federal fallback); and the
partial-coverage guard (`reported.transfer` never in `lib/metrics.ts`, `insights`, `indicators`, `history`, `compare`,
Home, Explore sorts, or `lib/dataset.ts` outside its filter). Each check was shown to fail with its code broken.

## Roadmap entry
- slug: cds-transfer
- summary: Transfer applicants, admits, and what transfer students need to get in — a chance at transferring, not
  just a headcount.
- complexity: 1 — One Common Data Set section, almost entirely deterministic reads (code tables, form fields, a
  layout pass for one checkbox grid); no new pipeline infrastructure beyond round-3's.
- after: ["college-reported-round-3"]
