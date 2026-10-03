# CDS Application Logistics: Deadlines, Deferral, and High School Prep

> Status: **built** (2026-10-03; see [As built](#as-built) for where the build differs from the plan below and what
> waits on other work). Wave 4. Covers the inventory's **U4** (application logistics: C13 fee waiver and
> online fee, C14 regular closing/priority date, C15 other terms, C16 notification, C17 reply-by date and housing
> deposit, C18 deferred admission) and **U10** (high school preparation: C3 completion requirement, C4 college-prep
> requirement, C5 units required/recommended by subject), from the [CDS gap inventory](../../). **Blocked on**
> [college-reported-round-3.md](../college-reported-round-3.md) (the records model this spec's items extract into) and
> reads alongside [cds-admissions.md](cds-admissions.md) (same CDS section C, same extraction group; C21/C22 early-round
> dates stay there). Research basis: the gap inventory read 19 real 2025–26 CDS documents item by item
> (`cds-gap-report.md`); this spec cites its coverage counts and quotes, and invents nothing beyond them.

## Question it answers
*When's the regular deadline, and is there an earlier priority date? How will I be notified, and when must I commit?
How much is the housing deposit, and do I get it back if I don't enroll? Can I take a gap year? What high school
courses does this college expect?*

## Out of scope
C21 (early decision) and C22 (early action) — deadlines, notification, and restrictiveness for the early rounds —
stay in [cds-admissions.md](cds-admissions.md); this spec's C14/C16/C17 cover the **regular round only**. C2 (wait
list), C8 (test policy), C9–C12 (scores, rank, GPA) are cds-admissions.md's. D9 (transfer deadlines) is
[cds-transfer.md](cds-transfer.md)'s. H9–H11 (aid deadlines) and H8 (CSS Profile/noncustodial forms) are the
inventory's proposed **U5** (not yet specced); this unit never touches section H.

## Source: CDS items, by template code (2025–26 edition)
All items below are read deterministically from the 2025–26 Excel template (per-sheet code table, codes stable
across colleges — round-3 §4) and from Howard's fillable PDF form (field names match the template's "US News PDF
Tag" column). Flattened PDFs need a model; every item here is a **single-column checklist or a label/value pair**
(not a multi-column grid), so plain PDF text keeps "X Label" together and plain `pdfPages` text is enough — no
layout-aware pass or vision needed, unlike C7/C8/F3/H14 (round-3 §5, gap inventory §4 "college-reported-data.md"
correction).

### Application fee waiver and online fee (C13, partial — the fee amount itself is out of scope, already `admissions.application_fee` from IPEDS IC)
| Code | Question | Coverage (gap inventory) | Notes |
|---|---|---|---|
| C.1303 | Can the application fee be waived for applicants with financial need? | All 4 template workbooks (VU, CU, WM, IL) read; checklist survives PDF-plain everywhere | Checkbox: blank ≠ "No" (round-3 §5) |
| C.1304 | For an on-line application, is the fee the same, or different? | VU blank, CU/WM/IL "Same fee" | Single-select; free text when "different" (no separate online amount field in the template) |
| C.1305 | Can the on-line fee be waived for financial need? | CU/WM/IL "Yes", VU blank | |

