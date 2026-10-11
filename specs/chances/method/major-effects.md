# Method: How the Major Changes the Estimate

> Method (not a work item). Part of [Quad's estimate](../estimate.md): the rules behind the major in [major-and-grades.md](../major-and-grades.md). Kept here until launch;
> moves to a private repository then ([../README.md](../README.md#quads-estimate-is-proprietary)). Never shown on the
> site.

### How it changes standing
In [standing.md](standing.md), only for a student with an intended major, and only at a unit whose `review` says
so:

| The college says | Effect |
|---|---|
| `major_considered: "no"` | Nothing changes. One reason line: "The major you list doesn't affect admission here (William & Mary says so)." |
| `pool` | The base rate becomes the unit's published rate where there is one ([base-rates.md](../base-rates.md#major)); otherwise one line: "Engineering admits separately here; you're compared with other engineering applicants." No new position |
| `pool_and_emphasis` with math or science named | A **subject position** joins the votes: the student's math (and science, when named) subject GPA placed against their overall GPA's position. `in` when the subject GPA is at least the overall GPA − 0.1; `below` when it is more than 0.3 under; `above` never (the college's subject bar isn't published). With the math section score: `below` when the student's SAT/ACT math is under the college's math 25th percentile. Reason: "Engineering applicants here get an extra look at math and science grades. Yours: math 3.9, science 3.7." |
| `required_courses` | Each requirement is checked against the course list (taken, in progress, or planned counts as met). A missing one makes the subject position `below` and says so: "Cornell Engineering expects a year of physics; it isn't on your list." |
| `gate` | Checked against the course list's AP and IB exam scores and the section scores. Met: one line ("You meet UT Austin's math requirement for engineering through AP Calculus (4)"). Not yet met but still possible (a planned course, a test to come): "To be considered for engineering at UT Austin you'll need one of: SAT Math 620+, ACT Math 26+, AP Calculus 3+." Not met and no route left: the reason says the major isn't open to this application, and the group is computed for the university's other majors when the college says applicants are considered for an alternate |

- The subject position is symmetric (it can lower the group) because, unlike rigor, it only appears where the college
  itself says it reads those grades; the pinned examples and the [calibration](../calibration.md) report measure it
  separately.
- With no `review` for a unit, or no intended major, standing is exactly what it was. A student with "undecided"
  sees, at colleges where the major matters, "You're undecided; at Illinois you'd apply to a specific college, and
  that choice is compared within its own pool."

### Thresholds
The subject-position thresholds (−0.1 and −0.3) live in `STANDING` and change only with an outcomes result
([outcomes.md](outcomes.md)).
