# When the Major Changes How Grades Are Read

> Status: **planned** 2026-10-10. Part 7 of [admission chances, revisited](README.md). After
> [base-rates.md](base-rates.md) (it extends the same first wave of `reported.major_admission`) and
> [rigor-in-context.md](rigor-in-context.md) (the course list); an input to [Quad's estimate](estimate.md) and feeds
> [course-plan.md](course-plan.md). Asked for by the owner: "Does the major a student selects impact how their grades
> are weighed? And if so can we add that in?"

## The answer, from the research (2026-10-10)
**At some colleges, yes; at most, no.** Where it matters, the major rarely reweights the GPA by a formula. It changes
four things, and each college says which in its own words:

| What changes | Example (from the college's or system's own pages unless marked) |
|---|---|
| **The pool**: applicants are compared within the college or major they applied to, not the whole university | Illinois reviews each application within the "academic community" chosen, and "each academic community may place different emphasis on specific academic or contextual factors". Purdue judges an application against the pool for its college or major, and uses courses and grades, not the GPA. Cal Poly: applicants compete within their major. Washington's Allen School: computer science must be the first-choice major |
| **Extra weight on math and science grades** | UC campuses decide independently whether to consider major; UC's 2023 counselor conference describes engineering applicants getting an additional review "where performance in mathematics and science courses is considered" (counselor-conference slides; confirm on the campus page per year). Washington's Allen School averages GPAs by subject (computer science, math, natural science) in its published rubric, though for transfer applicants |
| **Courses the unit requires** | Cornell Engineering asks for four years of math including calculus, a year of physics, and a year of chemistry, and says applicants without calculus are at a substantial disadvantage; Cornell's other colleges require precalculus and different sciences |
| **A hard gate for the major** | UT Austin's engineering, computer science, and geosciences majors are reported to require one of SAT Math 620+, ACT Math 26+, AP Calculus 3+, or IB HL Math 4+ (consultant summary of UT's prerequisites page; verify before use). Its automatic admission doesn't guarantee a major |

**Where it doesn't matter.** Many colleges that admit to the university as a whole say the intended major has no
bearing on the decision; William & Mary, for one, asks it only to match an advisor. A college that says so is quoted
saying so, which is useful information too.

**What nobody publishes.** No college publishes how much more math grades count for engineering than for history, so
the site never invents a weight. It uses the college's own words to decide *which* evidence counts and shows the
student that evidence; it never multiplies a GPA.

