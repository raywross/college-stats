# Getting Into the Major: Direct Admission, Secondary Admission, and Changing In

> Status: **idea** (2026-10-03). After [college-reported-round-3.md](../college-reported-round-3.md) (the agent, its
> archive and recipes) and [student-profile.md](../product/student-profile.md) (intended majors). Part of
> [ideas](README.md).

## Question it answers
*Do I apply to the college, or to the major? If I get into the university, am I in the program? Can I switch into it
later?* At many large universities the real selectivity is in computer science, nursing, engineering, and business,
not at the front door. Families find this out at orientation, when the "pre-major" letter arrives, or when a
change-of-major request is refused.

## Why it's fresh
College Kickstart sells admit rates for 600 departments at 80 colleges, gathered by hand. The structural facts matter
more and every college publishes them: **what unit admits** (the university, a school or college within it, or the
major itself), **which programs admit directly** from high school, **what secondary admission requires** after the
first year (a GPA floor in prerequisites, a competitive application, a cap on seats), and **whether changing into the
major is open, restricted, or closed**. No site collects these across colleges. The
[college-reported agent](../college-reported-data.md) already reads each college's admissions pages for other
purposes; this is a recipe per college and a review queue, the pattern round 3 builds for every document.

## Data
```
reported.major_admission[]: {
  cip_family: "11" | "51.38" | "14" | "52" | …,     // computer science, nursing, engineering, business first
  unit: "university" | "school" | "major",          // what the first-year application admits to
  direct_admit: true | false | "some",              // first-years can be admitted straight into the program
  secondary: { required: boolean, gpa_floor: number | null, prerequisites: string | null,
               competitive: boolean, cap: string | null } | null,
  change_in: "open" | "restricted" | "closed" | null,
  admit_rate: { admitted, applied, year } | null,   // only when the college publishes it; quoted like any figure
  quote: string, source_url: string, fetched: date, edition: string | null
}
```
Sources, in order: the college's "how we admit" pages; the department's "admission to the major" page; the catalog's
change-of-major policy. Every value carries a verbatim quote and its URL, as every figure the agent publishes does;
anything without a quote goes to review. Start with the 200 most-applied-to colleges and the four program families
families ask about most, then expand on request (a "request this college" button, like the data-update requests
CollegeIQ takes by form).

Examples to verify in the pilot, from public pages read 2026-10-03: the University of Washington admits to computer
science directly from high school and again later; Purdue admits to a first-choice major and publishes change-of-degree
requirements per program; UIUC admits by major and restricts changes into computer science; several University of
California campuses label majors "capped" or "selective".

## Display
- **Profile, Academics**: a "Getting into your major" block for the student's intended majors (or a picker): "Admitted
  to the major directly from high school" · "Admitted to the university; nursing admits after year one: GPA 3.2 in the
  prerequisites, competitive, about 60 seats" · "Changing into computer science is closed to current students", each
  with the quote in its citation popover and a link to the page.
- **Explore**: filters "Direct admit for my major" and "Changing into my major is open" (signed in with intended
  majors).
- **Standing** ([chances-and-fit.md](../product/chances-and-fit.md)): a caveat line when the unit is the major:
  "Standing here describes the university; computer science admits separately and publishes a 9% admit rate (fall
  2025)".
- **Saved list**: a chip per row ("major: direct", "major: after year one", "major: closed to changes").
- **Compare**: a row for the chosen major.
- **Glossary**: `direct-admit`, `secondary-admission`, `pre-major`, `capped-major`.

## Checks
A published major admit rate more than three times the college's overall rate goes to review (a department rarely
admits more generously than its university). `change_in: closed` needs a quote that says so. A program with no
completions in that CIP family can't have a record. A record older than two admissions cycles is shown with its year
and re-read when the page changes (the archive's manifest knows).

## Tier
Free on profiles: it is data about the college. Plus: the Explore filters and the list chips.

## Complexity
Large: a new recipe type for the agent with checks and review, new fields, a profile block, two filters, a standing
caveat, and a pilot.

## Open questions
1. The first pass is about 800 page visits (200 colleges × four families); measure its cost in the round-3 pilot
   before expanding.
2. Published admit rates by major overlap what Kickstart sells; capture them only where the college publishes them,
   with the quote, and never estimate one.
3. Nursing has a second gate (direct-entry versus 2+2 programs); the pilot decides whether the schema needs a
   `program_type`.
