# CDS Financial Aid: Forms, Deadlines, International Aid, Need vs Merit

> Status: **built** (2026-10-03; see [As built](#as-built)). Wave 4, built from the per-document CDS records of
> [college-reported-round-3.md](../college-reported-round-3.md). Covers the CDS inventory's units **U5** (aid process
> and forms), **U6** (aid for international students), **U7** (aid dollars by source, athletic awards), and **U8** (the
> full H2 lines for first-years and all full-time undergraduates). Supersedes the hand importer's `aid.cds`. Part of
> [data-expansion](README.md).

## Questions it answers
- *Do I need the CSS Profile? My parents are divorced: does the other parent have to file? Is there a business or farm
  supplement?* (H8)
- *When are the aid forms due, when will I hear, and when must I reply?* (H9–H11)
- *Does this college compute need with its own formula?* (methodology, H.102–H.104; the net price estimator needs it)
- *Will it give an international student aid, and how much?* No federal source covers aid to nonresidents. (H6, H7)
- *Is aid here mostly need-based or merit? Does it give athletic scholarships?* (H1, H2A P/Q)
- *If I'm a first-year with need, how much of it is met, and what does a typical package look like?* (H2 first-year
  column; the site today shows only the all-full-time column, for 8 colleges)
- *Has the college changed its aid policy recently (no-loan, free tuition under an income line)?* (H15)
- *What does its own scholarship money reward: academics, talent, athletics, residency, religion?* (H14)

