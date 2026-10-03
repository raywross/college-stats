# CDS Admissions by Residency: In-State, Out-of-State, International

> Status: **built** (2026-10-03; see [As built](#as-built): the per-edition history series, the "for you" rows, and the
> grid checks' review-queue wiring wait on other work). Wave 4, unit U1 of the CDS inventory. Ships from the round-3 records
> ([college-reported-round-3.md](../college-reported-round-3.md)) with no new visit to any college. Research: 19 real
> 2025–26 Common Data Sets read cell by cell (6 Excel, 11 PDF, 2 HTML; the inventory's working files). Part of
> [data-expansion](README.md).

## Question it answers
*What are my chances as an in-state applicant? From another state? From abroad? And once admitted, do students from
each place actually come?*

No federal file answers this. IPEDS ADM counts applicants and admits by sex, never by residency, and IPEDS EF part C
([residence.md](residence.md)) counts only enrolled first-years by home state. [chances-and-fit.md](../product/chances-and-fit.md)
says so today ("IPEDS has no in-state admit rate") and can only offer wording. CDS C1 has carried a residency grid
since at least the 2025–26 template: applied, admitted, and enrolled first-years in four columns (in-state,
out-of-state, international, unknown). From it come three admit rates and three yields per college.

The gaps are large and go both ways (sample, fall 2025 class, from each college's CDS):

| College | In-state admit | Other states | International | In-state yield | Other states yield |
|---|---|---|---|---|---|
| Georgia Tech | 29.5% | 10.1% | 7.3% | 65.6% | 31.0% |
| Purdue | 71.1% | 43.6% | 22.5% | 50.3% | 18.8% |
| Illinois (visible grid) | 49.3% | 29.0% | 30.5% | 45.4% | 12.7% |
| Texas A&M | 54.2% | 41.3% | 48.5% | 43.9% | 14.1% |
| Vanderbilt | 10.4% | 5.3% | 4.0% | 77.7% | 61.7% |
| TCU | 43.3% | 55.5% | 26.5% | 27.0% | 24.0% |
| Loyola Chicago | 77.4% | 87.1% | 47.3% | 8.9% | 8.6% |
| UW–Eau Claire | 38.8% | 37.1% | 70.7% (58 applicants) | 64.7% | 72.8% |

In-state applicants are not always favored: TCU, Loyola, Baylor (51.5% vs 54.5%), and Howard (38.6% vs 41.2%) admit
out-of-state applicants at the higher rate.

## Two different measures: who enrolls vs who gets in
The site already shows where first-years come from ([residence.md](residence.md)). This spec adds a different
number. They must never be worded as if they were the same.

| Measure | Numerator ÷ denominator | Answers | Source | Example (Purdue) |
|---|---|---|---|---|
| **Share of first-years from out of state** (residence.md) | Enrolled first-years from other states ÷ all enrolled first-years | *Who is on campus?* | IPEDS EF-C, even falls | 47% (federal, fall 2024); 50% in the CDS grid (fall 2025) |
| **Out-of-state admit rate** (this spec) | Out-of-state applicants admitted ÷ out-of-state applicants | *How hard is it to get in from another state?* | CDS C1 grid | 43.6% |
| **Out-of-state yield** (this spec) | Out-of-state admits who enrolled ÷ out-of-state admits | *Do admitted out-of-state students come?* | CDS C1 grid | 18.8% |
| CDS F1 "percent from out of state" | Out-of-state first-years ÷ U.S. first-years (international left out of both) | (stored, not shown; see residence.md) | CDS F1 | — |

The share can be high while the rate is low: half of Purdue's first-years are from other states although they are
admitted at 44% against 71% for Indiana residents, because 58,853 of its 87,220 applicants live elsewhere. Texas A&M
admits out-of-state applicants at 41%, close to its in-state 54%, yet only 5% of its first-years are from other
states. The glossary entries say this in one line each.

**Residency here is where the applicant lived when applying.** The template's instruction, printed above the grid in
every document: *"Please report based on known physical address at time of application."* That is not tuition
residency (reciprocity programs, military families, students who move), and IPEDS EF-C's "state of residence when
admitted" is close to it but not identical.

## Items the run must capture
All in CDS section C, group `C` of round 3. The grid's **Total** column has no code of its own in the 2025–26
template (C.101–C.130 are the whole of C1); its values equal C.116–C.118, which the pipeline already reads for the
funnel and which this unit reuses for the sum check.

| Code | Question (template wording) | Residency (template's `res` column) | Fillable-PDF tag | Excel, fillable PDF | Model for flattened PDF / HTML |
|---|---|---|---|---|---|
| C.116 | Total first-time, first-year students who applied | All | `AP_RECD_1ST_N` | yes (already read) | yes (already read) |
| C.117 | Total first-time, first-year students who were admitted | All | `AP_ADMT_1ST_N` | yes (already read) | yes (already read) |
| C.118 | Total first-time, first-year students who enrolled | All | `EN_TOT_1ST_N` | yes (already read) | yes (already read) |
| C.119 | Total first-time, first-year who applied | In-State | `AP_RECD_STATE_1ST_N` | yes | yes |
| C.120 | Total first-time, first-year who were admitted | In-State | `AP_ADMT_STATE_1ST_N` | yes | yes |
| C.121 | Total first-time, first-year who enrolled | In-State | `EN_TOT_STATE_1ST_N` | yes | yes |
| C.122 | Total first-time, first-year who applied | Out-of-State | `AP_RECD_NRES_1ST_N` | yes | yes |
| C.123 | Total first-time, first-year who were admitted | Out-of-State | `AP_ADMT_NRES_1ST_N` | yes | yes |
| C.124 | Total first-time, first-year who enrolled | Out-of-State | `EN_TOT_NRES_1ST_N` | yes | yes |
| C.125 | Total first-time, first-year who applied | Nonresidents (= international) | `AP_RECD_INTL_1ST_N` | yes | yes |
| C.126 | Total first-time, first-year who were admitted | Nonresidents (= international) | `AP_ADMT_INTL_1ST_N` | yes | yes |
| C.127 | Total first-time, first-year who enrolled | Nonresidents (= international) | `EN_TOT_INTL_1ST_N` | yes | yes |
| C.128 | Total first-time, first-year who applied | Unknown | `AP_RECD_UNK_1ST_N` | yes | yes |
| C.129 | Total first-time, first-year who were admitted | Unknown | `AP_ADMT_UNK_1ST_N` | yes | yes |
| C.130 | Total first-time, first-year who enrolled | Unknown | `EN_TOT_UNK_1ST_N` | yes | yes |
| (text) | "If available, please provide residency breakdowns … : Fall 2025" | — | — | yes (label row) | yes |

The last row is the grid's own heading; its "Fall YYYY" sets the year (below). The visible form's row labels are
"Total first-time, first-year (degree-seeking) who applied / were admitted / enrolled" under column headers
"In-State | Out-of-State | International | Unknown | Total".

**Reading, by format** (round 3 Decision 3):
- **2025–26 Excel template:** read the code table **and** the visible grid on sheet C, and compare (the
  [Illinois example](#worked-example-for-the-review-queue-illinois-2025-26) shows why). No model.
- **Classic Excel** (Berkeley, Purdue): the visible grid by row label, with column letters (not `sheetText`, which drops
  empty cells: a row with a blank Unknown cell would shift Total into Unknown). No model.
- **Fillable PDF** (Howard): the 12 widgets by tag. No model. **Trap:** in the tags `NRES` means *out-of-state*
  (nonresident of the state) and `INTL` international, while the template's `res` column calls the international
  columns "Nonresidents" (the IPEDS term for non-U.S. students). Map by code or tag, never by the word "nonresident".
- **Flattened PDF and HTML:** the group C model call reads the three grid rows from the layout text, where they are
  clean (UW–Eau Claire: `… who applied | 4614 | 2113 | 58 | 0 | 6785`). Values are placed by the header x positions
  when a row has fewer than five cells (Baylor fills 4 of 5: in-state @363, other states @426, international @481,
  total @579, Unknown @513 empty). A deterministic layout reader for this grid is possible later; not needed now.

**Coverage in the inventory's sample** (my reading of the 19 documents, which refines the inventory's counts; see
[Disagreements](#notes-on-the-inventory)):

| What the college filled | Documents |
|---|---|
| All three rows by residency (rates and yields computable) | **12 of 19**: Vanderbilt, Cornell, Purdue, USC, Georgia Tech, Howard, Baylor, TCU, Loyola Chicago, UW–Eau Claire, Texas A&M, Illinois |
| Enrolled row by residency only (147 / 496 / 5 / 0 / 648) | 1: Spelman |
| Total column only | 4: William & Mary, Berkeley ("*State applicant data not yet available"), Harvard, Michigan |
| Grid printed empty, including Total | 2: Duke, MIT |
| Not read (Cloudflare challenge) | UVA |

Unknown column: filled (0 or more) at 10 of the 12; blank at Purdue and Baylor; applied only at Illinois. Nonzero at
TCU (163 / 87 / 16), Loyola (362 / 164 / 0), and Howard (60 / 22 / 5).

## Years
- The grid describes the **entering class of the edition's first fall**: the 2025–26 edition's heading reads
  "… enrolled students: Fall 2025", the same class as C1's totals. Lineage `year` is that term ("Fall 2025") and
  `reported.admissions_by_residency.year` its number.
- Taken from the grid heading or C1's own text ("… enrolled (full- or part-time) in Fall 2025"), else the record's
  C-group year. **Never from page headers:** USC (31 pages) and Loyola (32) print "Common Data Set 2024-2025" on their
  2025–26 files.
- UI text never names a year; the ⓘ carries it. Compare's muted year appears when it differs from the row's usual
  year, as today.

## Checks
Per value (round 3's universal checks): the number is on its cited line or cell; an integer ≥ 0 after removing
thousands separators ("12,527"); `-`, `N/A`, empty → `blank` (null), never 0; a printed `0` is a value; text in a
numeric cell → `failed`.

Per grid (item `C1-residency`, one status for the whole grid; partial rows allowed):

| Check id | Rule | Fails in the sample | On failure |
|---|---|---|---|
| `residency-funnel` | For each residency: admitted ≤ applied, enrolled ≤ admitted | Illinois's code table (in-state admitted 32,702 > applied 29,419) | Review queue; escalated once (Decision 9) |
| `residency-sum` | in + out + international + unknown = C1 total (C.116/117/118) for each row, within 1% (within 1 when the total is under 100). A blank Unknown counts as 0 only if the sum then matches | None on the visible grids; Georgia Tech's admits sum to 8,920 against 8,921 and pass | Review queue; escalated once |
| `residency-total-unreadable` | When the grid's Total prints as `##` (Excel overflow: Loyola, every row), compare the parts with C1's by-sex totals instead (C.101–C.109), same tolerance | None (Loyola's parts 43,954 / 33,009 / 2,605 vs by-sex 43,778 / 32,998 / 2,605: within 0.4%) | As above |
| `residency-vs-federal` | Enrolled shares (in-state, other states, international) each within **10 points** of `demographics.residence` (IPEDS EF-C, a different class and a slightly different definition) | None of 13 documents with an enrolled row: largest gaps USC other states −7.6 points, Baylor −6.9, Baylor in-state +5.6; Illinois's code table gives an in-state share of 227% | Review queue (an implausible change against federal is escalated, Decision 9). Catches misplaced or transposed columns at most colleges; can't catch a swap of two near-equal columns (TCU 1,260 vs 1,397), which the header x positions and codes guard |
| `residency-form-vs-codes` | Excel template only: code-table values equal the visible grid's | Illinois (below) | Publish from whichever source passes `residency-funnel` and `residency-sum`; both failing → review. A disagreement is counted in the run summary's `items` |

No federal value exists for applicants or admits by residency, so there is no other agreement check.

### Worked example for the review queue: Illinois 2025–26
Illinois's workbook (Box static link, the 2025–26 template) is the case the checks exist for.

| | In-state | Out-of-state | International | Unknown | Total |
|---|---|---|---|---|---|
| Code table C.119–C.130 | 29,419 / **32,702** / **20,924** | (blank) / 9,495 / 1,210 | (blank) / 6,380 / 1,410 | 0 / – / – | — |
| Visible grid, sheet C | 29,419 / 14,509 / 6,587 | 32,702 / 9,495 / 1,210 | 20,924 / 6,380 / 1,410 | 0 / – / – | 83,045 / 30,384 / 9,207 |

The visible grid is consistent (parts sum to the totals, and to C.116–C.118). The code table took the in-state
column's admitted and enrolled cells from the *applied* row across (32,702 and 20,924 are the out-of-state and
international applicants), and left C.122 and C.125 blank. The inventory recorded this as "in-state admitted 32,702 >
applied 29,419", a document inconsistency; it is a code-table error in the college's file, like Cornell's C21 code row
that is off by one.

What happens:
1. A code-table-only read fails `residency-funnel` (32,702 > 29,419) and `residency-vs-federal` (in-state share 227%).
   As a review item it reads: *Illinois · CDS 2025–26 · C1-residency · residency-funnel: in-state admitted 32,702 >
   applied 29,419 (cells C.119, C.120) · residency-vs-federal: in-state enrolled 227% of first-years vs 71% federal.*
2. With `residency-form-vs-codes`, the reader also reads the visible grid, which passes every check, so the grid is
   published from sheet C's cells (lineage `cell` points at the grid, not the code table) and nothing waits for a
   person. The review queue gets the item only when both sources fail, or for a PDF or HTML document (one source)
   whose values fail after escalation, where Decision 9's "document inconsistent" applies.
3. The test fixture is this example (below), so the guard is proven both ways.

## Store
New key in `school.reported`, separate from `reported.admissions`. That block exists only when a college's class is
newer than its federal year (`applyNewest` keys on it); the residency grid is shown even when its class equals the
federal year (Cornell's CDS and federal data both describe fall 2025).

```ts
// lib/types.ts
export interface ReportedData {
  admissions?: ReportedAdmissions;
  /** CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md). */
  admissions_by_residency?: ReportedResidencyAdmissions;
}

export interface ResidencyCounts {
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
}

export interface ReportedResidencyAdmissions {
  /** Entering class from the grid heading or C1 text, e.g. "Fall 2025" (never page headers). */
  entering_term: string;
  /** Its fall year as a number. */
  year: number;
  /** CDS edition the grid was read from, e.g. "2025-26". */
  edition: string;
  in_state: ResidencyCounts;
  out_of_state: ResidencyCounts;
  international: ResidencyCounts;
  /** Kept for the sum check and the record; never shown as a rate. */
  unknown: ResidencyCounts;
  /** C1 totals of the same document (C.116–C.118): the same-class "all applicants" reference. */
  total: ResidencyCounts;
}
```
Missing is `null`, never 0. A block is stored only when the grid's status is `passed` and at least one residency row
is non-null (Spelman: enrolled only, stored; its rates are null and nothing shows but the check and history).

**Which edition.** The newest document whose `C1-residency` passed. A failed or blank grid in a newer edition doesn't
fall back silently: the older block is kept only if its class is within **two falls** of the headline admissions
year (`admissions.year`); older blocks feed history only.

**Registry** (`lib/fields.ts`, all `reported(…)`: source `college-site`, vintage `null`, topic `admissions`):
- `reported.admissions_by_residency.entering_term`, `.year`, `.edition`
- `reported.admissions_by_residency.{in_state,out_of_state,international,unknown,total}.{applicants,admitted,enrolled}`
  (15 leaves), so each value has its own lineage record: source `college-site`, method `extracted`, `year` (the
  entering term), `url`, `retrieved`, `quote` (the label + value line, or a generated "Total first-time, first-year
  who applied, In-State: 29,419" for Excel), and `page` or `cell` (`LineageRecord` gains `cell?: string` if round 3
  hasn't added it). `REPORTED_PATHS` then requires an `extracted` record for every stored leaf, as it does for C1.
- Computed at render time (`computed: true`, `derived` with inputs, topic admissions):
  `derived.admit_rate_in_state`, `derived.admit_rate_out_of_state`, `derived.admit_rate_international` (admitted ÷
  applied, none under 10 applicants, the overall rate's rule); `derived.yield_in_state`, `derived.yield_out_of_state`,
  `derived.yield_international` (enrolled ÷ admitted from the same grid, none under 10 admits); and
  `derived.admit_rate_for_student` (the in-state, out-of-state, or international rate chosen by the student's state of
  residence against `location.state`; inputs the three rates and `location.state`).

**Newest-everywhere rule.** Does not apply to the new fields: no federal field has applicants or admits by
residency, so they are new, partial-coverage fields. Shown on the profile and Compare; Explore gets boolean filters
only; **never** in `METRICS`, ranks, medians, percentile strips, the radar, Key differences, or "Known for" until
coverage is broad (a test enforces it). Two overlaps, decided:
- **C.116–C.118** are C1's totals, already published by round 2 under the newest rule. Unchanged.
- **Enrolled by residency vs `demographics.residence`:** not replaced. The definitions are close but not the same
  (address at application vs residence when admitted), and the Students page's "Where first-years come from" card
  pairs the three shares with the top home states and a state map that only EF-C has; replacing the shares would put
  two in-state figures from two classes on one card (Vanderbilt: 14.3% from the grid, "13% are from Tennessee" from
  EF-C). The grid's enrolled row is a **check** on the federal shares and the yield denominator. Open question 1.

## Display
Closest existing pattern: the "Men and women" card from [admissions-detail.md](admissions-detail.md) (`BenchmarkBar`
per group, a sentence, a notable-gap rule, a one-line fallback). Logic in `admissionsByResidency(school, studentState?)`
(`lib/insights.ts`), constants `RESIDENCY_NOTABLE_GAP = 0.05`, `RESIDENCY_NOTABLE_RATIO = 1.5`,
`RESIDENCY_MIN_APPLICANTS = 200` beside `BY_SEX_NOTABLE_GAP`.

**Profile, Admissions page** (`/schools/{id}/admissions`), a block `#residency` after "Men and women", before Yield:
- **Shown when** the in-state and out-of-state rates are both computable. International shows when its rate is.
- **Notable** when any two shown groups, each with 200+ applicants, differ by 5+ points or one rate is 1.5× the other.
  In the sample 9 of the 12 are notable: Georgia Tech, Purdue, Illinois, Texas A&M, Vanderbilt (10.4% vs 5.3%), TCU,
  Loyola, Howard (international 59.8%), and Cornell (through its international rate, 3.6%; in-state vs other states
  alone is 13.3% vs 9.0%, 4.3 points and 1.48×). Not notable: USC (largest gap 3.9 points), Baylor (4.9), UW–Eau
  Claire (its 70.7% international rate rests on 58 applicants). Then a card:
  - Title: **"Where applicants live"** with ⓘ `admit-rate-by-residency`.
  - Headline sentence: "**{State} applicants were admitted at {in}, applicants from other states at {out}, and
    international applicants at {intl}.**" ({State} is the college's state name; the international clause is dropped
    when that rate isn't shown.)
  - Bars: `BenchmarkBar` "From {State}", "From other states", "From abroad" on 0–100%, each cited to its derived
    field, with a thin tick for **all applicants in the same class** (C.117 ÷ C.116 from the same document; its own ⓘ).
    The tick is not a second headline number: it may differ from the page's funnel when the funnel shows a newer class
    profile, and its ⓘ says which class it is.
  - Yield line under the bars: "Of those admitted, {inY} from {State} enrolled, against {outY} from other states and
    {intlY} from abroad." ⓘ `yield-by-residency`.
  - **Student marker** (once [student-profile.md](../product/student-profile.md) exists and has a state): the
    student's row gets "(you)" after its label and the admissions domain color at full strength; nothing else
    changes. Signed out, no marker and no prompt.
  - **Caveat** (small, muted, under the card, always): "Counted by where applicants lived when they applied, which
    can differ from who qualifies for in-state tuition. A group's rate reflects who applies from there as well as how
    the college chooses."
- **Not notable:** one line under the funnel, like by-sex: "Applicants from {State} and from other states were
  admitted at similar rates ({in} and {out})." with the same ⓘ.
- No chip, no banner, no year in text. Provenance (college, "Common Data Set 2025–26", the quote, the cell or page,
  the retrieval date) lives in each ⓘ.

**Profile, Students page:** the "Where first-years come from" card ([residence.md](residence.md)) gains one quiet link
line when the block exists: "How applicants from each place were admitted →" to `admissions#residency`. No figures
repeated.

**Overview admissions card:** unchanged. The "Where you stand" chip ([chances-and-fit.md](../product/chances-and-fit.md))
consumes the rate later.

**Compare** ([comparison.md](../comparison.md)):
- All the numbers, Admissions group: **"Acceptance rate, in-state / other states / international"** (one row, three
  values per college, "–" for a missing one, like "Acceptance rate, men / women") and **"Yield, in-state / other
  states / international"**. A college without a grid shows "Not published" with the ⓘ saying the college's CDS has no
  breakdown. The muted year appears as for other college-reported values.
- **"Acceptance rate for you"**, once the student profile knows the state: the first row of the Admissions group and a
  `CompareMetric` card when 2+ of the colleges have it. Per college: the in-state rate when the student lives in the
  college's state, the out-of-state rate otherwise, the international rate for "Outside the U.S."; label "For you
  ({State})". A college without a grid shows "Not published", **never** its overall rate in this row (the overall rate
  is one row up).
- Not in Key differences or the radar (percentile-based).
- The planned [compare-redesign.md](../compare-redesign.md) moves these rows to its Admissions topic page unchanged.

**Explore** ([search-and-filtering.md](../search-and-filtering.md)), a "Where applicants live" filter group with two
boolean chips, each with its count ("of N colleges that publish this"):
- **"Publishes admit rates by residency"** (`byRes=1`): a passed grid with in-state and out-of-state rates.
- **"Admits out-of-state applicants about as often as in-state"** (`oosEven=1`): out-of-state rate ≥ in-state rate −
  5 points, both groups with 200+ applicants.
- No sort, no slider, no table column while coverage is partial (the inventory's "admits out-of-state at ≥ X%" slider
  waits; open question 4). Colleges without a grid are excluded by these chips and by nothing else.

**Planning tools:**
- [chances-and-fit.md](../product/chances-and-fit.md): the base rate becomes the student's group rate when published
  (below).
- [saved-lists.md](../product/saved-lists.md): inherits it through the standing.
- [student-profile.md](../product/student-profile.md): supplies the state (and needs an "Outside the U.S." choice).

**Glossary** (`lib/glossary.ts`, category Admissions):
- `admit-rate-by-residency` — term "Acceptance rate by residency"; short: "The share of applicants from the college's
  own state who were admitted, and the same for applicants from other states and from abroad, as the college reports
  them in its Common Data Set."; long: "Residency is where an applicant lived when applying, which isn't always the
  same as qualifying for in-state tuition. This is different from the share of first-years who come from out of state:
  that counts who enrolled, this counts who got in."; why: "At many public universities in-state applicants are
  admitted at a higher rate, but not everywhere, and some private colleges show the opposite. A group's rate also
  depends on who applies from there."; related `acceptance-rate`, `in-state-student`, `yield-by-residency`.
- `yield-by-residency` — "Of the students admitted from each place, the share who enrolled."; related `yield`,
  `admit-rate-by-residency`.
- `in-state-student` (existing): one sentence added to `long`: "The share of first-years from out of state is not the
  same as the out-of-state acceptance rate, which counts who got in, not who came."

## Changes to other specs
| Spec | Change |
|---|---|
| [chances-and-fit.md](../product/chances-and-fit.md) | "In-state status" row: source becomes CDS C1 by residency (this spec) where published, wording only elsewhere; drop "IPEDS has no in-state admit rate" as the last word. Rule 3 uses the student's **group rate** as the base rate when published (Georgia Tech: a Georgia student's base rate is 29.5%, not "Reach for everyone"; an out-of-state student's 10.1% is). The reason sentence names it ("Applicants from {State} were admitted at {rate}"), cited. A college without a grid uses the overall rate with the existing wording line. Add a test row for each case |
| [student-profile.md](../product/student-profile.md) | State of residence gains "Outside the U.S."; "Used by" adds the admit rate for you (this spec), Compare's row, and chances' base rate |
| [comparison.md](../comparison.md) | The three rows above in All the numbers; "Acceptance rate for you" after the student profile |
| [search-and-filtering.md](../search-and-filtering.md) | The "Where applicants live" filter group: `byRes`, `oosEven` |
| [residence.md](residence.md) | A "Two different measures" note pointing here; the Students card's link line; CDS C1 enrolled-by-residency is a check on the EF-C shares (10 points), not a replacement (until open question 1 says otherwise) |
| [admissions-detail.md](admissions-detail.md) | "See also": the residency block reuses the by-sex card pattern and its notable-gap rule; the by-sex card stays federal |
| [school-profile.md](../school-profile.md) | Admissions page: "where applicants live" after men and women; `TOPIC_FIELDS.admissions` adds the new fields |
| [college-reported-round-3.md](../college-reported-round-3.md) | Extraction scope, section C: C.116–C.130 and the grid heading; the reader cross-checks Excel code tables against the visible grid (codes are stable within an edition, but a college's code cells can be wrong: Illinois C1, Cornell C21); checks `residency-*` above |
| [trends/out-of-state.md](../trends/out-of-state.md) | Possible later companion: out-of-state admit rates at publics from CDS editions, once a fixed panel exists (below) |

## Keep history?
**Series per CDS edition.** Out-of-state admit rates move with policy (caps or targets for out-of-state enrollment at
public universities, merit recruiting in other states), and a family watching a college over several years wants to
see that line. The README's federal bar (comparable yearly files, ~8 years) doesn't fit a college-reported item, so
the rule is the one [cds-admissions.md](cds-admissions.md) set: a series once two or more editions are collected.

- **Family `cds-c1-res`** in the history shard (`step: 1`, falls), series `admit_rate_in_state`,
  `admit_rate_out_of_state`, `admit_rate_international`, `yield_in_state`, `yield_out_of_state`; a point per edition
  whose grid passed, `null` for missing or failed editions (gaps, not zeros). The newest point equals the snapshot's
  derived value (the shard contract), built by `sync-history` from `data/cds-records/` with the same `lib/derive.ts`
  helpers as the profile.
- **Over time → Admissions:** "Acceptance rate by where applicants live" (in-state solid, other states dashed,
  international dotted; one hue, directly labeled), shown from **3 editions**.
- **Backfill: worth it, from archived prior editions only.** Index pages list 10–25 past editions at many colleges;
  round 3's open question 2 would archive them by HTTP. For this unit, extract **C1 only** (totals and the grid) from
  up to 5 prior editions per college: the C1 grid is on one or two pages (Harvard p7, USC p9, Michigan p13), about
  3 K tokens per edition. Estimate: ~740 colleges × 4 editions × (3 K input × $0.50/M + 0.3 K output × $2.50/M at
  Haiku batch prices) ≈ **$7**; Excel editions free. **Unverified:** which template year first carried the residency
  grid. The backfill reads one older edition per format in the pilot and stops at the first edition without the grid
  (`absent`, not `blank`).
- No events.

## Top-level trend?
- **Hero indicator: no.** Partial coverage, and the question isn't asked of every college.
- **"Known for": no** while coverage is partial (percentile-based chips are forbidden for these fields). Later
  candidate: "Admits out-of-state applicants at a far lower rate" at publics, top 5% gap, once 500+ colleges have it.
- **Home fact: not now.** Candidate once 100+ public universities have 3+ editions: "Public universities admit
  applicants from other states at a lower rate than their own residents, and the gap is {growing/steady}", on a fixed
  panel.
- **Explore:** the two boolean chips only.
- **"Over time" chart:** yes, from 3 editions.

## Build
| File | Change |
|---|---|
| `lib/types.ts` | `ReportedData.admissions_by_residency`, `ReportedResidencyAdmissions`, `ResidencyCounts`; `LineageRecord.cell?` if not already added |
| `lib/fields.ts` | 18 `reported.admissions_by_residency.*` entries, 7 `derived.*` entries |
| `lib/cds-sections.ts` | Item `C1-residency` in group C: codes C.116–C.130, PDF tags, visible-grid row labels and column headers, the heading pattern for the year, the group-C schema fields (`in_state`, `out_of_state`, `international`, `unknown`, `total` × three counts, each `{ v, lines }`) |
| `lib/cds-checks.ts` | `residency-funnel`, `residency-sum`, `residency-total-unreadable`, `residency-vs-federal`, `residency-form-vs-codes` |
| `scripts/lib/cds-xlsx.mts` | Grid reader for both layouts (by label with column letters) and the code-table read; the cross-check picks the passing source |
| Fillable-PDF reader (round 3) | Tag map for the 15 tags; `NRES` → out-of-state |
| `lib/cds-merge/residency.ts` (new, pure) | Records → `reported.admissions_by_residency` + lineage per leaf; newest passed edition; two-falls window; called by `merge-reported` and `sync-data` |
| `lib/derive.ts` | `admitRatesByResidency()`, `yieldsByResidency()`, `rateForStudent()` (shared with history) |
| `lib/insights.ts` | `admissionsByResidency()` and the three constants |
| `components/school/ResidencyAdmissions.tsx` (new) | The card; `app/schools/[id]/admissions/page.tsx` places it; `components/school/Residence.tsx` the link line |
| `lib/profile-topics.ts` | `TOPIC_FIELDS.admissions` adds the new fields |
| Compare table and `CompareMetric` | The rows above |
| `lib/params.ts`, `lib/dataset.ts`, `FilterPanel`, `ActiveFilters` | `byRes`, `oosEven` |
| `lib/glossary.ts` | Two entries, one sentence on `in-state-student` |
| `lib/history.ts`, `scripts/sync-history.mts`, `lib/profile-history.ts` | Family `cds-c1-res`, the chart |
| `tests/residency-admissions.test.mts` (new) | Below |

### Tests (each guard shown to fail when broken)
1. **Illinois fixture:** the code table fails `residency-funnel` and `residency-vs-federal`; the visible grid passes
   and is published with grid cells in lineage. Break: drop the grid read, and the item is `failed` and queued.
2. **Both sources fail** (a fixture with the grid also wrong): one review item keyed college + edition + `C1-residency`,
   nothing merged. Break: publish on either source, and the test fails.
3. **Tags:** Howard's 12 tags map to the right columns. Break: map by the word "nonresident", and out-of-state and
   international swap.
4. **Placement by x:** Baylor's four-cell rows put the blank in Unknown. Break: place by order, and the total lands in
   Unknown and `residency-sum` fails.
5. **Sums:** Georgia Tech's 8,920 vs 8,921 passes; a 2% gap fails; Loyola's `##` totals use the by-sex totals.
6. **Blank vs zero:** `0` is stored; empty, `-`, `N/A` are null; Duke's and MIT's empty grids are `blank` and merge
   nothing; Spelman's enrolled-only grid stores counts with null rates and no card.
7. **Year:** a fixture with page headers "Common Data Set 2024-2025" and grid heading "Fall 2025" gets year 2025.
8. **Rates:** none under 10 applicants (or 10 admits for yield); Unknown is never a rate; the same-class tick uses
   C.116/C.117 of the same document even when the headline funnel is a newer class profile.
9. **Merge window:** a passed grid more than two falls older than `admissions.year` isn't in the snapshot but is in
   history; a newer failed grid doesn't hide an older passed one inside the window.
10. **Lineage:** a stored leaf without an `extracted` record fails `check:lineage`.
11. **Partial-coverage guard:** no `METRICS` entry, distribution, rank, sort option, or radar axis uses a
    `reported.admissions_by_residency.*` or residency `derived.*` field. Break: add a metric, and the test fails.
12. **For you:** same state → in-state; other state → out-of-state; "Outside the U.S." → international; no grid → "Not
    published", never the overall rate.
13. **Insight:** Georgia Tech is notable; a college at 43% / 44% gets the one-line sentence; the student marker
    appears only with a profile state.
14. **History:** the newest `cds-c1-res` point equals the snapshot's derived rate; a missing edition is `null`.

## Open questions for the owner
1. **Enrolled-by-residency vs the federal shares.** Keep EF-C as the Students card's figures and use the CDS row as a
   check (recommended), or apply newest-everywhere to the three shares and accept a card whose map and top states
   describe an older class?
2. **Notable-gap thresholds:** 5 points or 1.5×, 200+ applicants per group (9 of 12 notable in the sample). Baylor
   (4.9 points) and Cornell's in-state vs other states (4.3 points, 1.48×) fall just under.
3. **Backfill:** extract C1 from up to 5 archived prior editions (~$7 estimate), once round 3 archives them?
4. **Explore:** boolean chips only until coverage passes ~500 colleges, then an out-of-state-rate slider?
5. **Small international pools:** show the international rate from 10 applicants (UW–Eau Claire: 41 of 58), or
   require 30?

## Notes on the inventory
- **Illinois is not a document inconsistency.** The visible grid on sheet C is consistent (29,419 / 14,509 / 6,587
  in-state; 32,702 / 9,495 / 1,210 out-of-state; 20,924 / 6,380 / 1,410 international; totals 83,045 / 30,384 /
  9,207). The code table's C.120–C.121 hold the out-of-state and international applicant counts. Code cells can be
  wrong per college (also Cornell C21), so grid items need the visible-form cross-check.
- **Totals-only colleges:** the inventory lists six (William & Mary, Berkeley, Harvard, Spelman, Michigan, Duke). In the
  documents, Spelman fills the enrolled row by residency, and Duke's grid is empty including its Total column (its C1
  totals are in the by-sex table). So: 4 totals-only, 1 enrolled-only, 2 empty (Duke, MIT).
- Round 3 Decision 3.2 says Excel codes are read "by label since codes vary between colleges' files"; the inventory
  found the codes identical across the four 2025–26 workbooks. This spec follows the inventory (read by code) and adds
  the cross-check for wrong values in a college's code cells.
- The inventory's check "out-of-state + international admits ≤ total admits" is implied by `residency-sum`.
- Not verified: the first template year with the residency grid (matters for backfill depth); the grid's coverage
  outside this selective-heavy sample.

## As built
Built 2026-10-03 on the round-3 foundation. Real data: Vanderbilt 221999, Cornell 190415, and Illinois 145637 have a
block in `data/schools.json`; William & Mary 231624 prints C1 totals only (C.119–C.130 blank), so it has none and
Compare shows "Not published".

**Record → block** (`lib/cds/residency.ts`, pure; the spec's `lib/cds-merge/residency.ts`). `residencyFromRecord(record,
{ admissionsYear, federal })` walks the college's documents newest first and returns the block, a lineage record per
stored leaf, and an outcome per edition (`merged`, `blank`, `failed`, `too-old`). `mergeResidency(school, record)` is
idempotent and removes a previous block. `lib/reported-merge.ts#mergeReported(schools, reported, records = [])` calls it
once per school after the admissions block; `npm run merge-reported` and `sync-data` pass `readRecords(data/cds-records)`.
- **Which values.** A cell is a **passed** item's number. The one exception is the `residency-form-vs-codes` rule for
  template workbooks: an item that failed *only* `form-vs-code` takes its `form` value (the visible grid), and only if
  the whole grid built that way passes the checks below. A failed item's code-table value is never used; an item that
  failed any other check, or failed `form-vs-code` without a `form` value, makes the grid unusable. Illinois's C.120–C.122
  and C.125 are published this way (lineage `cell` is the visible grid's `CDS-C!E38`, `F37`, …; cells whose code and
  grid agree cite the code-table cell, since the record keeps a form cell only for disagreements). When the checks track
  promotes such items to `passed` with the grid's value, the reader takes them as ordinary passed items.
- **Grid checks at merge** (`checkGrid`): `residency-funnel`, `residency-sum` (rows whose three residency cells are all
  filled; blank Unknown as 0), and `residency-vs-federal` (10 points against `demographics.residence`). A grid that fails
  isn't merged; an older passed grid is used only within two falls of `admissions.year`. `residency-total-unreadable`
  (`##` totals vs C1's by-sex totals) is not here: a row without a printed total isn't sum-checked; it belongs to
  `lib/cds-checks.ts` with the review-queue item.
- **Year:** the record's `years.fall` ("Fall 2025"), else the edition's first fall; never a page header.
- **Quotes:** workbook cells get the generated "Total first-time, first-year who applied, In-State: 29,419".

**Registry** (`lib/fields.ts`): 18 `reported.admissions_by_residency.*` paths (`entering_term`, `year`, `edition`, and
5 groups × 3 counts) and 8 computed `derived.*` fields: the spec's seven plus `derived.admit_rate_same_class` (the
tick's own ⓘ: C.117 ÷ C.116 of the same document). Derived ⓘs show the college, the CDS year, the document link, the
retrieval date, and the formula; the quote and cell are on the stored counts' lineage.

**Display helpers** (`lib/cds/residency-display.ts`, pure; the spec placed these in `lib/derive.ts` and `lib/insights.ts`,
moved to one module so parallel tracks don't collide): `admitRatesByResidency`, `yieldsByResidency` (none under 10
admits), `sameClassAdmitRate`, `rateForStudent` (`OUTSIDE_US` = "outside-us"), `admissionsByResidency(school,
studentState?)` with `RESIDENCY_NOTABLE_GAP` 0.05, `RESIDENCY_NOTABLE_RATIO` 1.5, `RESIDENCY_MIN_APPLICANTS` 200,
`RESIDENCY_FILTERS` (`byRes`, `oosEven`), and Compare's `compareAdmitRates` / `compareYields`.

**Where it shows**
- Admissions page: `components/school/ResidencyAdmissions.tsx`, `variant="card"` after "Men and women" (title, ⓘ, the
  headline sentence, a bar per group with the same-class tick, the yield line, the caveat) or `variant="line"` under the
  funnel when not notable; both `id="residency"`, listed in On this page when the rates exist. The "(you)" marker is
  wired (`studentState`) but no page passes a state until the student profile exists.
- Students page: `components/school/Residence.tsx` adds the link line.
- Compare, All the numbers: the two rows after "Acceptance rate, men / women" (`app/compare/page.tsx`).
- Explore: "Where applicants live" chips in `FilterPanel` with counts, active-filter chips in `Toolbar`, `lib/params.ts`,
  `lib/dataset.ts`, and the facets in `app/explore/page.tsx`.
- Glossary: `admit-rate-by-residency`, `yield-by-residency`, and the sentence on `in-state-student`.

**Tests** (`tests/residency-admissions.test.mts`; each guard was broken once and the tests failed): the Illinois
fixture both ways (code table fails funnel and vs-federal; the visible grid publishes with grid cells; without `form`
nothing merges), both sources failing, tag-to-column mapping by code (`NRES` out-of-state, `INTL` international), sums
(8,920 vs 8,921 passes, 2% fails), blank vs zero (W&M's empty grid, a Spelman-like enrolled-only grid), year, rate
minimums and the same-class tick, the merge window both ways, lineage (a missing leaf record fails `validateSchool`),
the committed data equals a re-merge, the partial-coverage guard (no residency field in `lib/metrics.ts`,
`lib/insights.ts`, `lib/indicators.ts`, `lib/history.ts`, `app/page.tsx`, or Explore's sorters), "for you", the insight
(Georgia Tech notable, 43%/44% one line, small groups, Vanderbilt and Cornell notable), Compare cells, and the Explore
chips. `tests/merge-reported.test.mts` and `tests/profile-topics.test.mts` were updated for the records argument and the
new fields.

**Not built**
- **History** (`cds-c1-res` family, the Over time chart, test 14): not built. It needs two or more passed editions per
  college; the records hold one (2025–26) per college, and it touches `lib/history.ts`, `sync-history`, and the history
  shards, which other tracks share. Build it with the prior-edition backfill (open question 3).
- **"Acceptance rate for you"** in Compare and the chances base rate: wait for the student profile; the helper and its
  test exist.
- **Readers and per-item checks**: the classic-Excel grid reader, the fillable-PDF tag map, placement by x (test 4), the
  `C1-residency` item and review-queue entry, and `residency-total-unreadable` belong to the readers and checks tracks
  (`scripts/lib/cds-xlsx.mts`, `lib/cds-checks.ts`).
- Compare's "Not published" cell has no per-cell ⓘ (the row's ⓘ explains the term).

## Roadmap entry
- slug: cds-residency-admissions
- summary: See how often a college admits applicants from its own state, from other states, and from abroad, and how many of each enroll.
- complexity: 2 — One Common Data Set grid from the round-3 records, a new admissions block, Compare rows, two Explore filters, and a per-edition history series.
- after: ["college-reported-round-3"] (the Compare "Acceptance rate for you" row and the chances base rate also wait for "student-profile" and "chances-and-fit"; the rest ships without them)
