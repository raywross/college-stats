# Depth: Years and Progression in a Few Things, Not a List of Many

> Status: **built** 2026-10-12 on `feature/chances` (see "As built"; planned 2026-10-11) (owner: "consistency of students' courses and extracurriculars"). Part 10 of
> [admission chances](README.md). Reads the course list from [rigor-in-context.md](rigor-in-context.md) and adds an
> activities list. How the readings move the level is the method's
> ([method/standing.md](method/standing.md#the-other-multipliers)). After [levels.md](levels.md).

## Goal
Admissions readers reward a record that goes somewhere: a science track that rises every year toward the intended
major, four years of one sport ending as captain, two clubs held through high school with a role in one. They
discount a list of many short things. Rigor already counts advanced courses; Depth reads **sequence and trajectory**:
for courses, by subject against the intended major; for activities, years, role, and recognition in the top two. Both
readings are sentences with a suggestion first and an input to the estimate second, and neither ever lowers a level.

## Course tracks
Read from the built course list (`CourseEntry`: kind, subject, year, status, grades, exam) and `coreAtTopLevel`, per
subject family (`CourseSubject`: english, math, science, history, language, cs, arts). Nothing new is entered.

### Per family
| Measured | From |
|---|---|
| **Years** | Distinct years (9–12) with an advanced course (AP, IB, dual, honors) in the family, plus 11 and 12 where `coreAtTopLevel` is checked for that subject |
| **Level by year** | regular 0 · honors 1 · IB SL 1.5 · AP, IB HL, dual 2; the highest in the year |
| **Rising** | The level never falls year to year and ends at 2 |
| **Senior year** | A course in the family in grade 12 (taken, in progress, or planned) |
| **Grades** | The unweighted average of final (else latest semester) grades in the family's advanced courses; an AP exam score of 4 or 5 confirms the grade (a sentence), 1–2 never lowers it |

### The reading
| Reading | Rule |
|---|---|
| **Deep** | Years ≥ 3, rising, senior year included |
| **Steady** | Years ≥ 2, or years ≥ 3 without a senior-year course |
| **Light** | Years ≤ 1 |
| *(not read)* | The school offers nothing advanced in the family (the offering, as rigor reads it): the sentence says so and no reading is made |

### Against the intended major
`data/reference/major-course-expectations.json` (built for the course plan) names the subjects each major family
commonly expects. The **major's families** are the ones read for the estimate: a Deep track in each expected family
fills the major-subjects slot as **above** (`d = 1.25`); Light in an expected family where the admitting unit *states*
a requirement (`MajorReview.required_courses`) is **below**, as [major-effects.md](method/major-effects.md) already
does; Light otherwise is a sentence, not a position. Families outside the major are reported, never scored: six
unrelated APs don't beat four in sequence.

### The sentences
One per family the student has courses in, the major's families first:
- Deep: "Science: Biology, Chemistry, AP Chemistry, AP Biology (planned): a deep track for your major."
- Steady: "Math: Algebra II (honors), Precalculus (honors): a steady track. Most engineering programs expect calculus
  senior year." (the expected top course from the expectations file)
- Light: "History: AP U.S. History in 11th grade. History isn't among the subjects your major usually expects."
- Not offered: "Your school offers no advanced courses in computer science, so none is expected."

## Activities
### What the student enters
`StudentProfile.activities: ActivityEntry[]`, at most 20 (raised from 8 when the intake split into four activity
steps; the Common App allows 10), in the JSON profile document (no
migration), on `/me` → Activities, the household Numbers page, and in the planner behind "Add your activities" in
the header card's prompt line when the estimate lists it as missing.

```
ActivityEntry {
  id: string,
  name: string,                              // as typed, at most 60 characters ("Varsity soccer", "Robotics club")
  kind: "sport" | "club" | "arts" | "service" | "work" | "research" | "family" | "other",
  years: (9 | 10 | 11 | 12)[],               // checkboxes
  roles: Partial<Record<9 | 10 | 11 | 12, "member" | "officer" | "leader">>,   // per year; member when a year is checked and nothing picked
  hoursPerWeek: number | null,               // during the school year; 1–60
  recognition: 1 | 2 | 3 | 4 | null,         // highest, from the picker below
  relatedToMajor: boolean,                   // "This is connected to the major I want to study"
}
```
- **Roles**: member (took part) · officer (a named role: treasurer, section leader, varsity starter) · leader
  (captain, president, founder, editor-in-chief, first chair). The form shows the four years as a row of chips per
  activity; tapping a year cycles member → officer → leader → off.
- **Recognition** is a picker, not a text box, with examples beside each tier so a student can place themselves:
  1 national or international (a national award, a published paper, a national-level team); 2 state or regional (all-state,
  state champion, a state science fair place, a regional competition win); 3 school-level distinction (varsity letter,
  a school award, a lead role); 4 took part. The same four tiers as [awards](inputs-beyond-academics.md#awards).
- **Work and family** kinds carry hours and years like the rest; a job's role is member unless the student picks
  officer ("shift lead") or leader ("managed others"). They also feed `M_work`
  ([inputs-beyond-academics.md](inputs-beyond-academics.md#work-and-family-responsibilities)).
- The intake asks for activities only on four optional steps after AP courses (Sports, Clubs, Work, Other; see
  [intake.md "Activities, four steps"](../planner/redesign/intake.md#activities-four-steps)), never in the first
  two steps ([../planner/redesign/intake.md](../planner/redesign/intake.md)); the profile prompt says what it's for:
  "Colleges that read activities look for a few things done for years, with a role. Add your two or three biggest."

### The reading
Computed from the **top two** activities by `years × roleWeight` (member 1, officer 1.5, leader 2, using the highest
role held); the rest are reported, not scored. That is the whole treatment of a long list of one-year entries: it
neither helps nor hurts.

| Reading | Rule |
|---|---|
| **Focused** | Two activities with 3+ years each, and at least one of them with a leader role or recognition tier 1–2 |
| **Building** | One activity with 3+ years; or two with 2+ years and a role that rises year over year in one of them |
| **Sampling** | Anything else with at least one activity entered |
| *(not read)* | No activities entered: the estimate lists `activities` as missing where the college rates extracurriculars or talent at least *important* |

**Trajectory** (the role rises across the checked years, member → officer → leader) is what separates Building from
Sampling for two-year records and is named in the sentence for every reading. **Recognition** is read beside the
reading: the method takes the larger of the depth multiplier and the recognition multiplier, never both.

An activity marked `relatedToMajor` with 3+ years also counts as a year of the major's course track where the family
matches (`kind: "research"` or a club in a STEM major's subject), so Science Olympiad or a research program shows up
in the track sentence: "plus three years of Science Olympiad."

### The sentences
Suggestion first, in the student's words, never a grade:
- Focused: "Soccer, four years, captain this year; robotics, three years, treasurer. Two things carried through high
  school with a role in each: that's what colleges that read activities look for."
- Building: "Robotics, three years, officer this year. One activity carried through; a second you'd keep for two more
  years, or a bigger role in this one, would round it out."
- Sampling: "Six activities, each for a year or two. Colleges that read activities look for a few kept up over years
  with a role; pick the one or two you'd stay with."
- With recognition: "All-state in orchestra (state-level recognition) counts at colleges that rate talent."
- Where the college doesn't weigh it (C7 *not considered*, or no C7): "{College} doesn't say it weighs activities;
  they're shown here for you, not for the estimate."

## Where it shows
- **Profile → `/me` → Activities**: the list, the reading, and the sentences; **Courses** gets a "Tracks" line per
  family under the rigor reading.
- **College profile standing card and planner drawer**: one Depth line each for courses (the major's families) and
  activities, in the "what went into it" panel, cited to the college's C7 ratings where used.
- **Scores tab → Courses**: the track sentences beside the course plan's suggestions, which already read the
  expectations file; the plan's "your intended major" reason and the Steady sentence use the same expected top course.
- **Compare**: no new row; the standing row's estimate already includes it.
- Parents see everything the student entered (guardians are never hidden a student's data); privacy among siblings
  follows `apExamsPrivate`'s rule.

## Measurements
Two ablation switches, `depth_courses` and `depth_activities`, in the snapshot's `without_depth` column (both off);
the season report says what Depth bought. Depth never lowers a level, so the first season's question is only whether
Focused students are admitted more often than Sampling students with the same academic distance at colleges that rate
extracurriculars *important* (non-overlapping intervals), and whether a Deep major track predicts admission to the
major where the unit publishes a rate.

## Files (planned)
`lib/chances/depth.ts` (pure: `courseTracks(courses, core, offering, majors)`, `activitiesReading(activities)`,
the sentences as catalog notes), `lib/chances/types.ts` (`ActivityEntry`, `TrackReading`, `ActivitiesReading`),
`lib/student-profile.ts` (`activities`, validation: 8 entries, 60 characters, years ⊂ 9–12, hours 1–60),
`components/me/ActivitiesForm.tsx`, `components/me/CourseTracks.tsx`, the intake's optional step, `lib/chances/model.ts`
(the multipliers and the major-track slot), `lib/chances/notes.ts`, `lib/chances/snapshot.ts` (readings binned as
their words; counts of activities and years; never names), `tests/chances-depth.test.mts` (every reading on fixtures,
the top-two rule, trajectory, the major-track slot, no names in snapshots).

## Open questions
1. Should the intake's optional step show the activities form or only a link to `/me`? Recommendation: the form, two
   or three entries, because the planner header is where students are when the estimate asks.
2. IB SL at 1.5: treat as 2 if IB schools' students complain that SL is their top offering; the level table is one
   constant.

## As built (2026-10-12)
- `lib/chances/depth.ts`: `courseTracks`, `activitiesReading`, and `depthSnapshot` (the names-free shape for
  snapshots; no table column holds it yet). Shown as the Courses "Tracks" line and the activities reading on `/me` and
  in the planner's Scores tab → Courses (`components/me/CourseTracks.tsx`).
- An activity has no subject of its own, so `activityFamilyMatch` decides which track it can add a year to: research
  counts toward the major's science family (else computer science, else the major's first expected family); a club
  only toward computer science or science. IB SL counts 1.5 (open question 2's default).
- **Themes** (2026-10-12, [method Revision 2](method/standing.md#revision-2-depth-rank-and-rigor-nudges-2026-10-12)):
  `courseThemes(tracks, activities)` finds course families where the track reads Deep or Steady and an activity of two
  or more years has the same `family` (else its catalog entry's); its `depth.theme.*` sentences name the theme in
  family words and suggest the missing half.
