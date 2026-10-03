# CDS Student Body and Outcomes: Enrollment, Race, Retention, and Graduation One Year Newer

> Status: **built** (2026-10-03; see [As built](#as-built)). Wave 4, unit U9 of the CDS inventory plus the B1/B2 items that
> [college-reported-data.md](../college-reported-data.md) listed under "Later". Ships from the round-3 records
> ([college-reported-round-3.md](../college-reported-round-3.md)) with no new visit to any college. Research: 19 real
> 2025–26 Common Data Sets (the inventory's working files), the site's own data (`data/schools.json`,
> `data/overrides.json`), and the code that applies the newest-everywhere rule today (`lib/newest.ts`, `lib/lineage.ts`,
> `scripts/history/build.mts`). Part of [data-expansion](README.md).

## Question it answers
*How big is the student body this fall, and who is in it? How many first-years come back? How many students finish,
and do Pell Grant recipients finish as often as everyone else? How many finish in four years?* The site already
answers each of these from federal data. A Common Data Set answers them **one year (or one cohort) newer**, with the
**same definitions**, and adds one thing federal data doesn't have for the same students: graduation within 4 and 5
years by Pell group.

## Why this spec is mostly about the newest-everywhere rule
Every item here except the 4- and 5-year rates has the same definition as a federal field the site already shows, so
under [round 2, Decision 1](../college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere) the
college's newer value **replaces** the federal one in `data/schools.json`, in every view, with the previous value kept
and the year in the ⓘ popover. Today that rule exists only for the admissions funnel (`applyNewest`,
`admissions.federal`). This spec extends it to demographics and outcomes as a small table of **newest groups**, which
later CDS specs (the test policy in C8, next year's price in G1) can reuse.

| Site field (federal) | Federal year today | CDS item | CDS year (2025–26 edition) | Same definition? |
|---|---|---|---|---|
| `demographics.undergrad_enrollment` (Scorecard `student.size`, degree-seeking undergrads) | fall 2024 | B1 "Total degree-seeking", FT + PT, all genders | fall 2025 | Yes |
| `demographics.men_share`, `women_share` (Scorecard, add to 100%) | fall 2024 | B1 degree-seeking men and women, as shares of men + women | fall 2025 | Yes (IPEDS and the CDS template both distribute non-binary students across the two; see [Gender](#gender-the-third-column-is-unknown-not-another-gender)) |
| `demographics.part_time_share` (Scorecard, degree-seeking) | fall 2024 | B1 part-time degree-seeking ÷ degree-seeking | fall 2025 | Yes |
| `demographics.racial_diversity` (Scorecard, degree-seeking undergrads, seven groups) | fall 2024 | B2 **column 2** (degree-seeking undergraduates) | fall 2025 | Yes |
| `outcomes.retention_rate` (Scorecard `retention_rate.four_year.full_time`) | one cohort older ("entered fall 2023" expected; [probed at build](#retention-year)) | B22 | entered fall 2024, returned fall 2025 | Yes (first-time, full-time, bachelor's-seeking) |
| `outcomes.grad_rate_pell`, `grad_rate_loan_no_pell`, `grad_rate_no_pell_no_loan`, `grad_rate_ftft`, `grad_cohorts` (IPEDS `GR{Y}_PELL_SSL`) | entered fall 2018 | B4–B11 grid, "Fall 2019 Cohort" | entered fall 2019 | Yes: the grid's own instruction is "see the IPEDS GRS Forms and Instructions" |
| — (none at this definition) | — | B4–B11 lines D, E: completers within 4 and 5 years by Pell group | entered fall 2019 | **New field**: OM's `award_4` covers all entering students who entered fall 2016, a different population |

Not replaced: `outcomes.graduation_rate` (the profile's ring) is Scorecard's consumer rate, a different measure from
GR's first-time full-time rate; the two differ by more than half a point at 1,436 of the 1,572 site colleges that have
both (computed from `data/schools.json`, 2026-10-03). It stays federal.

**The strongest check we have.** The 2025–26 grid also repeats the previous cohort (fall 2018, codes `B.501`–`B.532`),
which is exactly IPEDS GR's newest class. At the three workbooks that fill it, the CDS equals the site's federal
figures to the student: Vanderbilt Pell 218 of 244 (89.34%), neither 1,240 of 1,316, all 1,491 of 1,594; William &
Mary Pell 135 of 159 (84.91% vs federal 84.91%); Illinois Pell 1,472 of 1,913 (76.95% vs 76.95%). So the previous
grid proves the reading, and the current grid is the next class.

## Items the run must capture
Template codes are the 2025–26 ANSWER SHEET codes (identical across Vanderbilt, Cornell, William & Mary, and Illinois;
Howard's fillable-PDF field names map to them, e.g. `EN_TOT_UG_N` = `B.176`, `GRS_BACH_PELL_P` = `B.429`,
`RETENTION_FRSH_N` = `B.2201`). **Deterministic** = read with no model from the template workbook's code table and from
the fillable PDF's form fields; both are "yes" for every item below. **Model** = needed for flattened PDFs and HTML
(group `B` of round 3's Decision 4, one call per document).

| Item | Codes (cells) | Question (template wording, shortened) | Coverage in the inventory | Deterministic | Model for PDF/HTML |
|---|---|---|---|---|---|
| B1 undergraduates, men | `B.101`–`B.113` (13) | Degree-seeking first-time first-year / other first-year / all other degree-seeking / **total degree-seeking** / all other undergraduates in credit courses / total, full-time then part-time; total undergraduates | All T5 (the four workbooks + Howard's form fields) and every flattened PDF: 15 of 19 tallied; Berkeley's classic workbook has it too | Yes | Yes; clean rows in layout-aware text |
| B1 undergraduates, women | `B.126`–`B.138` (13) | Same rows | Same | Yes | Yes |
| B1 undergraduates, unknown | `B.151`–`B.163` (13) | Same rows, column "Unknown" | Cornell 13, William & Mary 13, Illinois 11, UW–Eau Claire 2 (undergraduate totals); Vanderbilt blank cells with 0 totals; Harvard 0; Baylor "-"; **Michigan prints no Unknown column** | Yes | Yes; a two-value row (Harvard "803 870") needs x positions to tell men/women from unknown |
| B1 graduate students, by sex | `B.114`–`B.125`, `B.139`–`B.150`, `B.164`–`B.175` (36) | Graduate rows, same shape | All T5; `B.122`, `B.147`, `B.172` ("Total Graduate Students") are blank in all four workbooks: a template quirk | Yes | Yes |
| B1 totals | `B.176`–`B.178` (3) | Total all undergraduates / all graduate / grand total | All T5, every PDF (Baylor 14,183; Duke 6,525; Loyola 12,640) | Yes | Yes |
| B2 column 1 | `B.201`–`B.210` (10) | Degree-seeking first-time first-year, by race/ethnicity (9 groups + TOTAL) | All T5; PDFs | Yes | Yes |
| B2 column 2 | `B.211`–`B.220` (10) | **Degree-seeking undergraduates** (incl. first-time first-year), by race/ethnicity | All T5; PDFs | Yes | Yes |
| B2 column 3 | `B.221`–`B.230` (10) | Total undergraduates (degree- and non-degree-seeking), by race/ethnicity | All T5; PDFs. **Illinois fills it with non-degree students only** (TOTAL 1,010 against B1's 38,572) | Yes | Yes |
| B4–B11, current cohort | `B.401`–`B.432` (32) | The "Fall 2019 Cohort" grid (the template says "formerly CDS B4–B11"): lines A initial cohort, B allowable exclusions, C final cohort, D completed in ≤ 4 years, E in > 4 and ≤ 5, F in > 5 and ≤ 6, G total within 6 (D+E+F), H six-year rate (G ÷ C); columns Pell / subsidized loan without Pell / neither / total | Vanderbilt, William & Mary, Illinois, Cornell, Howard complete; 6-year rates in every PDF and HTML read; line D in the T5 files, the Excel-printed PDFs, and MIT's page | Yes | Yes; PDF-plain stacks the four columns, layout rows keep them |
| B4–B11, previous cohort | `B.501`–`B.532` (32) | The "Fall 2018 Cohort" grid, same lines and columns | Vanderbilt, William & Mary, Illinois; **blank at Cornell and Howard** | Yes | Yes |
| B4–B11 headings | (text, quoted) | "Fall 2019 Cohort", "Initial 2019 cohort of first-time, full-time, bachelor's …", "by Aug. 31, 2023" | Every document with the grid | Yes (sheet text) | Yes |
| B22 | `B.2201`–`B.2203` (3) | First-time, full-time bachelor's-seeking students who entered fall 2024 (cohort); still enrolled fall 2025 (retained); the percentage | **All 19 read**: Harvard 98%, USC 95.18%, Georgia Tech 97.3%, Howard 88 (2,409 of 2,738), Spelman 95%, Baylor 89.29%, TCU 93.4%, Loyola 84.9%, UW–Eau Claire 80.9%, Michigan 97%, Duke 97.0%, MIT 99%, Texas A&M 95, Berkeley 0.9703, Purdue 0.9237; Cornell 3,448 of 3,525; William & Mary 1,534 of 1,609; Illinois 8,582 of 9,002; **Vanderbilt typed 0.97 into the cohort-count cell** and left the other two blank | Yes | Yes |
| B1/B22 date text | (text, quoted) | "as of the institution's official fall reporting date or as of October 15, 2025"; "who entered in Fall 2024" | Every document | Yes | Yes |

**175 coded cells**: `B.101`–`B.178`, `B.201`–`B.230`, `B.401`–`B.432`, `B.501`–`B.532`, `B.2201`–`B.2203`. Graduate
rows and the unknown-gender cells are captured though nothing here displays them: they cost nothing in workbooks and
fillable PDFs, the B1 sums need them, and [lgbtq-life.md](../lgbtq-life.md) may want the unknown counts. Not required
by this spec: B3 (IPEDS Completions is as new and finer), B12–B21 (two-year programs; blank at every 4-year college in
the sample).

**Readers.** Template workbooks: the per-sheet code table, ANSWER SHEET as fallback (they agreed on section B in all
four). Fillable PDF: form fields by the template's PDF tag. Classic workbooks (Berkeley; Purdue, whose section B code
table is **misaligned with the form rows**): label plus column letter, never Purdue's codes. B2's three columns share
labels in the code table ("Undergraduates / All / All" for both `B.211`–`B.220` and `B.221`–`B.230`), so B2 is read by
**code number or column position, never by label**; the hand importer's "take the last group" is exactly the bug.

## Gender: the third column is "Unknown", not "Another gender"
The 2025–26 B1 header is "Males / Females / Unknown" in every document read, and the template's instruction (printed in
Harvard's, Baylor's, Georgia Tech's, Duke's, and Michigan's files) says "In cases where non-binary gender information
is provided, IPEDS recommends distributing across the two-binary categories." Berkeley adds "Unknown and Another gender
students are equally distributed across male and female categories for consistency with IPEDS reporting." So:
- `men_share` and `women_share` from B1 are men ÷ (men + women) and women ÷ (men + women), adding to 100% like the
  federal fields ([student-body.md](student-body.md)). Unknown is left out of the shares, as IPEDS leaves it out of its
  main tables.
- B1 is **not** a source of "another gender" counts in 2025–26. [lgbtq-life.md](../lgbtq-life.md)'s source table lists
  "Common Data Set B1 (2022–23 on): an 'Another Gender' column"; that is out of date for this edition (the inventory's
  2025–26 files show "Another Gender" only in other items' instructions, e.g. Michigan's D2). The unknown counts are in
  the records for that spec to use as "gender unknown", with its own display rules (blank ≠ 0).

## Years
| Item | Describes | Lineage year | How it's set |
|---|---|---|---|
| B1, B2 | The fall of the edition's first year | `"Fall 2025"` | Edition `2025-26` → fall 2025, confirmed by the B1 instruction's date ("October 15, 2025"). A stated date naming another fall fails the item (`edition-mismatch`). Page headers are ignored: USC and Loyola print "Common Data Set 2024-2025" on most pages of their 2025–26 files |
| B22 | Students who entered the fall before, counted in the edition's fall | `"Entered fall 2024"` | Edition start − 1, confirmed by the item text ("entered in Fall 2024") |
| B4–B11 current grid | Students who entered six falls before | `"Entered fall 2019"` (the same form as the `ipeds-gr` vintage, "Entered fall 2018") | Edition start − 6, confirmed by the grid heading and line A ("Initial 2019 cohort"). **The template lets a college fill this grid with fall 2018 data** ("If Fall 2019 cohort data are not available, provide data for the Fall 2018 cohort"): see the `holds-previous-cohort` check |
| B4–B11 previous grid | Seven falls before | (never displayed) | Edition start − 7; used only to check against IPEDS GR |
| 4- and 5-year completers | Same students as the current grid | `"Entered fall 2019"` | As the current grid |

Every lineage record written here also carries `edition: "2025–26"` (a new optional `LineageRecord` field) so the ⓘ
popover can say "in its Common Data Set 2025–26" next to a cohort year. No year is written in UI code; labels come from
lineage and the vintages.

<a id="retention-year"></a>**Retention year.** `outcomes.retention_rate` is registered today with vintage
`scorecard-latest` (no year), so the site can't yet say which class its federal retention describes, and the newest
rule needs that year. The build adds vintage `scorecard-retention`, found the way `scorecard-age` is: `detectScorecardYears`
probes which year key equals `latest.student.retention_rate.four_year.full_time`, and the vintage reads "Entered fall
2023" if key 2024 matches (IPEDS fall 2024 enrollment reports the class that entered fall 2023). The inventory's "one
cohort older" (Loyola: federal 81.67% vs CDS 84.9%) is consistent with that but unverified until the probe runs.

## Checks
Universal checks from round 3 Decision 9 apply (the number is on its cited line; counts are integers ≥ 0; rates
0–100%). Blanks (`""`, `-`, `N/A`, `N/Av`) are `blank`, never 0. Text in a numeric cell fails that cell.

**Percent forms** (`parseRate`, one function for B22 and line H): a value with `%` is divided by 100 ("88.6%", "91%",
"95.18%"); a bare number above 1 and at most 100 is a percent (Loyola 63.73, Howard 88); a number from 0 to 1 is a
fraction (Vanderbilt 0.9037037…, William & Mary 0.898876404, Illinois 0.88, Cornell 0.97815…). A bare `1` is
ambiguous and is accepted as 100% only when the counts confirm it. **Counts beat stated rates**: when the counts are
there, the rate is computed from them and the stated rate is only checked (±0.5 point); the stated rate is used alone
only when the document gives no counts (Harvard "98%", MIT "99%").

### B1
| Check | Rule | On failure |
|---|---|---|
| Rows add up | For each sex and each of FT/PT: first-time + other first-year + all other degree-seeking = total degree-seeking (±1); total degree-seeking + non-degree = total FT (or PT) (±1); FT + PT = total undergraduates by sex (`B.113`, `B.138`, `B.163`) (±1); `B.176` = the three sexes' totals (±1); `B.178` = `B.176` + `B.177` (±1). A blank total with its parts present is computed from the parts (printed totals can overflow, as Loyola's C1 "##" did); parts are never filled from totals | Item `failed`, escalated once |
| Unknown is small | Unknown degree-seeking undergraduates ≤ 5% of degree-seeking, else the shares would mislead | Item `failed` (review) |
| Agrees with federal (one fall older) | Degree-seeking total within ±10% of `demographics.undergrad_enrollment`; men share and part-time share within ±5 points | Review queue (`federal-disagrees`), escalated once. Example: Harvard's degree-seeking total is 6,675 (3,075 + 3,593 full-time, 4 + 3 part-time) against the site's federal 7,601 (−12%): a scope difference to look at, not a reading error, so it goes to review rather than through |
| Layout traps | Michigan has two columns, not three; a row with a blank Unknown prints two numbers; classic workbooks lose empty cells in `sheetText` | Layout-aware lines with x positions; column letters in classic workbooks |

### B2
B2 is stored as three sub-items, `B2.first_year`, `B2.degree_seeking`, `B2.all`, each with its own status, so a bad
column 3 can never block column 2 (the only one published).

| Check | Rule | On failure |
|---|---|---|
| Columns add up | Each column's nine groups sum to its TOTAL (±1) | That sub-item `failed` |
| Column 1 matches B1 | `B.210` = B1 first-time first-year degree-seeking (`B.101`+`B.107`+`B.126`+`B.132`+`B.151`+`B.157`), ±1% (Vanderbilt 1,635 = 1,635) | `B2.first_year` failed |
| **Column 2 matches B1** | `B.220` = B1 total degree-seeking (`B.104`+`B.110`+`B.129`+`B.135`+`B.154`+`B.160`), ±1% (Vanderbilt 7,355 = 7,355; Cornell 15,979 = 15,979; Illinois 37,562 = 37,562) | `B2.degree_seeking` failed: nothing published from B2 |
| **Column 3 matches B1** | `B.230` = `B.176`, total all undergraduates, ±1% (Vanderbilt 7,366 = 7,366; Howard 11,084 = 11,084; **Illinois 1,010 ≠ 38,572**) and each group in column 3 ≥ the same group in column 2 | `B2.all` failed, check id `column-3-not-all-undergrads`. Nothing publishes from column 3, so the circuit breaker doesn't count it (round 3's breaker counts only sub-items that feed a published value); the review queue lists it so the hand importer's trap is visible |
| Agrees with federal (one fall older) | Each of the site's seven shares within ±5 points of Scorecard's | Review (`federal-disagrees`). This also catches Purdue's 2024–25 override, whose international share is 0 |

The site's seven groups from B2 column 2, matching `lib/derive.ts#raceShares` for Scorecard: Asian, Black, Hispanic,
White, two or more, international (nonresidents), and other (American Indian or Alaska Native + Native Hawaiian or
Pacific Islander + unknown), as shares of `B.220`, rounded to 4 places, summing to 1 (±0.001).

### B22
| Check | Rule | On failure |
|---|---|---|
| Counts are counts | Cohort and retained are integers, retained ≤ cohort | Item `failed` (`count-not-integer`). **Vanderbilt's 0.97 in the cohort cell fails here**; the pipeline never moves a number to another cell. The review item names the likely fix |
| Rate | Computed retained ÷ cohort; stated rate (after `parseRate`) within ±0.5 point (Cornell 3,448 ÷ 3,525 = 97.8%, stated 0.9781…; Howard 2,409 ÷ 2,738 = 88.0%, stated 88) | `failed`, escalated once |
| Agrees with federal (one cohort older) | Within ±5 points of `outcomes.retention_rate` (Loyola 84.9% vs 81.67%: passes) | Review (`federal-disagrees`) |
| Year | Item text names the edition's fall − 1 | `failed` (`edition-mismatch`) |

No small-cohort suppression: the federal retention rate has none, and the same definition gets the same treatment.

### B4–B11
The grid is one item and publishes **all or nothing**: replacing some groups' rates and not others would put two
classes on one dot plot.

| Check | Rule | On failure |
|---|---|---|
| Lines add up | Per column: C = A − B; G = D + E + F (±1); G ≤ C; D, E, F ≥ 0. Per line A–G: the three groups sum to the total column (±1), as the template says | `failed`, escalated once |
| Rate | H = G ÷ C within ±0.5 point after `parseRate` | `failed` |
| Small groups | A group's rates are null when its final cohort (C) is under 30, the cohort kept (same rule as [graduation-by-group.md](graduation-by-group.md)). Vanderbilt's subsidized-loan group (29 students) is suppressed | — |
| **Previous grid agrees with IPEDS GR** | Where `B.501`–`B.532` are filled: each group's final cohort within 2% of `outcomes.grad_cohorts` and its six-year rate within 1 point of the federal rate (Vanderbilt, William & Mary, Illinois match exactly) | The current grid goes to review (`previous-cohort-disagrees`): either the college's two reports differ or the grids were read crossed |
| `holds-previous-cohort` | The current grid equals the previous grid, or equals IPEDS GR's fall 2018 cohort and completers exactly | Not a failure: the item is `passed` with `cohort_year` set to the previous fall, so the merge finds it **not newer** and replaces nothing |
| Agrees with federal (one cohort older) | Each shown group's six-year rate and the total within ±5 points of the federal rate; each final cohort within ±10% of `grad_cohorts` (Howard: total 73.5% vs 69.96%, Pell 70.3% vs 66.32%: both pass; Vanderbilt total 92.6% vs 93.54%) | Review (`federal-disagrees`) |
| Implausible gap | Pell vs neither more than 40 points apart: stored, cautioned, not ranked (the existing `MAX_PLAUSIBLE_GAP` rule) | — |
| Order of the new rates | 4-year ≤ 5-year ≤ 6-year per group (cumulative D, D+E, G) | `failed` |

Every federal comparison is made against `restoreFederal(school)`, the baseline before any replacement, as
`sync-college-reported` already does for C1, so a re-run never compares a college with its own previous CDS value.

> **As built (checks, 2026-10-03; `lib/cds-checks.ts`).** Every check above is built and runs on deterministic reads
> too. Two tolerances changed with the real workbooks: the current B4 grid's final cohort is compared with
> federal `grad_cohorts` within **±25%**, not ±10% (entering classes move: Illinois's Pell cohort grew 13%, William &
> Mary's loan group shrank 22%, Vanderbilt's Pell group 11%, all valid), and groups under 30 students (whose rates aren't
> shown) skip the federal comparison (Vanderbilt's 29-student loan group, 75.9% vs 97.1%). The ±5-point rate bound is
> unchanged. B2's sub-items are its three columns' codes (B.201–B.210, B.211–B.220, B.221–B.230), each failing alone;
> B22's year check reads each code's own text (Illinois's B.2203 says "Fall 2025 entering cohort" and fails
> `edition-mismatch`; its counts still give the rate). `holds-previous-cohort` is the merge's rule, not a record check.

## How the records take over from the 8 hand-imported overrides
`data/overrides.json` sets `demographics.undergrad_enrollment` and `demographics.racial_diversity` for 8 colleges
(Berkeley, Illinois, Maryland, Cornell, NYU, Vanderbilt, William & Mary, Purdue), from `scripts/import-cds.mts`. Those
values don't match the federal definitions: the enrollment is `B.176` (it includes non-degree students: Cornell 16,138
vs 15,979 degree-seeking), and the race shares come from "the last group", which is column 3 (wrong at Illinois this
year; Purdue's shows 0% international). Seven of the eight are 2024–25 editions, describing fall 2024, the same fall
as Scorecard, so they are not newer than federal data either.

The build therefore:
1. **Removes `demographics` from all 8 override patches** (admissions and `aid.cds` stay; `school.cds` is still cited by
   them). The baseline for every college becomes the federal value.
2. **Stops `import-cds` writing B1/B2** (and deletes its "last group" race code), so re-importing Illinois can't
   compute shares from 1,010 students.
3. **Guards it**: `lineageForPatch` refuses an override that sets any path owned by a newest group (the five
   demographics paths, `outcomes.retention_rate`, the graduation paths), naming the records as the way in. A test
   proves an override with `demographics.racial_diversity` fails `check:lineage`.
4. The records then supply these values through the newest groups like any other college. Cornell's 2025–26 override
   was the one newer value; its 2025–26 workbook is in the inventory (read by code) and in the run, so the record
   replaces it. If Cornell's record were to fail a check, Cornell would show federal fall 2024 until review clears it:
   no figure is invented to fill the gap.

## Store
### Where each value lives
Replaced values live **in their federal paths** (that is the newest-everywhere rule), each with a lineage record; the
federal values they replaced are kept beside them; the raw values stay in `data/cds-records/` (round 3's staging
store). Unlike admissions, there is **no mirror block** of replaced values under `school.reported`: admissions needed
one because `data/college-reported.json` predates the records, and a mirror here would add about 1 MB of duplicate
lineage to `data/schools.json` (estimate below). Only the genuinely new field goes under `school.reported`.

```ts
// lib/types.ts
demographics: {
  …,
  /** The federal fall these values replaced (lib/newest.ts); present only when a newer CDS fall replaced one of them. */
  federal?: {
    year: number;                          // 2024, the federal fall replaced
    undergrad_enrollment: number;
    men_share: number | null;
    women_share: number | null;
    part_time_share: number | null;
    racial_diversity: RacialDiversity | null;
  };
};
outcomes: {
  …,
  /** Federal outcomes a newer CDS cohort replaced; each part present only when that part was replaced. */
  federal?: {
    retention?: { entering_year: number | null; retention_rate: number | null };
    graduation?: {
      entering_year: number;               // 2018
      grad_rate_pell: number | null; grad_rate_loan_no_pell: number | null;
      grad_rate_no_pell_no_loan: number | null; grad_rate_ftft: number | null;
      grad_cohorts: Record<"pell" | "loan_no_pell" | "no_pell_no_loan" | "total", number | null> | null;
    };
  };
};
reported?: {
  admissions?: ReportedAdmissions;
  /** New fields from the CDS (specs/data-expansion/cds-student-body-and-outcomes.md). */
  outcomes?: {
    /** Finished within 4 and 5 years, first-time full-time bachelor's-seeking students, by aid group (B4–B11 D, D+E ÷ C). */
    graduation?: {
      entering_year: number;               // always the cohort the shown 6-year rates describe
      within_4: Record<"pell" | "loan_no_pell" | "no_pell_no_loan" | "total", number | null>;
      within_5: Record<"pell" | "loan_no_pell" | "no_pell_no_loan" | "total", number | null>;
    };
  };
};
// LineageRecord gains: edition?: string   // the CDS edition, e.g. "2025–26"
```
Nullable everywhere; a group under 30 students is null, never 0. `undergrad_enrollment` stays a number (it is never
replaced by null: B1 without a degree-seeking total doesn't pass).

### Field registry (`lib/fields.ts`)
| Path | Source / vintage | Notes |
|---|---|---|
| `demographics.federal` | `scorecard` / `scorecard-enrollment` | The replaced federal fall; read by the ⓘ popover and history's rule 1 |
| `outcomes.federal.retention` | `scorecard` / `scorecard-retention` (new) | |
| `outcomes.federal.graduation` | `ipeds-gr` / `ipeds-gr` | Also the race dot plot's overall line when replaced |
| `outcomes.retention_rate` | vintage `scorecard-latest` → **`scorecard-retention`** | Every college's tooltip gains the cohort it describes |
| `reported.outcomes.graduation` | `reported(…, "outcomes")`: `college-site`, no vintage | One registered path, one lineage record |

`REPORTED_PATHS` (every stored `reported.*` value needs a `college-site` record) now accepts method `derived` as well as
`extracted`, with the quote of the lines it was computed from: the 4- and 5-year shares are calculated, not printed.

### Lineage per value
Records are copied from the CDS record's cited lines (round 3, Decision 4): `source: "college-site"`, `method:
"extracted"` for a value printed in the document (B22's stated rate when there are no counts) or `"derived"` for one
computed from printed counts (every share, every rate computed from counts), `year` as in [Years](#years), `edition`,
`url`, `retrieved`, `quote` (the item's total line, ≤ 160 characters, e.g. "Total degree-seeking | 3,441 | 3,864 | 0"),
and `page` (PDF) or the cell in the quote's place for workbooks. Per value:

| Group | Paths with a record | Paths without (inherit) |
|---|---|---|
| Enrollment (B1) | `demographics.undergrad_enrollment`, `men_share`, `women_share`, `part_time_share` | — |
| Race (B2) | `demographics.racial_diversity` | — |
| Retention (B22) | `outcomes.retention_rate` | — |
| Graduation (B4–B11) | `outcomes.grad_cohorts` (the anchor) | The four `grad_rate_*` paths: registered as derived from `outcomes.grad_cohorts`, so their citations already expand to the anchor's source; giving them their own copies would only add size |
| New | `reported.outcomes.graduation` | — |

**Size** (estimate): 8 records × ~270 bytes ≈ 2.2 KB per college with every group, × ~700 colleges with a CDS (round
3's estimate of ~740 documents) ≈ **1.5 MB** on the 3.6 MB `data/schools.json`. The build reports the measured growth
in its PR; if it is over 2 MB, open question 4 decides.

## The newest groups (`lib/newest.ts`)
One table generalizes what `applyNewest` does for admissions:

```ts
export const NEWEST_GROUPS = [
  { key: "enrollment", item: "B1", targets: ["demographics.undergrad_enrollment", "demographics.men_share",
      "demographics.women_share", "demographics.part_time_share"], keep: "demographics.federal",
      federalYear: "scorecard-enrollment", atomic: true },
  { key: "race", item: "B2.degree_seeking", targets: ["demographics.racial_diversity"], keep: "demographics.federal",
      federalYear: "scorecard-enrollment", atomic: true },
  { key: "retention", item: "B22", targets: ["outcomes.retention_rate"], keep: "outcomes.federal.retention",
      federalYear: "scorecard-retention", atomic: true },
  { key: "graduation", item: "B4-B11", targets: ["outcomes.grad_cohorts", "outcomes.grad_rate_pell",
      "outcomes.grad_rate_loan_no_pell", "outcomes.grad_rate_no_pell_no_loan", "outcomes.grad_rate_ftft"],
      anchor: "outcomes.grad_cohorts", keep: "outcomes.federal.graduation", federalYear: "ipeds-gr", atomic: true },
] as const;
```
Admissions keeps its own code (partial replacement, the derived rate, yield); it is not rewritten.

**`applyNewestGroups(school, found, years)`** (pure; `found` = the newest passed value set per group from the college's
records, built by `lib/cds-b.ts`; `years` = the federal year per group, parsed from `meta.vintages` by
`federalYears(meta)`):
- A group replaces only when its CDS year is **newer** than the federal year (ties go to federal: when IPEDS publishes
  GR2025, the fall 2019 class, the CDS value stops replacing and federal data shows, with no code change).
- All of a group's targets are replaced together, or none (`atomic`).
- A group replaces only when none of its targets already has a lineage record (a value from anywhere but its default
  federal source is left alone), so `restoreFederal` can always put back exactly what was there. With the overrides
  cleaned up this is every college; the guard keeps it so.
- The replaced values go into the `keep` container (one `demographics.federal` for enrollment and race, written whole
  when either replaced, like `admissions.federal`), with the federal year.
- `reported.outcomes.graduation` (4- and 5-year shares) is stored only when its `entering_year` equals the cohort the
  shown six-year rates describe: the CDS cohort when the graduation group replaced, or the federal cohort when federal
  data has caught up to the same class. It never sits beside six-year rates of a different class.

**`restoreFederal`** undoes every group byte for byte (values from the containers, the group's records removed, the
containers removed, key order kept), as it does for admissions today. `mergeReported` = strip (restore, drop
`reported.*` lineage) → re-apply C1 → apply the newest groups from `data/cds-records/`. `sync-data` and
`merge-reported` call the same function, so they can't disagree.

## The lineage guard (`lib/lineage.ts#validateNewest`)
Generalized from admissions to every group in `NEWEST_GROUPS`. For each group:
1. A target cited to `college-site` has method `extracted` or `derived` and a quote, url, retrieved date, year, and
   edition.
2. A target cited to `college-site` requires the group's `keep` container.
3. Its lineage year is **newer** than the container's federal year.
4. **Atomic**: if one target (or the anchor) cites the college, every target does (the graduation rates through the
   anchor), and all carry the same year.
5. A target whose value differs from the container's must be cited to the college (no silent change).
6. A container with nothing replaced is an error (no orphan `demographics.federal`).
7. `men_share + women_share = 1` (±0.0002) when they cite the college.
8. `reported.outcomes.graduation.entering_year` equals the year of the six-year rates shown beside it.
9. Overrides can't set a target path (`lineageForPatch`).

`lineageFor` fills `Cited.replaces` for every group from its container (the year label from the container: "Fall
2024", "Entered fall 2018"), and `Cited.replaces.value` widens to `number | Record<string, number> | null` for race.
`Cited.sourceKind` is `"cds"` for these paths, and the new `Cited.edition` comes from the record.

## History and trends
**History stays federal**, as round 2 decided for admissions: the "Over time" charts for undergrads, men's share,
part-time share, race and ethnicity, and Pell graduation end on the federal year while the headline may be a year
newer. No CDS point is added to any series: the national middle-half bands and the Home facts' fixed panels need one
source per year, and a CDS point at a few hundred colleges would put a one-year step in every band.

**The latest-point check (rule 1) gets stronger, not weaker.** Today `lastPointMismatches`
(`scripts/history/build.mts`) skips any value with a lineage record, so a replaced college would simply not be checked.
Instead, for the newest groups' series it compares the history's last point with the **kept federal value**:
`undergrads`, `men_share`, `part_time_share`, and every `race_*` series with `demographics.federal` when present (else
the shown value, as today). `gradByGroupMismatches` (`scripts/history/graduation-groups.mts`) **doesn't skip lineage at
all today**, so without this change every replaced college would fail it; it compares `grad_rate_pell`,
`grad_rate_no_pell_no_loan`, and both cohort series with `outcomes.federal.graduation` when present. Retention has no
series. A test breaks each comparison (compare with the shown value instead) and sees rule 1 fail.

**`school.trends` is unchanged**: computed from history, so `trends.diversity`, `trends.men_share`,
`trends.undergrads`, and `trends.pell_gap` stay federal at both ends.

**The diversity trend indicator** ([trend-indicators.md](../trend-indicators.md)) keeps its federal measure, bands, and
filter. One visible fix: that spec promises the indicator's end value equals the diversity index on the profile, which
stops being true when race is replaced (the Students card shows the CDS fall's index right above its ten-year line).
When `demographics.federal` exists, `detailText` names the end fall ("index 0.63 → 0.77, fall 2014–2024"), on the
History card tile, the Students card's ten-year line, Explore cards, and Compare's "10-year direction" table, so the two
numbers aren't read as one. The same function should name the end fall for selectivity when `admissions.federal`
exists (the same gap has existed since round 2).

**Home**: the "What's changed" facts (`data/history/facts.json`, fixed federal panels) are untouched. The stat strip's
undergraduate total, the "Largest enrollment" leaderboard, and the "Most diverse" lens read the dataset, so they use
the newest values, like the admissions figures since round 2; `MultiSourceNote` already cites a mix of sources and
years.

## Display
Quiet, as round 2 decided: no chips, no banners, no "federal data" lines under figures; the ⓘ popover carries the
source, edition, year, quote, link, retrieval date, and the replaced figure.

**Profile, Students** (`/schools/{id}/students`): nothing new on the page. Campus size, the race and ethnicity chart and
diversity index, and the "Who they are" bars show the newest values. Their ⓘ says, for example, "Reported by Cornell
University in its Common Data Set 2025–26 (fall 2025, degree-seeking undergraduates). Federal data, fall 2024: 45.4%."
For race the replaced line lists the seven federal shares in the chart's order.

**Profile, Outcomes** (`/schools/{id}/outcomes`):
- "Staying and finishing": the retention figure shows the newest value; ⓘ "Reported by {college} in its Common Data
  Set {edition}: {retained} of the {cohort} first-time, full-time students who entered in {entering term} returned the
  next fall. Federal data, {federal year}: {rate}."
- "Graduation by group": the Pell/loan dot plot shows the newest class. **New**: when `reported.outcomes.graduation`
  exists, each group's row gets a second, lighter mark for "within 4 years" on the same scale, its value printed
  beside it, and the card's headline sentence becomes "Of 100 Pell Grant recipients who entered in {entering term}, {n4}
  finished within 4 years and {n6} within 6." (years from lineage). The legend's "within 4 years" carries the
  `on-time-graduation` term, which holds the caveat: "First-time, full-time students who started a bachelor's degree;
  the college's own count from its Common Data Set. The 6-year rate counts the same students two years later." The
  5-year shares are stored and shown only in Compare's table and the dot's tooltip. Groups under 30 read "Not shown:
  under 30 students", as now.
- The race dot plot stays on Scorecard's class (entered fall 2018); its overall line reads
  `outcomes.federal.graduation.grad_rate_ftft` when the Pell plot was replaced, so it always describes the race rates'
  class. Each plot is cited on its own, so the two years show.
- "8 years later" and "How long it takes" (OM, all entering students) are unchanged: a different population, kept on
  its own card so two different "within 4 years" figures never sit side by side.

**Overview cards**: the Students card's undergraduates and diversity index and the Outcomes card's retention show the
newest values; the Students card's ten-year line names its end fall as above.

**Compare**: existing rows (undergraduates, men / women, part-time, race groups, retention, Pell and neither
graduation, the Pell gap) show the newest value with the muted year round 2 built for a cell whose year differs from
its row's usual one. New rows in "All the numbers" → Outcomes: "Finished within 4 years: Pell recipients", "…: neither
Pell nor subsidized loan", "…: all first-time full-time", and the same three for 5 years; "Not published" for a college
without them; no "Highest" flags.

**Explore**: no new filter, sort, or column. The 4- and 5-year shares are partial and self-reported, so they're never
ranked, filtered, or used in medians or percentiles (a "has data" filter would answer no family question). The existing
filters and sorts that read replaced fields (gender balance, mostly full-time, size, diversity, the Pell gap, "Pell
students graduate at the same rate") use the newest values, as admissions do since round 2.

**Planning tools**: none consume these in this build. The four-year totals in
[net-price-estimator.md](../product/net-price-estimator.md) and
[award-letter-analyzer.md](../product/award-letter-analyzer.md) could later cite the 4-year share by Pell group
("{n} of 100 Pell Grant recipients here finish in four years").

**Data page**: "Newer figures from colleges" counts colleges with a newer enrollment, race, retention, and graduation
class, beside the admissions count.

**Glossary** (`lib/glossary.ts`): new `on-time-graduation`; `retention-rate`, `pell-graduation-gap`, and
`degree-seeking` gain one sentence each ("The newest figure may come from the college's own Common Data Set, a year
newer than federal data; the ⓘ shows which.").

## Keep history?
**None.** These measures already have long federal series with the same definitions (undergrads and men's share from
1996, race from 2010, Pell graduation from the class of 2010); a CDS value is the next point early, and federal data
replaces it a year later. Storing CDS points would duplicate the federal series with a second source.

**Backfill past editions: no.** Index pages list 10–25 past PDFs at many colleges (Georgia Tech 25, TCU 25, Harvard 19),
but every past year of these items is already in federal history with the same definition, so past editions add
nothing the charts lack. The 4-year rate by Pell group has no federal series, but one class per college beside the
6-year rate is enough; a series of it fails the "Deciding on history" bar (no comparable yearly federal file).

## Top-level trend?
- **Hero indicator: no.** No new measure; the diversity indicator stays federal (above).
- **Home fact: no.** Fixed panels need one source per year.
- **"Known for": no new standout.** "Pell students graduate at the same rate" now reads the newest class where replaced.
- **Explore: no.** Above.
- **Over time chart: no.** History stays federal.

## Build
| File | Change |
|---|---|
| `lib/cds-sections.ts` | Group B items: the 175 codes above, B2's three sub-items, the grid headings and date text, schema version |
| `lib/cds-checks.ts` | Every check above, with ids `rows-add-up`, `unknown-gender-share`, `column-1-not-first-years`, `column-2-not-degree-seeking`, `column-3-not-all-undergrads`, `count-not-integer`, `rate-mismatch`, `previous-cohort-disagrees`, `holds-previous-cohort` (a note, not a failure), `federal-disagrees`, `edition-mismatch` |
| `scripts/lib/cds-xlsx.mts` | Readers for the B codes (code table, ANSWER SHEET fallback) and the classic layout by label + column letter |
| `lib/cds-b.ts` (new, pure) | `parseRate`; degree-seeking totals and shares from B1; the seven race groups from B2 column 2; retention; the grid's rates, cohorts, 4- and 5-year shares with the under-30 rule; `foundFromRecords(records)` → the newest passed value set per group with lineage |
| `lib/newest.ts` | `NEWEST_GROUPS`, `applyNewestGroups`, `federalYears(meta)`; `restoreFederal` undoes the groups |
| `lib/reported-merge.ts` | `mergeReported(schools, reported, records, meta)` applies C1 then the groups |
| `lib/lineage.ts` | `validateNewest` generalized (rules 1–9), `replacedBy` and `Cited.replaces` for every group, `Cited.edition`, `REPORTED_PATHS` accepting `derived`, `lineageForPatch` refusing target paths |
| `lib/fields.ts`, `lib/types.ts` | The entries and shapes above; `LineageRecord.edition`; vintage `scorecard-retention` |
| `scripts/sync-data.mts` | Probe the retention year; pass `meta` to the merge |
| `scripts/import-cds.mts`, `data/overrides.json` | Stop writing B1/B2; remove `demographics` from the 8 patches |
| `scripts/history/build.mts`, `scripts/history/graduation-groups.mts` | Rule 1 against the kept federal values |
| `lib/indicators.ts` | End fall in `detailText` when the shown value is newer |
| `components/ui/info-tip.tsx` | Edition in the source phrase; the replaced race shares |
| `components/school/GraduationByGroup.tsx`, `components/charts/GroupDotPlot.tsx` | The "within 4 years" mark and headline; the race plot's overall line from the federal container |
| Compare table config, `app/data/page.tsx`, `lib/glossary.ts` | Rows, counts, terms |
| Specs | See below |

**Tests** (each guard shown to fail when broken):
1. `tests/cds-b.test.mts`, fixtures from the four workbooks' real values: B1 sums (Vanderbilt passes; one changed cell
   fails); Illinois B2 column 3 fails `column-3-not-all-undergrads` while column 2 passes and publishes; Vanderbilt's
   B22 fails `count-not-integer`; `parseRate` gives the same rate for 0.886, "88.6%", and 88.6 and reads 63.73 and
   "91%"; a current grid equal to the previous one is `holds-previous-cohort` and not newer; Vanderbilt's previous grid
   matches its GR figures and a perturbed one fails; the subsidized-loan group of 29 is null; 4 ≤ 5 ≤ 6.
2. `tests/newest.test.mts`: each group replaces when newer and not on a tie; atomic; a school with an existing lineage
   record on a target is left alone; `restoreFederal` is byte-identical; applying twice changes nothing.
3. `tests/lineage.test.mts`: each of rules 1–9 rejects a hand-broken school (remove the atomic rule and the mixed
   graduation school passes: the test fails); `Cited.replaces` for race carries the object and the federal fall.
4. `tests/merge-reported.test.mts`: records merge into the committed file exactly; the 8 former override colleges get
   federal baselines; an override with `demographics.racial_diversity` fails `check:lineage`; `import-cds` writes no
   `demographics`.
5. History: rule 1 compares a replaced college's `men_share` and `grad_rate_pell` with the kept federal values;
   comparing with the shown value instead makes the test fail.
6. `tests/indicators.test.mts`: the end fall appears in the diversity detail only when `demographics.federal` exists.

### Changes to other specs
- [college-reported-round-3.md](../college-reported-round-3.md): Extraction scope, section B row = the 175 codes and
  checks here; the breaker counts only sub-items that feed a published value.
- [college-reported-data.md](../college-reported-data.md): "Later: B1/B2 enrollment" now points here.
- [data-lineage.md](../data-lineage.md) rule 3: the newest rule covers the groups in `NEWEST_GROUPS`, not only
  admissions; `demographics.federal` and `outcomes.federal` beside `admissions.federal`.
- [student-body.md](student-body.md), [graduation-by-group.md](graduation-by-group.md), [cost-outcomes.md](../cost-outcomes.md):
  the newest value may be the college's CDS; retention's vintage.
- [time-to-degree.md](time-to-degree.md): its follow-up "GR's fresher 4-year rate" is met for CDS colleges by the
  grid's line D (first-time full-time, by Pell group).
- [trend-indicators.md](../trend-indicators.md): the end-fall note.
- [lgbtq-life.md](../lgbtq-life.md): 2025–26 B1 has "Unknown", not "Another gender".
- [data-sync.md](../data-sync.md) (overrides): B1/B2 no longer come from overrides.

## Open questions for the owner
1. **Small groups.** ±5 points against federal will send many groups of 30–99 students to review (a few students move
   a rate several points). Keep ±5 for all, or ±10 for groups under 100?
2. **Reviewed corrections.** Vanderbilt's 0.97 is almost surely its retention rate in the wrong cell. Should a reviewer
   be able to record a correction in the record (with a note, shown in the ⓘ), or does such an item wait for next
   year's edition?
3. **Scope differences.** When a college's degree-seeking count is more than 10% below federal (Harvard −12%), and
   review finds the CDS simply counts a narrower population, show the college's figure (the rule says newest) or keep
   federal for that college?
4. **Snapshot size.** If the measured growth is over 2 MB, move the lineage records' shared `url`/`retrieved` into a
   per-college document list referenced by id (a lineage format change), or accept the size?
5. **The entering class's race** (B2 column 1) is captured. Show it later on the Students page as "this fall's
   first-years", or leave it in the records?

## Notes on the inventory
- Agree: B1/B2/B22 everywhere; B4–B11 one cohort newer with 4-year completers; the Illinois column-3 trap and
  Vanderbilt's 0.97; the three percent forms.
- Added: B2's column 2, not column 3, is the federal definition (degree-seeking), so the replacement reads column 2 and
  the column-3 check protects the record, not the site. The 8 overrides use `B.176` and column 3, off the federal
  definition.
- Added: the template allows a fall 2018 class in the fall 2019 grid; the inventory didn't flag it.
- Added: the previous grid matches IPEDS GR exactly at Vanderbilt, William & Mary, and Illinois (checked against the
  site's federal values).
- Corrected for lgbtq-life: the 2025–26 B1 third column is "Unknown" with non-binary students distributed across men
  and women.
- Not verified: which class Scorecard's latest retention describes (probe at build); why Harvard's degree-seeking count
  is 12% below federal; coverage of the B2 column-3 problem beyond Illinois.

## As built
Built 2026-10-03 on the round-3 foundation, from the four template-workbook records (Vanderbilt 221999, Cornell
190415, William & Mary 231624, Illinois 145637). Differences from the plan above are marked **Changed**.

**Where it lives**
| File | What |
|---|---|
| `lib/newest-groups.ts` (new, pure) | `NEWEST_GROUPS`, `NEWEST_TARGETS`, `federalYears(meta)`, `applyNewestGroups`, `restoreNewestGroups`, `newestGroupCitation` (`Cited.sourceKind`, `cdsEdition`, `replaces`), `validateNewestGroups` (rules 1–8). **Changed:** the spec put the table in `lib/newest.ts`; it has its own module so other display specs' edits to `lib/newest.ts` stay one line. `lib/newest.ts#restoreFederal` calls `restoreNewestGroups` first (one line), so every federal baseline in the pipeline undoes the groups too |
| `lib/cds/student-body.ts` (new, pure; the spec's `lib/cds-b.ts`) | `parseRate`, `checkB1`, `checkB2` (three sub-items), `checkRetention`, `checkGrid`, and `studentBodyFromRecord(record, federalBaseline)` → the value set per group with lineage plus every problem (check id, detail, edition). **Changed:** the section-B checks live here, not in `lib/cds-checks.ts`, and run when the value set is built; a group is offered only when its record items passed and every check here passes. The checks track can call the same functions to write statuses into the records |
| `lib/reported-merge.ts` | `mergeReported(schools, reported, records = [], meta?)`: strip (restores groups and admissions) → C1 → the newest groups. Without `records` and `meta` it applies no groups (old callers unchanged) |
| `lib/lineage.ts` | `validateSchool` runs `validateNewestGroups`; `lineageFor` spreads `newestGroupCitation`; `lineageForPatch` refuses a group's path (rule 9); `validateOverrides` (run by `check:lineage`); `Cited.replaces.value` widened to objects; `Cited.cdsEdition` (**Changed** from `edition`: the citation guard forbids `.edition` in UI code) |
| `lib/types.ts`, `lib/fields.ts` | `FederalDemographics`, `FederalOutcomes`, `ReportedOutcomes`, `GradAidGroup`; `demographics.federal`, `outcomes.federal.retention`, `outcomes.federal.graduation`, `reported.outcomes.graduation` registered; `outcomes.retention_rate` on vintage `scorecard-retention` |
| `scripts/sync-data.mts` | Probes the retention year (`student.retention_rate.four_year.full_time`, key N → "Entered fall N − 1"); builds meta before the merge and passes the records |
| `scripts/merge-reported.mts`, `scripts/check-lineage.mts` | Pass `data/cds-records/` and meta; check `data/overrides.json` |
| `scripts/import-cds.mts`, `data/overrides.json` | B1/B2 no longer imported; `demographics` removed from all 8 patches |
| `scripts/history/build.mts`, `scripts/history/graduation-groups.mts` | Rule 1 against `demographics.federal` and `outcomes.federal.graduation` |
| `lib/indicators.ts` | `Indicator.endFall`; `detailText` adds "(to fall 2024)" for diversity (and selectivity) when the shown value is newer |
| `components/ui/info-tip.tsx` | "Reported by X in its Common Data Set 2025–26 (fall 2025)."; replaced race shares in the chart's order; percent formatting by path |
| `components/charts/GroupDotPlot.tsx`, `components/school/GraduationByGroup.tsx` | `secondary` mark ("within 4 years"), the headline sentence, the legend with the `on-time-graduation` term, the race plot's overall line from `outcomes.federal.graduation` |
| `app/compare/page.tsx`, `app/data/page.tsx`, `app/schools/[id]/students/page.tsx`, `lib/glossary.ts` | Six 4/5-year rows; counts per group; a cited ⓘ on Campus size; `on-time-graduation` and the three sentences |
| `data/meta.json`, `data/release-calendar.json` | `scorecard-retention`: "Entered fall 2023" (the probe: Scorecard key 2024 equals `latest` at all 8 former override colleges) |
| `tests/cds-student-body.test.mts` | Tests 1–6 of the plan in one file (plus the updated `lineage`, `merge-reported`, `profile-topics` tests) |

**Lineage years.** Enrollment and race: the record's fall ("Fall 2025"). Retention: "Entered fall 2024". Graduation and
the 4/5-year shares: "Entered fall 2019" (edition − 6; − 7 when the grid holds the previous cohort). Every record
carries `edition: "2025–26"` and the cell; quotes join the printed cells a value was computed from (≤ 160 characters).

**The former overrides.** The 8 colleges' federal enrollment and race were put back in `data/schools.json` from the
College Scorecard API (the values `sync-data` builds: `latest.student.size`, `raceShares`) rather than by a full
`sync-data` run; Berkeley's override race shares equalled Scorecard's, the other seven differed.

**What the four records give** (`npm run merge-reported`):
| College | Enrollment, race (fall 2025) | Retention (entered fall 2024) | Graduation (entered fall 2019) |
|---|---|---|---|
| Vanderbilt | 7,355 (federal fall 2024: 7,208) | Review: B.2201 holds 0.97 (`count-not-integer`) | Review: Pell cohort 270 vs federal 244 (+10.7%, `federal-disagrees`) |
| Cornell | 15,979 (federal 15,995; the override's 16,138 was B.176) | 97.8% (federal 98.4%) | Replaced, with 4- and 5-year shares: Pell 78% / 86% / 89% |
| William & Mary | 6,941 (federal 7,055) | 95.3% (federal 94.6%) | Review: subsidized-loan cohort 178 vs federal 229 (−22%) |
| Illinois | 37,562 (federal 36,258) | 95.3% (federal 94.8%) | Review: Pell cohort 2,160 vs federal 1,913 (+12.9%) |

The ±10% cohort rule sends three of the four grids to review although each one's previous grid matches IPEDS GR
exactly: Pell and loan groups move more than 10% between classes. See open question 6.

**Size.** `data/schools.json` grew 11,880 bytes for the four colleges (12,381,769 → 12,393,649 after the baselines):
about 2.0 KB for enrollment and race only (Vanderbilt), 2.4 KB with retention, 3.5 KB with every group (Cornell). At
~700 CDS colleges that is about 2–2.5 MB, over the 2 MB line of open question 4.

**Verified** in the running app (`DATA_SOURCE=json npm run dev`): `/schools/221999/students` shows 7,355 undergrads,
47% men, the CDS race shares; each ⓘ reads "Reported by Vanderbilt University in its Common Data Set 2025–26 (fall
2025)" with "Federal data, Fall 2024: 7,208" (race lists the seven federal shares); the diversity index cites the same
document; the overview's ten-year line ends "(to fall 2024)". `/schools/190415/outcomes`: retention 98% with "Federal
data, entered fall 2023: 98%"; "Of 100 Pell Grant recipients who entered in fall 2019, 78 finished within 4 years and
89 within 6." with the lighter 4-year marks. `/compare?ids=221999,190415`: the replaced rows carry the muted year,
"Finished within 4/5 years" rows read "Not published" for Vanderbilt.

**Not built.** The ⓘ for retention doesn't compose the "{retained} of the {cohort} … returned the next fall" sentence
(the quote shows both counts). The checks don't yet read stated dates in B1 ("October 15, 2025"); B22's quotes are
checked for the fall they name (`edition-mismatch`). PDF and HTML readers for section B and the review queue
(`ReviewItem` per code) belong to the round-3 pipeline tracks. Of "Changes to other specs", `data-lineage.md`,
`college-reported-data.md`, `data-sync.md`, and `sources-and-citations.md` are updated, and `lgbtq-life.md` already
says the 2025–26 third column is "Unknown"; the round-3, student-body, graduation-by-group, cost-outcomes,
time-to-degree, and trend-indicators notes are left for the coordinator's spec pass.

**Open question 6 (new).** Keep ±10% for each shown group's cohort against federal, or check the total cohort only
(±10%) when the previous grid matches IPEDS GR? Today only Cornell's graduation class publishes.

## Roadmap entry
- slug: cds-student-body-and-outcomes
- summary: Enrollment, gender balance, race and ethnicity, retention, and graduation by Pell status a year newer than federal data for colleges that publish a Common Data Set, plus how many in each group finish in four years.
- complexity: 3 — Extends the newest-everywhere rule from admissions to demographics and outcomes (shared code in lib/newest.ts, the lineage guard, and history's checks) that later CDS specs reuse, plus four CDS items with their checks.
- after: ["college-reported-round-3"]
