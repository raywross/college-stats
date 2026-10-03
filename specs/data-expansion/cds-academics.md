# CDS Academics: Class Sizes

> Status: **planned** (2026-10-03). Wave 4. Depends on
> [college-reported-round-3.md](../college-reported-round-3.md) (the one-big-run record model: every document read
> once into `data/cds-records/<unit_id>.json`, items grouped, line-cited quotes, checks per item). Supersedes this
> file's 2026-09-28 skeleton (Vanderbilt 2024–25 research); now grounded in a CDS gap inventory (19 real 2025–26 CDS
> documents read item by item, 2026-10-03), which also added the E1/E3 curriculum items (unit U11) to this spec's
> scope. Part of [data-expansion](README.md).

## Question it answers
*How big are my classes?* Families ask this more than student-faculty ratio, and only the CDS has it. *How many
students per faculty member does the college itself report, and on what definition?* *Is there an honors program?
Can I double-major? Design my own major? Is there a required core, or is the curriculum open?*

## Source: CDS section I (faculty and class size)
| Item | What | Coverage (19 documents read) | Extraction notes |
|---|---|---|---|
| **I.301–I.307** | Undergraduate class **sections** by size: 2–9, 10–19, 20–29, 30–39, 40–49, 50–99, 100+ | **All 19.** "Present and clean in all 19 documents read; the cleanest CDS table in every format" (inventory §4) | A plain ordered list of 7 numbers; survives `pdfPages` with no column loss (unlike the checkbox grids). LUC prints its total as `##` (Excel overflow), so the total must be summed from the 7 parts, not read as printed, there and anywhere else it recurs |
| **I.308** | Sections total | All 19 | Check: equals the sum of I.301–I.307 (below) |
| **I.309–I.315** | Undergraduate class **subsections** by size (labs, discussions): same 7 bins | All 19 (counted separately from sections; e.g. Vanderbilt 254 vs. 1,809 sections) | Same extraction as sections |
| **I.316** | Subsections total | All 19 | Check: equals the sum of I.309–I.315 |
| **I.201** | Student-to-faculty ratio ("N to 1"), the fall the edition names (e.g. "Fall 2025 Student to Faculty ratio" is the item's own label in the 2025–26 template) | All 19 **except UW–Eau Claire, which leaves it blank** (`status: "blank"`, not an error) | A single number; survives `pdfPages` |
| **I.202** | — based on how many students | Same as I.201 | |
| **I.203** | — and how many faculty | Same as I.201 | |
| I.101–I.130 | Instructional faculty FT/PT/total by sex, race, terminal degree | All T5 | **Skip.** Overlaps [faculty.md](faculty.md); IPEDS SAL (salary) and Scorecard HR (full-time share) already cover what the site shows, and this spec does not read I-1 |

**I-2's definition, verbatim from the template's own Definitions sheet** (so the glossary states it exactly, not a
paraphrase): *"Report the Fall 2025 ratio of full-time equivalent undergraduate and graduate students (full-time plus
1/3 part time) to full-time equivalent instructional faculty of undergraduate and graduate students (full-time plus
1/3 part time). In the ratio calculations, exclude both faculty and students in stand-alone graduate or professional
programs such as medicine, law, veterinary, dentistry, social work, business, or public health in which faculty teach
virtually only graduate level students."* This is **not** the federal ratio the site already shows
([student-faculty-ratio.md](student-faculty-ratio.md), IPEDS EF part D `STUFACR`, which also excludes
graduate-only-serving staff but is computed by NCES from a different enrollment/staffing file, not from the college's
own FTE arithmetic). The two numbers disagree at several colleges in the sample for exactly this reason, not because
one is wrong: **Harvard 11 (CDS) vs. 7 (federal); Michigan 15 vs. 11.** Do not treat a gap as an error.

**I-3's definitions** (same sheet): a **class section** is "an organized course offered for credit, identified by
discipline and number, meeting at a stated time or times in a classroom or similar setting, and not a subsection such
as a laboratory or discussion session... at least one degree-seeking undergraduate student enrolled for credit,"
excluding distance-learning and noncredit classes, independent study, internships, and one-on-one instruction. A
**class subsection** is "any subsection of a course, such as laboratory, recitation, and discussion subsections that
are supplementary in nature and are scheduled to meet separately from the lecture portion."