## Source: CDS section H, by template code (2025–26 template)
Every item below is read **deterministically** from the 2025–26 Excel template (the per-sheet code tables; codes are
stable across colleges' files in this edition, inventory §4.4) and from the official fillable PDF (form field names =
the template's "US News PDF Tag" column; Howard's tags are given). Flattened PDFs and HTML pages need the model; the
last column says what else they need. Coverage is from the CDS inventory (19 documents read; **T5** = the four template
workbooks VU, CU, WM, IL plus Howard's form fields, where every item was read by code). Counts marked † were read for
this spec from the inventory's own files (`answer-sheet.tsv`, `howard-by-code.tsv`, `text/`, `text-layout/`).

All 132 codes below are in scope for the one full run, including those nothing displays yet (the part-time column,
the H1 rows other than institutional and athletic): they cost nothing in a workbook or fillable PDF and little in a
model read of the same tables. Round-3 group: `GH`.

### U5. The aid year, methodology, forms, dates, criteria, policy
| Code(s) | Question (template wording, shortened) | Coverage | Fillable PDF tag | Flattened PDF / HTML |
|---|---|---|---|---|
| `H.101` | "Indicate the academic year for which data are reported for items H1, H2, H2A, and H6 below": **2025-2026 Estimated** or **2024-2025 Final** | 14 checked†: estimated VU, CU, BU, DU, TCU, LUC; final WM, IL, HA, USC, EC, GT; **blank** SP; HU's field holds **"2023"** | `ACAD_YR` (text) | Model + layout pass: the form is two column labels with a mark under one, and plain text loses the column (HA: "x" at x=588 under "2024-2025 Final" at x=553; DU: "X" at 393 under "2025-2026 Estimated" at 358) |
| `H.102`–`H.104` | "Which needs-analysis methodology does your institution use in awarding institutional aid? (Formerly H3)": Federal (FM) / Institutional (IM) / Both | FM: IL, EC, HU; IM: HA; both: WM, BU, TCU, USC, GT, DU†; **blank at CU and VU**, both of which require the CSS Profile | `METH_FM`, `METH_IM`, `METH_FM_IM` | Single-column list; layout text keeps "x \| Institutional methodology (IM)" |
| `H.801`–`H.808` | H8: forms domestic first-year aid applicants must submit: FAFSA, institution's own form, CSS Profile, state form, Noncustodial Profile, Business/Farm Supplement, Other (+ text) | All T5; CSS Profile checked at VU, CU, WM, HA, BU, TCU, USC, GT, DU, UM†; Noncustodial at CU, TCU, USC, DU†; FAFSA only at IL and HU | `FORM_DOM_FAFSA`, `_INST`, `_CSS`, `_STATE`, `_NON_CUSTODIAL`, `_BUS`, `_OTH`, `_OTH_T` | Layout pass: **HA's plain text prints the marks in a block apart from their labels**†; layout text pairs them ("X \| CSS Profile"). The same labels appear in H7 just above, so the reader must place each mark by section (BU, DU, TCU print "CSS Profile" twice) |
| `H.901`–`H.907` | H9: priority date for filing (box + month + day), deadline (box + month + day), no deadline / rolling | VU 2/1; CU priority 2/15, deadline 2/15; WM priority box checked, no date; IL priority 3/15; HU priority 2/1, deadline 5/1; UM priority 12/15, deadline 3/1† | `AP_DL_PRIORITY(_MON/_DAY)`, `AP_DL(_MON/_DAY)`, `AP_DL_NO` | Model; printed as "1-Feb", "12/15", or text. **`H.906` has empty metadata columns in the template's code table**: read it by code, not by section/sub-section |
| `H.1001`–`H.1006` | H10: notified on or about (date) or on a rolling basis starting (date) | VU 4/1; CU 4/1; IL rolling from 2/15; HU rolling from 2/1 | `AP_NOTIF_DL`, `AP_NOTF_DL_MON/_DAY`, `AP_NOTF_ROLL(_MON/_DAY)` | Model |
| `H.1101`–`H.1103` | H11: students must reply by (month, day) or within N weeks of notification | VU, IL, HU 5/1; CU blank | `AP_REPLY_DL_MON_FA`, `_DAY_FA`, `AP_REPLY_DL_WEEK` | Model |
| `H.1401`–`H.1419` | H14: criteria for awarding institutional aid, **non-need (`H.1401`–`H.1410`) × need (`H.1411`–`H.1419`)**: academics, alumni affiliation, art, athletics, job skills, ROTC (non-need only), leadership, music/drama, religious affiliation, state/district residency | VU, WM, IL, HU; CU blank; HA blank except ROTC "N/A" | `ACADS_NN` … `STATE_NN`, `ACADS_NB` … `STATE_NB` | **Two-column grid: column lost in plain text** (inventory §2 H14); layout pass, vision only if undecided. **`H.1418` (religious, need) is typed "Text" in the template** though it is a checkbox: treat it as one |
| `H.1501` | H15: "If your institution has recently implemented any major financial aid policy, program, or initiative to make your institution more affordable…" (free text) | VU, CU, WM, IL; HU blank | `FA_PROGS_T` | Model; the text is the value (quote kept whole, up to 600 characters) |

### U6. Aid for international students
| Code(s) | Question | Coverage | Fillable PDF tag | Flattened PDF / HTML |
|---|---|---|---|---|
| `H.601`–`H.603` | Institutional aid to undergraduate degree-seeking nonresidents: need-based available / non-need available / **not available** | CU need-based; IL non-need; HU both; WM not available† | `INTL_NB`, `INTL_NN`, `INTL_NO` | Single-column list |
| `H.604`–`H.606` | Number of nonresidents awarded institutional aid; average; total dollars | CU 318 / $88,263 / $28,067,649; IL 45 / $5,176 / $232,934; HU 447 / $27,544 / $12,312,337†; averages at USC $27,577, SP $48,041, TCU $57,638, DU $87,841; UM prints "n/a"†. Figures in 7 of the 17 documents checked | `INTL_RECD_N`, `INTL_AVG_D`, `INTL_TOT_D` | Model |
| `H.701`–`H.704` | H7: forms nonresident first-year aid applicants must submit: own form, CSS Profile, other (+ text) | CU CSS Profile; IL "other" with no text; HU "other": "International Student's Financial Aid Application"† (the inventory says "own form"); UM none checked† | `FORM_INTL_INST`, `_CSS`, `_OTH`, `_OTH_T` | As H8 (same labels; place by section) |

### U7. Dollars by source; athletic awards
| Code(s) | Question | Coverage | Flattened PDF / HTML |
|---|---|---|---|
| `H.105`–`H.116` | H1 **need-based** dollars to degree-seeking undergraduates: federal, state, **institutional** (excluding athletic aid and tuition waivers), external, total grants; student loans, Federal Work-Study, state/other work, total self-help; parent loans; tuition waivers (optional); athletic awards | All T5 (VU in its H sheet, not its ANSWER SHEET); "a two-column money table" in the PDFs | Two columns (need, non-need) with blanks (HU leaves waivers blank): place by x, or require both columns per row, else layout pass |
| `H.117`–`H.127` | H1 **non-need** dollars, same rows without Federal Work-Study | Same | Same |
| `H.2A03`/`H.2A04`, `H.2A07`/`H.2A08`, `H.2A11`/`H.2A12` | H2A **P** (students awarded an institutional non-need athletic scholarship) and **Q** (their average), for first-years / full-time / part-time | WM 111 first-years at $20,325, 350 full-time at $26,671; IL 61 at $28,937, 291 at $36,163; HU 16 at $19,292, 52 at $26,458†. Not checked line by line elsewhere | Three columns, as H2 |

Fillable PDF tags: `SCHOL_NB_*_D`, `SH_NB_*_D`, `NB_PARENT_D`, `NB_WAIVER_D`, `NB_ATHL_D` and the `NN` equivalents;
`FRESH_FT_NN_ATHL_N/_D`, `UG_FT_NN_ATHL_N/_D`, `UG_PT_NN_ATHL_N/_D`.

### U8. H2 lines A–M and H2A N–O, all three columns
| Code(s) | Lines | Coverage | Flattened PDF / HTML |
|---|---|---|---|
| `H.201`–`H.213` | **First-time, full-time first-years**: A degree-seeking students; B applied for need-based aid; C found to have need; D awarded any aid; E need-based grant; F need-based self-help; G non-need grant; H need fully met; I average % of need met; J average package; K average need-based grant; L average need-based self-help; M average need-based loan | All T5; line I in every flattened PDF checked (HA 100%, USC 99.4%, GT 61.2%, SP 19%, BU 70.5%, TCU 78.6%, LUC 83.8%, EC 83.7%, UM 91%, DU 100%) | Three numeric columns per line; VU leaves the part-time column blank, so a short row must be placed by x |
| `H.214`–`H.226` | Same lines, **all full-time undergraduates** (including first-years): what `aid.cds` stores today | Same | Same |
| `H.227`–`H.239` | Same lines, **less than full-time**: stored, not shown | All T5 except VU (blank) | Same |
| `H.2A01`/`H.2A02`, `H.2A05`/`H.2A06`, `H.2A09`/`H.2A10` | H2A **N** (students without need awarded institutional non-need aid) and **O** (their average), per column | VU, WM, IL, HU, HA ($4,728), USC, GT, BU, TCU, LUC, EC, UM, DU ($91,953); **blank at CU and SP** (13 of 15 checked) | Same |

Fillable PDF tags: `FRSH_FT_*` (first-years), `UG_FT_*` (full-time), `UG_PT_*` (part-time); `*_NN_NONEED_N/_D`.

**Out of this spec:** H4–H5 (graduates' debt) are [cds-cost-and-debt.md](cds-cost-and-debt.md)'s, and H6 moves from
that skeleton's source table to this spec. H12–H13 (loan and grant programs offered, `H.1201`–`H.1309`) are low value
(inventory §3, "Not worth a spec"); the scope table should still store them because the read is free, but nothing here
uses them.

### Definitions that shape every display
From the template's own definitions (Cornell's sheet, inventory `text/cornell.txt`):
- "When reporting questions H1 and H2, **non-need-based aid that is used to meet need should be counted as
  need-based aid**." So "non-need" dollars are merit awards to students without need or beyond their need, not all
  merit scholarships.
- "Financial need: as determined by your institution using the federal methodology and/or your institution's own
  standards." So "100% of need met" at two colleges can mean different prices.
- H1 covers all degree-seeking undergraduates (the B1 cohort for the reported year) and "include[s] aid awarded to
  international students".
- H2 line A is the B1 cohort of the aid year: the edition's own B1 when the year is the edition's estimate (CU: H2 A
  first-years 3,827 vs B1 full-time first-time first-years 3,826†), the previous edition's when it is last year's
  final.

## Years
**The aid year differs by college within one edition**, so every value's year comes from its own document.

| Item group | Year it describes | Lineage `year` |
|---|---|---|
| H1, H2, H2A, H6 | The academic year marked in `H.101`: "2025-2026 Estimated" → 2025–26, the college's estimate; "2024-2025 Final" → 2024–25, final | "2025–26 (estimated)" or "2024–25", built by `aidYearLabel()` from the parsed `{ start, status }`, never typed |
| H7, H8, H9–H11 | The aid process for students applying for the next fall: edition start year + 1 (a 2025–26 edition → students entering fall 2026), the same cycle rule [cds-application-logistics.md](cds-application-logistics.md#source-cds-items-by-template-code-202526-edition) uses for C14–C17 | "Fall 2026 entrants" from the edition, by `cycleLabel()` |
| H.102–H.104, H14, H15 | Standing policy as of the edition | The edition label ("2025–26") |

**Parsing `H.101`.** Accept the two template choices (and their spellings "Estimate", "Est.", en dash, "2025-26").
Anything else (HU's "2023", a blank as at SP) fails the `aid-year` check: the whole H1/H2/H2A/H6 group goes to the
review queue and is not published, because a value with no year can't be cited. H7–H15 still publish (they don't
depend on `H.101`). A reviewer can set the year by hand in the review entry (it becomes the lineage year, with the
reviewer's note as the quote's context).

**Which record wins.** For the H1/H2/H2A/H6 group the snapshot takes the college's record with the **newest aid
year**; for the same aid year, a final figure beats an estimate, then the newer edition wins. For H7–H15 the newest
edition wins. (A college that switches from "estimated" to "final" reporting publishes the same aid year twice in a
row; the final one replaces the estimate.)

**Against the federal aid year.** The site's federal aid figures (IPEDS SFA) carry the `ipeds-sfa` vintage
(2023–24 today). CDS aid years in the sample are one or two years newer, but a college can report an older one (HU's
"2023", if a reviewer confirms it as 2023–24 or 2022–23). The rule, in `cdsAidYearNote(school, meta)`:
- CDS aid year ≥ the SFA year: the block's caption names its year from lineage ("First-years and all full-time
  undergraduates, 2025–26 estimates"). Nothing else.
- One year older than the SFA year: the caption adds ", a year before the federal figures above".
- Two or more years older: the CDS aid block isn't shown on the profile or in Compare (the values stay in the detail
  file and the history series). The process facts (forms, dates, criteria) are unaffected.
No sentence ever joins a CDS figure and a federal figure without each one's year.

## Checks
Universal checks from round 3 Decision 9 apply (number on its cited line, type ranges). Each failing item goes to the
review queue keyed by college + edition + item and never blocks another item; nothing fails silently.

### Traps (normalization before checks)
- **Percent forms in line I:** "1" (CU), "0.82" (WM, IL), "58.6" (HU), "99.4%" (USC), "100%" (HA). Store a fraction
  0–1. A string with "%" → ÷100; a number > 1 → ÷100; a number ≤ 1 → as a fraction, **except** exactly 1, which is
  100% only when line H ≥ 0.95 × line D (CU: H = D = 1,744) or another column of the same document uses fractions;
  otherwise review. A result under 0.05 is reviewed (the "0.61 means 0.61%" trap from F1 at HU).
- **Text in numeric cells:** "N/A", "n/a" (UM H6), "-", "None", "Varies" → blank (status `blank`), never 0. "##"
  (Excel overflow printed into a PDF) → review. A dollar figure with split digits ("$3 4 , 604", GT in G1) is joined
  before parsing.
- **Blank ≠ no for checkbox lists.** A list (H8, H7, H6 types, methodology, H14) with **no** box checked is `blank`
  (forms: `null`), not "nothing required". Within a list that has at least one mark, an unchecked box is `false`.
  H14 is the exception: an unchecked criterion is stored `false` but always displayed as "not marked", never "not
  considered".
- **Placeholder text** ("Yes or No", "Specify:") in a text cell → blank.
- **Marks:** "X", "x", "✔", ☒, ZapfDingbats or private-use check glyphs (SP), radio values "Y" (HU) → checked; ☐ →
  unchecked.
- **Dates:** parsed by `parseCdsDate` from [cds-application-logistics.md](cds-application-logistics.md#build) (split
  month/day cells, "M/D", "D-Mon", "Mon D", Excel serials); an unparseable date keeps its quote and fails
  `valid-date`. A checked date box with no date (WM's priority box) stores `"unstated"`.

### Per-item checks
| Item | Check | On failure |
|---|---|---|
| `H.101` | One of the two template choices (above) | Review; H1/H2/H2A/H6 unpublished |
| H2, each column | **B ≤ A, C ≤ B, D ≤ C; E, F, G, H ≤ D**; N ≤ A − C (students without need can't outnumber A − C); M ≤ L; all counts integers ≥ 0 | Review (the column) |
| H2 line I | 0–100% after normalization; H = D ⇒ I ≥ 99%; I = 100% ⇒ H ≥ 0.95 × D | Review |
| H2 package | **J ≥ K** and **K × E + L × F ≤ 1.05 × J × D** (a package contains its need-based grant and self-help). The brief's "J ≈ K + L ± 15%" is kept only as a note in the record when G = 0 (no non-need grants), never as a failure: measured, it fails on valid documents (WM first-years J $33,452 vs K + L $26,065, −22%; HU $29,925 vs $13,689, −54%) because J also contains non-need grants (G is 283 of 528 at WM, 2,156 of 2,249 at HU) | Review |
| H2 line A | Same aid year as the document's B1 (an "estimated" edition-year report): first-years A within 2% of B1 full-time first-time first-years, full-time A within 2% of B1 full-time degree-seeking undergraduates. A "final" prior-year report: within 10% of the previous edition's record when the run has one, else of federal `aid.cohort` when its year equals the aid year; else not checked | Review |
| H2A P/Q | P ≤ A; Q ≤ the cost of attendance (below); P × Q (full-time) within 0.5–1.5 × H1 athletic dollars (`H.116` + `H.127`) when both exist (IL 291 × $36,163 = $10.5M vs $10.45M passes; **HU 52 × $26,458 = $1.4M vs $11.3M fails**†); P > 0 at a college whose `campus.athletics.division` is NCAA III (Division III gives no athletic scholarships) | Review (P/Q only) |
| H1 | Each column's grant rows (federal + state + institutional + external) = "Total Scholarships/Grants" ± $1K, and loans + work-study rows = "Total Self-Help" ± $1K (CU and HU sum exactly†); every row ≥ 0 | Review (H1) |
| H6 | **average × number = total ± 5%** (CU, IL, HU pass†); average ≤ the cost of attendance; number ≤ nonresident degree-seeking undergraduates (B2) × 1.05 when B2 is read; `H.603` "not available" excludes `H.601`/`H.602` and requires `H.604`–`H.606` blank or 0 | Review (H6) |
| H8 | **FAFSA checked** whenever any H8 box is checked (every college on the site takes federal aid: Scorecard covers Title IV institutions only) | Review (H8) |
| Methodology ⇔ forms | IM or both ⇒ CSS Profile (`H.803`) or own form (`H.802`) checked; FM only with CSS Profile checked ⇒ review (possible but rare). Methodology blank: no check; the methodology is inferred (Store) | Review (methodology) |
| H6/H7 vs H8 | A mark read for "CSS Profile" must come from the H8 block, not H7 (section boundary by line, in flattened PDFs) | Review (H7 and H8) |
| H9–H11 | Valid month/day; deadline box and "no deadline" (`H.907`) not both checked; on-date and rolling notification (`H.1001`, `H.1004`) not both checked; in cycle order (September → August): priority ≤ deadline (UM 12/15 then 3/1 passes), notification ≥ priority, reply-by ≥ notification; reply weeks 1–12 | Review (that date) |
| H14 | Each row: a non-need and a need mark are both allowed; ROTC has no need column; "N/A" text → blank | — |
| H15 | Trimmed; boilerplate (fewer than 60 characters, or matches "not implemented", "no new", "please visit", "see our website") stored with `display: false` | — |

**Cost of attendance** for the H6 and H2A bounds: G1's out-of-state total from [cds-cost-and-debt.md](cds-cost-and-debt.md)
when read (it describes the next year, so the bound only loosens), else federal `cost.cost_of_attendance`, × 1.1.

No H item has a federal value with the same definition (IPEDS SFA counts first-time full-time students receiving each
kind of aid; CDS H2 frames the class by need), so there is **no agreement-with-federal check** beyond the cohort size
above, and no item replaces a federal value.

## Store
### Snapshot: `school.reported.aid` (small; what filters, Compare, and the headlines read)
```ts
/** CDS section H facts for filters, Compare, and the cost page headline (specs/data-expansion/cds-financial-aid.md). */
export interface ReportedAid {
  edition: string;                               // "2025-26": the document the process facts came from
  aid_year: AidYear | null;                      // H.101; null → H1/H2/H2A/H6 aren't published
  methodology: "federal" | "institutional" | "both" | null;   // H.102–H.104 as stated; never inferred here
  forms: AidForms | null;                        // H.801–H.808; null = the list was left blank
  dates: AidDates | null;                        // H.901–H.1103
  international: InternationalAid | null;        // H.601–H.605 (total in the detail file)
  first_years: H2Headline | null;                // H2/H2A first-year column, the lines shown
  institutional_grants: { need: number | null; non_need: number | null } | null;  // H.107, H.119
}
export interface AidYear { start: number; status: "estimated" | "final" }          // start 2025 = 2025–26
export interface AidForms {
  fafsa: boolean; own_form: boolean; css_profile: boolean; state_form: boolean;
  noncustodial_profile: boolean; business_farm_supplement: boolean; other: string | null;
}
export interface AidDates {                        // CdsDate = { month, day } from cds-application-logistics.md
  priority: CdsDate | "unstated" | null; deadline: CdsDate | "unstated" | null; no_deadline: boolean | null;
  notify_by: CdsDate | null; notify_rolling_from: CdsDate | "unstated" | null;
  reply_by: CdsDate | null; reply_within_weeks: number | null;
}
export interface InternationalAid {
  need_based: boolean; non_need: boolean; none: boolean;
  recipients: number | null; average: number | null;
}
/** H2 lines by template letter: a–m, and H2A n–q. Shares are derived, never stored. */
export type H2Line = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q";
export type H2Column = Record<H2Line, number | null>;       // i is a fraction 0–1
export type H2Headline = Pick<H2Column, "a" | "c" | "d" | "h" | "i" | "j" | "k" | "m" | "n" | "o" | "p" | "q">;
```
About 20 values; null everywhere a document is blank, never 0.

### Detail file: `detail.cds_aid` (everything else, with a quote per value)
Section H is ~130 values a college; with per-value quotes that is ~30 KB, too big for `data/schools.json` (12.4 MB
today) across ~740 colleges. The full set goes in the per-college detail file (`data/detail/schools/{unitid}.json`,
`lib/detail.ts`), as a new table:
```ts
export interface CdsAidDetail {
  document: { url: string; edition: string; retrieved: string; sha256: string };
  aid_year: AidYear | null;
  h1: { need: H1Row; non_need: H1Row };             // H.105–H.127
  h2: { first_years: H2Column; full_time: H2Column; part_time: H2Column };   // H.201–H.239, H.2A01–H.2A12
  h6: { need_based: boolean; non_need: boolean; none: boolean;
        recipients: number | null; average: number | null; total: number | null } | null;
  h7: { own_form: boolean; css_profile: boolean; other: boolean; other_text: string | null } | null;
  h14: Record<H14Criterion, { non_need: boolean | null; need: boolean | null }> | null;
  h15: { text: string; display: boolean } | null;
  /** Every non-null value above, by template code: the verbatim quote and where it is. */
  cite: Record<string, { quote: string; page?: number; cell?: string; line?: number }>;
}
export interface H1Row {
  federal: number | null; state: number | null; institutional: number | null; external: number | null;
  total_grants: number | null; student_loans: number | null; federal_work_study: number | null;  // FWS: need only
  other_work: number | null; total_self_help: number | null; parent_loans: number | null;
  tuition_waivers: number | null; athletic: number | null;
}
export type H14Criterion = "academics" | "alumni_affiliation" | "art" | "athletics" | "job_skills" | "rotc"
  | "leadership" | "music_drama" | "religious_affiliation" | "state_residency";
```
`DETAIL_TABLES.cds_aid.checkRows` requires a `cite` entry with a quote and a page, cell, or line for every non-null
value, and that the snapshot's `reported.aid.first_years` equals `h2.first_years` (a `detailMismatches` rule, as
majors does for its top 5).

### Registry (`lib/fields.ts`)
All with `reported(label, "aid")` (source `college-site`, vintage `null`), so every stored value needs an `extracted`
lineage record:
`reported.aid.edition`, `reported.aid.aid_year`, `reported.aid.methodology`, `reported.aid.forms`,
`reported.aid.dates`, `reported.aid.international`, `reported.aid.first_years`, `reported.aid.institutional_grants`;
`detail.cds_aid` (source `college-site`). Derived, computed in `lib/aid-cds.ts`:
- `derived.merit_dollar_share`: `H.119 ÷ (H.107 + H.119)`, inputs `reported.aid.institutional_grants`. Sample†: CU 0%,
  WM 12.6%, IL 13.4%, HU 83.9% (HU also marks 2,156 of 2,249 aided first-years as getting non-need grants, so it
  likely reported by scholarship type rather than by need use; the caveat below covers it).
- `derived.aid_methodology`: the stated methodology; else `"institutional"` **inferred** when the CSS Profile or the
  college's own form is required (CU, VU), cited as derived from `reported.aid.forms`; else null.
- `aid.cds_previous` (source `cds`): see Supersession.

**Lineage per value.** Each registered snapshot path has one record: `source: "college-site"`, `method:
"extracted"`, `url`, `retrieved`, `year` (from the Years table), `quote` (the item's row, or for a checkbox object the
checked labels joined: "X FAFSA; X CSS Profile; X Noncustodial Profile"), and `page` or `cell`. The per-value quote
for every number is in `detail.cds_aid.cite` by template code, and the profile's ⓘ shows that one; Compare, which
doesn't load detail files, shows the path's record. `LineageRecord` gains `cell?: string` (round 3 already writes
cells into records).

### Newest-everywhere and supersession of `aid.cds`
- **No federal value is replaced.** Nothing in section H has the same definition as a federal field the site shows,
  so all of it is new, partial-coverage data: shown on the profile and in Compare, filterable only as booleans, and
  **never in ranks, sorts, medians, percentile strips, key differences, the radar, or "Known for"** until coverage is
  broad.
- **`aid.cds` is superseded.** Today `aid.cds` (`CdsAid`, 10 values, full-time column only) comes from
  `import-cds` (`flat(…, 2)` takes the second of the three H2 columns) for the 8 override colleges (Berkeley, UIUC,
  Maryland, Cornell, NYU, Vanderbilt, W&M, Purdue), cited to the override's edition, and shown only in the cost page's
  "From {college}'s Common Data Set" panel ([cost-outcomes.md](../cost-outcomes.md#aid-schoolaid-ipeds-sfa-aidcds-from-a-common-data-set)).
  `applyNewest` (`lib/newest.ts`) gains an aid step: when a college has a passing H2 record whose edition is the same
  as or newer than the override's, it moves the override's `aid.cds` to `aid.cds_previous` (`{ edition, url,
  values }`, registered, source `cds`) and the panel reads only `reported.aid` and `detail.cds_aid`. Each full-time
  figure's ⓘ then adds "Replaces: {college} Common Data Set 2024–25: 77%" (`replacedBy` in `lib/lineage.ts` reads
  `aid.cds_previous` as it reads `admissions.federal`). With no record, `aid.cds` stays and is shown as today. A
  record older than the override never replaces it. The lineage guard requires `aid.cds_previous` whenever an
  override's `aid` exists alongside a published `reported.aid.first_years`.
- **The hand importer stops reading H2.** `import-cds` drops its H2/H2A block; the round-3 Excel readers read all
  three columns by code. When none of the 8 colleges still lacks a record, `aid.cds` and `CdsAid` are deleted (the
  history series keeps the old editions' points).
- **Existing bug fixed on the way:** `aid.cds` is cited with the override's edition ("2024-25"), but H2 describes the
  `H.101` year (W&M's 2025–26 edition is "2024-2025 Final"; its 2024–25 edition may be 2023–24 final). A one-time read
  of `H.101` from the 8 override workbooks sets `_lineage["aid.cds"].year` in `data/overrides.json` until supersession.

## Display
Quiet, as everywhere: provenance in the ⓘ, no chips or banners, no figure shown twice. Every new term gets a glossary
entry. Years below are placeholders; the UI takes them from lineage.

### Cost topic page (`/schools/{id}/cost`, [school-profile.md](../school-profile.md))
1. **"Who gets aid" → the CDS panel** (replaces today's four tiles from `aid.cds`): a two-column table, **First-years**
   and **All full-time undergraduates**, caption from `cdsAidYearNote` ("First-years and all full-time
   undergraduates, {aid year}"). Rows, each a cited `MetricLabel`, omitted when null in both columns:
   - Have financial need: C ÷ A ("54%", sub "1,744 students")
   - Need met, on average: I
   - Need fully met: H ÷ D
   - Average aid package: J
   - Average need-based grant: K
   - Average need-based loan: M
   - Merit aid without need: N ÷ A, sub "average {O}"
   - Athletic scholarships: P, sub "average {Q}" (only when P > 0)

   Under the table, from H1: "{merit_dollar_share} of the college's own grant dollars were awarded without regard to
   need." Caveat line, always beneath: "Each college decides what a family needs, so '100% of need met' can mean
   different prices at different colleges. Merit awards that went toward a student's need count as need-based here."
   Phones: the two numeric columns fit at 390 px; the merit line wraps.
2. **New block "Applying for aid"** (`#apply-for-aid`), after "Who gets aid", caption "For students entering fall
   {cycle}":
   - Forms: "To apply for aid: FAFSA and CSS Profile." Then, when checked: "If your parents are divorced or separated,
     the other parent also files the CSS Noncustodial Profile." / "Families who own a business or farm also file a
     Business/Farm Supplement." / "Also: {other text}". FAFSA only → "To apply for aid: the FAFSA."
   - How need is figured (only when stated): "Need is calculated with the college's own formula as well as the
     federal one" (both) / "with the college's own formula" (IM) / "with the federal formula" (FM). Inferred
     methodology is never shown as a statement; the estimator alone uses it.
   - Dates: "Priority date: February 15 · Deadline: March 1 · Aid offers: about April 1 (or 'on a rolling basis from
     February 15') · Reply by: May 1 (or 'within 3 weeks')". `"unstated"` dates are left out. When today is past the
     cycle's reply date, the caption adds "Dates for fall {cycle} entrants; the next cycle's are usually similar."
   - "What the college's own scholarships consider" (H14): a two-column grid, **Merit awards** and **Need-based
     awards**, listing only rows marked in either column, with "A blank means the college didn't mark it, not that it
     never counts." Hidden when H14 is blank.
   - Policy note (H15, when `display`): "In the college's words:" and the text as a quote, with the link to the
     document (IL: the Illinois Commitment income and asset limits).
3. **New block "International students"** (`#international-aid`), when H6 or H7 has data: "{recipients} international
   students received an average of {average} from the college ({aid year})." / "The college doesn't offer its own
   grants to international students." (`H.603`) Types: "Need-based and merit aid offered." Forms: "International
   applicants file: CSS Profile" / "the college's own form" / "{other text}".

The overview's cost card is unchanged.

### Compare ("All the numbers", a "Financial aid process" group)
Rows, "–" when null (never "No"), the muted year when a value's year differs from the row's usual one:
"Aid forms" (FAFSA · CSS Profile · Noncustodial), "Aid priority date or deadline", "Need met, first-years",
"Average aid package, first-years", "College grant dollars given as merit", "Aid for international students" ("318
students, average $88K" / "Not offered"). No key differences, no radar axis.

### Explore filters (booleans only, counts from colleges with data)
| Filter | Param | Matches |
|---|---|---|
| No CSS Profile | `aidForms=no-css` | `forms` not null and `css_profile` false (a blank H8 list never matches) |
| Aid for international students | `intlAid=1` | `international.need_based` or `non_need`, or `recipients` > 0 |
Label in the panel: "Financial aid (from colleges' own reports)". No sort, no table column, no range.

### Planning tools
- **[Net price estimator](../product/net-price-estimator.md):** method switch from `derived.aid_methodology` (IM or
  both, stated or inferred, → institutional; FM → federal; null → unknown, widest range); a noncustodial-parent
  question shown when `forms.noncustodial_profile`; "need met" from the **first-year** line I with its aid year;
  possible merit from first-year N ÷ A and O; confidence widens when the aid year is an estimate or older than the
  SFA year.
- **[Saved lists](../product/saved-lists.md):** "Aid forms due" (H9 priority date or deadline) beside the application
  deadline in each row and in "Next 30 days"; "Reply to aid offer by" (H11) once the student is admitted.

### Glossary (`lib/glossary.ts`)
New: `css-profile`, `noncustodial-profile`, `business-farm-supplement`, `aid-methodology` (federal vs institutional),
`aid-package`, `self-help-aid`, `merit-dollar-share`, `athletic-scholarship`, `aid-for-international-students`.
Reused: `need-based-aid`, `merit-aid`, `need-met`, `institutional-aid`, and `priority-date` from
[cds-application-logistics.md](cds-application-logistics.md) (its definition must also cover aid forms).

## Keep history?
- **Series per aid year** (not per edition), in a `cds_aid` family of the history shard: first-year I, J, K, N ÷ A;
  full-time I; `merit_dollar_share`; H6 recipients and average. A final figure replaces the estimate for the same
  year; the latest point equals the snapshot. Charted on Over time under the Aid group once a college has three or
  more points, labeled "reported by the college". Unlike federal series these are self-reported and partial, so no
  national line.
- **Events** (`lib/events.ts`): CSS Profile added or dropped, Noncustodial Profile added or dropped, methodology
  changed, international aid started or stopped (`H.603` toggled), by cycle year: "Stopped requiring the CSS
  Profile, fall 2027 entrants". Derived from consecutive editions, never hand-kept; shown in Over time → Changes.
- **Backfill: worth it, later, from the archive.** Index pages list 10–25 past editions at many colleges; H2, H6, and
  H8 have long been in the template (older editions put methodology in H3 and have no code tables, so they need the
  model). Recommend archiving prior editions in the first run (HTTP only, round 3 open question 2) and extracting
  H.101, H2 (first-year and full-time), H6, and H8 from up to five prior editions in one later `--reextract` batch
  (about $7 per edition sweep by round 3's Decision 10 estimate) once the series UI exists. Not part of the first run's
  extraction.

## Top-level trend?
- **Hero indicator: no.** Partial, self-reported.
- **Home fact: not now.** "Colleges dropping the CSS Profile" needs a fixed panel of colleges with several editions;
  revisit after a backfill.
- **"Known for": no** (percentile-based chips need broad coverage). See open question 3 for an absolute "Meets full
  need" fact.
- **Explore:** the two boolean filters only.
- **Over time chart:** yes, as above.

## Build
- **`lib/cds-sections.ts`** (round 3): the 132 H codes above in group `GH` with their Excel codes, fillable-PDF tags,
  labels for flattened text, item groups (`aid-year`, `process`, `policy`), and the checks; `schema_version` bump.
  Output budget: ~130 values at ~13 tokens with line ids ≈ 1.7K tokens for section H, plus G; size `max_tokens` for
  `GH` accordingly.
- **`lib/cds-checks.ts`**: the checks table above, plus the traps as normalizers (`normalizePercent`,
  `parseAidYear`, `isBlankText`, `readMark`).
- **`scripts/lib/cds-xlsx.mts`**: readers for every code (per-sheet code tables first: VU's ANSWER SHEET section H is
  blank while its H sheet has values, inventory §5); the fillable-PDF reader maps the tags above.
- **`scripts/lib/college-reported/split.mts`** (round 3): the layout pass covers `H.101` (two-label choice),
  H14 (two-column grid), and the H7/H8 section boundary.
- **`lib/aid-cds.ts`** (new, pure): `aidYearLabel`, `cycleLabel`, `cdsAidYearNote`, `meritDollarShare`,
  `aidMethodology`, `h2Shares`, `pickAidRecord` (the "which record wins" rule), `showPolicyNote`.
- **Merge** (`merge-reported`, records → dataset): `passed` H items → `reported.aid` and `detail.cds_aid`, with
  lineage; `applyNewest` aid step (`lib/newest.ts`) for supersession.
- **`lib/types.ts`**: the types above; `ReportedData.aid`; `School.aid.cds_previous`; `DetailTables.cds_aid`;
  `LineageRecord.cell`.
- **`lib/fields.ts`**, **`lib/detail.ts`** (`DETAIL_TABLES.cds_aid`), **`lib/lineage.ts`** (`replacedBy` for
  `aid.cds_previous`; the supersession guard), **`lib/glossary.ts`**.
- **Components:** `components/charts/AidBreakdown.tsx` (the two-column CDS panel), new
  `components/school/ApplyingForAid.tsx` and `components/school/InternationalAid.tsx`; `lib/profile-topics.ts`
  (`TOPIC_FIELDS.cost` gains the new paths and blocks); Compare rows; `lib/params.ts` + the filter panel (`aidForms`,
  `intlAid`); history family and events.
- **`scripts/import-cds.mts`**: remove the H2/H2A block; **`data/overrides.json`**: the 8 `aid.cds` lineage years.
- **Tests** (each guard shown to fail when broken):
  1. Percent normalization: "1" with H = D → 100%; "1" with H < 0.95 D → review; 58.6, "99.4%", 0.82 → fractions;
     0.03 → review. Break: drop the H = D test and CU's "1" becomes 1%.
  2. `H.101`: both template strings parse; "2023" and blank fail and keep H1/H2/H2A/H6 unpublished while H8 publishes.
  3. H2 order and package bounds: the CU, WM, IL workbooks and HU's fields pass; swapping B and C fails; a package
     smaller than its parts fails; the old J ≈ K + L rule is asserted to fail WM and HU (documents why it was dropped).
  4. H6 product, H1 sums: CU/IL/HU and CU/HU pass; a ×10 typo and a dropped row fail; `H.603` with recipients fails.
  5. Forms: IL (FM, FAFSA only) passes; IM without CSS or own form → review; CSS with blank methodology → inferred
     institutional, cited as derived; a wholly blank H8 → `forms: null` and excluded from "No CSS Profile".
  6. H7/H8 boundary: a layout-text fixture with "CSS Profile" in both blocks assigns each mark to its own item.
  7. Years: the record with the newer aid year wins over a newer edition; final beats estimate; `cdsAidYearNote`
     adds its phrase one year back and hides the panel two years back; no literal year in the new components (the
     existing lineage guard).
  8. Supersession: an override college with a same-or-newer record moves `aid.cds` to `aid.cds_previous` and the
     panel reads the record; an older record leaves it. Break: skip the edition comparison and an older record wins.
  9. Lineage: a `reported.aid.*` value without an `extracted` record, or a `detail.cds_aid` value without a `cite`,
     fails `check:lineage`.
  10. Never ranked: `reported.aid.*` and `derived.merit_dollar_share` are rejected as sort keys, percentile inputs,
      key differences, and standouts (a partial-coverage list checked by the sort parser and `standouts`).
  11. History: same aid year final replaces estimate; CSS Profile dropped between editions → one event.
  12. Division III: a fixture with P > 0 at an NCAA III college → review.

## Changes to other specs (to apply with this one)
- **[net-price-estimator.md](../product/net-price-estimator.md):** replace "About 200 colleges (CSS Profile) use their
  own formula" (no source) with: which colleges use institutional methodology comes from each college's CDS (H8 CSS
  Profile; `H.102`–`H.104`; inferred when methodology is blank), counted on the Data page after the run. Method step
  4: "need met" uses the **first-year** line I with its aid year; merit share is first-year N ÷ A from the same column
  and year (not "H2A count ÷ first-year enrollment"). Inputs: a "parents separated?" question when the college
  requires the Noncustodial Profile. Validation pilot picks "CSS Profile and not" from H8.
- **[saved-lists.md](../product/saved-lists.md):** Deadlines also come from CDS H9 (aid forms due) and H11 (aid reply
  date) via this spec.
- **[search-and-filtering.md](../search-and-filtering.md):** two filter rows (`aidForms=no-css`, `intlAid=1`) and the
  rule that college-reported booleans exclude colleges with no data.
- **[school-profile.md](../school-profile.md):** the cost route's content adds "applying for aid, international
  students".
- **[cost-outcomes.md](../cost-outcomes.md):** the Aid section: `aid.cds` superseded by `reported.aid` and
  `detail.cds_aid`; the CDS panel shows first-years and all full-time undergraduates.
- **[cds-cost-and-debt.md](cds-cost-and-debt.md):** H6 moves here.
- **[religious-life.md](../religious-life.md):** `religion.aid_by_affiliation` is derived from this spec's
  `detail.cds_aid.h14.religious_affiliation` (`H.1409` or `H.1418` marked), not extracted separately; its display on
  Campus life links to the cost page's grid.
- **[college-reported-round-3.md](../college-reported-round-3.md):** the H rows of the scope table from the lists
  above; Decision 3.2's "read by label since codes vary between colleges' files" no longer holds for the 2025–26
  template (key on codes, labels as fallback for classic workbooks).
- **[data-expansion/README.md](README.md):** the Wave 4 row's "H0–H2A" becomes "H.101–H.104, H1, H2, H2A".

## Open questions for the owner
1. **Snapshot size.** About 20 aid values with lineage in `data/schools.json` (~2–3 MB more across ~740 colleges,
   estimate), the rest in detail files. Acceptable, or should snapshot lineage records for every Wave 4 field carry
   only a reference with the quote in the detail file?
2. **Older aid years.** Hide the CDS aid panel when its year is two or more years older than the federal aid year
   (recommended), or always show it with its year?
3. **"Meets full need."** An absolute fact (first-year line I = 100%), not a percentile: offer it as a "Known for"
   chip or an Explore boolean while coverage is partial?
4. **Policy note.** Show H15 as the college's own words (recommended), or only link to it?
5. **Part-time column.** Store only (recommended), or show it for colleges with many part-time students?

## As built
Built 2026-10-03 on branch `feature/cds3-financial-aid` against the four real 2025–26 records (Vanderbilt 221999,
Cornell 190415, William & Mary 231624, Illinois 145637). All four publish with no review items.

**Where it lives**
- `lib/cds/financial-aid.ts` (pure; the spec's `lib/aid-cds.ts`): template code maps (`H1_CODES`, `H2_CODES`,
  `H6/H7/H8_CODES`, `METHOD_CODES`, `H14_CODES`); normalizers and checks (`normalizeNeedMet`, `checkH2Column`,
  `checkAthletic`, `checkH1Row`, `checkH6`, `checkForms`, `checkMethodology`, `checkDates`, `showPolicyNote`); years
  (`aidYearLabel` → "2025–26 (estimated)" / "2024–25", `cycleLabel` → "Fall 2026 entrants", `cdsAidYearNote`,
  `pickAidRecord`, `pickProcessRecord`); derived values (`meritDollarShare`, `aidMethodology`, `h2Shares`); the build
  (`buildFinancialAid` → snapshot, lineage per path, detail table, review items), `applyFinancialAid`,
  `supersedeCdsAid` / `restoreCdsAid`, `financialAidProblems` (lineage guard), `financialAidDetails`,
  `checkCdsAidDetail`, `cdsAidMismatch`, and the Explore predicates `noCssProfile`, `offersInternationalAid`.
- `lib/cds/financial-aid-compare.ts`: `compareAidRows(sfaYear)`, appended to Compare's "All the numbers".
- Types appended in `lib/types.ts` (`ReportedAid`, `AidYear`, `AidForms`, `AidDay` (the spec's `CdsDate`), `AidDates`,
  `InternationalAid`, `H2Line/H2Column/H2Headline`, `H1Row`, `H14Criterion`, `CdsAidDetail`, `CdsAidPrevious`);
  `ReportedData.aid`; `School.aid.cds_previous`; `SearchFilters.aidForms/intlAid`.
- Fields (`lib/fields.ts`, end of the college-reported block): the eight `reported.aid.*` paths, `detail.cds_aid`,
  `aid.cds_previous`, and computed `derived.merit_dollar_share`, `derived.aid_methodology`.
- Detail table: `DETAIL_TABLES.cds_aid` (`lib/detail.ts`); `DetailTable.vintage` may now be null for a per-document
  source (the table's `year` is then its aid year, checked present, not against meta). `detailMismatches` requires
  `reported.aid.first_years` to equal the detail file's first-year column.
- Merge: `mergeReported(schools, reported, records)` (`lib/reported-merge.ts`) applies each college's record after its
  round-2 entry; `restoreFederal` (`lib/newest.ts`) first undoes the `aid.cds` supersession, so `stripReported` restores
  the school byte for byte. `npm run merge-reported` reads `data/cds-records/` and rewrites only the `cds_aid` table of
  each detail file; `npm run sync-data` merges the records and adds `financialAidDetails` to its detail builders.
- Lineage display (`lib/lineage.ts`, `components/ui/info-tip.tsx`): a record value's ⓘ reads "Reported by {college}
  in its 2025–26 Common Data Set, for {year}" (`Cited.cdsEdition`), its source label is "{college} Common Data Set
  {edition}", `Cited.replaces` gained `label`/`display` (the CDS panel's "Replaces" line for `aid.cds_previous`), and a
  college-reported field a college has no value for no longer adds a placeholder source to footnotes.
- UI: `components/school/CdsAidTable.tsx` (rendered by `components/charts/AidBreakdown.tsx` when there's no `aid.cds`;
  the full-time cells' ⓘ names the replaced hand-imported figure), `components/school/ApplyingForAid.tsx`
  (`#apply-for-aid`), `components/school/InternationalAid.tsx` (`#international-aid`), on `/schools/{id}/cost`;
  `TOPIC_FIELDS.cost` appended. Explore: `aidForms=no-css`, `intlAid=1` in `lib/params.ts`, `lib/dataset.ts`,
  `FilterPanel` ("Financial aid (from colleges' own reports)"), `Toolbar` chips. Glossary: the nine new terms.
- `scripts/import-cds.mts` no longer reads H2/H2A; a re-import keeps the patch's existing `aid` and `lineage`.
- `data/overrides.json`: each override's `lineage["aid.cds"].year` is the aid year its workbook marks in H0 (read
  2026-10-03): Berkeley and Vanderbilt 2024–25 (estimated); Illinois, Maryland, W&M, Purdue 2023–24; Cornell
  2025–26 (estimated). NYU's workbook URL returned 403, so its year is still the edition.
- Tests: `tests/cds-financial-aid.test.mts` (spec tests 1–5, 7–10, 12, plus dates and the committed aid years); the
  re-merge test in `tests/merge-reported.test.mts` now includes the records.

**Measured deviations from the spec**
- `M ≤ L` is not a check: Vanderbilt's valid first-years have M $2,931 > L $2,229 (M averages only loan recipients).
- "Notification ≥ priority" applies to an on-date notification only: Illinois notifies on a rolling basis from
  February 15, before its March 15 priority date, which is valid.
- A failed line I nulls line I only; a failed H2 column nulls the column; failed P/Q null P and Q only.
- `H.101` blank or unparseable keeps the record from winning the aid-year pick; there is no review-queue UI yet, so
  review items are returned by `buildFinancialAid` (`reviews`) and not persisted.

**Not built (deferred)**
- Net price estimator and saved-list changes: those features don't exist yet.
- The H2 line A vs B1 cohort check (needs the B1 codes and the checks track's `lib/cds-checks.ts`); the H7/H8 boundary
  in flattened PDFs (spec test 6) belongs to the round-3 split/layout pass; Howard's fillable-PDF fields aren't a
  record yet, so tests use the four workbooks only.
- The per-aid-year history series and events (spec test 11): history shards are built by `sync-history`, and with
  one edition per college there is nothing to chart yet.
- The scope-table and `lib/cds-sections.ts` changes the Build list names (group `GH`, schema bump) belong to the
  round-3 pipeline track.

## Roadmap entry
- slug: cds-financial-aid
- summary: See whether a college requires the CSS Profile (and the noncustodial parent's form), its aid deadlines, how much of first-years' need it meets, how much of its scholarship money is merit, and what it gives international students.
- complexity: 3 — two new cost-page blocks and a rebuilt aid panel, a detail table with per-value quotes, supersession of the hand-imported `aid.cds`, the first per-aid-year CDS series and events, and changes to the estimator and saved lists
- after: ["college-reported-round-3"]
