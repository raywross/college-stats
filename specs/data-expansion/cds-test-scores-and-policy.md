# CDS Test Policy and Test Scores (C8, C9)

> Status: **built** (2026-10-03; see [As built](#as-built)). Wave 4: built from the CDS records of [round 3](../college-reported-round-3.md)
> after its one full run, with no new visit to any college. Inventory units U2 (the coming cycle's test policy) and U3
> (C9 detail: the college's own SAT total, score bands, number submitting). Coverage figures come from the CDS
> inventory of 19 read 2025–26 documents (scratchpad `cds-gap/cds-gap-report.md`, 2026-10-03); where this spec counts
> something the inventory didn't, it says so and the count was made from the inventory's own files (`answer-sheet.tsv`,
> `howard-by-code.tsv`, `text/`, `text-layout/`). Part of [data-expansion](README.md).

## Question it answers
- *Do I have to send SAT or ACT scores for the cycle I'm applying in?* The site shows the federal policy for students
  who entered in fall 2024 (IPEDS ADM `ADMCON7`). A 2025–26 CDS answers for students applying for fall 2027, which by
  the time the round-3 run publishes (autumn 2026) is the cycle students are applying in.
- *Where does my 1450 fall?* The site adds the two SAT section percentiles to estimate a total. The CDS gives the
  college's own SAT total percentiles and, more useful, the share of enrolled first-years in each score band ("23% of
  those who sent an SAT scored 1400 or higher"), plus how many students actually sent each test.

## What the inventory found
- **C8 is answered everywhere; the grid column is the hard part.** Grid marks were read for 17 of 19 documents
  (counted for this spec): 4 required (Cornell, Harvard, Georgia Tech, MIT), 1 recommended (Michigan), 12 considered
  if submitted (Vanderbilt, William & Mary, UIUC, Howard, Baylor, Duke, Loyola, Spelman, TCU, USC, UW–Eau Claire, Texas
  A&M). Berkeley and Purdue are classic workbooks whose "x" loses its column in `sheetText` (inventory section 5).
- **Few changes against federal, but the ones that exist matter.** Against the site's federal fall 2024 value, 2 of
  the 17 differ: Cornell (considered → required) and Michigan (considered → recommended, a category IPEDS dropped in
  fall 2022). Harvard, Georgia Tech, MIT, and Purdue already required tests in fall 2024. The inventory's "several
  colleges have since reinstated requirements" is one college in this sample.
- **The true SAT total barely differs from the site's sum.** At 14 of the 17 documents with both, the composite
  percentiles equal the section sums or differ by at most 20 points (Vanderbilt, William & Mary, Duke, and Michigan
  equal at all three percentiles, which suggests some colleges add the sections themselves); UIUC differs by 38 at the
  50th (1442 vs 720 + 760), UW–Eau Claire by 40 (23 SAT submitters), and Loyola by 100 at the 25th percentile (1220 vs
  580 + 540). The gain from C9 is the bands,
  the 50th percentiles, the counts, and a class one year newer, not the composite.
- **Number submitting checks the share.** Number ÷ C1 enrolled matched the stated share within 1 point at every
  document checked (Baylor 1,679 of 3,552 = 47.3% vs 47%; Harvard 1,325 of 1,675 = 79.1% vs 79%; Michigan, Duke, Georgia
  Tech, Spelman, TCU, USC, William & Mary) except UW–Eau Claire's SAT: "0%" stated, 23 of 1,742 = 1.3%.
- **Submission shares move with policy.** Harvard sent SAT scores at 54% in fall 2024 (federal) and 79% in fall 2025
  (CDS) after reinstating its requirement, so no federal-agreement check is possible on shares.

## Items to capture (by template code)
Every item below is read **deterministically** from the 2025–26 template workbook (per-sheet code table or ANSWER
SHEET) and from the fillable CDS PDF (field name = the template's "US News PDF Tag"). "Model" says whether a
flattened PDF or HTML page needs the round-3 model call (after the layout pass). "Merged" = merged into
`school.reported`; "records" = kept in `data/cds-records/` only, with no UI until a feature needs it.

### C8: SAT and ACT policies (one group year: the application cycle)
| Code | Item | PDF tag (fillable form) | Coverage (19 read) | Model for PDF/HTML? | Kept |
|---|---|---|---|---|---|
| `C.801` | C8A: Does your institution make use of SAT or ACT scores in admission decisions for first-time, first-year, degree-seeking applicants? (Yes/No) | `ADMS` | Every document checked | No (single value beside its label) | Merged |
| `C.802` | C8A grid, row "SAT or ACT": Required to be considered for admission / Required for some / Recommended / Not required for admission, but considered if submitted / Not considered for admission, even if submitted, "for students applying for Fall 2027" | `EXAM_CODE_S1A` | 17 of 19 decided (see above); all T5 | Layout pass (x under column headers) first; model or vision only if undecided | Merged |
| `C.803` | Grid row "ACT Only" (same five answers) | `EXAM_CODE_ACT` | Marked at CU, IL, VU, LUC, USC, SP, TAMU, UCB; blank elsewhere | Same | Merged |
| `C.804` | Grid row "SAT Only" | `EXAM_CODE_SAT` | Same as ACT Only | Same | Merged |
| — | C8B, C8C: "Has been removed from the CDS" in 2025–26 (no codes; the inventory's "C8A–C8D grid" is the C8A grid plus C8D) | — | — | — | — |
| `C.8D` | C8D: Does your institution use applicants' test scores for academic advising? | `AP_TEST_ADVISE` | All T5; PU No; MIT No; TAMU "N/A" | No | Records |
| `C.8E01`, `C.8E02` | C8E: Latest date by which SAT or ACT scores must be received for fall-term admission (month, day) | `AP_SAT1_ACT_DL_MON`, `_DAY` | CU, WM, HU, EC (inventory); also HA "1-Mar", GT "23-Jan", MIT "Feb. 15", TAMU "December 1" (counted here); PU "N/A" | Yes (free-form dates) | Records |
| `C.8F` | C8F: If necessary, use this space to clarify your test policies (free text) | `AD_TEST_POLICY_T` | WM, IL ("test optional"), EC (a URL) (inventory); HA, BU, UCB (counted here; UCB's text is about references, not tests) | Yes | Merged (as a quote) |
| `C.8G01`–`C.8G07` | C8G: Tests used for placement: SAT, ACT, AP, CLEP, institutional exam, state exam (check), state exam (name) | `SAT1_PLACE`, `ACT_PLACE`, `AP_PLACE`, `CLEP_PLACE`, `INST_PLACE`, `STATE_PLACE_T_CHECK`, `STATE_PLACE_T` | VU, WM, IL, HU, EC (inventory); HA, MIT (counted here) | No (single-column list survives plain text) | Records |

### C9: first-year profile, test scores (one group year: the entering fall)
| Codes | Item | Coverage (19 read) | Model for PDF/HTML? | Kept |
|---|---|---|---|---|
| `C.901`, `C.902` | Percent submitting SAT / ACT scores | 18 of 19 (UCB's C9 is blank: test-blind) | Yes (row "Submitting SAT Scores \| 47% \| 1,679" in layout text) | Merged |
| `C.903`, `C.904` | Number submitting SAT / ACT scores | 17 of 19 (not LUC, UCB) | Yes | Merged |
| `C.905`–`C.907` | SAT Composite 25th / 50th / 75th percentile | 16 complete; LUC 25th and 75th only (its form has no 50th column); blank at HA and UCB. The inventory's "17 of 19" counts UCB, whose C9 is empty | Yes | Merged |
| `C.908`–`C.910` | SAT Evidence-Based Reading and Writing 25th / 50th / 75th | 18 of 19 (LUC no 50th) | Yes | Merged (replaces federal, Decision 2) |
| `C.911`–`C.913` | SAT Math 25th / 50th / 75th | 18 of 19 (LUC no 50th; Duke's row falls on the next page) | Yes | Merged (replaces federal) |
| `C.914`–`C.916` | ACT Composite 25th / 50th / 75th | Every document with C9 scores | Yes | Merged (replaces federal) |
| `C.917`–`C.919`, `C.920`–`C.922` | ACT Math, ACT English 25th / 50th / 75th | Same | Yes | Merged (replaces federal 25th/75th; 50ths new) |
| `C.923`–`C.925` | ACT Writing 25th / 50th / 75th (2–12 scale) | VU only | Yes | Records |
| `C.926`–`C.928`, `C.929`–`C.931` | ACT Science, ACT Reading 25th / 50th / 75th | Science 10 of 19 (VU, HA, HU, BU, GT, LUC partial, USC, MIT, TAMU, PU; counted here); Reading in the same documents where checked | Yes | Merged |
| `C.932`–`C.937` (+ `C.938` total) | % of first-years with SAT EBRW in 700–800, 600–699, 500–599, 400–499, 300–399, 200–299 | Every document with SAT scores (HA included) | Yes | Merged |
| `C.939`–`C.944` (+ `C.945`) | Same for SAT Math | Same, except LUC (prints EBRW only) | Yes | Merged |
| `C.946`–`C.951` (+ `C.952`) | Same for SAT Composite: 1400–1600, 1200–1399, 1000–1199, 800–999, 600–799, 400–599 | 17 of 19 (blank at HA, UCB) | Yes | Merged |
| `C.953`–`C.958` (+ `C.959`) | % with ACT Composite in 30–36, 24–29, 18–23, 12–17, 6–11, below 6 | Every document checked (14) | Yes | Merged |
| `C.960`–`C.965` (+ `C.966`), `C.967`–`C.972` (+ `C.973`) | Same for ACT English, ACT Math | Most; CU "-" for both; TCU composite only; LUC no English | Yes | Merged |
| `C.974`–`C.979` (+ `C.980`), `C.981`–`C.986` (+ `C.987`) | Same for ACT Reading, ACT Science | About half (BU, GT, HA, HU, USC, PU, LUC; EC and TCU blank) | Yes | Records |

The bracketed totals (`C.938`, `C.945`, `C.952`, `C.959`, `C.966`, `C.973`, `C.980`, `C.987`) are template formula
cells: read, never stored as data, used only to place a lone column and to tell a blank column (total 0) from a filled
one. **102 codes** in all: 15 in C8, 87 in C9.

### How each format reads them
| Format | C8 grid | C9 |
|---|---|---|
| 2025–26 workbook (VU, CU, WM, IL) | Code table text values: `C.802` = "Required to be considered for admission", "Not required for admission, but considered if submitted", etc., mapped by normalized prefix | Code table values, as typed (fractions like 0.972, floats like 0.0337892…) |
| Fillable PDF (HU) | Radio export values, **trimmed** ("ADMS_CONSIDER " has a trailing space): `ADMS_REQ` required, `ADMS_RFS` required for some, `ADMS_REC` recommended, `ADMS_CONSIDER` considered, `ADMS_NOT_USED` not considered. The widgets are listed REQ, REC, RFS, …, not in column order: map by export value, never by widget index | Field values by code (`SUBMIT_SAT1_N` 1163, `SAT1_COMP_25TH_P` 1050). Band fields are named `ACT_6_P` … `ACT_1_P` (6 = 30–36): map through the tag column, not the name |
| Flattened PDF (HA, USC, GT, SP, BU, TCU, LUC, EC, UM, DU) | Layout pass: the mark ("X", "x", Spelman's private-use glyph) is assigned to the column header whose center is nearest its x (HA X at 287 under "Required to be considered" at 258–318; EC x at 371 under "Not required … considered" at 349–410). Michigan prints five ☐/☒ glyphs per row: the ☒'s index is the column | Layout rows (`SAT Math \| 730 \| 770 \| 790`); band columns with blanks are placed by x or by the "Totals should = 100%" row (EC: "100.00% 100.00% 100.00% 0.00% 0.00%" says Reading and Science are blank) |
| Classic workbook (UCB, PU) | Needs column letters; `sheetText` drops them | Label match |
| HTML (MIT, TAMU) | MIT: an "X" cell, after collapsing whitespace inside `<tr>`; TAMU: each cell reads "Applies" or "Does not apply" | Table rows |

## Years
- **C8 (all items): the application cycle**, read from the document's own sentence ("…for students applying for Fall
  2027"). Stored as `cycle` (the fall the applicants would enter) and as the lineage year `"Fall 2027 applicants"`
  (`fallYear()` reads 2027). Check: cycle = edition start year + 2; a mismatch fails the group (wrong edition filed, or
  a stale template), which also catches USC's and Loyola's "2024-2025" page headers on 2025–26 files.
- **C9: the entering class**, from C9's sentence ("enrolled in Fall 2025"); must equal the edition's start year.
  Lineage year `"Fall 2025"`.
- UI text never names a year: the policy block's "For students entering in fall {cycle}" and the scores' class year
  come from lineage, so the next edition (fall 2028 applicants, fall 2026 class) needs no code change.

## Checks
Every check sets the item's record status (round 3 [Decision 9](../college-reported-round-3.md#decision-9-checks-for-every-item-including-deterministic-reads-publish-and-escalate-per-item)):
a failure sends the item to the review queue, never a silent fix. Only `passed` items reach the merge.

### C8
| Check | Rule | Sample |
|---|---|---|
| Normalize | Yes/No from "Yes", "Y", "No", "N"; the placeholder "Yes or No" and "N/A" are blank | — |
| One mark per row | Each grid row has 0 or 1 mark; two marks fail | — |
| Grid present | C8A Yes ⇒ at least one row marked; C8A No ⇒ no row marked other than "not considered" (C8A No alone means not considered, quoted from C8A) | — |
| C8A agrees with the grid | C8A Yes with "SAT or ACT" = not considered fails ("says tests are used, marks them not considered") | UCB: C8A "Y" with a note about SAT II subject tests, while federal says test-blind. Its column must come from column letters; if it reads "not considered", this check sends it to review |
| Headline | `policy` = the "SAT or ACT" row; else ACT Only and SAT Only when they agree; else null ("varies by test"), which is stored and shown per test, not a failure | All 17 decided documents mark "SAT or ACT" |
| C8F agrees | Keyword rules on C8F: "test-blind" or "not consider" contradicts required/considered; "optional" contradicts required; "required" (not "not required") contradicts considered or not considered. A contradiction fails; no keyword, no check | WM "optional" + considered: pass. IL "test optional": pass |
| Cycle | As in Years | All 17 say Fall 2027 |
| Federal | **No agreement check**: the federal value describes an earlier cycle, so a difference is the point. The run summary lists every difference for the owner to eyeball ("Cornell: considered (fall 2024) → required (fall 2027 applicants)") | 2 of 17 |
| C8E | Month 1–12 and a valid day; normalizes "6/1", "1-Mar", "Feb. 15", "December 1", Excel serials; "N/A" blank | Records only |
| C8G | Blank ≠ no: an unchecked box is null, never false | Records only |

### C9
| Check | Rule | Sample |
|---|---|---|
| Ranges | SAT sections 200–800, composite 400–1600, ACT 1–36, ACT Writing 2–12, shares 0–100%, numbers whole and ≥ 0 | Values need not be multiples of 10: IL's composite 50th is 1442, its ACT 50th 32.3 ("if you average the scores, use the average") |
| Order | 25th ≤ 50th ≤ 75th per row; a missing 50th is allowed | LUC |
| Composite vs sections | At each percentile with all three present, \|composite − (EBRW + Math)\| ≤ 50 | 16 of 17 pass (max 40, EC); LUC fails at the 25th (+100) → review |
| Share form | Decided per test by the number: share = number ÷ C1 enrolled tells 0.24 from 24 from 0.24%. Without a number, ≤ 1 is a fraction unless written with "%" | VU 0.24, HU 47, TAMU 76.72, PU 0.8384… |
| Number vs share | \|stated share − number ÷ C1 enrolled\| ≤ 1 point, with C1 enrolled from the **same document's passed C1**; number ≤ C1 enrolled. No passed C1: the check is skipped and the number is stored but not shown | 11 documents checked pass; EC SAT fails ("0%" vs 1.3%) → review. The reviewer may accept the computed share |
| Band column form | Per column: values summing to 1 ± 0.01 are fractions, to 100 ± 1 are percents; anything else fails. Blank cells in a filled column are 0 | VU 0.972 (fraction), LUC "23.8" (percent with no sign), PU 0.4266 |
| Bands sum | Each filled column sums to 100% ± 1. A column whose cells are all blank, "-", or "N/A", with a total of 0, is **blank**, not failed | WM 1.0001: pass. CU ACT English "-" with total 0: blank |
| Bands agree with percentiles | For each test with both: the band holding the p-th percentile satisfies share below the band ≤ p ≤ share through the band, ± 2 points, for p = 25 and 75. Catches a lone column placed under the wrong header | EC composite: 25th 1050 in 1000–1199, 8.7% below, 56.5% through: pass |
| Federal change | Each SAT section 25th/75th within 50 points of the value it would replace; ACT composite within 3. A failure is an "implausible change" (escalated once, then review) | All 17 pass; largest HA Math 25th 730 vs 770 (40), after Harvard reinstated tests |
| Display minimum | A test with fewer than 50 submitters (`MIN_SUBMITTERS`; number, or share × C1 enrolled) **passes** but is neither shown nor applied | EC SAT: 23 submitters, so its bands (43.5% = 10 students) never show |

### Traps (from the inventory and this count)
- "##" overflow in printed totals (LUC C1) can hit C1 enrolled, which the number check needs: C1's own rule sums the
  parts.
- Digits split by the printer (GT "$3 4 , 604"): join digits inside one cell when the x-gaps are small.
- A table split by a page break (Duke's SAT Math row is on the next page) and blank pages mid-section (Duke).
- Text in numeric cells ("N/A", "N/Av", "-", "XXXXX") is blank; never 0.
- Template totals are formulas: a total of 0 with "-" cells is a blank column, not a 0% column.
- Rounding: VU-style stated shares to two places; IL-style long floats. Store as 0–1 rounded to 4 places.

## Decision 1: the coming cycle's policy is the newest test policy
**Rule.** A passed C8 policy **replaces `admissions.test_policy` in the dataset** under the newest-everywhere rule
([round 2, Decision 1](../college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere)), with
the previous value kept and the cycle named in the ⓘ ("For students applying to enter in fall 2027 · Harvard
University's Common Data Set 2025–26 · Federal data, fall 2024: Required").

**Why it's the same field, not a new one.**
- Same question and population: how SAT/ACT scores are used in admission decisions for first-time, first-year,
  degree-seeking applicants. IPEDS's three answers since fall 2022 (required, considered if submitted, not considered)
  are three of the CDS's five; "recommended" was an IPEDS answer through fall 2021, so `TestPolicy` already has it.
- The reader's question is about their own cycle. The federal value is three cycles old; the CDS value is the current
  cycle once the run publishes. Showing both would be the duplicate figure the owner ruled out.
- What stays honest: the ⓘ names the cycle and the replaced federal value; the scores below carry their own class
  year; when the policy changed between the scores' class and the coming cycle, the scores say so (Display).

**The new answer.** `TestPolicy` gains `"required-some"` (CDS "Required for some"). It never comes from federal data.
Labels: required "Test scores required", required-some "Required for some applicants", recommended "Test scores
recommended", considered "Test-optional", not-considered "Test-blind".

**What does not change.** History stays federal (round 2): the `test_policy` series, the Over time policy shading,
Home fact 3 ("Test-optional went mainstream"), and the [test-optional study](../trends/test-optional.md)'s national
lines and group shares are all IPEDS. The history latest-point check already skips a value with a lineage record.
`TEST_POLICY_CODES` is unchanged; `"required-some"` is never encoded into a series.

## Decision 2: same-definition C9 values replace federal ones, a block per test
C9's section percentiles, ACT composite/English/Math percentiles, and submission shares have the IPEDS ADM
definitions (enrolled first-time students who submitted the test; 25th/50th/75th). So the newest-everywhere rule
applies to them, **as a block per test**, never value by value, so a page never shows a federal median on a
college-reported range (today's `federalSat`/`federalAct` guard on the admissions page exists for exactly that):

| Block | Dataset fields replaced | Applied when |
|---|---|---|
| Policy | `test_policy` | C8 passed; cycle > the current value's fall |
| SAT | `sat_reading_25_75`, `sat_math_25_75`, `sat_reading_median`, `sat_math_median`, `test_submission_rate_sat` | EBRW and Math 25th/75th and the SAT share passed; entering fall newer than the current block's lineage year; ≥ `MIN_SUBMITTERS` SAT submitters |
| ACT | `act_composite_25_75`, `act_composite_median`, `act_english_25_75`, `act_math_25_75`, `test_submission_rate_act` | ACT composite 25th/75th and the ACT share passed; newer; ≥ `MIN_SUBMITTERS` |

Within a replaced block every value is the CDS's: a 50th or a section the CDS left blank becomes null in the
dataset (LUC's medians), never a leftover federal value. The previous block is kept in `admissions.federal_tests`
and restored byte for byte when the college leaves the records, exactly as `admissions.federal` works for the
funnel. A hand-imported CDS override (`data/overrides.json`, 8 colleges, which set C9 ranges today) is the
"previous" block when a newer edition arrives. The SAT and ACT blocks can come from different years; each value's ⓘ
says its own.

## Decision 3: the new C9 values never feed ranks; exactly what does
New fields (partial coverage, no federal definition): the college's SAT total percentiles, the band shares, the
numbers submitting, ACT Reading/Science percentiles. They are shown on the profile and Compare and are **never** in
ranks, medians, percentile comparisons, sorts, Known-for chips, or Explore range filters.

| Ranking, median, filter | Reads | After this spec |
|---|---|---|
| SAT metric `sat`: Explore `minSAT`/`maxSAT`, sort `sat`, the "median SAT" tile, card SAT meter, `rankOf("sat")` strip, `metricMedian("sat")` (the national median line), "Top test scores" chip, `similarSchools`, the Compare radar and Key differences | `derived.sat_mid` ← `derived.sat_composite` = `admissions.sat_reading_25_75` + `sat_math_25_75` | Still the **sum of sections for every college**, so all colleges are measured one way. The sections themselves are the newest (Decision 2: CDS when newer, else IPEDS ADM fall 2024). The college's own SAT total never enters |
| ACT metric `act`: `minACT`/`maxACT`, sort, rank, median | `derived.act_mid` ← `admissions.act_composite_25_75` | Newest (Decision 2) |
| "Test-optional heavy" chip | `test_submission_rate_sat`/`_act` | Newest (Decision 2) |
| Explore test-policy filter (new) | `admissions.test_policy` | Newest (Decision 1); categorical, no rank |
| History series `sat_25`, `sat_75`, `act_*`, `sat_submit`, `test_policy`; national distributions | IPEDS only | Unchanged |

**One SAT total per view.** The SAT total a college *shows* (`derived.sat_total`, computed) is its own composite
25th–75th when its SAT block came from a CDS that reports one, else the sum of sections. It is used wherever a
college's own range is drawn: the profile's ScoreChecker, the overview card's compact bar, Compare's SAT range bars and
"SAT middle 50%" row. Where a rank is drawn beside it (the "SAT midpoint vs. every college" strip), the strip shows the
college's position and rank sentence but prints no second total; its ⓘ says the rank adds sections for every college.
Measured difference between the two: at most 20 points at 14 of 17 documents, at most 40 at 16.

## Store
```ts
/** CDS C8's five answers, in the grid's column order. IPEDS uses required / considered / not-considered (and recommended before fall 2022). */
export type TestPolicy = "required" | "required-some" | "recommended" | "considered" | "not-considered" | null;

interface ReportedAdmissions {
  /* …existing C1 fields… */
  /** C8: policy for students applying to enter in fall `cycle` (C.801–C.804). */
  test_policy?: ReportedTestPolicy | null;
  /** C8F verbatim, trimmed to 500 characters; shown as a quote, never parsed beyond the C8F check. */
  test_policy_note?: string | null;
  /** Changes across the college's CDS editions and against the federal value (Keep history?). */
  test_policy_events?: TestPolicyEvent[] | null;
  /** C9: the first-years who entered in fall `year` and sent scores. */
  tests?: ReportedTests | null;
}

interface ReportedTestPolicy {
  cycle: number;                       // 2027
  uses_tests: boolean | null;          // C.801
  sat_or_act: Exclude<TestPolicy, null> | null;   // C.802
  act_only: Exclude<TestPolicy, null> | null;     // C.803
  sat_only: Exclude<TestPolicy, null> | null;     // C.804
  policy: Exclude<TestPolicy, null> | null;       // headline (Checks: "Headline"); null = varies by test
}

type Pct3 = { p25: number | null; p50: number | null; p75: number | null };
/** Shares 0–1 of enrolled first-years who sent that test, top band first, in the template's order. */
type Bands6 = [number, number, number, number, number, number];

interface ReportedTests {
  year: number;                                        // entering fall, 2025
  sat_share: number | null; act_share: number | null;  // C.901–C.902
  sat_submitters: number | null; act_submitters: number | null;  // C.903–C.904
  sat_composite: Pct3 | null;                          // C.905–C.907
  sat_ebrw: Pct3 | null; sat_math: Pct3 | null;        // C.908–C.913
  act_composite: Pct3 | null; act_math: Pct3 | null; act_english: Pct3 | null;  // C.914–C.922
  act_science: Pct3 | null; act_reading: Pct3 | null;  // C.926–C.931
  bands: {
    sat_ebrw: Bands6 | null; sat_math: Bands6 | null; sat_composite: Bands6 | null;   // C.932–C.951
    act_composite: Bands6 | null; act_english: Bands6 | null; act_math: Bands6 | null; // C.953–C.972
  };
}

interface TestPolicyEvent {
  cycle: number;                          // the fall the new policy applies to
  from: Exclude<TestPolicy, null>; to: Exclude<TestPolicy, null>;
  from_source: "cds" | "ipeds-adm"; from_year: number;
}

// school.admissions: the blocks a newer C8/C9 replaced (Decisions 1–2); present only then.
federal_tests?: {
  policy?: { year: number | null; test_policy: TestPolicy };
  sat?: { year: number | null; sat_reading_25_75; sat_math_25_75; sat_reading_median; sat_math_median; test_submission_rate_sat };
  act?: { year: number | null; act_composite_25_75; act_composite_median; act_english_25_75; act_math_25_75; test_submission_rate_act };
};
```
Missing is null everywhere, never 0. Records-only items (C8D, C8E, C8G, ACT Writing, ACT Reading/Science bands) are not
in `school.reported`.

**Registry** (`lib/fields.ts`, `reported()` helper: source `college-site`, vintage null, year per value):
`reported.admissions.test_policy`, `.test_policy_note`, `.test_policy_events`, `.tests.year`, `.tests.sat_share`,
`.tests.act_share`, `.tests.sat_submitters`, `.tests.act_submitters`, `.tests.sat_composite`, `.tests.sat_ebrw`,
`.tests.sat_math`, `.tests.act_composite`, `.tests.act_math`, `.tests.act_english`, `.tests.act_science`,
`.tests.act_reading`, and the six `.tests.bands.*` columns. Plus `admissions.federal_tests` (`adm`, like
`admissions.federal`) and computed `derived.sat_total` ("the college's own SAT total when its scores come from its
CDS and it reports one; else Reading & Writing + Math", inputs `reported.admissions.tests.sat_composite`,
`derived.sat_composite`).

**Lineage per value:** `source: "college-site"`, `method: "extracted"`, `url`, `retrieved`, `year` (the cycle for C8,
the entering fall for C9), `quote` built from the cited line(s) (a percentile row "SAT Composite | 1370 | 1460 | 1530";
a band column as "SAT Composite: 1400–1600 70.3%, 1200–1399 …", trimmed to 160 characters), and `page` or `cell`
(round 3's addition to `LineageRecord`). Replaced dataset values copy the record of the `reported.*` value they came
from, as `applyNewest` does for C1.

**Guard** (`validateSchool`): every `admissions.*` test value cited to `college-site` is extracted with quote, URL,
date, and year; `admissions.federal_tests` holds the block it replaced; within a replaced block, every non-null value
is cited to the college (nulls are blanks the CDS left); `reported.admissions.test_policy.cycle` is greater than the
federal policy's fall; `"required-some"` appears only with a `college-site` record.

## Display
Quiet, as round 2 ruled: provenance in the ⓘ, no chips, no banners, no duplicate figures.

**Admissions page, Test scores panel** (`#scores`):
- **Title wording fix:** "What admitted students scored" → "What enrolled first-years scored"; the ScoreChecker legend
  "Middle 50% of admitted students" → "Middle 50% of enrolled first-years who sent scores". Both ranges (IPEDS and CDS)
  describe enrolled students; chances-and-fit.md already says so.
- **New first block, "Test policy"** (every college with a policy; year from lineage): a headline and one sentence.
  CDS: "For students entering in fall {cycle}". Federal: "For students who entered in fall {year}".
  | Policy | Headline | Sentence |
  |---|---|---|
  | required | Required | Send SAT or ACT scores: they're required to be considered. |
  | required-some | Required for some applicants | Some applicants must send scores. Then the C8F note as a quote (≤ 200 characters, the rest in the ⓘ) |
  | recommended | Recommended | Scores are recommended, not required. |
  | considered | Optional | Scores are considered if you send them. |
  | not-considered | Not considered | Scores aren't considered, even if you send them. |
  | null (rows differ) | Varies by test | "SAT: required · ACT: optional" |

  When an event (Keep history?) moved required ↔ not required after the class the scores describe, one muted line
  under the ScoreChecker: "These scores are from the class that entered in fall {scores year}, before the change."
- **ScoreChecker** (`components/school/ScoreChecker.tsx`): the SAT total bar draws `derived.sat_total`, with the CDS
  composite 50th as the median ring when present; ACT Reading and Science range bars join English and Math under the
  composite when present. With a score typed in and bands present, one sentence under the bar: "Your score is in the
  1400–1600 band, where 74% of enrolled first-years who sent an SAT scored. 26% scored below 1400."
- **New "Score bands" block** (`components/school/ScoreBands.tsx`) under the checker: one stacked bar per test (SAT
  total, ACT composite), each band directly labeled, and a sentence: the top band's share when it is ≥ 10% ("23% of
  enrolled first-years who sent an SAT scored 1400 or higher"), else the largest band ("91% scored 1000–1399"). When
  one band holds ≥ 90%, only the sentence ("Nearly all who sent an SAT (98%) scored 1400 or higher"): a bar adds
  nothing at Vanderbilt-like colleges. Section and ACT English/Math bands sit behind `ShowMore`. Caveat line, always:
  "Shares of the {share}% of first-years who sent an SAT; students who didn't send scores aren't in these bands." The
  existing "Read with care" box (under 50% submission) is unchanged. Bands for a test under `MIN_SUBMITTERS` don't show.
- **"Who submitted scores?"** adds the count under each ring: "1,243 students". Shares come from the newest block.
- The `federalSat`/`federalAct` guards in `app/schools/[id]/admissions/page.tsx` go: a block is never mixed (Decision 2).
- A "Recent change" line under the page headline for a test-policy event in the last 3 cycles, as admission factors do.

**Overview and hero.** The hero's test-policy `Term` reads the newest `admissions.test_policy`; its ⓘ names the cycle
and the replaced federal value. The admissions card's compact SAT bar draws `derived.sat_total`.

**Compare** ([comparison.md](../comparison.md)): "Test policy" row reads the newest value; a cell whose cycle differs
from the row's usual year shows it muted ("fall 2027 applicants"), as round 2's year rule does. "SAT middle 50%" row
and the SAT range bars draw `derived.sat_total`. New rows in All the numbers: "Sent an SAT" and "Sent an ACT" (count
and share, "1,243 (33%)"), "Scored 1400+ on the SAT" and "Scored 30+ on the ACT" (the top band's share); "–" where not
reported. No new metric cards; nothing new in the radar or Key differences.

**Explore** ([search-and-filtering.md](../search-and-filtering.md)): the backlog's test-policy filter, specified here.
Three chips with counts, param `policy=required,optional,blind`: Required (`required`); Optional (`required-some`,
`recommended`, `considered`; the chip's ⓘ says it includes colleges requiring scores of some applicants); Test-blind
(`not-considered`). It reads the newest policy each college has published, so cycles differ between colleges; the
filter's ⓘ says so. Colleges with no policy are excluded. No filters on bands or counts.

**Planning tools.** [chances-and-fit.md](../product/chances-and-fit.md) score position: the SAT position uses
`derived.sat_total` (a student's total against the college's own total percentiles is the right comparison); test-blind
→ `unused` from the newest policy, so a coming-cycle change reaches the student's standing; a student planning not to
submit at a college whose policy is required gets the reason "Requires SAT or ACT scores from students entering in
fall {cycle}" (no change to thresholds). Bands add one reason sentence with the student's band and its share. The
signals table's "Test policy and submission shares" source becomes "IPEDS ADM, or the college's CDS C8/C9 when newer".
[saved-lists.md](../product/saved-lists.md) needs nothing.

**Test-optional study** ([trends/test-optional.md](../trends/test-optional.md)): its national line, groups, dumbbells,
and the fall 2019 panel stay federal (partial CDS coverage is skewed to selective colleges: round 3's answer key found
newer figures at 29 of 29 very selective and selective colleges but 2 of 11 less selective and open-admission ones).
Section 5, "Went back to requiring", gains a second list: colleges whose newest CDS requires tests for a coming cycle
while their newest federal policy doesn't, each named with its cycle and cited to its CDS, under the heading "Announced
for coming cycles, from colleges' own Common Data Sets". The study's link to the Explore filter says the filter uses
the newest policy each college has published. Computed by `sync-history` from `data/schools.json`
(`reported.admissions.test_policy_events`), not from shards.

**Glossary** (`lib/glossary.ts`): new `score-bands` ("The share of enrolled first-years who sent a test whose score
fell in each range…"), `application-cycle` ("The year students apply, named by the fall they would enroll; a college's
Common Data Set states its policy for the coming cycle"), `required-for-some`. Updated: `test-policy` (five answers,
cycle wording), `sat` (the college's own total where reported; the site's sum elsewhere), `test-submission` (counts),
`act` (the enhanced ACT's optional science section and three-test composite from 2025, per ACT's announcement;
verify the dates before writing).

## Keep history?
- **C8 policy: events** ([README](README.md#deciding-on-history)). The merge computes `test_policy_events` from every
  document in the college's record (newest first) plus the federal value:
  - CDS edition → next CDS edition: any change on the five-answer scale, except one undone within two editions (the
    reporting-slip rule of [admission-factors.md](admission-factors.md)).
  - Federal → CDS (only when no earlier CDS edition was read): required ↔ not required, and considered ↔ not
    considered. A move between recommended or required-some and considered is a scale difference, not a decision.
  - Shown in Over time → Changes with factor events ("Requires the SAT or ACT again, for students entering in fall
    2027"; "Became test-blind…"), each cited to the newer document. In the sample: Cornell's would be the only one.
- **C9: none in the history shards.** The federal series (section percentiles from fall 2001, medians from fall 2022,
  submission shares) already carry the trend, and the college's own total tracks the section sum within 40 points at 16 of 17 documents.
  Each edition's values stay in the records at no cost, so a series can be built later if bands prove interesting.
- **Backfill of past editions: no.** For C8, federal history covers past cycles; past CDS editions add only the two
  finer answers. For C9, past bands describe self-selected submitters (the study's hub rule 5 caveat), which a series
  would invite readers to misread. Revisit only if the owner archives prior editions for other units (round 3 open
  question 2).

## Top-level trend?
- **Hero indicator: no.** A policy, not a measure.
- **Home fact: not now.** Candidate later: "{n} of the very selective colleges require tests for the coming cycle, up
  from {m} in federal data", on the fixed panel of the 59 very selective colleges, only if the run reads C8 at 90% or
  more of them. Until then the study's "Announced for coming cycles" list carries the story.
- **"Known for": no.** Bands and totals are partial; the policy is categorical.
- **Explore: yes**, the test-policy filter above.
- **Over time chart: none new**; events only.

## Build
- `lib/types.ts`: `TestPolicy` gains `"required-some"`; `ReportedAdmissions` fields, `ReportedTestPolicy`,
  `ReportedTests`, `TestPolicyEvent`, `admissions.federal_tests`. Fix `School.reported`'s comment ("never used in
  Explore, Compare, ranks…"), outdated since round 2's Decision 1.
- `lib/fields.ts`: the registry entries above.
- `lib/cds-sections.ts` (round 3): the 102 codes, group C, per format (code, PDF tag, label patterns), schema entries
  for the model, and the checks; `lib/cds-checks.ts`: `one-mark-per-row`, `grid-present`, `uses-tests-agrees`,
  `policy-note-agrees`, `policy-cycle`, `percentile-order`, `composite-vs-sections`, `submitters-vs-enrolled`,
  `band-column-form`, `bands-sum`, `bands-agree-percentiles`, `federal-score-change`, and the `below-display-minimum`
  note (not a failure).
- `lib/test-policy.ts` (new, pure): answer maps per format (`C8_TEXT`, `C8_EXPORT`, column-by-x and glyph-index
  helpers for the layout pass), the headline rule, the event rules, the Explore bucket, headlines and sentences.
- `lib/score-bands.ts` (new, pure): band edges per test, column normalization, `bandOf(score, test)`, shares below and
  through a band, the sentences, `MIN_SUBMITTERS = 50`.
- `lib/reported-merge.ts`: passed C8/C9 items from `data/cds-records/` into `school.reported.admissions.*`, events.
- `lib/newest.ts`: `applyNewestTests` / `restoreFederalTests` for the three blocks, called by `mergeReported` after
  `applyNewest`; `lib/lineage.ts` guard additions.
- `lib/metrics.ts`: `TEST_POLICY_LABELS["required-some"]`, `satTotal(s)` for `derived.sat_total`; `lib/dataset.ts` and
  `lib/params.ts`: the `policy` filter; `components/explore/FilterPanel` chips with counts.
- `components/school/ScoreChecker.tsx`, new `components/school/ScoreBands.tsx` and `TestPolicyBlock.tsx`;
  `app/schools/[id]/admissions/page.tsx`, the overview card and hero, `app/compare/page.tsx` rows; `lib/events.ts`
  reads `test_policy_events`; `lib/insights.ts` `scoresTakeaway` mentions a coming-cycle requirement.
- `lib/glossary.ts` entries; `lib/history.ts` study computation for the "Announced" list.

**Tests** (each guard shown to fail when broken), with fixtures cut from the sample: VU code table, HU field values
(with the trailing space), EC and HA layout text, UM glyphs, TAMU and MIT HTML, LUC's two-percentile row.
1. Grid reading: each fixture yields the policy above; HU maps by export value (break: map by widget index, and HU reads
   "recommended"); UM's ☒ index picks recommended; a row with two marks fails.
2. C8A/grid/C8F agreement: a UCB-like fixture (C8A Yes, not considered) fails; WM's note passes; "not required" never
   matches "required".
3. Cycle: a 2025–26 document stating Fall 2026 fails.
4. Composite vs sections: LUC fails at the 25th, EC passes at 40 (break: widen to 150, and LUC passes).
5. Number vs share: EC's SAT fails, its ACT passes; without a passed C1 the number is not shown.
6. Bands: EC's ACT columns are placed by the totals row; a column shifted one header left fails the percentile
   agreement; CU's "-" column with total 0 is blank, not failed; LUC's bare "23.8" is read as percent.
7. Blocks: a CDS SAT block replaces all five SAT fields, sets LUC-like missing medians to null, keeps the previous
   block in `federal_tests`, and `restoreFederalTests` returns the identical school; an ACT block under 50 submitters
   is not applied; the guard rejects a federal median inside a replaced block.
8. Ranks: `derived.sat_composite` and the `sat` metric are unchanged by a reported composite (break: read
   `sat_total` in `satMid`, and the test fails); bands and counts never appear in `METRICS`.
9. Events: federal considered → CDS required gives an event; considered → recommended doesn't; a CDS A → B → A
   within two editions gives none.
10. Explore: `policy=optional` includes required-some; colleges without a policy are excluded.

## Specs this changes
[college-reported-round-3.md](../college-reported-round-3.md#extraction-scope) (the C8/C9 rows of the scope table: the
102 codes above); [college-reported-round-2.md](../college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere)
("SAT/ACT, submission rates, test policy … federal" becomes "replaced by C8/C9 blocks, see this spec");
[admissions-detail.md](admissions-detail.md) (the CDS-override paragraph: blocks replace the guard);
[school-profile.md](../school-profile.md) (admissions page blocks; "SAT/ACT stay federal" on the card);
[comparison.md](../comparison.md); [search-and-filtering.md](../search-and-filtering.md) (the filter);
[trends/test-optional.md](../trends/test-optional.md) (section 5, the filter link); [chances-and-fit.md](../product/chances-and-fit.md)
(signals table, rule 1); [backlog.md](../backlog.md) (the filter item points here); [data-lineage.md](../data-lineage.md)
(`federal_tests` records and the guard); [cds-admissions.md](cds-admissions.md) needs nothing (it never listed C8/C9).

## Open questions
1. **One SAT total or two?** Recommended: the college's own total where it reports one, the sum for ranks (Decision 3).
   The simpler alternative: the sum everywhere, the college's total only in the ⓘ; the measured difference is at most
   20 points at 14 of 17 documents and at most 40 at 16.
2. **`MIN_SUBMITTERS = 50`** for showing a test's percentiles and bands from a CDS: right threshold?
3. **"Required for some" in Explore:** bucket it with Optional (recommended), or give it its own chip?
4. **Forward-looking policy:** a college can change its policy after publishing its CDS. Accept the CDS as the newest
   statement (recommended), or also read the admissions page's testing policy each autumn (a class-profile-style
   source, not in round 3's scope)?

## As built
Built 2026-10-03 from the four 2025–26 template-workbook records (Vanderbilt 221999, Cornell 190415, William & Mary
231624, Illinois 145637); every other college gets its values when round 3's full run writes its record.

**Where things live.**
- `lib/cds/test-scores.ts`: record → `school.reported`. `policyFromDocument` (C8 grid via `policyFromText`, headline
  rule, the C8A-agrees rule, cycle = edition + 2), `testsFromDocument` (C9 percentiles with order checked, shares, the
  number submitting only beside the same document's passed C1 enrolled and within a point of the share, band columns
  normalized and dropped when they disagree with their own percentiles), `reportedTestsFromRecord` (newest document per
  group, C8F note, events, lineage quotes such as "SAT Composite | 1490 | 1530 | 1550" and "SAT Composite: 1400–1600
  93.5%, …"), `mergeTestScores` (called once per school by `mergeReported`).
- `lib/cds/test-blocks.ts`: `applyNewestTests` / `restoreFederalTests` (one-line hooks at the top of
  `lib/newest.ts#applyNewest` and `#restoreFederal`), `replacedTest` (the ⓘ's "Federal data, Fall 2024:
  Test-optional"), `satTotalInputs` (`derived.sat_total`'s citation), `validateTests` (the guard, called from
  `validateSchool`).
- `lib/test-policy.ts` (answer maps `C8_TEXT`, `C8_EXPORT`; headline; events and their sentences; labels and the
  block's headlines; Explore buckets) and `lib/score-bands.ts` (band edges, `bandOf`, shares below/through,
  `normalizeBandColumn`, `bandsAgreeWithPercentiles`, `compositeVsSections`, `submittersAgree`, sentences,
  `MIN_SUBMITTERS = 50`, `satTotal`/`satTotalMedian`, `lineageFall`). Both pure, client-safe.
- UI: `components/school/TestPolicyBlock.tsx`, `components/school/ScoreBands.tsx`, `ScoreChecker` (own SAT total and
  its 50th, ACT Reading/Science bars, the typed-score band sentence, new legend), the admissions page (`#scores`:
  policy block first, Score bands `#bands`, counts under the rings, "Recent change" for policy events in the last 3
  cycles, "before the change" line), hero `Term` with the policy's citation, card and Compare on `derived.sat_total`,
  `lib/compare-tests.ts` rows, Explore `policy=` (`lib/params.ts`, `lib/dataset.ts`, FilterPanel chips with counts,
  Toolbar chip), glossary `score-bands`, `application-cycle`, `required-for-some` and updated `test-policy`, `sat`,
  `act`, `test-submission`.
- Wiring: `mergeReported(schools, reported, { records, federalPolicyYear })`; `scripts/merge-reported.mts` and
  `scripts/sync-data.mts` read `data/cds-records/` (`readRecords`) and the ADM fall.
- Tests: `tests/cds-test-scores-and-policy.test.mts` (Tests 1–10). Each guard was broken in turn and the file failed:
  satMid reading `satTotal`, the replaced-block rule, the restore, a value-by-value block, "not required" read as
  required, tolerance 150, a number without C1 or disagreeing with its share, bands without the percentile check, no
  slip rule, required-some as Required, no cycle check.

**Choices made while building.**
- **Fields live at `reported.test_policy`, `reported.test_policy_note`, `reported.test_policy_events`, and
  `reported.tests.*`**, beside `reported.admissions`, not inside it: a college can publish C8/C9 without a newer C1
  (Cornell), and `reported.admissions` means "a newer C1 class" to the lineage guard and the Data page's counts.
- **A same-edition hand-imported override is replaced too** (Cornell's override is its 2025–26 CDS): the record is the
  same document read in full, and replacing it means the SAT/ACT blocks are never mixed (override ranges with federal
  medians). "Newer" otherwise, as Decision 2 says.
- `admissions.federal_tests.<block>` keeps `year` (null = the dataset's IPEDS ADM release), each replaced value
  (absent = the key was absent), and `records`, the lineage each value had, so restore is byte for byte.
- `Cited` gained `cdsEdition` (from a record's `edition`) and `replaces.text`; the ⓘ reads "Reported by Cornell
  University in its Common Data Set 2025–26 (fall 2027 applicants)" and "Federal data, Fall 2024: Test-optional".
- Display-safety checks run in the merge until the checks track's per-item statuses land: number vs share, band
  column form and sum, bands vs percentiles, 25th ≤ 50th ≤ 75th, C8A vs grid, cycle and class year. William & Mary's
  SAT total bands fail bands-vs-percentiles (25th 1390, but 20.1% at or below 1399), so they stay off the page.
- `RangeBar`'s typed-score sentences say "enrolled first-years who sent scores", like the legend.

**Measured on the four colleges.** Cornell: policy Required for fall 2027 applicants (federal fall 2024:
Test-optional), one event. Vanderbilt, William & Mary, Illinois: Optional for fall 2027 applicants. Every SAT and ACT
block replaced (all have ≥ 50 submitters); Illinois's ACT 50th is 32.3 as printed. Composite vs sections ≤ 38 points.

**Not built here (other tracks or later).**
- The C8/C9 per-item checks as record statuses (`lib/cds-checks.ts`: the checks track) and PDF/HTML reading, layout
  column-by-x and Michigan's glyph index (the readers track). `lib/score-bands.ts` exports the check functions they
  can call.
- Over time → Changes listing the policy events (`lib/events.ts`), the test-optional study's "Announced for coming
  cycles" list (`sync-history`), and the planning-tool rules (chances-and-fit): the admissions page shows the events.
- The "SAT midpoint vs. every college" strip still prints the sum's midpoint beside the shown total (the shared
  `DistributionStrip` has no "position only" mode yet).

## Roadmap entry
- slug: cds-test-scores-and-policy
- summary: Whether each college requires the SAT or ACT for the cycle you're applying in, its own SAT total range, how
  many students sent scores, and what share of the class scored in each score band.
- complexity: 3 — extends the newest-everywhere machinery to three new replaceable blocks with restore and guards,
  plus a policy filter, events, and a new score-band view on the profile and Compare.
- after: ["college-reported-round-3"]
