# Getting Into the Major: Direct Admission, Secondary Admission, and Changing In

> Status: **idea** (2026-10-03; **rewritten** 2026-10-26 after the roadmap review as the **second wave**). The first wave
> of this idea's data is built inside Quad's estimate: `reported.major_admission[]` (`data/major-admission.json`,
> hand-curated with a quote and URL for every value; `lib/chances/major-admission.ts`) records, per unit, what admits
> (the university, a school, or the major), whether first-years are admitted directly, the published admit rate, and
> how the unit reviews a record (the subjects it weighs, required courses, score gates)
> ([../chances/base-rates.md](../chances/base-rates.md#major), [../chances/major-and-grades.md](../chances/major-and-grades.md),
> 2026-10-11). On 2026-10-26 the file held 13 units at 9 universities; the chances specs name about 50 as the first
> wave's target. What remains here is the rest of the question and the scale: secondary admission after year one,
> change-of-major rules, the agent recipe that reads these pages for 200 colleges, and the places on the site that show
> them. Part of [ideas](README.md).

## Question it answers
*If I get into the university, am I in the program? Can I switch into it later?* At many large universities the real
selectivity is in computer science, nursing, engineering, and business, not at the front door. Families find this out at
orientation, when the "pre-major" letter arrives, or when a change-of-major request is refused. The built first wave
answers "do I apply to the college or the major" for the student's own estimate; it does not yet answer what happens
after the first year.

## Why it's fresh
College Kickstart sells admit rates for 600 departments at 80 colleges, gathered by hand. The structural facts matter
more and every college publishes them: **what secondary admission requires** after the first year (a GPA floor in
prerequisites, a competitive application, a cap on seats) and **whether changing into the major is open, restricted, or
closed**. No site collects these across colleges. The [college-reported agent](../college-reported-data.md) already
reads each college's admissions pages for other purposes; this is a recipe per college and a review queue, the pattern
round 3 built for every document.

## Data
Two fields added to the built unit (`MajorAdmissionUnit`, `lib/chances/types.ts`), each value with its verbatim quote
and URL as every value in the file has:

```
reported.major_admission[]: {
  …the built fields (unit_id, unit, name, cip_families, direct_admit, admit_rate, published_rate, review)…
  secondary: { required: boolean, gpa_floor: number | null, prerequisites: string | null,
               competitive: boolean, cap: string | null, quote, source_url } | null,   // new
  change_in: { rule: "open" | "restricted" | "closed", quote, source_url } | null         // new
}
```
Sources, in order: the college's "how we admit" pages; the department's "admission to the major" page; the catalog's
change-of-major policy. Anything without a quote goes to review. The **agent recipe** replaces hand curation: start
with the 200 most-applied-to colleges and the four program families families ask about most (computer science,
nursing, engineering, business), then expand on request. Examples to verify in the pilot, from public pages read
2026-10-03: the University of Washington admits to computer science directly from high school and again later; Purdue
admits to a first-choice major and publishes change-of-degree requirements per program; UIUC admits by major and
restricts changes into computer science; several University of California campuses label majors "capped" or
"selective".

## Display
- **Profile, Academics**: a "Getting into your major" block for the student's intended majors (or a picker): "Admitted
  to the major directly from high school" · "Admitted to the university; nursing admits after year one: GPA 3.2 in the
  prerequisites, competitive, about 60 seats" · "Changing into computer science is closed to current students", each
  with the quote in its citation popover and a link to the page. The direct-admit and admit-rate lines are built in the
  estimate's "what went into it" panel; this block makes them public on the college's page, for anyone.
- **Explore**: filters "Direct admit for my major" and "Changing into my major is open" (signed in with intended majors).
- **The estimate**: no change. The built notes already say when a unit admits separately and what it reads; the
  secondary and change-in facts are shown beside the estimate as college facts, not as inputs, so nothing here touches
  the method.
- **The plan's list row panel**: one line per row ("major: direct", "major: after year one", "major: closed to changes").
- **Compare**: a row for the chosen major.
- **Glossary**: `direct-admit`, `secondary-admission`, `pre-major`, `capped-major`.

## Checks
A published major admit rate more than three times the college's overall rate goes to review (a department rarely admits
more generously than its university); built as a check on the curated file, kept for the agent's reads. `change_in:
closed` needs a quote that says so. A program with no completions in that CIP family can't have a record. A record older
than two admissions cycles is shown with its year and re-read when the page changes (the archive's manifest knows).

## Tier
Free on profiles: it is data about the college. The Explore filters and the row line with the planner's tier.

## Complexity
Medium: a recipe for the agent with checks and review, two fields on a built type, a profile block, two filters, and a
pilot. (Large in the first draft, which also counted the data model and the estimate's use of it, both built.)

## Open questions
1. Hand curation got 9 universities in a day; the agent's recipe is what makes 200 possible. Build the recipe first, or
   extend the hand file to the 50 named in base-rates.md while the recipe is written? Recommendation: the recipe first;
   each hand entry costs an hour and the recipe reads the same pages.
2. "Capped" and "selective" (the UC words) map to `secondary.competitive` with a `cap`; other systems' words are collected
   in the pilot before the vocabulary is fixed.
