# Course Plan: Which Advanced Courses to Take Next

> Status: **planned** 2026-10-10. Part 6 of [admission chances, revisited](README.md). After
> [rigor-in-context.md](rigor-in-context.md) (the course list with grades, the AP catalog, the reading); better with
> [estimate.md](estimate.md) (whether a course would change the estimate). Planner first; one line on the college
> profile. Asked for by the owner after reading the first draft: "make recommendations on adding APs as part of the
> planner".

## Goal
The one part of a student's academic record that is still a choice is next year's schedule, and for a junior it is
the schedule colleges will see. Course registration happens in late winter or spring, long before applications, and
most families make the choice with a counselor meeting of a few minutes. The planner already knows the student's
courses and grades, what their high school offers, their intended major, and what each college on their list
recommends. This part turns that into **at most two suggestions for next year, each with its reason, or a plain
"you're set"**, at the moment the choice is made.

It follows the redesign's rule for the retake suggestion ([../planner/redesign/scores.md](../planner/redesign/scores.md#when-to-suggest-another-test)):
say it only when it is true and actionable, as one sentence with one button, and never "you should".

## What counselors and colleges say
- **"The most demanding schedule you can do well in."** The Common App counselor report rates course selection
  against what the school offers (*most demanding* down to *less than demanding*), and colleges read rigor school by
  school ([rigor-in-context.md](rigor-in-context.md#goal)). More APs past the school's top level in each subject add
  little; a weak grade in an extra AP costs more than the course adds. Selective colleges say so on their own pages,
  in words that vary; the plan quotes none of them generically and instead uses each college's own filing (CDS C7
  rigor, C8 units).
- **Subjects before counts.** CDS C8 publishes, per college, the years of English, math, science, language, and
  history it requires and recommends (156 colleges today, growing with every college-reported run). A fourth year of
  science or math, recommended by a college on the list, is often worth more than a third AP in a subject already at
  the top level.
- **Majors have expectations.** Engineering, computer science, and the sciences expect math through calculus and
  lab sciences; the plan says so per major family, as editorial guidance with its method published, never as a
  college's requirement unless the college publishes one.
- **Wellbeing.** Harvard's Making Caring Common report ("Turning the Tide", cited in the
  [planner redesign](../planner/redesign/README.md#research-2026-10-09)) asks colleges and families to value depth over
  a stack of advanced courses. A cap on how many advanced courses the plan will ever suggest in a year is part of the
  design, not a tuning detail.

## The inputs
| Input | From |
|---|---|
| The student's courses, grades, and `advancedGpa` | The course list ([rigor-in-context.md](rigor-in-context.md#the-students-courses)) |
| The student's year and the season | Class year (built) and today's date |
| The school's course list | [Below](#the-schools-course-list) |
| Course sequences and major relevance | `data/reference/ap-courses.json` (each course's usual prerequisites, next courses, grade levels, major families) |
| Intended majors | Student profile (built, `plans.intendedMajors`) |
| What the list's colleges recommend | CDS C8 units required and recommended per college (`admissions_hs_prep`), C7 rigor rating, GPA crowding ([how-colleges-read.md](how-colleges-read.md)) |
| Whether a course changes the estimate | The estimate endpoint, asked with the course added ([estimate.md](estimate.md#in-the-planner)) |

### The school's course list
The plan only suggests a course the student's school offers. Sources, best first:
1. **The school profile's AP and IB list** (the pilot high schools; more as profiles are collected).
2. **Courses other students at the same school have listed**, once at least **three** students from that school have
   listed a course (the count is never shown below three, no student is ever named, and the list holds course names
   only). Shown as "Students at your school have listed these."
3. **The student's own marks**: "Which of these does your school offer?" on the catalog, asked once when neither of the
   above exists, and kept on the student's profile.
4. **CRDC count only** (13,191 schools): the plan knows *how many* AP courses are offered but not which; it suggests by
   subject ("a math course at your school's top level") and links to ask the counselor.

## The rules
`coursePlan(student, school, list)` in `lib/chances/course-plan.ts` (pure). Candidates are courses the school offers
that the student hasn't listed, whose usual prerequisites are on the list (taken or in progress), and whose usual
grade levels include next year. Each candidate gets the first reason that applies, in this order (a requirement before a recommendation):

| Reason | Fires when | Sentence |
|---|---|---|
| **A course a unit on the list requires** | A college on the list admits the student's intended major through a unit with `required_courses` or a course-based `gate` ([major-and-grades.md](major-and-grades.md#data)) that the list doesn't meet yet | "Cornell Engineering requires physics. AP Physics 1 is offered at your school and fits next year." |
| **A subject the list's colleges recommend** | Counting the list and the core-subject answers, the student will finish with fewer years in a subject than the C8 recommendation of at least half the colleges on their list (or the Dream) | "4 of your 7 colleges recommend 4 years of science; you're on track for 3. AP Environmental Science would make it 4." (Can name a non-AP course from the school's list when no AP fits: "a fourth year of science") |
| **Your school's top level in a core subject** | Next year has no advanced course in a core subject, the school offers one, and its prerequisite is met | "AP Calculus AB would put your math at your school's top level next year." |
| **Your intended major** | A course tagged for the student's first intended major family isn't on the list and is offered | "Engineering programs expect calculus and physics; AP Physics 1 is next in your science sequence." |

Then the guardrails, which decide whether anything is shown at all:
1. **Grades first.** When the student's grades in advanced courses are weak (a low average, or a recent grade below
   B−), no course is suggested. The card says: "Strong grades in the advanced courses you have count for more than
   adding another. Your grades in them: 3.1."
2. **A cap per year.** Never suggest a course that would take next year past `MAX_ADVANCED_PER_YEAR` (5) advanced
   courses, and never more than **two** suggestions at once.
3. **Already there.** When the reading is *most of what's offered* and every core subject is checked at the top level
   for next year: "Your schedule is already about as demanding as your school allows. Keep the grades up."
4. **Too late.** From September of 12th grade the schedule is set: no suggestions; the card says "Senior grades still
   count: colleges see midyear grades, and an offer can depend on finishing the year well."
5. **Not offered.** Nothing outside the school's list. When a subject's top course isn't offered, the card can add once:
   "If your school doesn't offer it, colleges know. Dual enrollment or an online course is an option, not an
   expectation."
6. **Earlier years.** 9th and 10th graders see no suggestions, only a **path**: the sequence that reaches the top
   course in each core subject by 12th grade, from the catalog's prerequisites ("To take AP Calculus BC as a senior,
   take Precalculus by 11th grade"), and only for subjects tied to their intended major.

### Saying what it changes
Each suggestion may add one line about the list, from the estimate endpoint asked with the course added as planned
(the same way the Scores tab asks about a retake):
- If the reading moves (*some* → *much*, *much* → *most*): "It would make your schedule *most of what your school
  offers*."
- If the estimate at a college on the list would change: "At Elon: Target → Likely." At most one college named;
  never shown for a "Reach for everyone".
- Never a percentage, and never a promise: the line ends "if your grades stay strong" whenever it names a group.

## Where it shows
### In the planner
- **Scores tab → Courses** ([rigor-in-context.md](rigor-in-context.md#in-the-planner)): under the list, a card titled
  **Next year** with up to two suggestions. Each has its reason, the "what it changes" line when there is one, and two
  buttons: **Add to my plan** (adds the course to the list as *planned* for next year) and **Not for me** (dismissed for
  this season, remembered). The guardrail messages replace the suggestions when they fire.
- **When it appears**: from the "Choose next year's courses" window (below) until the student marks next year's
  schedule done, then the card collapses to the list. Outside the window the card shows only when the student opens
  Courses.
- **Calendar** (cycle-file entries in `data/application-cycle.json`, each with its source, in the student's lane):
  - "Choose next year's courses": 9th–11th graders, window February–April (the usual registration season, marked
    "check your school's dates"); the task links to the Next year card.
  - "Sign up for AP exams by your school's deadline": students with an AP course in progress; the College Board's final
    ordering deadline for fall courses is November 13, 2026 (late orders cost $40 more per exam, through March 12,
    2027), and schools set earlier dates of their own, so the task says "your AP coordinator's date is usually
    earlier".
  - "AP exams" for the two May weeks, and "AP scores out" in early July (2026 scores reached students July 6), from
    the College Board's published calendar each year.
  - **Send AP scores for credit**: after the student commits to a college (the offers stage,
    [../planner/offers.md](../planner/offers.md)), a task to send AP scores when the college awards AP credit
    (`admissions.accepts_ap_credit`, built).
- **Parents** see the card read-only and can send a nudge about it ([../planner/parents.md](../planner/parents.md));
  they never see exam scores unless the student shares them.

### On the college profile
In "What you'll need in high school" (`#hs-prep`), the **You** column from
[rigor-in-context.md](rigor-in-context.md#on-the-college-profile-signed-in-with-courses-entered) gains one line when a
subject falls short of this college's recommendation and the student still has a year to choose: "Science: 4
recommended, you're on track for 3. See next year's options in your plan." Nothing more; the suggestions live in the
planner.

### Not on Explore or Compare
Course choices are about the student's school and list, not about choosing colleges.

## Data
- `data/reference/ap-courses.json` (from [rigor-in-context.md](rigor-in-context.md#entering-them)) gains `prereqs`
  (catalog keys or a subject level, e.g. "Algebra II"), `next` (keys), `grades` (usual years), and `majors` (major
  family codes from `lib/majors.ts`). Sequences and major tags are **editorial**: the file says so, the method page
  lists them, and each is reviewed in a data PR. The course names, subjects, and pages are the College Board's.
- `data/reference/major-course-expectations.json`: per major family, the subjects expected (e.g. engineering: math
  through calculus, physics, chemistry), each with the published sources it was written from (college and
  professional-body pages), shown as "commonly expected", never as a college's requirement.
- The pooled school course lists live in Supabase (`school_course_counts`: high school id, course key, distinct
  students), maintained by a trigger on profile writes and readable only through a function that applies the
  three-student threshold.

## Rules
- Only courses the school offers; only when the student's grades are strong; at most two; never past the yearly cap.
- Every reason names its evidence: the colleges' C8 recommendations (cited with their editions), the school's list
  (cited with its source), or the editorial sequence (linked to the method).
- No "you should", no percentages, and no group change named without "if your grades stay strong".
- Telemetry: `course_plan_shown {reasons, guardrail}`, `course_plan_added`, `course_plan_dismissed`; never a course
  name, a grade, or a score.

## Files (planned)
`lib/chances/course-plan.ts` (pure: candidates, reasons, guardrails, the path for 9th–10th graders, the what-it-changes
line via the estimate endpoint), the catalog fields and `major-course-expectations.json` with schema checks in
`npm run verify`, migration `…_school_course_counts.sql` (table, trigger, threshold function, policies),
`components/planner/NextYearCard.tsx`, the cycle-file entries (course registration window, AP ordering, AP exams, AP
scores, send scores for credit), the profile's You-column line, `tests/chances-course-plan.test.mts` (each reason; each
guardrail, including weak grades suppressing every suggestion; the cap; prerequisites; nothing outside the school's
list; the three-student threshold; the path for a 10th grader; the what-it-changes line with and without a group move).

## Open questions
1. Is five advanced courses a year the right cap? Recommendation: start at five, measured against what students on the
   site actually enter; a lower cap for 10th grade (two).
2. Should the plan ever suggest dropping an advanced course (grades falling mid-year)? Recommendation: no; that is a
   conversation for the student, family, and counselor. The grades guardrail already stops it from adding more.
3. Should the pooled school course lists be shown to students at a school who haven't entered courses (as "courses
   offered at your school")? Recommendation: yes, at the same three-student threshold; it helps the next student and
   names no one.
4. Should IB diploma candidates get suggestions? Recommendation: no; the diploma fixes the schedule. They see the path
   and the AP-exam dates only if they also take APs.
