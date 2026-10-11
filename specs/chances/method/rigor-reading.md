# Method: the Rigor Reading

> Method (not a work item). Part of [Quad's estimate](../estimate.md): the rules behind the reading in [rigor-in-context.md](../rigor-in-context.md). Kept here until launch;
> moves to a private repository then ([../README.md](../README.md#quads-estimate-is-proprietary)). Never shown on the
> site.

### What we take from the proposal, and what we don't
| Proposal | Here | Why |
|---|---|---|
| Advanced Course Exhaustion Ratio (taken ÷ offered) | **Kept, with a reachable denominator** and shown as a reading, not a ratio | No one can take all of a 23-course AP catalog; a full load of advanced core classes in 11th and 12th grade is about ten. The ratio as written penalizes students at the best-resourced schools |
| Advanced course count, completed + planned by senior year | **Kept, as a course list**: each AP, IB, dual-enrollment, and honors course by name, year, status (taken, in progress, planned), and grade; the counts are derived | Colleges see each course and its grade on the transcript and the senior schedule; a list lets the plan name courses, check sequences, and read grades. Honors is listed but not compared (its meaning varies most by school) |
| AP exam scores (average; count of 4s and 5s) | **Kept as an optional score per course**, shown in the reasons, not used for the group | Self-reported and optional at most colleges; senior-year exams aren't scored until July, after decisions; many students don't sit every exam (fees, school policy) |
| AP Performance Integrity Index (4+ exams ÷ AP courses) | **Not built** | It treats a missing exam as a failed one and frames the student as suspect; colleges that want exam evidence ask for it |
| Course-Level Rigor Score (grade × difficulty multiplier per course) | **Partly**: grades in the *advanced* courses are read ([below](../rigor-in-context.md#grades-in-advanced-courses)); the multipliers aren't used, and the full transcript waits ([later](../rigor-in-context.md#later-a-recalculated-gpa)) | The advanced courses are 5–15 rows a student can enter in a couple of minutes; the whole transcript is 24–30. The multipliers would be ours; colleges that recalculate publish their own method (UC's capped weighted GPA is the clearest) |
| Core-subject unweighted GPA | **Not a new field** | The profile already asks for the unweighted GPA; asking for a second one is a burden with no data to compare it against (colleges publish overall GPA bands, not core-only) |
| High school grading scale, rank policy, college-going share | **Read from the high school record**, not asked | The school profile PDFs carry scale and rank policy; EDFacts/state files carry college-going rates ([high-school-data.md](../../product/high-school-data.md)) |

### The reading
`rigorReading(student, highSchool)` in `lib/chances/rigor.ts`, pure:
```
reachable = min(offered, REACHABLE_CAP)          // REACHABLE_CAP = 10: five core subjects × 11th and 12th grade
advanced  = rows of kind ap, ib_hl, ib_sl, dual, any status (taken, in progress, planned)
share     = advanced / max(reachable, 1)
core      = count of coreAtTopLevel checked (0–10)
strong    = advancedGpa is null (no grades yet) or ≥ STRONG_ADVANCED_GPA (3.3), and no advanced final grade below C
```
| Reading | Rule (constants in one object, tuned by the [pilot](#pilot-against-outcomes)) | Sentence |
|---|---|---|
| **Most of what's offered** | (`share ≥ 0.7` or `core ≥ 8`) and `strong` | "You've taken or planned 8 of the 9 AP courses your school offers, about as demanding a schedule as it allows." |
| **Much of what's offered** | `share ≥ 0.4` or `core ≥ 5` (including a *most* schedule that isn't `strong`) | "You've taken or planned 6 of your school's 14 AP courses." With weak grades: "…; colleges look for strong grades in demanding courses, and your grades in them (2.9) matter as much as how many you take." |
| **Some of what's offered** | otherwise, with at least one course entered | "You've taken or planned 2 of your school's 14 AP courses. At colleges that rate rigor very important, the courses behind a GPA matter as much as the GPA." |
| **Few offered** | `offered ≤ 3` (or 0) and the student took what there was | "Your school offers 2 AP courses and you've taken both. Colleges read rigor against what your school offers; your counselor's report says so." |
| **Can't place** | no linked school, or the school's offering isn't on record | "Add your high school to see your courses against what it offers." (counts still shown) |

- Dual enrollment and IB count toward `share` even when only AP is counted in the offering, because a student who
  took dual enrollment in place of AP has a demanding schedule; the sentence names each kind.
- Honors never enters `share` (its meaning varies most), but is shown: "plus 4 honors courses".
- A planned course is marked as such ("planned") in every sentence; the student's grade (from the class year) decides
  whether "planned" is still a choice (spring of 11th grade) or a fact.
- Grades add one sentence when given: "A's in 5 of your 6 finished advanced courses (3.8 in them)."
- Exam scores add one sentence when given: "4s or 5s on 3 of the 4 AP exams you've taken." Never a ratio to courses,
  and a course with no exam is never counted against the student.

The reading is a **position** for the standing model ([standing.md](standing.md#the-rigor-position-asymmetric-for-now)):
*most* → `above`, *much* or *few offered* → `in`, *some* → `below`, *can't place* → `unknown`. Only colleges whose C7 rates rigor at
least *important* (or IPEDS marks the high school record *required*) use it, and only as a tie-breaker where GPAs are
crowded; see that spec.

### Grades
`advancedGpa` and `strong` as above: `STRONG_ADVANCED_GPA` is 3.3, and any advanced final grade below C keeps a schedule
from reading *most*. The [course plan](../course-plan.md)'s grades guardrail uses the same 3.3 and suppresses
suggestions after any advanced grade below B− this year or last.

### Pilot against outcomes
Once the planner's outcome share has a season of data ([outcomes.md](outcomes.md)), check whether *most* readers are
admitted more often than *some* readers at the same GPA and score position at colleges that rate rigor very
important; if not, the reading stays a sentence and leaves the model.