### Regular deadline and priority date (C14)
| Code | Question | Coverage | Notes |
|---|---|---|---|
| C.1401 | Does your institution have an application closing date? | CU, WM, IL, HU, EC, TAMU read item-by-item (6 of 19 spot-checked; likely higher — the gap inventory didn't check every document for this item) | TAMU: "Yes" |
| C.1402/1403 | Application closing date (fall): Month / Day | Same colleges | TAMU Dec 1; CU Jan 5; WM Jan 5; **VU types the date as free text**, leaving the code cells blank — the xlsx reader must fall back to the visible form, not just the code table |
| C.1404/1405 | Priority Date: Month / Day | IL only among T5 (Nov 1) | Low coverage; most leave it blank |

### Other terms, notification, reply, housing deposit (C15–C17)
| Code | Question | Coverage | Notes |
|---|---|---|---|
| C.1501 | Are first-time, first-year students accepted for terms other than fall? | All T5, EC | **Store only, never displayed** (gap inventory U4: "low" value) |
| C.1601–1608 | Notification: (a) rolling basis beginning (date), (b) by (date), (c) other, with a free-text line | All T5, EC (rolling from 8/15) | Single-select, one mark per row; W&M's "Other:" cell holds the Excel serial `46113` (see [Date handling](#date-handling)) |
| C.1701–1712 | Reply policy: (a) must reply by (date), (b) no set date, (c) must reply by May 1st or within __ weeks if notified later, (d) other; then housing deposit deadline (month/day), amount, and whether it's refundable | All T5, EC | WM deposit $350 (due 5/1, non-refundable); HU $500; IL has free text in the amount cell ("varies" or similar — store the quote, leave `amount` null) |

### Deferred admission / gap year (C18)
| Code | Question | Coverage | Notes |
|---|---|---|---|
| C.1801 | Does your institution allow students to postpone enrollment after admission? | All T5 | **Cornell's cell literally reads "Yes or No"** — the template's unanswered placeholder, not a value; treat as `status: "blank"`, never coerce to a boolean (round-3 §5 lists this exact string as a known trap) |
| C.1802 | If yes, maximum period of postponement | VU "2 Year" (own text), Duke "2 years" (gap inventory §2, row C18), Cornell leaves it blank along with its placeholder C.1801 | Free text ("1 year OR 2 years for U.S. Military" at one T5 college per the answer sheet): store the quote; parse a number of years/semesters only when the text is a bare count, else leave `max_postponement` as the quote with no parsed value |

### High school preparation (C3–C5)
| Code | Question | Coverage | Notes |
|---|---|---|---|
| C.301 | High school completion requirement | All 4 template workbooks | Single-select among the template's fixed options ("High school diploma is required and GED is accepted" at all 4 read) — a closed checklist, not free text, so the value is safe to store as an enum of the template's own wording |
| C.401 | Require/recommend/neither a general college-preparatory program | All 4 | VU "Require", CU "Neither", WM "Recommend", IL "Neither" |
| C.501–512 | Units **required**, by subject (total, English, math, science, of-which-lab, foreign language, social studies, history, academic electives, computer science, visual/performing arts, other) | VU and IL filled (both 12 cells); HU filled; **WM blank** (recommended only); **Cornell "-" in every cell** | VU: total 18 = English 4 + math 3 + science 3 + language 2 + social studies 2 + history 1 + electives 3 + CS 0 + arts 0 (lab's 2 is a subset of science, not added). IL: total 15 = 4+3+2+2+0+0+2+0+0, same lab-is-a-subset pattern |
| C.513–524 | Units **recommended**, same 12 subjects | VU and IL filled; HU filled; **WM fills individual recommended subjects (English/math/science/lab/language/social-studies = 4/4/4/3/4/4) but leaves the recommended total and history/electives/CS/arts blank**; Cornell "-" throughout | VU: total 21 = 4+4+4+2+3+1+3+0+0 (lab 3 again a subset of science 4) |

The inventory's spot check at Eau Claire (EC) covered C3/C4 only, not C5; no other document beyond the four
template workbooks and Howard was checked item-by-item for C5. Coverage across the full 1,893-college run is
unmeasured; expect it to track the GPA bands (C11/C12), which the inventory found blank at many selective colleges.

## Date handling
Every date in this unit — C14's closing/priority date, C16's rolling-from/by date, C17's reply date and housing
deposit deadline — is a **month/day pair with no year in the cell**, and the formats seen in the sample are, in
increasing order of difficulty:
1. **Split month/day cells** (the template's native form): two integers, e.g. month `1`, day `2`.
2. **A single free-text cell holding a date**: `"11/1"`, `"1-Nov"`, `"Nov 1st"`, `"8/1"`.
3. **An Excel serial number**, when a date was typed or pasted into a text cell Excel then reformatted: William &
   Mary's C.1608 ("Other:" under notification) holds the literal string `"46113"`. Excel's epoch is 1899-12-30, so
   serial 46113 is **April 1, 2026** — plausible as a regular-round notification date, and a believable trap: code
   that treats it as a bare number (or rejects it as out of range for a month/day pair) gets it wrong either way.
   Detect a bare integer in the few-thousand-to-sixty-thousand range in a date-typed cell and convert it; this rule
   is Excel-only (never applies to PDF or HTML text).
4. **Free text that isn't a date at all.** Duke's CDS — in its early-decision section, C21, not this unit — prints
   "First or only early decision plan closing date: 11 months 1 day" where a month/day pair was expected. No model
   or regex recovers a date from that; it is exactly the shape of error this unit's C14/C16/C17 cells can also hold
   (a durations-as-words answer, a stray note, a cross-reference to another section). The rule is the same wherever
   it happens: **store the quote always; store a parsed `{ month, day }` only when the text resolves to one
   unambiguous calendar date** (an explicit day 1–31 and month 1–12, or a name/abbreviation matched to one). A date
   that doesn't parse keeps its quote (in the field's lineage record) with `month: null, day: null` and `status:
   "failed"` on the `valid-date` check (below), not silently dropped and not guessed at.

**The cycle year.** Items C13 (fee) through C19 of a CDS describe the admissions cycle that **opens after the
edition's own current-class data**: the gap inventory confirms this for C13 directly ("CDS fee is for the fall 2026
cycle" in the 2025–26 edition, whose C1 funnel describes the fall 2025 class already enrolled). This unit's C14–C18
inherit the same one-cycle-ahead year: a 2025–26 edition's regular deadline, notification, reply date, housing
deposit, and gap-year policy describe **applying for fall 2026 entry**, read in fall 2025 by a student targeting the
following year. Every date and the deferred-admission fact in this unit is tagged `cycle: "Fall 2026"` (edition
start year + 1) in its lineage record's `year`, independent of C1's `admissions.year` (which is the edition's
*current* class, one year earlier). This differs from C8's test policy, which the inventory found describes a class
**two** cycles out (fall 2027) — don't assume every forward-looking C-section item uses the same offset; each is
checked against its own question text.

**C3/C4/C5 carry no cycle year.** They describe standing admission policy (what the college has always required of
applicants), not one entering class. Their lineage `year` is the **CDS edition label** itself ("2025–26"), the same
convention `cds` overrides already use for non-class-specific facts, not a "Fall ____" cycle string.

**No history, no rollover logic beyond replacement.** Each edition's record for this unit fully replaces the
previous one; there is no year-over-year series (see [Keep history?](#keep-history)), so there is nothing to merge
across editions — a new edition's C14 simply overwrites the old value, the way a non-replacing snapshot field
would, except there is no federal baseline underneath it to fall back to when the field is missing (unlike
`applyNewest`'s funnel, which falls back to IPEDS when the college hasn't published a newer class). A college with
no CDS this year, or whose CDS left an item blank, shows nothing for that item — never last year's now-expired date.

## Checks
Every value also gets round-3's universal checks (the number/date is on its cited line; values are within type
range). Per-item:

| Check | Applies to | Failure |
|---|---|---|
| **Valid date** | C14, C16, C17 dates | Month 1–12, day valid for that month (28–31); an unparsed free-text cell is `status: "blank"` with the quote kept, not a failure — only a cell that *looks* numeric but is out of range (e.g. day 34) fails and goes to review |
| **Regular closing on/after early closing** | C14's `regular_closing` vs. [cds-admissions.md](cds-admissions.md)'s C21/C22 closing dates, same college and cycle | When both parse and share a cycle year, `regular_closing` must be ≥ the ED/EA closing date (month/day compared within the cycle); a regular date earlier than an early one is reviewed, not published |
| **Reply on/after notification** | C17's reply date vs. C16's by-date/rolling-from date | When both resolve to a concrete date, reply ≥ notification; `may1_or_weeks` and `rolling` can't be compared numerically without a specific notification date, so the check is **skipped** (not failed) for those, and recorded as "not checkable" rather than passed |
| **One mark per row** | C3 completion, C4 college-prep, C16 notification kind, C17 reply kind (each a single-select among fixed options) | More than one option marked, or a mark under no option, fails; exactly one mark passes; zero marks is `status: "blank"` |
| **Known placeholder text is blank, not a value** | C.1801 (and the same literal elsewhere in the template, per round-3 §5) | The cell text `"Yes or No"` (case-insensitive) is `status: "blank"`, never parsed as `true` |
| **Subject total equals the sum of its parts** | C5 required total vs. English+math+science+language+social-studies+history+electives+CS+arts (lab excluded — it's a subset of science, not an addend); same check for recommended | Off by more than 1 unit: review. A blank total with filled subject cells (as at WM, recommended) computes the total from the parts instead of failing |
| **Recommended ≥ required, per subject** | Each of the 9 subjects in C5, when both columns exist for a college | Recommended < required for any subject: review (it would mean the college asks less of applicants than it requires) |
| **Lab ≤ science** | Within both the required and the recommended column of C5 | Lab units greater than science units for the same column: review |

## Store
```ts
// school.reported.admissions.logistics — the regular round's dates, deposit, and gap-year policy.
// Replaces nothing (no federal equivalent exists for any of these); null until a CDS supplies it.
reported.admissions.logistics: {
  fee: { waiver: boolean | null; online_same: boolean | null; online_waiver: boolean | null } | null;   // C.1303–1305
  regular_closing: CdsDate | null;                                                                      // C.1401–1403
  priority_date: CdsDate | null;                                                                        // C.1404–1405
  other_terms: boolean | null;                                                                          // C.1501 — never displayed
  notification: {
    kind: "rolling" | "by_date" | "other";
    rolling_from: CdsDate | null;
    by_date: CdsDate | null;
  } | null;                                                                                              // C.1601–1608
  reply: {
    kind: "fixed_date" | "may1_or_weeks" | "no_set_date" | "other";
    date: CdsDate | null;
    weeks: number | null;
  } | null;                                                                                              // C.1701–1708
  housing_deposit: {
    due: CdsDate | null;
    amount: number | null;
    refundable: "full" | "partial" | "no" | null;
  } | null;                                                                                              // C.1709–1712
  deferred_admission: { allowed: boolean | null; max_postponement: string | null } | null;               // C.1801–1802
} | null

// school.reported.admissions.hs_prep — standing admission policy, not tied to one entering class.
reported.admissions.hs_prep: {
  completion: string | null;       // C.301, the template's own wording, stored verbatim (closed checklist)
  college_prep: "required" | "recommended" | "neither" | null;   // C.401
  units_required: UnitsBySubject | null;      // C.501–512
  units_recommended: UnitsBySubject | null;   // C.513–524
} | null

interface UnitsBySubject {
  total: number | null;
  english: number | null; math: number | null; science: number | null; lab: number | null;
  foreign_language: number | null; social_studies: number | null; history: number | null;
  electives: number | null; computer_science: number | null; arts: number | null;
  other_text: string | null;   // C.512/C.524's free-text "Other" line
}

/** A month/day pair, no year (the year lives in the field's own lineage record — see "The cycle year"). Both
 *  null means the cell was free text or blank; the verbatim text is always in the lineage quote, never dropped. */
interface CdsDate { month: number | null; day: number | null }
```
Registered in `lib/fields.ts` at the object granularity shown above (10 paths under `logistics`, 4 under `hs_prep`;
a stored leaf like `housing_deposit.amount` is covered by its nearest registered ancestor, per
[data-lineage.md](../data-lineage.md)), source `college-site`, method `extracted`, each with its quote, URL,
retrieved date, and the year rule above. `ReportedData` (`lib/types.ts`) gains `admissions.logistics` and
`admissions.hs_prep` as new optional siblings of the existing `ReportedAdmissions` funnel — this is the same pattern
[cds-admissions.md](cds-admissions.md) uses for `gpa`/`factor_weights`/`early_decision`/`wait_list`, not a change to
the funnel `applyNewest` reads. **No newest-everywhere replacement**: nothing here has a federal or existing
hand-imported equivalent to replace (the application-fee *amount* does, via `admissions.application_fee`, but the
waiver/online-fee flags are new). **Never** used in ranks, medians, or Explore percentile comparisons (partial,
self-reported, exactly as the Store rules in [README.md](README.md#shared-build-rules) require for a new field).

## Display
- **Admissions topic page, a new "Applying" block** (near "Applying early", [early-decision-strategy.md](../product/early-decision-strategy.md)'s `ApplyingEarly`, in the order [school-profile.md](../school-profile.md) already lays out the admissions page): regular deadline ("Apply by {date} for fall 2026" with a priority-date note when one exists), how the college notifies ("Decisions sent on a rolling basis starting {date}" / "by {date}"), the reply-by rule ("Must reply by May 1 or within {weeks} weeks of your decision" / a fixed date), the housing deposit ("$350 due {date}, non-refundable"), and the gap-year fact ("Admitted students may postpone enrollment up to {max_postponement}" or, when not allowed, nothing — never "No" as a headline). Every figure cited through `citeField`; a sub-line omitted entirely when its item is null, never shown as "Not reported" for a block this granular. The fee-waiver flag is a short caveat line under the existing application-fee figure, not its own block.
- **Admissions topic page, a smaller "What you'll need in high school" block**, below or beside the first: the completion and college-prep requirement as plain sentences, and the required/recommended units as a small by-subject table (English, math [+ lab note], science, language, social studies, history) when C5 exists; omitted entirely when only C3/C4 exist (low value alone, per the inventory's U10 rating). This is **school-profile.md's only new display surface** for this spec; the route table there doesn't currently list an "Applying" or "high school prep" block, so that spec's admissions-page content line changes from "funnel, men and women, yield..., what they look at, the admissions map" to add ", Applying, What you'll need in high school" after "what they look at".
- **[saved-lists.md](../product/saved-lists.md) changes**: today it says deadlines come "from the college's own data when the site has it (CDS C21/C22 deadlines via cds-admissions.md)" — that's only the early-round dates. It should instead read: regular-round deadlines come from this spec's C14 (and the priority date, when one exists); early-round deadlines stay C21/C22 via cds-admissions.md; the housing deposit's due date (C17) is what populates the "Next 30 days" strip once a student's status for that college is `admitted`, alongside whichever round's deadline is still ahead of the applying/considering student. No change to the list's data model — these are display sources, not new columns.
- **No planning-calendar surface exists yet.** Nothing in [product/README.md](../product/README.md) or elsewhere in `specs/product/` names a planning calendar; the closest thing today is saved-lists' "Next 30 days" strip. If a calendar view is built later, this unit's `regular_closing`, `notification`, `reply`, and `housing_deposit` dates are exactly what it would plot (alongside C21/C22's early dates); until then they only feed the list page described above.
- **[student-profile.md](../product/student-profile.md) course planning**: that spec's "course rigor" field is currently just a count of AP/IB/dual-enrollment courses, with no per-subject tracking, so there's nothing yet for `units_required`/`units_recommended` to check against. This spec's hs_prep block is read-only context on the profile until student-profile.md (or a later revision of it) tracks courses by subject; at that point a "meets this college's recommended math units" line becomes possible from the same data, with no change needed here.
- **[early-decision-strategy.md](../product/early-decision-strategy.md) boundary**: that spec's ED/EA dates and the "Applying early" block stay sourced from cds-admissions.md's C21/C22, unchanged. One naming collision to flag for whoever writes the UI copy and glossary: saved-lists.md's application-outcome vocabulary already uses `deferred` for an ED applicant pushed to the regular round — a different thing from this unit's C18 "deferred admission" (postponing enrollment after being admitted, the gap-year case). The glossary needs two distinct terms (e.g. `deferred-decision` for the ED outcome, `deferred-admission`/`gap-year-deferral` for C18) so "deferred" doesn't read as the same concept in two different places on the site.
- **Explore**: one boolean filter, "Allows deferred admission (gap year)", from `deferred_admission.allowed`. Nothing else here clears the bar for a filter or sort (partial coverage, low standalone decision value per the inventory's "low for the rest" rating on U4, and U10's "medium-low").
- **Compare**: a "Deadlines & deposit" row (regular closing date, reply-by rule, housing deposit amount) and a "Gap year allowed" row, shown only for colleges with the data; no row for C3–C5 (too niche for a comparison table; it stays a profile-only block).
- **Glossary**: new terms `priority-date`, `rolling-notification`, `reply-by-date`, `housing-deposit`, `deferred-admission` (with the disambiguation above), `college-preparatory-program`.

## Keep history?
**None**, for both halves, matching the gap inventory's own verdict on U4 and U10. For the logistics items: each
edition's dates describe one specific, soon-irrelevant cycle (next year's "Apply by Dec 1" is a different fact, not
a new data point in the same series), and the gap-year policy and reply-date *rule* (fixed date vs. "May 1 or N
weeks") essentially never change year to year, so there's no trend worth charting. For the high-school-prep items:
they're standing policy, and a 1-unit change in a required-math figure is more likely a reporting correction than a
real change. If a college's deferred-admission *policy* itself changes (starts or stops allowing gap years), that
would be `events`-worthy ([README.md](README.md#deciding-on-history)'s "a category that changes rarely"), but
nothing in the sample showed this happening, so it's not built now — an open question below.

## Top-level trend?
**None.** No hero indicator, Home fact, or "Known for" standout: these are planning facts for one family applying to
one college, not population-level stories, and partial self-reported coverage rules out a ranked or percentile view
in Explore. Pure profile + Compare + saved-lists display, per [README.md](README.md#deciding-on-top-level-trends)'s
bar.

## Build
- **`lib/cds-sections.ts`** (round-3, new): extend section-C's item list with the codes above (`C.1303`–`C.1802`,
  `C.301`–`C.524`), their Excel code/label lookups, and the checks table; bump section C's `schema_version` so a
  `--reextract --group C` run picks them up from the archive with no refetch.
- **`lib/cds-dates.ts`** (new, pure): `parseCdsDate(raw: unknown): { month: number | null; day: number | null }` —
  handles split month/day cells, `"M/D"`, `"D-Mon"`, `"Mon Dth"` text, and Excel-serial detection (bare integer in a
  date-typed cell, converted from the 1899-12-30 epoch); returns `{ null, null }` for anything else, never throws.
  Shared by this unit and, later, D9/H9–H11 if those specs want it. Tested against every format in
  [Date handling](#date-handling), including the W&M serial and a deliberately malformed "11 months 1 day" input.
- **`lib/types.ts`**: `ReportedData.admissions` gains `logistics` and `hs_prep` (both optional, as specified above);
  new `CdsDate`/`UnitsBySubject` types.
- **`lib/fields.ts`**: register the 14 paths under `reported.admissions.logistics.*` and `reported.admissions.hs_prep.*`
  via the existing `reported()` helper; extend `ReportedValuePath` (`lib/reported.ts`) with the same paths so the
  lineage guard (`validateSchool`) covers them.
- **Merge step**: extend whatever merges round-3 records into `school.reported.*` (the mechanism Decision 2 commits
  every Wave 4 spec to building; C1 already works this way) to copy this unit's `passed` items from
  `data/cds-records/<unit_id>.json`'s section-C group into `reported.admissions.logistics`/`hs_prep`.
- **`components/school/`**: an `ApplyingBox` (the deadlines/notification/reply/deposit/gap-year block) and an
  `HsPrepBox` (completion/college-prep/units table), both added to the admissions topic page's block order in
  `lib/profile-topics.ts` (`TOPIC_FIELDS.admissions` gains the new paths, so the page's `SourceNote` and the
  overview's `PROFILE_FIELDS` list pick them up automatically).
- **`lib/glossary.ts`**: the six terms named in [Display](#display).
- **Tests**: `tests/cds-dates.test.mts` (every format, including the serial and the unparseable case);
  `tests/cds-application-logistics.test.mts` (checks table — each guard proven to fail when broken: a closing date
  before C21's ED closing fails; a reply date before notification fails when both are concrete and is *skipped*
  (not failed) for `may1_or_weeks`/`rolling`; `"Yes or No"` never becomes `true`; a blank C5 total with filled
  subjects sums correctly; recommended below required fails; lab above science fails); extend
  `tests/profile-topics.test.mts`'s "every field still shown" check for the two new blocks.

## Open questions
1. **"May 1st or N weeks" with rolling notification.** When notification is `rolling` (no fixed date) and reply is
   `may1_or_weeks`, there's no concrete notification date to add weeks to for the "reply on/after notification"
   check or for display copy ("within 3 weeks of your decision" has nothing to anchor to). Recommendation: display
   the rule as stated ("must reply within 3 weeks of notification") without computing a date, and skip the check for
   this combination, as already specified.
2. **C15 (other terms) — truly never shown?** Stored per the brief; confirm with the owner that it should stay
   store-only forever rather than surface as e.g. an Explore filter for colleges with rolling/multi-term admission,
   should that ever matter to a use case not yet specced.
3. **Deferred-admission policy changes as `events`.** Worth building once two or more editions exist for enough
   colleges to show it ever changes, or is this permanently low-value? No evidence either way in the sample.
4. **The "-" convention in Cornell's C5 cells.** Every C5 cell at Cornell reads "-"; this spec treats that as
   `status: "blank"` (unanswered) rather than 0 (no requirement in that subject), consistent with round-3's general
   blank-token list. If a larger sample shows "-" reliably means "no requirement" at Ivy-type colleges with no fixed
   HS curriculum mandate, revisit and store 0 instead of null for those cells.

## As built
Built 2026-10-03 from the round-3 records (`data/cds-records/<unit_id>.json`); live for the four template workbooks.

**What exists**
- `lib/cds-dates.ts` (pure): `parseCdsDate(raw, { excel })` on top of `lib/cds-sections.ts`'s `monthDay` (the one
  cell parser the records reader already uses; the records already store one-cell dates as `"--MM-DD"`, so W&M's
  `46113` arrives as April 1), `splitCdsDate(month, day)`, `dateCheck` (the `valid-date` outcomes: `valid`,
  `unparsed` free text, `invalid` numeric-but-out-of-range, `blank`), `cycleOrder`/`compareInCycle` (a cycle runs
  August to July, so November 1 sorts before January 5), `formatCdsDate` ("January 5"). `CdsDate` lives in
  `lib/types.ts`.
- `lib/cds/application-logistics.ts` (pure): `readLogistics(doc)` reads one document's passed items into both blocks
  and runs the checks; `logisticsFromRecord(record)` adds lineage; `mergeApplicationLogistics(school, record)` is the
  one call in `lib/reported-merge.ts`, after `mergeResidency`, idempotent. Only the **newest** document is read (a
  blank item shows nothing, never last year's date). A block whose check fails is left out and the failure recorded in
  the outcome (`regular-after-early`, `reply-after-notification` with `skipped` for not-checkable pairs, `one-mark`,
  `valid-date`, `units-sum`, `recommended-at-least-required`, `lab-within-science`); other blocks still merge. Wiring
  these outcomes into the review queue waits on the checks track (`lib/cds-checks.ts`).
- `lib/cds/application-logistics-display.ts` (pure): the "Applying" lines, the fee-waiver caveat, the high school
  sentences and unit rows, `LOGISTICS_FILTERS` (Explore `gapYear`), `compareDeadlines`/`compareGapYear`.
- `components/school/ApplyingBox.tsx` (`#applying`) and `components/school/HsPrepBox.tsx` (`#hs-prep`) on the
  Admissions page after "What they look at", side by side from `lg`, each in "On this page" only when it renders; the
  fee-waiver caveat sits under "$75 to apply". Every line is cited to its block (`MetricLabel cited`), years from
  lineage, never literals.
- Explore: "After you're admitted" → "Allows deferred admission (gap year)" (`gapYear=1`; `lib/params.ts`,
  `lib/dataset.ts`, `FilterPanel`, active-filter chip). Compare: "Deadlines & deposit" and "Gap year allowed", hidden
  when no compared college has the data, cited through two computed fields (`derived.application_deadlines`,
  `derived.gap_year_allowed`) because `tests/reported-guards.test.mts` bans `reported.admissions…` paths in
  `app/compare/`.
- Glossary: `priority-date`, `rolling-notification`, `reply-by-date`, `housing-deposit`, `deferred-admission` (with
  the ED/EA "deferred" disambiguation in its long text), `college-preparatory-program`.
- Tests: `tests/cds-dates.test.mts`, `tests/cds-application-logistics.test.mts` (each check shown failing on a broken
  record, the placeholder, lineage, idempotency, newest-only, display, Explore, Compare, partial-coverage guard);
  `tests/profile-topics.test.mts` lists the 11 displayed paths.

**Where it differs from the plan**
- Paths are `reported.admissions_logistics.*` and `reported.admissions_hs_prep.*`, siblings of
  `admissions_by_residency`, not `reported.admissions.logistics`: `reported.admissions` is the funnel
  (`ReportedAdmissions`, with required fields) that `applyNewest` and `validateNewest` read, and a CDS college can have
  logistics without a newer funnel. `ReportedValuePath` (`lib/reported.ts`) was not extended; `REPORTED_PATHS` from
  `lib/fields.ts` already puts the new paths under `validateSchool`'s guard.
- Registered paths: 10 under logistics (`cycle`, `edition`, `fee`, `regular_closing`, `priority_date`, `other_terms`,
  `notification`, `reply`, `housing_deposit`, `deferred_admission`) and 4 under hs_prep. One lineage record per
  block, cited to its first answered item; for workbook cells the quote is generated from short labels and each
  cell's printed answer ("Notified, other: ✔; Other: 46113"), since a cell alone doesn't say which question it
  answers. C.1501 has no quote in the records (store-only), so its quote is generated the same way.
- `notification` gained `other_date`/`other_text` and `reply` gained `other_text`, so the "Other:" answers (W&M's
  April 1, Cornell's "Early April") display instead of living only in the quote. `UnitsBySubject` gained
  `total_summed` (shown with an asterisk).
- `lib/cds-sections.ts` needed no change: the template already assigns these codes to call C with this spec as owner.
  C.1301/C.1302 (has a fee, amount) are read by the template but not stored here (the amount is IPEDS's
  `admissions.application_fee`).
- C3/C4 are one choice cell in the workbook, so `one-mark` applies only to C16/C17's checkboxes there.

**Real values (2025–26)**: W&M: apply by Jan 5, decisions April 1 (the serial), reply by May 1, $350 deposit due May 1
non-refundable, gap year up to "2 Year", recommended units summed to 20. Cornell: Jan 2, "Early April", May 1 or 2
weeks, $0 deposit, no C18 answer (placeholder), C3/C4 only (no high school block). Illinois: Jan 5, priority Nov 1,
reply by a set date (no date given), deposit non-refundable (amount cell says "$100 application fee", so null), gap year
"1 year OR 2 years for U.S. Military", units 15 required / 24 recommended. Vanderbilt: closing date typed as free text
outside the code cells (blank here; the reader's visible-form fallback for C14 is round-3 work), May 1 rule, gap year
allowed, units 18 / 21. Explore's gap-year chip matches 3 colleges.

**Waits on other work**: the review-queue wiring of these checks (checks track); the `regular-after-early` check
reads C21/C22 items directly from the record and will also hold once cds-admissions.md stores its early dates;
saved-lists' "Next 30 days" strip (not built) is the only consumer of the dates beyond the profile.

## Roadmap entry
- slug: cds-application-logistics
- summary: Application deadlines, how and when you'll be notified, the reply-by date and housing deposit, whether a
  gap year is allowed, and what high school courses a college expects — read from each college's Common Data Set.
- complexity: 2 — Medium: a dozen-plus new items added to an existing extraction group (section C), one new shared
  date-parsing helper, two new profile blocks, and boolean-only Explore/Compare surfaces; no new pipeline
  infrastructure (reuses round-3's groups, checks, and archive).
- after: ["college-reported-round-3", "cds-admissions"]