## Data
The first wave of `reported.major_admission[]` from [base-rates.md](base-rates.md#major) (and the
[getting into the major](../ideas/getting-into-the-major.md#data) idea) gains a `review` object per unit, each value with
its verbatim quote and URL, collected by the college-reported agent with a review queue:

```
reported.major_admission[].review: {
  major_considered: "no" | "pool" | "pool_and_emphasis" | null,  // "no" only when the college says so
  emphasis: ("math" | "science" | "cs" | "writing" | "arts")[],    // subjects the college names for this unit
  required_courses: { subject, level, quote }[],                   // e.g. math: "calculus"; science: "physics"
  gate: { any_of: { kind: "sat_math" | "act_math" | "ap" | "ib_hl", course?: string, min: number }[] } | null,
  quote, source_url, fetched, edition
}
```
- University-level statements ("the major you list has no bearing") are stored once with `unit: "university"` and
  `major_considered: "no"`.
- First wave: the large universities that admit by college or major (the same ~50 as the major admit rates: Illinois,
  Purdue, Georgia Tech, Washington, Texas, Virginia Tech, Michigan, Cornell, Carnegie Mellon, the UC campuses, Cal
  Poly, and others), plus the most-listed colleges on the site's saved lists, to find the "doesn't matter" statements.
- Nothing is inferred: a unit with no statement has `major_considered: null`, and the plan says nothing about it.

## The student's side
- **Intended major** is built (`plans.intendedMajors`); the first one is used.
- **Math and science grades.** The course list ([rigor-in-context.md](rigor-in-context.md#the-students-courses)) holds
  advanced courses. For a student whose first intended major is in a math- or science-heavy family (computer science,
  engineering, engineering technologies, math and statistics, physical sciences, biology, health professions), the
  picker also offers "Add your other math and science courses" (`kind: "regular"`, subject math or science, about
  six to eight rows). From these, `subjectGpa.math` and `subjectGpa.science`: the unweighted average of final (else
  latest semester) grades in that subject, advanced and regular together.
- **Section scores** are built (`tests.satMath`, `tests.actMath`); the college's SAT math and ACT math middle 50% are
  on record at 931 and 846 colleges (IPEDS), and newer from the CDS at about 120.

## What the estimate does with it
Where a unit's `review` says the major is considered, [Quad's estimate](estimate.md) takes into account what the
college says it reads for that unit: the unit's own pool and admit rate, the student's math and science grades and
math section score where the college names those subjects, the required courses on the student's list, and any score
requirement. How much each counts is part of the method ([method/major-effects.md](method/major-effects.md)), never
shown on the site. Where a college says the major doesn't matter,
or has no statement, the major doesn't change the estimate.

What the student sees is public and the same everywhere, from the note catalog ([estimate.md](estimate.md#protecting-the-method)):

| The college says | What's shown |
|---|---|
| The major isn't considered | "The major you list doesn't affect admission here (William & Mary says so)." |
| Applicants are compared within the unit | "Engineering admits separately here; you're compared with other engineering applicants," with the unit's admit rate when published ([base-rates.md](base-rates.md#major)) |
| Math or science grades get extra weight | "Engineering applicants here get an extra look at math and science grades. Yours: math 3.9, science 3.7." |
| Required courses | Met: listed with a check. Missing: "Cornell Engineering expects a year of physics; it isn't on your list." (taken, in progress, or planned counts as met) |
| A score requirement | Met: "You meet UT Austin's math requirement for engineering through AP Calculus (4)." Not yet: "To be considered for engineering at UT Austin you'll need one of: SAT Math 620+, ACT Math 26+, AP Calculus 3+." No route left: the note says the major isn't open to this application, and names the college's published alternate-major route if it has one |

A student who is undecided sees, at colleges where the major matters: "You're undecided; at Illinois you'd apply to a
specific college, and that choice is compared within its own pool."

## Where it shows
### On the college profile
- **How this college reads a record** ([how-colleges-read.md](how-colleges-read.md)) gains a **Major** line, for
  everyone, from the `review` data: "Applicants are compared within the college they apply to; engineering applicants
  get an extra look at math and science grades." Or: "The major you list doesn't affect admission." Hidden when there
  is no statement.
- For a signed-in student with an intended major, the standing card's "what went into it" panel includes the lines
  above, and "What you'll need in high school" shows the unit's required courses beside the college-wide C8 units
  ("Engineering also requires: calculus, physics, chemistry") with the You column.
- Signed out, the admissions page lets a visitor pick a major (as the ScoreChecker lets them type a score) and shows
  that unit's lines.

### In the planner
- The row's ⓘ carries the major lines; the list row itself stays free of statistics.
- **Course plan** ([course-plan.md](course-plan.md)): a unit's `required_courses` and `gate` become the first reason,
  ahead of the list's C8 units, because they are the college's requirement, not a recommendation: "Cornell Engineering
  requires physics. AP Physics 1 is offered at your school and fits next year."
- **Scores** ([../planner/redesign/scores.md](../planner/redesign/scores.md)): for a gate on a section score, the
  retake card can say "A 620 on SAT Math meets UT Austin's engineering requirement" when the student is below it.
- **Numbers card**: for a student with a STEM major and at least one college on the list with `pool_and_emphasis`, the
  "most useful missing input" line can be "Adding your math and science grades would help at Illinois and Purdue."

### On Compare
A "How your major is read" row (the Major line per college), shown when the student has an intended major.

## Lineage
- Every `review` value is a college-reported field with its quote, URL, and edition; register
  `reported.major_admission.review.*` in `lib/fields.ts`.
- `subjectGpa` is the student's own number ("your numbers").
## Glossary
`major-review` ("At some universities you apply to a specific college or major and are compared with other applicants
to it; some also look harder at the grades that matter for it. Others say the major you list doesn't affect
admission."), `direct-admit` (already proposed by the getting-into-the-major idea).

## Files (planned)
The `review` extraction schema and recipe for the agent's first wave, its review-queue checks (a quote for every
value; a gate's numbers must appear in the quote), `lib/chances/major-review.ts` (pure: gate checking and
required-course checking against the course list, subject GPAs, and the notes above), the Major line in
`lib/chances/reading.ts`, the regular math/science rows in the course picker, the course-plan and Scores hooks,
`tests/chances-major-review.test.mts` (each `review` kind's notes; a gate met by an exam, by a section score, not yet
met, closed; a missing required course; "no" quoted; undecided; no review at all). How the estimate weighs these is
tested with the model (`tests/chances-model.test.mts`).

## As built (2026-10-11)
- `lib/chances/major-review.ts` (pure, client-safe): `majorReviewFor(student, school, { testingClosed? })` returns
  the unit and university statement that apply, `considered` (the unit's statement first, else the university's),
  the emphasis with the student's `subjectGpas`, `requiredCourses` checks, a `gate` check, the public `notes`, the
  `unitRequires` line for "What you'll need in high school", and `facts`. Helpers: `checkRequiredCourses`,
  `meetsLevel` (catalog name or typed name; a later course meets an earlier level; "Pre-Calculus" isn't calculus; IB
  Math AA HL/SL and AI HL meet calculus), `checkGate` (route statuses met / pending / below / absent), `majorMatters`,
  `isStemFamily`, `UNDECIDED_MAJOR` (the value `majors[0]` holds for an undecided student; an empty list is no
  major). A gate is "closed" only when the caller says testing is over; otherwise a section score can still be
  retaken and it is "not yet". No alternate-major route is stored yet, so `major.gate_alternate` isn't emitted.
- `data/major-admission.json`, first wave, 13 units: "the major doesn't affect admission" at William & Mary and
  Georgia; university-level "compared within the college or major" at Illinois, Purdue, Cornell, and Cal Poly;
  Illinois's Grainger Engineering and Gies Business printed first-choice admit rates (Fall 2025); UW's Allen School
  (first-choice major only); UT Austin's calculus-readiness gate for engineering and computer science; Berkeley
  Engineering's math and science emphasis; Cornell Engineering's required courses. All `verified_via: "search"`
  (pages couldn't be fetched from the build container); recheck quotes on the pages at the next data run. Not found
  in a quotable official form: Georgia Tech, Virginia Tech, Michigan, Carnegie Mellon, and other UC campuses' unit
  rates.
- Tests: `tests/chances-major-review.test.mts`.

## Open questions
1. Should the math section score be shown as evidence where no math grades are entered? Recommendation: yes, beside
   the college's university-wide math range, saying so (the unit's own range is rarely published, and is usually
   higher).
2. Ask for regular math and science courses only for STEM majors? Recommendation: yes at first; extend to writing for
   humanities units only if colleges are found that name writing grades.
3. When a gate closes a major, should the plan suggest the college's alternate-major route? Recommendation: only where
   the college publishes one (UT and the UCs describe alternates), quoted, never as advice.

## Sources
- Illinois admission review policy: https://admissions.illinois.edu/admission-review-policy/
- Purdue freshman profile and review: https://admissions.purdue.edu/academics/freshmanprofile.php
- Cal Poly selection criteria: https://www.calpoly.edu/admissions/first-year-student/selection-criteria
- UW Allen School direct-to-major: https://www.cs.washington.edu/academics/ugrad/admissions/direct/ ; transfer rubric:
  https://www.cs.washington.edu/wp-content/uploads/2025/11/Spring-2026-Admissions-Rubric-Allen-School-Admissions.pdf
- UC comprehensive review: https://admission.universityofcalifornia.edu/counselors/preparing-freshman-students/comprehensive-review.html ;
  2023 counselor conference, "Major mayhem": https://admission.universityofcalifornia.edu/counselors/_files/documents/2023-counselor-conference/pdfs-with-notes/major-mayhem_everyone-wants-my-major-what-do-i-do_with-notes.pdf
- Cornell college and school requirements: https://admissions.cornell.edu/how-to-apply/first-year-applicants/college-and-school-admissions-requirements ;
  Engineering FAQ: https://faq.enrollment.cornell.edu/kb/article/155-what-science-and-math-courses-are-prospective-engineering-students-expected-to-take-in-high-school-if-i-am-missing-a-requirement-will-this-hurt-my-chances-of-being-admitted
- UT Austin math gate (secondary; verify on UT's prerequisites page): https://orieladmissions.com/how-to-get-into-ut-austin/
- William & Mary on the intended major: https://wmblogs.wm.edu/?p=8620
