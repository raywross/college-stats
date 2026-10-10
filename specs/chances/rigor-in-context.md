# Rigor in Context: Your Courses Against What Your School Offers

> Status: **planned** 2026-10-10. Part 2 of [admission chances, revisited](README.md). After
> [student-profile.md](../product/student-profile.md) (built: `courseRigorCount`, `classRankPercentile`, the linked
> `highSchoolId`) and [high-school-data.md](../product/high-school-data.md) (built: CRDC AP course counts for 13,191
> high schools, school-profile AP lists for the pilot schools). An input to [Quad's estimate](estimate.md).

## Goal
Colleges don't read "7 AP classes" as a number; they read it against the high school. The counselor's school report
on the Common App asks the counselor to rate the applicant's course selection against the school's other college-prep
students (*most demanding*, *very demanding*, *demanding*, *average*, *less than demanding*) and how many AP, IB, and
honors courses the school offers; the school profile the counselor sends lists them. Admissions offices read rigor
school by school against that profile (EAB's survey of admissions officers found all of them did). A student with 5 APs at a school that offers 6 has taken nearly everything; a student with 5 at a school that
offers 30 has taken a modest share. The site already knows what's offered at over a third of U.S. high schools. This
part has the student list their advanced courses one by one (taken, in progress, and planned, with grades), places
them against the student's own school, and says so in one sentence on the profile and in the planner; the same facts
are inputs to [Quad's estimate](estimate.md). The same list is what the
[course plan](course-plan.md) reads to suggest which advanced courses to take next.

## The student's courses
A list in `StudentProfileAcademics.courses` (JSON document, no migration), optional, on `/me`, the household Numbers
page, and in the planner behind "Add your courses":

```
courses: CourseEntry[]                 // at most 40
CourseEntry {
  id: string,
  kind: "ap" | "ib_hl" | "ib_sl" | "dual" | "honors" | "regular",   // "regular": math and science only, for STEM majors (major-and-grades.md)
  key: string | null,                  // AP and IB: a catalog key ("ap_calculus_bc"); dual and honors: null
  name: string | null,                 // dual and honors only: as the student types it, ≤ 60 characters
  subject: "english" | "math" | "science" | "history" | "language" | "cs" | "arts" | "other",
  year: 9 | 10 | 11 | 12,
  status: "taken" | "in_progress" | "planned",
  grades: { s1: Mark | null, s2: Mark | null, final: Mark | null },   // Mark: A+ … F, or P (pass)
  exam: 1 | 2 | 3 | 4 | 5 | null       // AP only, optional
}
```

### Entering them
- **Pick, don't type.** AP courses come from a catalog file, `data/reference/ap-courses.json` (42 courses for 2026–27
  per third-party counts of the College Board list, including AP Business with Personal Finance and AP Cybersecurity,
  new this year; verified against the College Board's course list when the file is written, each entry with its
  official page): key, name, subject, whether it is a core subject, the usual grade levels, its usual prerequisites
  and next courses (the sequences the [course plan](course-plan.md) reads), and the major families it relates to. IB
  courses come from a similar short file; dual enrollment and honors are a subject plus a name.
- **Start from the school's list.** When the linked high school has a profile with its AP list (or a list built from
  other students at the school; see [course-plan.md](course-plan.md#the-schools-course-list)), the form opens on that
  list as chips: "Your school offers these 14 AP courses. Tap the ones you've taken, are taking, or plan to take."
  Otherwise the full catalog with search.
- **Then one line per course**: year (defaults from the course's usual grade and the student's class year), status
  (defaults from the year), and the grade: a final grade for a finished course, semester grades for a year-long
  course in progress (the first semester's once it's out). The exam score is behind "Add AP exam score (optional)".
- A student can enter counts only ("I've taken 5 APs") and skip names; the four counts become placeholder rows
  without names, so nothing below breaks, and the plan asks once to name them.
- `courseRigorCount` (built) becomes the derived count of AP, IB, and dual-enrollment rows; an existing value turns into
  that many unnamed AP rows with a one-time "Want to name these?" prompt.

### The core-subject question
`coreAtTopLevel` stays: for 11th and 12th grade, "Were your English, math, science, history, and language classes the
most advanced your school offered?" Five checkboxes per year, **pre-checked** for any subject and year where the list
has an AP, IB, or dual-enrollment course, so most students only confirm. It still matters on its own: at a school with
no AP in a subject, the top level may be honors or regular, and only the student knows.

### Grades in advanced courses
From the list, `advancedGpa`: the unweighted 4.0-scale average of the final grades (else the latest semester grades)
of AP, IB, and dual-enrollment courses (A = 4, A− = 3.7, B+ = 3.3, …; P ignored). It is shown, never compared with
any college's figure (no college publishes one), and the reading takes it into account: a demanding schedule with
weak grades isn't read as the strongest schedule.

The high school comes from the built `highSchoolId` (picked on `/me`). A student with no linked school gets the list,
the grades, and the core-subject question, never the comparison.

## The school's offering
From the linked high school's record ([high-school-data.md](../product/high-school-data.md)), best source first:
1. **The school profile** (pilot schools, `kind: "hs-profile"` extraction): the AP and IB course names as printed, the
   weighting, the rank policy. Shown as "Your school's profile lists 14 AP courses."
2. **CRDC 2023–24** `rigor.ap_courses` (the number of different AP courses, `SCH_APCOURSES`), `ib_enrolled > 0` (IB
   offered), `dual_enrolled > 0` (dual enrollment offered). Measured 2026-10-10: 13,191 of 35,390 high schools have an
   AP course count; median 9, middle half 4–17, 90th percentile 23.
3. **Nothing on record**: CRDC marks AP as offered only with "Yes"; a school that answered "No" is stored today as
   missing. *Change in this part:* `scripts/lib/high-schools/crdc.mts` stores an explicit `0` for a "No" (never for -9,
   which stays missing), so a school without AP reads "Your school doesn't offer AP courses" rather than nothing.

## The reading
`rigorReading(student, highSchool)` in `lib/chances/rigor.ts` places the schedule against the school's offering and
returns one of five readings, each with its sentence. Which schedules land in which reading (how many courses, the
core-subject answers, the grades) is part of the confidential method and lives with it in the private model
repository ([estimate.md](estimate.md#architecture)); this repository holds the labels, the sentences, and the
interface, and the open baseline uses a simple published rule.

| Reading | Sentence |
|---|---|
| **Most of what's offered** | "You've taken or planned 8 of the 9 AP courses your school offers, about as demanding a schedule as it allows." |
| **Much of what's offered** | "You've taken or planned 6 of your school's 14 AP courses." With weak grades: "…; colleges look for strong grades in demanding courses, and your grades in them (2.9) matter as much as how many you take." |
| **Some of what's offered** | "You've taken or planned 2 of your school's 14 AP courses. At colleges that rate rigor very important, the courses behind a GPA matter as much as the GPA." |
| **Few offered** | "Your school offers 2 AP courses and you've taken both. Colleges read rigor against what your school offers; your counselor's report says so." |
| **Can't place** | "Add your high school to see your courses against what it offers." (the list is still shown) |

- Dual enrollment and IB are named alongside AP in the sentence; honors is shown ("plus 4 honors courses").
- A planned course is marked "planned" in every sentence; the student's year decides whether "planned" is still a
  choice (spring of 11th grade) or a fact.
- Grades add one sentence when given: "A's in 5 of your 6 finished advanced courses (3.8 in them)."
- Exam scores add one sentence when given: "4s or 5s on 3 of the 4 AP exams you've taken." A course with no exam is
  never counted against the student.

## Where it shows
### On the college profile (signed in, with courses entered)
- In the standing card under the GPA checker (the profile's "Where you stand" display from
  [chances-and-fit.md](../product/chances-and-fit.md#display)): the reading's sentence, then one line tying it to this
  college: "Vanderbilt rates course rigor *very important*, and 88% of its first-years had a 3.75 or higher
  ([how it reads a record](how-colleges-read.md))."
- Signed out: a "Check your courses" prompt beside the GPA checker that opens the same course picker and the high school
  in the browser (kept like the signed-out profile today) and shows the same sentence.
- In "What you'll need in high school" (`#hs-prep`, the college's CDS C8 units): a **You** column beside required and
  recommended, counted from the list plus the core-subject answers, e.g. "Science: 4 recommended, you have 3 (one
  planned)". Shown only for subjects the list can count (years with an advanced course or a checked core subject);
  the rest say "add your courses to compare".

### In the planner
- **Numbers card**: the three numbers stay the first screen ([../planner/redesign/standing.md](../planner/redesign/standing.md#the-numbers));
  under them, "Add your courses (optional): helps at colleges where most students have top GPAs." It opens the course
  picker. The plan works without it.
- **Scores tab → Courses**: a section after the score coach for students who entered courses: the reading, the list by
  year with grades, the school's offering with its ⓘ, and the [course plan](course-plan.md)'s suggestions for next
  year. The suggestions, the course-registration and AP-exam dates on the calendar, and their rules are that spec's.
- **Parents** see the reading, the list, and its grades (academics are shared with guardians under
  [accounts.md](../product/accounts.md#privacy-model)); never the AP exam scores unless the student shares them
  (exam scores are student-private by default, like list notes).

### On the high school page
`/high-schools/{id}` already shows AP courses offered. Add, for a signed-in student whose linked school it is: "You've
taken or planned 6 of these." Nothing for anyone else.

## Lineage
- The school's offering cites CRDC 2023–24 or the profile (year, page) through `HS_FIELDS` (built).
- The student's values say "your numbers" with the date entered, as the built profile values do.
- The glossary's `course-rigor` term explains what the readings mean in words; their thresholds are not published.

## Pilot
Before the reading is shown: take the pilot high schools that have a school profile (the 100 in
`data/high-schools/profile-pilot.json`) and check that the CRDC count and the profile's AP list agree within two
courses for at least 80% of them (they measure the same thing a year apart). How much the reading should count in the
estimate is decided in the private repository from outcomes ([calibration.md](calibration.md)).

## Later: a recalculated GPA
Some colleges recalculate GPA by a published method (the University of California's: 10th and 11th grade a–g
courses, with an honors bonus capped at eight semesters). For a student applying to those colleges, a "UC GPA"
calculator would answer a real question with the college's own rule. The course list above is shaped for it (a
`kind: "regular"` row is all it adds), but it needs every course, not just the advanced ones, so it waits for demand
from the planner's telemetry.

## Files (planned)
`lib/student-profile.ts` (`CourseEntry`, sanitizing: catalog keys must exist, at most 40 rows, a planned course
can't have a final grade; the derived `courseRigorCount` and `advancedGpa`), `data/reference/ap-courses.json` and the
IB list with a schema check in `npm run verify`, `lib/chances/rigor.ts` (pure: `rigorReading`, constants, sentences),
`components/profile/CoursePicker.tsx` (chips from the school's list or the catalog, one line per course; used on
`/me`, Numbers, the plan's sheet, and signed out), `components/school/RigorLine.tsx`, the You column in `HsPrepBox`,
the Scores tab's Courses section, the CRDC "No" → 0 change and its test, `tests/chances-rigor.test.mts` (the
sentences for each reading, can't-place, planned vs taken wording, honors shown, unnamed placeholder rows, the grade
and exam sentences; the reading's thresholds are tested in the private repository).

## Open questions
1. Should the core-subject question come before the list? Recommendation: the list first (students know their
   courses), then the core question pre-checked from it, because it is the counselor's real measure and works at
   schools with no AP at all.
2. Should honors ever be named in the reading? Recommendation: shown as a count, never compared; the school profile
   sometimes says how honors is weighted, and that can be shown as context.
3. Semester grades or final grades only? Recommendation: both, as above; a junior applying in the fall has only last
   year's finals and this year's first semester, which is exactly what colleges see.
