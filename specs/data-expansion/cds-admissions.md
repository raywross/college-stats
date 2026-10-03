# CDS Admissions Profile: GPA, Factors, Early Rounds, Wait List

> Status: **planned** (2026-10-03). Wave 4. Built from the per-document records of
> [college-reported-round-3.md](../college-reported-round-3.md) (`data/cds-records/<unit_id>.json`), which must capture
> every item in [Items the one run must capture](#items-the-one-run-must-capture) on its first visit to each document,
> even the ones shown later or never. Upgraded from the 2026-09-28 skeleton (Vanderbilt 2024–25 and Cornell 2025–26
> workbooks) with the CDS inventory of 2026-10-03, which read 19 colleges' 2025–26 documents item by item. Part of
> [data-expansion](README.md).

## Question it answers
*What high school GPAs do this college's first-years have, and where does mine fall? How much does each part of an
application count here? Does applying early change the odds? How many people get in off the wait list?*

## Scope
| Covered here | Template items |
|---|---|
| Wait list: offered, accepted a place, admitted (ranked and released: stored only) | C2 |
| How much each of 18 factors counts: very important / important / considered / not considered | C7 |
| Class rank bands and the share whose school reported a rank | C10 |
| GPA bands in three columns: sent test scores / didn't / all | C11 |
| Average high school GPA and the share who reported one | C12 |
| Early decision: offered, dates, applications, admits | C21 |
| Early action: offered, restrictive or not, dates (the template has no EA counts) | C22 |

**Not covered here** (each has its own spec; cross-linked, not repeated):
- C1 by residency (in-state / out-of-state / international applied, admitted, enrolled; `C.119`–`C.130`):
  [cds-residency-admissions.md](cds-residency-admissions.md).
- C8 test policy for the coming cycle and C9 scores (composite percentiles, score bands, number submitting):
  [cds-test-scores-and-policy.md](cds-test-scores-and-policy.md).
- C1 totals (`C.116`–`C.118`) stay with round 2's reader ([college-reported-round-2.md](../college-reported-round-2.md)).
  This spec reads them from the same document's record only for its checks.
- C3–C6 and C13–C19 (requirements, fees, deadlines, notification, deposits, gap year) belong to other units of the
  inventory (U4, U10).

## The sample behind every number here
The CDS inventory (2026-10-03) read the 2025–26 edition of 20 colleges; 19 were readable (UVA's page is a Cloudflare
challenge). Coverage below is counted in those 19 unless a row says otherwise.

| Document type | Colleges | How this spec's items read |
|---|---|---|
| 2025–26 Excel template (per-sheet code tables + ANSWER SHEET) | Vanderbilt, Cornell, William & Mary, Illinois | By code, no model |
| Official fillable CDS PDF (answers only in form fields) | Howard | Form fields named by the template's "US News PDF Tag" column, no model |
| Older or custom Excel (no code table) | Berkeley, Purdue | Label match **with column letters** (`sheetText` drops empty cells, so a lone value or an "x" loses its column) |
| Flattened PDF with a text layer | Harvard, USC, Georgia Tech, Spelman, Baylor, TCU, Loyola Chicago, UW–Eau Claire, Michigan, Duke | Layout-aware text (rows rebuilt by y, x kept); a model reads values; C7 marks placed by x in code |
| HTML | MIT, Texas A&M | `htmlToText` fixed to keep empty cells; a model reads values |

The sample leans selective (it was chosen from colleges known to publish a CDS), so its coverage rates are upper
bounds for the 1,893 colleges. Round 3's run summary (`items`, per CDS item: passed / failed / blank / absent) measures
the real rates.

## Items the one run must capture
Every code below goes into round 3's [Extraction scope](../college-reported-round-3.md#extraction-scope), group `C`.
"Store only" items are kept in the record and never merged into `data/schools.json`; capturing them costs nothing
extra (they sit in the same grids as shown items) and spares a re-read if they're wanted later.

| Item | Codes (2025–26 template) | Count | Shown? | Deterministic from template workbook / fillable PDF | Model for flattened PDF and HTML | Coverage (inventory) |
|---|---|---|---|---|---|---|
| C2 wait list | `C.201`–`C.204` | 4 | Yes | Yes | Yes (values); no for the yes/no | Counts at 11 of 19; policy only at Duke |
| C2 ranked / released | `C.205`–`C.207` | 3 | Store only | Yes | Yes | `C.205` answered in all 4 workbooks (all No); `C.206`–`C.207` blank or "-" |
| C7 factor grid | `C.701`–`C.718` | 18 | Yes | Yes | **No**: the layout pass places each mark by x | All 19 |
| C7 free text | `C.719` | 1 | Store only | Yes | Yes | Illinois ("We admit by major…") |
| C10 class rank | `C.1001`–`C.1006` | 6 | Yes | Yes | Yes | 12 of the 15 documents checked |
| C11 GPA bands | `C.1101`–`C.1130` | 30 | Yes | Yes | Yes | Filled at 12 of 19, blank at 7 |
| C12 average GPA | `C.1201`–`C.1202` | 2 | Yes | Yes | Yes | 11 of 19 |
| C21 early decision | `C.2101`–`C.2111` | 11 | Yes | Yes, with the visible-form cross-check (Cornell) | Yes | Counts at 7, offered without counts at 1 (Duke), no ED at 8 |
| C21 free text | `C.2112` | 1 | Store only | Yes | Yes | Rarely filled |
| C22 early action | `C.2201`–`C.2206` | 6 | Yes | Yes | Yes | Offered at 12 of 19 |

**82 codes in all.** Plus, read for checks only: `C.116` (applied), `C.117` (admitted) from the same document's C1.

### C2: wait list
| Code | Wording | Stored as | Howard field |
|---|---|---|---|
| `C.201` | Do you have a policy of placing students on a waiting list? | yes / no | `AD_WAIT` |
| `C.202` | Number of qualified applicants offered a place on waiting list | count | `AP_RECD_WAIT_N` |
| `C.203` | Number accepting a place on the waiting list | count | `AP_ACPT_WAIT_N` |
| `C.204` | Number of wait-listed students admitted | count | `AP_ADMT_WAIT_N` |
| `C.205` | Is your waiting list ranked? | yes / no, store only | `WAITLIST_RANK` |
| `C.206` | If yes, do you release that information to students? | yes / no, store only | `WAITLIST_INFO_STUD` |
| `C.207` | Do you release that information to school counselors? | yes / no, store only | `WAITLIST_INFO_SCH` |

**Coverage.** All three counts at Cornell (9,720 offered / 6,598 accepted / 254 admitted), William & Mary
(4,085 / 1,901 / 103), Georgia Tech, Baylor, TCU, Michigan, MIT, and Spelman (568 / 2 / 0, which the inventory calls
odd). Illinois: 4,317 accepted and **1 admitted** (suspect), offered blank in its workbook (the inventory lists Illinois
as complete; its answer sheet has no `C.202` value). Howard: 1,310 offered and 637 accepted, admitted blank (from its
form fields; the inventory's C2 row doesn't mention Howard). Admitted only: Vanderbilt 207, Harvard 75. Policy only:
Duke. Zeros or blank: USC, UW–Eau Claire, Loyola. Not checked: Berkeley, Purdue, Texas A&M.

**Year.** The template asks "for Fall 2025 admissions": the edition's entering class.

**Traps.** Vanderbilt answers `C.201` with "X" instead of Yes (read "X" in a yes/no cell as yes). A policy of Yes with
every count 0 (USC, UW–Eau Claire, Loyola) is treated as **blank counts**, not "nobody was admitted"; a 0 next to
nonzero counts (Spelman's 0 admitted) is a published 0.

### C7: how much each factor counts
Eighteen rows, one mark each in Very important / Important / Considered / Not considered, then a free-text note.

| Code | Factor (template wording) | Key | Template group | Howard field | IPEDS factor with the same meaning |
|---|---|---|---|---|---|
| `C.701` | Rigor of secondary school record | `rigor` | Academic | `Q111_1` | — (IPEDS "secondary school record" is the record, not its rigor) |
| `C.702` | Class rank | `class_rank` | Academic | `Q111_2` | `class_rank` (ADMCON2) |
| `C.703` | Academic GPA | `gpa` | Academic | `Q111_3` | `gpa` (ADMCON1) |
| `C.704` | Standardized test scores | `test_scores` | Academic | `Q111_4` | — (test policy is C8 / `test_policy`) |
| `C.705` | Application Essay | `essay` | Academic | `Q111_5` | `essay` (ADMCON11) |
| `C.706` | Recommendation(s) | `recommendations` | Academic | `Q111_6` | `recommendations` (ADMCON5) |
| `C.707` | Interview | `interview` | Nonacademic | `Q112_1` | — |
| `C.708` | Extracurricular activities | `extracurriculars` | Nonacademic | `Q112_2` | — |
| `C.709` | Talent/ability | `talent` | Nonacademic | `Q112_3` | — |
| `C.710` | Character/personal qualities | `character` | Nonacademic | `Q112_4` | — |
| `C.711` | First generation | `first_generation` | Nonacademic | `Q112_5` | — |
| `C.712` | Alumni/ae relation | `alumni_relation` | Nonacademic | `Q112_6` | `legacy` (ADMCON12) |
| `C.713` | Geographical residence | `geographic_residence` | Nonacademic | `Q112_7` | — |
| `C.714` | State residency | `state_residency` | Nonacademic | `Q112_8` | — |
| `C.715` | Religious affiliation/commitment | `religious` | Nonacademic | `Q112_9` | — (shared with [religious-life.md](../religious-life.md)) |
| `C.716` | Volunteer work | `volunteer_work` | Nonacademic | `Q112_11` | — |
| `C.717` | Work experience | `work_experience` | Nonacademic | `Q112_12` | `work_experience` (ADMCON10) |
| `C.718` | Level of applicant's interest | `interest` | Nonacademic | `Q112_13` | — |
| `C.719` | Additional information if the importance of any factor differs by academic program | store only | — | `CDS_ACAD_NONACAD_FACTORS_TEXT` | — |

The skeleton said 19 factors; the 2025–26 template has 18 (Howard's form skips `Q112_10`).

**Coverage.** All 19 documents.

**Year.** The basis for selecting the edition's entering class (C1–C12 describe fall 2025 in the 2025–26 edition).

**Extraction (no vision needed in this sample).** Each source marks the column differently:
| Source | Mark | How the column is found |
|---|---|---|
| 2025–26 code tables | Words: "Very Important", "Important", "Considered", "Not Considered" | The value itself |
| Howard (form fields) | Radio export values `VI` / `I` / `C` / `NC` | The value itself |
| Classic Excel (Berkeley, Purdue) | "x" in one of columns C–F | The column letter against the header row. `sheetText` drops empty cells, so this reader must work on cells, not text |
| Flattened PDFs (Harvard, USC, Georgia Tech, Baylor, TCU, Loyola, UW–Eau Claire, Duke) | "X" | x position inside the header's column range. Plain `pdfPages` text loses it ("Class rank X"); the layout pass recovers it in every one. Harvard: headers "Considered" at x=425 and "Not Considered" at x=497, marks at 450 and 532 |
| Spelman | A private-use-area glyph | Counted as a mark, then placed by x |
| Michigan | ☐☐☐☒ in column order | Position of ☒ among the four boxes |
| MIT (HTML) | "X" in one of four `<td>`s | Only if `htmlToText` collapses whitespace inside each `<tr>` first; today empty cells vanish |

This is round 3's [Decision 3.5](../college-reported-round-3.md#decision-3-deterministic-readers-first-four-document-types) layout pass. Its
vision fallback stays for pages the pass can't decide, but the inventory found none.

### C10: class rank
| Code | Wording | Howard field |
|---|---|---|
| `C.1001` | Percent in top tenth of high school graduating class | `FRSH_HS_RANK_10_P` |
| `C.1002` | Percent in top quarter of high school graduating class | `FRSH_HS_RANK_25_P` |
| `C.1003` | Percent in top half of high school graduating class | `FRSH_HS_RANK_50_P` |
| `C.1004` | Percent in bottom half of high school graduating class | `FRSH_HS_RANK_LESS50_P` |
| `C.1005` | Percent in bottom quarter of high school graduating class | `FRSH_HS_RANK_LESS25_P` |
| `C.1006` | Percent of total first-time, first-year students who submitted high school class rank | `FRSH_HS_RANK_SUBMIT_P` |

**Coverage.** 12 of the 15 documents checked: Vanderbilt, Cornell, William & Mary, Illinois, Harvard, USC, Georgia
Tech, Spelman, Baylor, TCU, Loyola, UW–Eau Claire. Blank at Howard, Michigan, Duke. Not checked: Berkeley, Purdue, MIT,
Texas A&M. **The share submitting is often 12–60%** (Cornell 12.2%, Vanderbilt 19.8%, Illinois 21.7%, William & Mary
30.1%), so the bands describe a minority of the class: the students whose high schools still rank. They're never shown
without that share.

**Year.** Enrolled first-years of the edition's entering class.

### C11: GPA bands, three columns
"Percentage of all enrolled, degree-seeking, first-time, first-year students who had high school grade-point averages
within each of the following ranges (using 4.0 scale)." Nine bands: 4.0; 3.75–3.99; 3.50–3.74; 3.25–3.49; 3.00–3.24;
2.50–2.99; 2.0–2.49; 1.0–1.99; below 1.0.

| Column | Codes | Total | Howard fields |
|---|---|---|---|
| Students who submitted scores | `C.1101`–`C.1109` (bands in the order above) | `C.1110` | `FRSH_GPA_SUBMIT_1_P`…`_9_P`, `TOT_FRSH_GPA_SUBMIT_P` |
| Students who did not submit scores | `C.1111`–`C.1119` | `C.1120` | `FRSH_GPA_NO_SUB_1_P`…`_9_P`, `TOT_FRSH_GPA_NO_SUB_P` |
| All enrolled students | `C.1121`–`C.1129` | `C.1130` | `EN_FRSH_GPA_1_P`…`_9_P`, `TOT_EN_FRSH_GPA_P` |

**Coverage.** Three columns at Vanderbilt, Purdue, USC, Spelman (4); two at Loyola (didn't submit + all); "all" only at
William & Mary, Berkeley, Harvard, Georgia Tech, Howard, UW–Eau Claire (6); one column at Michigan (which one needs x).
**Blank at 7 of 19**: Cornell, Illinois, Baylor, TCU, Duke, MIT ("N/Av"), Texas A&M ("N/A"). This isn't only the most
selective colleges, as the skeleton said: Baylor and TCU admit 48–52%.

**Year.** Enrolled first-years of the edition's entering class.

**Traps.**
- **Key on the code, never on the template's lowercase tag.** The 2025–26 workbook's tag column runs band-by-column
  (`C.1102` is tagged `c11_percent_who_had_gpa_of_4_0_percent_students_who_did_not_submit_scores`) while its codes and
  question text run column-by-band (`C.1102` = "Percent who had GPA between 3.75 and 3.99", in the submitted column).
  The codes and wording are right: Vanderbilt's totals (`C.1110` = `C.1120` = 1) and Howard's field names
  (`FRSH_GPA_SUBMIT_2_P` on `C.1102`) agree with them. Found while writing this spec, in the inventory's answer sheet.
- **Totals are formulas.** `C.1110`/`C.1120`/`C.1130` read 0 for an empty column (Cornell, Illinois) and
  0.9999999999999999 at Vanderbilt. A total of 0 means blank, not 0%.
- **A lone column has no position in plain text.** Harvard's plain text gives "74.70%" beside "Percent who had GPA of 4.0"
  with no column; its totals row ("Totals should = 100% | 0.00% | 0.00% | 100.00%") says it's "all". Use the totals
  row, else the value's x under the column headers.
- **Scale per column, never per value.** Workbooks store fractions (0.351), Howard whole percents (7, 43, 30), PDFs
  "74.70%". Decide each column's scale from its total (≈1 → fractions, ≈100 → percents) or a "%" sign. The existing
  `frac()` in `cds-xlsx.mts` (divide when over 1.5) would read Harvard's "0.98%" as 98%.

### C12: average high school GPA
| Code | Wording | Howard field |
|---|---|---|
| `C.1201` | Average high school GPA of all degree-seeking, first-time, first-year students who submitted GPA | `FRSH_GPA` |
| `C.1202` | Percent of total first-time, first-year students who submitted high school GPA | `FRSH_GPA_SUBMIT_P` |

**Coverage.** 11 of 19: Vanderbilt 3.895, William & Mary **4.34**, Berkeley 3.9, Harvard **4.22**, USC 3.85, Georgia
Tech **4.17**, Howard 3.68, Spelman 3.96, Loyola 3.74, UW–Eau Claire 3.64, Michigan 3.9. Blank at Cornell, Illinois,
Purdue (which fills C11), Baylor, TCU, Duke, MIT, Texas A&M.

**Year.** Enrolled first-years of the edition's entering class.

**Weighted averages.** Three of the 11 are above 4.0, so they count extra points for honors and AP courses. The template
asks for no scale (only C11 says "using 4.0 scale"), and the CDS definitions allow either ("Unweighted GPA's assign the
same weight to each course. Weighting gives students additional points…"). So:
- Store a `scale` with every average: `weighted` when the average is above 4.0 or the document says weighted next to
  C12; `unweighted` only when the document says so; otherwise `not_stated`. A value of 4.0 or below can still be weighted.
- **Never compare C12 across colleges as if it were unweighted**: no ranks, medians, sorts, percentiles, or Compare key
  differences, and the GPA checker never compares a student's GPA with it.
- The skeleton's check "C12 average falls inside the C11 band range" is **dropped**: it fails at every weighted college.
- At weighted colleges the C11 "4.0" band seems to hold every GPA of 4.0 or more (Harvard: 74.7% in the 4.0 band, average
  4.22). The tooltip says so; see open question 4.

### C21: early decision
| Code | Wording | Stored as | Howard field |
|---|---|---|---|
| `C.2101` | Does your institution offer an early decision plan…? | yes / no | `AD_EDEC` |
| `C.2102`, `C.2103` | First or only early decision plan closing date: month, day | month/day | `AP_DL_EDEC_1_MON`, `_DAY` |
| `C.2104`, `C.2105` | First or only early decision plan notification date: month, day | month/day | `AP_NOTF_DL_EDEC_1_MON`, `_DAY` |
| `C.2106`, `C.2107` | Other early decision plan closing date: month, day | month/day | `AP_DL_EDEC_2_MON`, `_DAY` |
| `C.2108`, `C.2109` | Other early decision plan notification date: month, day | month/day | `AP_NOTF_DL_EDEC_2_MON`, `_DAY` |
| `C.2110` | Number of early decision applications received by your institution | count | `AP_RECD_EDEC_N` |
| `C.2111` | Number of applicants admitted under early decision plan | count | `AP_ADMT_EDEC_N` |
| `C.2112` | Please provide significant details about your early decision plan | text, store only | `AP_EDEC_T` |

**Coverage.** Counts at 7: Vanderbilt 6,202 applied / 874 admitted, William & Mary 1,477 / 735, Howard 430 / 363,
Spelman 437 / 70, Baylor 566 / 453, TCU 1,373 / 935, Cornell 10,057 / 1,889 (visible form). **Duke offers ED but
publishes no counts.** No ED at 8: Harvard, USC, Georgia Tech, Loyola, UW–Eau Claire, Michigan, Illinois, MIT. Not
stated for Berkeley, Purdue, Texas A&M. One count pair covers every ED round (the template has no separate ED II counts).

**Year.** The counts are "For the Fall 2025 entering class": the edition's class. The offered flag and the dates are the
plan **as the edition publishes it**; they carry month and day only, so lineage labels them with the edition
("2025–26"), never a guessed cycle.

**Traps.**
- **Cornell's code table is off by one row**: `C.2111` ("admitted") holds 10,057, which is its applications; `C.2104`/
  `C.2105` (notification) hold 11 and 1, its closing date; `C.2101` holds the template placeholder "Yes or No". Its
  visible form is right (10,057 / 1,889). So for C21 the workbook reader reads **both** the code table and the visible
  form by label, and the checks below decide.
- Vanderbilt types its dates as free text, so its date code cells are blank; parse a month name and day from the
  visible cell, else leave the date null with its quote.
- Baylor's plain PDF text prints "Yes 11/1 12/15 566 453" with no labels; the layout pass pairs each value with its row.
- Dates appear as month/day cells, "11/1", "1-Nov" (Spelman), "Nov 1st", Excel serials, and "11 months 1 day" (Duke).
- "Yes or No" (the template placeholder) is blank, not yes.

### C22: early action
| Code | Wording | Stored as | Howard field |
|---|---|---|---|
| `C.2201` | Do you have a nonbinding early action plan…? | yes / no | `AD_EACT` |
| `C.2202`, `C.2203` | Early action closing date: month, day | month/day | `AP_DL_EACT_MON`, `_DAY` |
| `C.2204`, `C.2205` | Early action notification date: month, day | month/day | `AP_NOTF_DL_EACT_MON`, `_DAY` |
| `C.2206` | Is your early action plan a "restrictive" plan under which you limit students from applying to other early plans? | yes / no | `AP_EACT_RESTRICT` |

**Coverage.** The inventory lists EA at Illinois, Howard, Baylor, TCU, USC, and Georgia Tech. Reading each document's
C22 for this spec found six more: Harvard (restrictive; 11/1, decisions 12/16), Spelman, Michigan, Purdue, Texas A&M,
and MIT (not restrictive; Nov. 1, Dec. 20). **Offered at 12 of 19**; no at Vanderbilt, William & Mary, Loyola,
UW–Eau Claire, Berkeley; "N/A" at Duke; the placeholder at Cornell. The template has **no EA counts**.

**Year.** As for the C21 plan: labeled with the edition.

## Checks
Every value also passes round 3's universal checks: the number appears on its cited line or cell, the cited line exists,
the document's own edition matches, and the value is in its type's range (percentages 0–100, counts ≥ 0, GPA 0–5).
A failing item never blocks another item; it goes to the review queue keyed by college + edition + item
([round 3, Decision 9](../college-reported-round-3.md#decision-9-checks-for-every-item-including-deterministic-reads-publish-and-escalate-per-item)).
None of these items has a federal value, except the six C7 factors below; nothing here is checked against IPEDS counts.

| Item | Check | On failure |
|---|---|---|
| All | Placeholders "Yes or No", "-", "N/A", "N/Av", "n/a", "Not Applicable", "XXXXX", and empty cells are blank; text in a numeric cell ("varies") is blank with its quote kept | — (normalization) |
| All yes/no | "X", "x", "✔", "Y", "Yes", ☒, a radio "Y" are yes; "N", "No" are no | — |
| C2 | admitted ≤ accepted ≤ offered, for each pair present | failed |
| C2 | offered ≤ C1 applicants; admitted ≤ C1 admitted (same document) | failed |
| C2 | policy No with nonzero counts | failed |
| C2 | offered ≥ 100 and accepted under 1% of offered (Spelman 568 / 2) | review note; published |
| C7 | each row has at most one mark | that row null; the item failed if two or more rows have two marks |
| C7 | at least 9 of 18 rows marked | failed (a column misread, not a sparse grid) |
| C7 | not every marked row in the same column | failed (the x ranges are off) |
| C7 | the six shared factors against IPEDS `admissions.factors` (considered or above vs not considered) | see [Newest everywhere](#newest-everywhere-the-six-shared-factors); a disagreement is never silent |
| C10 | top tenth ≤ top quarter ≤ top half; bottom quarter ≤ bottom half; top half + bottom half = 100 ± 1; scale from the set | failed |
| C10 | rank bands present but submitted share blank | failed (bands can't be shown without it) |
| C11 | each column present sums to 100 ± 1 in its scale | that column failed; other columns publish |
| C11 | with all three columns, each "all" band lies between the other two columns' bands ± 1 point (it's their mix) | failed |
| C11 | a column whose values are all 0 or blank | blank |
| C12 | 0 < average ≤ 5.0 (above 5: a 100-point or other scale) | failed |
| C12 | average > 4.0 | sets `scale: "weighted"`; not a failure |
| C12 | submitted share 0–100 | failed |
| C21 | ED admitted ≤ ED applications ≤ C1 applicants; ED admitted ≤ C1 admitted (same document) | failed. Catches Cornell's code table (10,057 "admitted" > 6,077 C1 admits) |
| C21 | workbooks: code table and visible form disagree | the visible form when it passes every check, else failed; both values kept in the record |
| C21 | offered No (or blank) with counts or dates | failed |
| C21, C22 | dates valid; notification after closing in cycle order (August → July); other-ED closing after first-ED closing | that date null with its quote; review note |
| C22 | offered No with dates, or restrictive Yes without an offered Yes | failed |

The skeleton's "C12 average falls inside the C11 band range" is dropped (weighted averages). "Wait-list admits ≤
wait-list accepted" and "C21 admits ≤ applications" stay, joined by the C1 comparisons.

## Store
### Shape
```ts
/** `school.reported.admission_profile`: CDS C2, C7, C10–C12, C21–C22 (specs/data-expansion/cds-admissions.md). */
export interface ReportedAdmissionProfile {
  gpa: {                                   // C11 + C12, always from the same edition
    average: number | null;                // C.1201 as published (3.895, 4.34)
    scale: "weighted" | "unweighted" | "not_stated";
    submitted_share: number | null;        // C.1202, 0–1
    bands: {                               // nine shares 0–1, top band first; null = column blank or failed
      with_test: GpaBands | null;          // C.1101–C.1109
      without_test: GpaBands | null;       // C.1111–C.1119
      all: GpaBands | null;                // C.1121–C.1129
    };
  } | null;
  class_rank: {                            // C10
    top_tenth: number | null; top_quarter: number | null; top_half: number | null;
    bottom_half: number | null; bottom_quarter: number | null;
    submitted_share: number;               // required: bands are never stored without it
  } | null;
  factors: Partial<Record<C7Factor, FactorImportance | null>> | null;   // C.701–C.718
  wait_list: { policy: boolean | null; offered: number | null; accepted: number | null; admitted: number | null } | null;
  early_decision: {
    offered: boolean;
    first: { closing: MonthDay | null; notification: MonthDay | null } | null;
    other: { closing: MonthDay | null; notification: MonthDay | null } | null;   // ED II
    applicants: number | null; admitted: number | null;                         // all ED rounds
  } | null;
  early_action: { offered: boolean; closing: MonthDay | null; notification: MonthDay | null; restrictive: boolean | null } | null;
}
export type GpaBands = [number, number, number, number, number, number, number, number, number];
export type FactorImportance = "very_important" | "important" | "considered" | "not_considered";
export type C7Factor = "rigor" | "class_rank" | "gpa" | "test_scores" | "essay" | "recommendations" | "interview"
  | "extracurriculars" | "talent" | "character" | "first_generation" | "alumni_relation" | "geographic_residence"
  | "state_residency" | "religious" | "volunteer_work" | "work_experience" | "interest";
export type MonthDay = { month: number; day: number };
```
Missing is `null`, never 0; a block with nothing published is `null`. Store only (record, not `schools.json`): `C.205`–
`C.207`, `C.719`, `C.2112`. A new key beside round 2's `reported.admissions` (the C1 class, which `applyNewest` keys on)
so the two never interfere. Estimated size: about 0.4 KB per college that publishes these items.

### Which edition
Each block (`gpa`, `class_rank`, `factors`, `wait_list`, `early_decision`, `early_action`) comes from the **newest
edition in the college's record where that item passed**, at most two editions older than the college's newest CDS (a
college that stops publishing GPA doesn't keep a five-year-old average). Blocks can come from different editions; each
value's lineage says its year. C11 and C12 always come from one edition so the GPA block never mixes classes.

### Lineage
Every stored value gets a record: `source: "college-site"`, `method: "extracted"`, `url`, `retrieved`, `quote`, and
`page` or `cell` (the Excel cell, which round 3 adds to `LineageRecord`). Year: `"Fall 2025"` for C2, C7, C10, C11,
C12, and C21 counts (the edition's entering class, from the cover or item text, never page headers: USC and Loyola print
"2024-2025" in the headers of their 2025–26 files); the edition (`"2025–26"`) for C21/C22 offered flags and dates. A
helper in `lib/admission-profile.ts` derives both from the record's edition; no year is written by hand.

### Field registry (`lib/fields.ts`, all `reported(label)`: source `college-site`, topic `admissions`)
| Path | Label |
|---|---|
| `reported.admission_profile.gpa.average` | Average high school GPA of first-years |
| `reported.admission_profile.gpa.scale` | GPA scale (derived: weighted when above 4.0 or stated) |
| `reported.admission_profile.gpa.submitted_share` | Share of first-years who reported a GPA |
| `reported.admission_profile.gpa.bands.all` / `.with_test` / `.without_test` | First-years by GPA band (all / sent test scores / didn't) |
| `reported.admission_profile.class_rank` | First-years by high school class rank, with the share who reported one |
| `reported.admission_profile.factors` | How much each factor counts in admission (four levels) |
| `reported.admission_profile.wait_list.policy` / `.offered` / `.accepted` / `.admitted` | Wait list |
| `reported.admission_profile.early_decision.offered` / `.dates` / `.applicants` / `.admitted` | Early decision |
| `reported.admission_profile.early_action.offered` / `.dates` / `.restrictive` | Early action |
| `derived.ed_admit_rate` | ED admitted ÷ ED applications (derived) |
| `derived.wait_list_admit_rate` | Wait-list admitted ÷ accepted a place (derived) |
| `derived.gpa_middle_half` | GPA bands holding the 25th and 75th percentile of the "all" column (derived) |

`REPORTED_PATHS` picks these up, so the lineage guard requires an `extracted` record for each stored one.

### Newest everywhere: the six shared factors
Nothing in C2, C10–C12, C21, or C22 has a federal field with the same definition, so they are **new fields**: shown on
the profile and in Compare's table, an Explore filter only as "has GPA data", and **never in ranks, medians, sorts,
percentiles, Known for, Home facts, or Compare's key differences** while coverage is partial.

C7 is a different scale from IPEDS ADM (importance, not required / considered / not considered), so it doesn't replace
`admissions.factors` wholesale. But six rows ask the same yes/no question underneath: is the factor considered at all?
(`gpa`, `class_rank`, `recommendations`, `essay`, `alumni_relation` ↔ `legacy`, `work_experience`). Under round 2's
rule ([Decision 1](../college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere)), when the C7
class is newer than `admissions.factors`' IPEDS year and that yes/no answer differs:
- `applyNewest` (`lib/newest.ts`) sets the IPEDS factor to `not_considered` (C7 not considered) or `considered` (C7
  considered or above) with an `extracted` lineage record, and keeps the federal answer in `admissions.federal_factors`
  (new field, IPEDS ADM) for the ⓘ line ("Federal data, fall 2024: considered"); `restoreFederal` puts it back.
  A federal `required` is never replaced by C7 "very important"/"important"/"considered" (C7 has no "required"; the
  answers agree).
- Explore's "Doesn't consider legacy", "Essay not required", and "GPA required" filters and Compare then follow the
  newest answer with no change of their own.
- The disagreement is logged as a review note ("changed since federal": legacy is the common case, as colleges drop it);
  when the C7 class is **not** newer, the federal answer stays and the note says "contradicts federal".

## Display
Quiet, as round 2 decided: no chips, no banners, no second copy of a figure. The ⓘ on each figure carries the source
("Harvard University's Common Data Set 2025–26"), the year, the quote, the link, and the retrieval date. Years in
labels come from lineage (`{class year}` below), never typed.

### Admissions topic page ([school-profile.md](../school-profile.md))
New and changed blocks, in page order:

1. **Getting in** (existing panel), after the funnel and yield: a **wait-list line** (`WaitListLine`):
   - all counts: "Wait list: {offered} offered a place, {accepted} accepted, {admitted} admitted ({rate}% of those who
     accepted)" with the `wait-list` term;
   - admitted only: "{admitted} admitted from the wait list"; policy only: "Uses a wait list; numbers not published";
     policy No: "No wait list". Nothing when C2 is null.
2. **Applying early** (new block, `#early`, `EarlyRounds`): the basic version that
   [early-decision-strategy.md](../product/early-decision-strategy.md) later extends with the non-ED rate, advantage,
   share of class, and series.
   - ED with counts: headline "Early decision: {ED rate}% admitted" and "{admitted} of {applicants} early applicants;
     {overall rate}% of all applicants". The overall rate comes from **the same document's C1** (same class), never the
     newest-everywhere funnel when that's another year; without a passed C1 in that document, the ED rate stands alone.
   - ED without counts (Duke): "Offers early decision. The college doesn't publish how many apply or are admitted early."
   - Dates: "Apply by {Nov 1}; decisions by {Dec 15}", and "Second round: apply by {Jan 5}; decisions by {Feb 1}" when
     present. The ⓘ says the dates are as published in the college's {edition} Common Data Set.
   - **The ED caveat, always under the ED figures, never in a tooltip:** "Early decision is binding: if admitted, you
     commit to enroll. Recruited athletes and other applicants with an edge often apply early, so the early rate
     overstates the gain for a typical applicant."
   - EA: "Early action (not binding): apply by {closing}; decisions by {notification}". Restrictive: "Restrictive early
     action: applicants agree not to apply to other colleges' early plans, with exceptions the college sets." No EA
     counts are ever shown (the CDS has none).
   - Hidden when C21 and C22 are both null or both "not offered"; "Doesn't offer early decision or early action" only
     when both are an explicit No.
3. **What they look at** (existing, `components/school/AdmissionFactors.tsx`): when C7 passed and its class is at least
   as new as the IPEDS year, a **four-level grid** replaces the three-level one: rows grouped "Academic" (rigor, GPA, class
   rank, test scores, essay, recommendations) and "Personal" (the other twelve), one filled mark per row under Very
   important / Important / Considered / Not considered; on phones each row shows its level as a word instead of four
   columns. Below it, one line for the IPEDS-only factors when any is not "not considered" ("From the federal survey:
   college-prep program required; English proficiency test considered"). The legacy line stays, from `alumni_relation`
   ("Considers whether an applicant's parent attended (legacy status)"). The existing "Recent change" line (IPEDS
   events) is unchanged. The religious row also feeds [religious-life.md](../religious-life.md)'s campus-life line.
4. **High school record** (new h2 `Panel`, `#gpa`, before Test scores `#scores`; eyebrow "{class year} first-years"):
   - Title "First-years' high school GPA". (The skeleton called it "Admitted students' GPA"; C11 and C12 describe
     **enrolled** first-years, so the title says that.)
   - Headline: "Average GPA {3.90}". Weighted: "Average GPA {4.22}, weighted" with the `weighted-gpa` term and the line
     "This average gives extra points for honors and AP courses, so it runs above 4.0 and can't be compared with an
     unweighted GPA." When the submitted share is under 90%: "From the {88}% of first-years who reported a GPA."
   - The standing caveat, always: "High schools grade differently, and colleges recalculate or weight GPAs their own
     way, so compare this college only with itself."
   - **Band bar** (`StackedBar`, sequential admissions ramp): the "all" column as 4.0 / 3.75–3.99 / 3.50–3.74 / 3.25–3.49 /
     3.00–3.24 / below 3.0 (the last four bands summed; all nine in the accessible table), with "The middle half had GPAs
     of {3.75}–{4.0}" (`derived.gpa_middle_half`). A toggle "All · Sent test scores · Didn't send scores" shows only the
     columns present (Loyola: two).
   - **`GpaChecker`** (`components/school/GpaChecker.tsx`, client, built like `ScoreChecker`): "Your GPA (unweighted, 4.0
     scale)". For a valid entry: "Your {3.80} is in the {3.75–3.99} band, with {57}% of enrolled first-years. {32}% had a
     higher GPA, {11}% lower." The marker sits on the band bar. Over 4.0: "Enter your unweighted GPA; this college's
     breakdown uses a 4.0 scale." Never compares the entry with the C12 average. Average but no bands: no checker, and
     "This college publishes an average but not a breakdown." Uses `gpaPosition()` (shared with
     [chances-and-fit.md](../product/chances-and-fit.md)).
   - **Class rank line**: "{91}% were in the top tenth of their high school class, {95}% in the top quarter", always
     followed in the same sentence by "of the {20}% whose high school reported a rank" (`class-rank` term). Folded under
     `ShowMore` on phones.
   - The whole panel is left off when `gpa` and `class_rank` are both null.

### Overview
The Admissions card gains one `CardStat`, "Avg. GPA {3.90}" (with "weighted" under it when flagged), when the average
exists; the card footer adds "GPA" to its list. Open question 5.

### Compare ([comparison.md](../comparison.md))
"All the numbers", Admissions group, new rows with info tips (muted year after any value whose year differs from the
row's usual one, as built):
| Row | Cell |
|---|---|
| Average high school GPA | "3.90" or "4.22 weighted"; "–" when null |
| First-years in the top tenth of their class | "91% (of the 20% with a rank)" |
| Early decision | "14% of 6,202 admitted" / "Offered; no counts" / "Not offered" |
| Early action | "Offered" / "Offered, restrictive" / "Not offered" |
| Wait list | "254 admitted of 6,598 who accepted" / "254 admitted" / "No wait list" |
| One row per C7 factor | The C7 level where present, else the federal use ("Very important" next to "Required" is fine: each cell's ⓘ names its survey) |

No `CompareMetric` card, radar axis, or key-difference sentence uses any of these.

### Explore ([search-and-filtering.md](../search-and-filtering.md))
One filter: **"Publishes first-years' GPA"** (param `gpa=1`; true when `gpa.average` or any band column is stored), in
the "What they look at" filter group with its count. No sort, column, range slider, or summary tile. ED/EA filters
("Offers ED", "Offers EA") are booleans owned by [early-decision-strategy.md](../product/early-decision-strategy.md).

### Planning tools
- [chances-and-fit.md](../product/chances-and-fit.md): GPA position from `gpaPosition(bands, gpa)` on the "all" column.
- [early-decision-strategy.md](../product/early-decision-strategy.md): reads `early_decision` / `early_action` and the same
  document's C1.
- [saved-lists.md](../product/saved-lists.md): ED/EA dates as deadlines, labeled with the edition.

### Glossary (`lib/glossary.ts`)
New terms: `high-school-gpa`, `weighted-gpa`, `gpa-band`, `class-rank`, `factor-importance` (what "very important" vs
"considered" means in the CDS), `early-decision`, `early-action`, `restrictive-early-action`, `wait-list`. The existing
`admission-factor`, `legacy-status`, and `cds` stay. ([early-decision-strategy.md](../product/early-decision-strategy.md)
adds `ed-advantage` and `hooked-applicant`.)

## Keep history?
**Series per CDS edition** for two measures, the only ones worth charting:
- **Average GPA** (`cds_gpa_average`), each point with its `scale`; a change of scale is a series break, never a line
  across it.
- **ED admit rate** (from `cds_ed_applicants` and `cds_ed_admitted`, stored as counts).

They go in the history shard ([trends-data.md](../trends-data.md#storage)) under the admissions family, keyed by the
entering class, with the latest point equal to the snapshot. The Over time page's Admissions group shows them once a
college has two or more points. The records keep every edition's other items too, so a later series (wait-list admits,
class rank) costs no extraction.

**C7: events, later.** A factor's level changing between two passed editions ("Test scores: considered → very
important, fall 2026") fits `lib/events.ts`; built only once the records hold two editions for many colleges.

**Backfill: worth it, for the selective tiers.** Index pages list many past editions (Georgia Tech 25 PDFs, TCU 25,
Harvard 19, Spelman 13, Loyola 12, Howard 10). If round 3 archives prior editions (its open question 2), a group-C-only
re-read of five past editions at the 249 very selective and selective colleges is about 1,250 documents × ~$0.01
(round 3's one-group batch estimate) ≈ **$12–15**, all from the archive. Only the "all" C11 column and C12 compare across
editions before 2023–24 (the three-column C11 is newer); C21 counts and C12 are stable in the template.

## Top-level trend?
- **Hero indicator, Known for, Explore sort: no.** Partial coverage and weighted averages fail every bar.
- **Home fact, later:** "First-years' average high school GPA keeps rising" on a fixed panel of colleges with five or
  more editions and **the same scale in every edition**, counting colleges up / steady / down, never averaging GPAs
  across colleges. Only after the backfill.
- **"Over time" chart:** yes, the two series above.
- The share of the class filled early is [early-decision-strategy.md](../product/early-decision-strategy.md)'s Home fact
  candidate.

## Build
| File | Change |
|---|---|
| `lib/cds-sections.ts` (round 3) | Items C2, C7, C10, C11, C12, C21, C22 in group C: codes, labels, Howard field names, store-only flags, the C7 column headers and glyph set, schema for the model |
| `lib/cds-checks.ts` (round 3) | The checks above; `columnScale()`, `yesNo()`, `monthDay()`, `isPlaceholder()` |
| `scripts/lib/cds-xlsx.mts` | Code-table readers for the 82 codes; a cell-based classic reader with column letters for C7 and C11; the C21 visible-form reader; fix the comment that codes "aren't stable across colleges' files" (they are within an edition: 1,105 identical codes across the four workbooks, 1,087 of Howard's 1,089 fields matched) |
| `scripts/lib/college-reported/split.mts` (round 3) | C7 in the layout pass: header x ranges, marks "X"/"x"/"✔"/☒/private-use glyphs, Michigan's box order |
| `scripts/lib/college-reported/` form-field reader (round 3) | The Howard field names above |
| `lib/html-text.ts` or wherever `htmlToText` lives | Collapse whitespace inside `<tr>` before splitting lines (MIT) |
| `lib/admission-profile.ts` (new, pure) | Record → `reported.admission_profile` (newest passed per block, two-edition limit), lineage with years from the edition, `edRate`, `waitListRate`, `gpaMiddleHalf`, `gpaPosition` |
| `lib/reported-merge.ts` | Call it after C1 |
| `lib/newest.ts` | The six-factor replacement and its restore; `admissions.federal_factors` |
| `lib/types.ts` | The types above; fix the `reported` comment ("never used in Explore, Compare…"), outdated since round 2 |
| `lib/fields.ts` | The registry rows above, `admissions.federal_factors`, the derived fields |
| `lib/profile-topics.ts`, `lib/profile-data.ts` | Admissions `TOPIC_FIELDS`; "has GPA" and "has early rounds" flags |
| `components/school/` | `GpaPanel.tsx`, `GpaChecker.tsx`, `EarlyRounds.tsx`, `WaitListLine.tsx`; `AdmissionFactors.tsx` gains the four-level grid |
| `app/schools/[id]/admissions/page.tsx` | The blocks in order; `OnThisPage` ids `early`, `gpa` |
| `lib/compare.ts`, `lib/params.ts`, `lib/dataset.ts`, `components/explore/FilterPanel.tsx` | Compare rows; `gpa` param and filter |
| `lib/glossary.ts` | The terms above |
| `scripts/sync-history.mts`, `lib/profile-history.ts` | The two series from records |
| `scripts/measure-profile.mts` budgets | Re-measure the admissions page at three widths; the panel folds on phones |

### Tests (each guard shown to fail when broken)
1. **C11 by code, not tag:** a fixture keyed like Howard's fields lands `C.1102` in the submitted column's 3.75–3.99 band.
   Break: map by the lowercase tag, and the value lands in the not-submitted 4.0 band.
2. **Column scale:** Harvard-like "0.98%" stays 0.98 percent and Howard's whole percents sum to 100. Break: use `frac()`
   per value, and the column fails its sum.
3. **Lone column:** a text fixture with one column of values and the totals row "0.00% | 0.00% | 100.00%" stores it as
   `all`. Break: drop the totals-row rule, and it lands in `with_test`.
4. **Formula totals:** a column with total 0 and blank bands is `blank`, not 0%.
5. **Weighted flag:** 4.22 stores `scale: "weighted"`; no Explore sort, percentile, Known for, or key difference reads
   `reported.admission_profile.*` (a test scans `SORT_KEYS`, `standouts`, `keyDifferences`). Break: add a GPA sort, and
   the test fails.
6. **Checker never uses the average:** `gpaPosition` reads bands only; an entry over 4.0 returns "unweighted" guidance.
7. **Cornell C21:** a workbook fixture with the off-by-one code table (10,057 admitted, C1 admits 6,077) and the correct
   visible form publishes 10,057 / 1,889. Break: remove the C1 comparison, and 10,057 is published as admits.
8. **Duke:** offered Yes with blank counts publishes `offered: true`, counts null, and the "doesn't publish" line.
9. **Placeholders:** "Yes or No" in `C.2101` is blank, not yes; "X" in `C.201` is yes; all-zero C2 counts with policy Yes
   are blank.
10. **C7 marks:** layout fixtures for an x-placed mark, Michigan's ☐☐☐☒ row, Howard's `VI`/`NC`, and an MIT row with
    empty `<td>`s each give the right level. Break: revert the `<tr>` whitespace fix, and MIT's row has no level.
11. **C7 sanity:** a grid with every mark in one column fails; a row with two marks is null.
12. **Six-factor newest rule:** a newer C7 with alumni relation "not considered" flips `admissions.factors.legacy` and the
    "Doesn't consider legacy" filter matches; `restoreFederal` restores byte for byte; a federal `required` is untouched
    by C7 "very important". Break: skip the year comparison, and an older C7 overrides a newer IPEDS answer.
13. **Same-class ED comparison:** the overall rate beside the ED rate comes from the same document's C1, not the newest
    funnel of another year.
14. **Lineage:** every stored `reported.admission_profile.*` value has an `extracted` record with a year from the
    edition; removing one fails `check:lineage`.
15. **Class rank:** bands without a submitted share fail; the rendered line always contains the share.

## Specs this changes
For the coordinator; this spec doesn't edit them.
1. **[early-decision-strategy.md](../product/early-decision-strategy.md)**, Research: replace "The site's existing CDS
   overrides already carry C21 for 8 colleges; the agent extends it." with: "No college's C21 is on the site today:
   `import-cds` reads only B1/B2, C1, C9, and H2/H2A, so the 8 hand-imported overrides carry none of it. Round 3 captures
   C21 and C22 from every CDS it reads ([cds-admissions.md](../data-expansion/cds-admissions.md))." The "Duke 13.8% ED"
   example didn't come from Duke's CDS, which says Duke offers ED but leaves the counts blank: cite its real source or
   drop it. Its Explore "sort by ED advantage" breaks the rule that partial college-reported data is never ranked: drop
   it until coverage is broad (the filters stay). Add the workbook check (code table vs visible form, from Cornell) to its
   checks, and compute the non-ED rate from the same document's C1.
2. **[admission-factors.md](admission-factors.md)**, Display: "C7 replaces the grid" is specified here, including the
   six shared factors following the newest answer (`admissions.federal_factors`), which the Explore filters then follow.
3. **[religious-life.md](../religious-life.md)**: `school.religion.admission_weight` reads
   `reported.admission_profile.factors.religious` (one extraction, one stored value); the note that UT's checkmarks need
   "layout-aware parsing or a vision model" becomes "layout-aware text places them; no vision needed in the inventory's
   sample".
4. **[chances-and-fit.md](../product/chances-and-fit.md)**: GPA position uses `gpaPosition()` on the "all" column; the
   bands describe enrolled first-years; never compare with the C12 average.
5. **[saved-lists.md](../product/saved-lists.md)**: ED/EA dates are labeled with the CDS edition they came from; the
   regular deadline (C14) is another unit.
6. **[school-profile.md](../school-profile.md)**: the admissions page's new blocks and order; the Admissions card's GPA
   stat.
7. **[comparison.md](../comparison.md)** and **[search-and-filtering.md](../search-and-filtering.md)**: the rows and the
   `gpa` filter.
8. **[college-reported-round-3.md](../college-reported-round-3.md)**: its Extraction scope gets the 82 codes; Decision 3.2's
   "read by label since codes vary between colleges' files" → codes are stable within an edition; C7 needs no vision in
   the sample; C21 is read from both the code table and the visible form.
9. **[data-lineage.md](../data-lineage.md)**: `LineageRecord.cell` for Excel values (if round 3 doesn't add it first).
10. **[README.md](README.md)**, Wave 4 table: C1 by residency and C8 are now separate specs.

## ACTS alternative
If NCES publishes the ACTS supplement ([data-page.md](../data-page.md#watching-acts)) at the institution level, it may
give GPA for every college. It would then be the baseline, and a newer CDS value would replace it under the newest rule
when the definitions match.

## Open questions
1. **Six shared factors:** let a newer C7 flip the federal considered / not considered answer (and so Explore's legacy,
   essay, and GPA filters)? Recommended: yes, it's round 2's rule.
2. **Stale items:** keep a block from up to two editions older than the newest CDS, or only from the newest?
3. **Backfill:** re-read five past editions at selective colleges for C11, C12, C21, and C2 (about $12–15), once prior
   editions are archived?
4. **Top band at weighted colleges:** keep the template's "4.0" label with the tooltip note, or label it "4.0 or higher"
   when the average is weighted?
5. **Overview card:** add "Avg. GPA" to the Admissions card, or keep GPA on the topic page only?

## Roadmap entry
- slug: cds-admissions
- summary: First-years' high school GPA with a GPA checker, how much each part of an application counts, early decision
  and early action numbers, and wait-list odds, from each college's Common Data Set.
- complexity: 2 — Medium: a new admissions section with a checker, one filter, and two history series, built on records
  round 3 already extracts.
- after: ["college-reported-round-3"]