## Source: CDS section E (academic offerings and policies)
### E1 — special programs beyond what the site already shows (U11, high–medium for the three most-asked, low for the rest)
The site already shows three of the template's 19 checkboxes from IPEDS IC, not the CDS
([campus-services.md](campus-services.md), `campus.programs`): study abroad (E.115), undergraduate research (E.117),
and the program for students with intellectual disabilities (E.102). This spec adds the other **13**:

| Code | Program |
|---|---|
| E.101 | Accelerated program |
| E.103 | Cross-registration |
| E.104 | Distance learning |
| E.105 | Double major |
| E.106 | Dual enrollment |
| E.107 | English as a Second Language (ESL) |
| E.108 | Exchange student program (domestic) |
| E.110 | Honors program |
| E.111 | Independent study |
| E.112 | Internships |
| E.113 | Liberal arts/career combination |
| E.114 | Student-designed major |
| E.116 | Teacher certification program |
| E.118 | Weekend college |

Coverage: asked of all T5 and read wherever checked in the full 19-document sample (inventory §2, row E1). **E.109**
(external degree program) and **E.119/E.120** (other, specify) are in the template but not in this scope: free text or
near-universally blank, low decision value (inventory's "not worth a spec" list).

**The checkbox rule: blank ≠ no.** Cornell's 2025–26 file leaves study abroad and undergraduate research unchecked
(E.115, E.117) despite running both — a respondent left a box blank rather than typing "no." The same applies to every
E1 program. **Only ever store and show "offered" facts. Never show, store, or imply "not offered."** A program this
spec doesn't see checked is simply absent from the record — not a stored `false`, not a "Not offered" chip, not a
"no" in Explore. (This is stricter than the federal IC checkboxes the site already reads in
[campus-services.md](campus-services.md), where an unticked box is a real "Implied no" in IPEDS's own coding and the
UI still only shows "Not listed," never "No" — CDS checkboxes carry no such federal convention and a college fills
out its own CDS without that discipline, per the inventory's repeated finding.)

### E3 — required core curriculum areas (medium-low)
| Code | Area |
|---|---|
| E.301 | Arts/fine arts |
| E.302 | Computer literacy |
| E.303 | English (including composition) |
| E.304 | Foreign languages |
| E.305 | History |
| E.306 | Physical education |
| E.307 | Humanities |
| E.308 | Intensive writing |
| E.309 | Mathematics |
| E.310 | Philosophy |
| E.311 | Sciences (biological or physical) |
| E.312 | Social science |

Coverage: asked of all T5; read wherever checked in the 19-document sample. **E.313/E.314** (other, describe) are free
text, out of scope. Same blank-≠-no rule: an E3 area with nothing checked is not stored as "not required." A document
where **every** E3 box is blank (MIT, Brown, per the inventory) gets a distinct, intentional reading: **open
curriculum** — no college-wide required core — shown only when the section itself was read (`status: "passed"` for
the E group, not `absent`), so a document we never reached is never mistaken for an open-curriculum college.

## Years
- **I-2, I-3:** the fall the item's own label states (e.g., "Fall 2025" in the 2025–26 edition) — the same current-fall
  snapshot as section B enrollment, not an "entering class" year like C1. Lineage year is read from that label text on
  the cited line, never assumed from the document's edition name alone (the inventory's "Edition and year traps": USC
  and Loyola Chicago print "Common Data Set 2024-2025" in page *headers* of their 2025–26 files, so the edition and
  the year must come from the item text, not the header).
- **E1, E3:** not tied to a cohort. Lineage year is the edition's academic year (e.g., "2025–26") — "as of this
  catalog," like a policy, not a measured population.

## Checks
Per [college-reported-round-3.md, Decision 9](../college-reported-round-3.md#decision-9-checks-for-every-item-including-deterministic-reads-publish-and-escalate-per-item):
every value passes the **universal** checks (the number is on its cited line; the cited line is in the document; the
stated edition matches the one filed; counts ≥ 0) plus these item checks:

| Items | Check | On failure |
|---|---|---|
| I.301–I.307 vs. I.308 | Sum of the 7 bins equals the stated sections total, **within ±1** (rounding; LUC's `##` overflow means the total must be summed from the parts regardless of what's printed) | Review |
| I.309–I.315 vs. I.316 | Same, for subsections | Review |
| I.201 vs. I.202 ÷ I.203 | The stated ratio is within 0.5 of the computed one (internal consistency — a wrong digit in the college's own file, as other sections of the inventory found real errors in colleges' own numbers) | Review |
| I.201 | **No check against the federal ratio** (`academics.student_faculty_ratio`, IPEDS EF-D). The definitions differ — CDS counts FTE by the college's own 1/3-part-time rule and excludes different stand-alone programs than NCES does — so a gap is expected, not an error. **This corrects round-3's draft universal-check list**, which proposed "I-2 ratio within 2 of federal"; that tolerance would flag Harvard (11 vs. 7) and Michigan (15 vs. 11) on real, correctly-reported numbers | Never fails on disagreement; `blank` (not a check failure) at UW–Eau Claire |
| E1, E3 marks | The cited line contains the item's own label text beside a mark (a checkbox glyph, "X", "x", "✔", a ticked PDF form value, or an Excel code-table "Very Important"-style literal for the item) | A mark that can't be tied to its label by position (lost column) escalates once to Sonnet 5 (layout re-read), same as C7/F2/H14 elsewhere in round-3 |

No item here is checked against a federal field: none of I-2, I-3, E1, or E3 has a federal counterpart with the same
definition (I-1 is skipped; J is skipped as redundant with IPEDS Completions).

## Store
Additive only — nothing here replaces a federal value (the newest-everywhere rule,
[college-reported-round-2.md, Decision 1](../college-reported-round-2.md#decision-1-show-the-newest-figures-we-have-everywhere),
does not apply: no field here shares a definition with an existing federal field). Shown alongside, cited to the
college, exactly like `aid.cds` ([cost-outcomes.md](../cost-outcomes.md)) sits beside the federal aid figures today.

```ts
// lib/types.ts, ReportedData
export interface ReportedData {
  admissions?: ReportedAdmissions;
  academics?: ReportedAcademics;          // new
}

export interface ReportedAcademics {
  class_sections?: {
    /** I.301–I.307: 2-9, 10-19, 20-29, 30-39, 40-49, 50-99, 100+. */
    sections: [number, number, number, number, number, number, number];
    sections_total: number;               // I.308
    subsections: [number, number, number, number, number, number, number];   // I.309–I.315
    subsections_total: number;            // I.316
    /** The fall the item labels itself with, e.g. "Fall 2025". */
    term: string;
  } | null;
  /** The college's own figure, by its own CDS definition (never compared to academics.student_faculty_ratio). */
  student_faculty_ratio?: {
    ratio: number;                        // I.201
    students: number;                     // I.202
    faculty: number;                      // I.203
  } | null;
  /**
   * Only programs the college marked. A key present means "offered"; a key the college left blank is simply absent
   * — never stored as `false` (blank ≠ no). `status` on the E group tells a UI whether the section was read at all.
   */
  programs?: Partial<Record<CdsProgramKey, true>>;
  /** Same rule: a key present means the college checked that core area as required. Absent ≠ not required. */
  core_curriculum?: Partial<Record<CdsCoreAreaKey, true>>;
}

export type CdsProgramKey =
  | "accelerated" | "cross_registration" | "distance_learning" | "double_major" | "dual_enrollment" | "esl"
  | "exchange" | "honors" | "independent_study" | "internships" | "liberal_arts_career"
  | "student_designed_major" | "teacher_certification" | "weekend_college";

export type CdsCoreAreaKey =
  | "arts" | "computer_literacy" | "english" | "foreign_languages" | "history" | "physical_education"
  | "humanities" | "intensive_writing" | "mathematics" | "philosophy" | "sciences" | "social_science";
```

Field registry (`lib/fields.ts`, the existing `reported()` helper, topic `"academics"`, source `"college-site"`,
vintage `null` — the year lives in each value's lineage record, like `reported.admissions.*` today):
- `reported.academics.class_sections`
- `reported.academics.student_faculty_ratio`
- `reported.academics.programs`
- `reported.academics.core_curriculum`

Each stored value needs an `extracted` lineage record (quote, URL, retrieved date, year); the records validator
(`validateCdsRecords`, round-3 Decision 2) requires a quote and page/cell for every value in the staging store before
anything here is merged out of it. Unlike `reported.admissions`, there's no `applyNewest`-style merge step: a passing
record's values are copied straight into `school.reported.academics.*` (`lib/reported-merge.ts`), the same way
`aid.cds` is populated today — nothing in `school.academics.*` (the federal fields) is ever touched.

**Never** used in ranks, medians, or Explore percentile comparisons while coverage is partial (same rule as every
other Wave-4 CDS field).

## Display
- **Profile, Academics page** (`/schools/{id}/academics`):
  - **Class sizes block.** Headline "**59% of classes have fewer than 20 students**" (sections under 20 ÷
    `sections_total`, computed in code — `academics.ts#classSizeShareUnder20`, never stored) over a 7-bar histogram of
    `class_sections.sections` (one bar per bin, I.301–I.307). A standing caveat sits with the histogram, not hidden in
    a tooltip: *this counts class **sections**, not students — a lecture of 300 is one section, so a student is more
    likely to sit in a large class than the section-level share suggests.* No subsections chart on the profile (the
    data is stored and citable, but sections are the question families actually ask); subsections are available in
    "All the numbers" on Compare if useful later.
  - **Student-to-faculty ratio**, next to the existing EF-D tile from [student-faculty-ratio.md](student-faculty-ratio.md):
    when `reported.academics.student_faculty_ratio` exists, a second line under the federal figure reads "*The college
    also reports 8 to 1 in its Common Data Set (7,190 students, 935 faculty)*," cited separately, with the glossary's
    CDS definition one tap away. **Never merged with the federal figure, never flagged as a discrepancy** — the two
    numbers measure different things by design (see Checks). If only the CDS figure exists (shouldn't happen: EF-D
    covers nearly every college) it still shows on its own, labeled as the college's own figure.
  - **Programs & curriculum block.** A chip row for every `programs` key present (plus the three already shown from
    `campus.programs` — study abroad, undergraduate research — so a reader sees the full picture in one place, each
    chip cited to its own source). Chips read as facts, not checklists: "Honors program," "Double major," never a
    grayed-out "No weekend college." Beneath the chips, the required core: a short list of the `core_curriculum` keys
    present ("Requires: English composition, math, a lab science, a foreign language…"), or, when the E group was read
    and nothing was checked, "**Open curriculum** — no college-wide required core."
- **Compare:** a new row, **"Classes under 20 students,"** in "All the numbers" — the same derived share as the
  profile headline, one cell per school, "–" where a school has no `class_sections` record.
- **Explore:** no filter for class sizes (partial coverage, same as before). One new filter from the `programs` field:
  **"Has an honors program"** (`honors=1`) — **positive only**, following the checkbox rule: there is no "no honors
  program" option, because a blank really can mean "has one but didn't check the box." The filter can only ever
  narrow toward colleges the agent found evidence for, never away from them. Other `programs`/`core_curriculum` keys
  are stored and available on the profile from day one but get Explore filters later only if coverage and demand
  justify it (same bar as every partial-coverage Wave-4 field).
- **Glossary:** new entries —
  - `cds-student-faculty-ratio`: the verbatim CDS definition (above), explicitly contrasted with `student-faculty-ratio`
    ("a different number than the federal ratio shown elsewhere on this page, because the two are defined
    differently — not because one is wrong").
  - `class-section` / `class-subsection`: the verbatim definitions (above), with the "sections, not students" caveat
    repeated.
  - `open-curriculum`: what it means when a college reports no required core.
  - Each program chip label (honors program, double major, etc.) is plain English and doesn't need its own glossary
    entry; `related` links from `cds-student-faculty-ratio` to the existing `student-faculty-ratio` term.

## Keep history?
- **Class sections: series per CDS edition** for the under-20 share, once 2+ editions exist for a college (the
  round-3 archive and `data/cds-records/` keep every edition read). **Low priority**, per the README's bar: it needs
  several years of editions per college before a line chart is worth drawing, and the agent has only ever read one
  edition so far. No backfill of older editions in this spec; round-3's open question 2 (archiving prior editions)
  decides whether that becomes possible later.
- **Student-faculty ratio (CDS figure): none.** The federal series already charts this trend
  ([student-faculty-ratio.md](student-faculty-ratio.md), fall 2009 on); a second, differently-defined series on the
  same chart would confuse more than it clarifies.
- **Programs and core curriculum: none.** Checkbox lists are self-reported and inconsistently filled year to year
  (blank ≠ no in each edition, not just once); a "dropped" event could just as easily be "stopped checking the box."

## Top-level trend?
**None.** A later candidate, only once coverage is broad enough to set a percentile: "Known for: small classes"
(sections under 20 at the national top of the distribution), the same bar [student-faculty-ratio.md](student-faculty-ratio.md)
set for its own "Known for" standout.

## Build
- **`lib/types.ts`**: `ReportedAcademics`, `CdsProgramKey`, `CdsCoreAreaKey` (above), added to `ReportedData`.
- **`lib/fields.ts`**: the four `reported.academics.*` paths via the existing `reported()` helper.
- **`lib/cds-sections.ts`** (new in round-3; this spec is one of its contributors): I.201–I.203 and I.301–I.316 join
  group **`IJ`** (faculty and class size); E.101–E.120 (minus E.109, E.119, E.120) and E.301–E.314 (minus E.313/E.314)
  join group **`DEF`** (academic offerings, alongside this wave's D-transfer and F-student-life items). Each item's
  code, label-match patterns (for Excel), and the checks above.
- **`lib/cds-checks.ts`** (new in round-3): the sum-within-±1 and ratio-internal-consistency checks; explicitly *no*
  federal-agreement check registered for I.201 (so a future contributor doesn't re-add round-3's draft tolerance).
- **`lib/academics.ts`**: `classSizeShareUnder20(sections: number[])`, `classSizeShareOver50(sections)` (pure,
  derived — never stored), `hasCdsProgram(programs, key)`.
- **`lib/reported-merge.ts`**: copy a passing document's `IJ`/`DEF` class-size, ratio, program, and core-curriculum
  values into `school.reported.academics.*` (no `applyNewest`-style replace; nothing in `school.academics.*` changes).
- **`components/profile/`**: `ClassSizeHistogram` (7-bar, the under-20 headline, the sections-not-students caveat),
  a `ProgramChips` row (merges `reported.academics.programs` with the existing `campus.programs` study-abroad/
  undergrad-research chips into one cited list), a core-curriculum line, and the second student-faculty-ratio line
  on the existing ratio tile from [student-faculty-ratio.md](student-faculty-ratio.md).
- **`app/compare/page.tsx`**: one new `TABLE_ROWS` entry, "Classes under 20 students."
- **`lib/params.ts` / Explore filter panel**: `honors=1`, positive-only (no corresponding "exclude" state).
- **`lib/glossary.ts`**: `cds-student-faculty-ratio`, `class-section`, `class-subsection`, `open-curriculum`.
- **Tests** (`tests/cds-academics.test.mts`), each guard shown to fail when broken:
  1. The sections-sum check fails when the 7 bins don't add to the stated total beyond ±1; passes within it.
  2. I.201 is never flagged by a federal-agreement check — a fixture with CDS 11 and federal 7 (Harvard's real
     numbers) publishes clean; removing the "no federal check" guard and reintroducing round-3's draft tolerance
     makes this test fail, proving the guard matters.
  3. A `programs`/`core_curriculum` key is only ever `true` or absent — the type and a runtime assert reject `false`;
     an unchecked E1/E3 item never renders "not offered" anywhere in `components/profile/ProgramChips.tsx`.
  4. Open curriculum shows only when the E group's `status` is `"passed"` with zero keys set, never when the group is
     `"absent"` (a document never reached for that college).
  5. The Explore `honors=1` filter only ever narrows the result set toward colleges with the key present; there is no
     code path that excludes a college for *not* having it.
  6. `classSizeShareUnder20` is pure and matches the Vanderbilt worked example (489 + 605) ÷ 1,843 ≈ 59%, once
     `class_sections` is populated from a fixture record.

## Open questions for the owner
1. Should the "Classes under 20" Compare row also show subsections, or stay sections-only as the profile does (this
   spec recommends sections-only, to match the one question families actually ask)?
2. Once coverage is broad, is "small classes" worth a dedicated Explore sort, or does the Compare row and profile
   histogram cover the need without one?

## Roadmap entry
- slug: cds-academics
- summary: Class sizes by section size, the college's own student-faculty ratio, and program/curriculum facts (honors,
  double major, open curriculum, and more) straight from each college's Common Data Set.
- complexity: 2 — a new profile section (class-size histogram, program chips) with one Explore filter and a low-priority
  history series, built on records the one-big-run already captures; no new pipeline of its own.
- after: ["college-reported-round-3"]
