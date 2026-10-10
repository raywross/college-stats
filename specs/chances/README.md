# Admission Chances: Quad's Estimate, Its Inputs, and Where It Shows

> Overview of the chances work (not a work item itself). Written 2026-10-10 from the owner's input on grade inflation
> and holistic admission, the planner's built standing (planner redesign, PR #105), the planned
> [chances-and-fit.md](../product/chances-and-fit.md), and the site's data that day. Each part below is a separate work
> item on the [roadmap](../roadmap.md).

## Why
The planner sorts every college on a student's list into Reach, Target, or Likely, and the profile will show the same
"Where you stand". At a growing number of colleges most admitted students have nearly the same top GPA, so a GPA and
one test score no longer separate applicants well; colleges lean on course rigor (read against the high school), the
subjects that matter for the major, tests, and the pool the student is applying from. This work gives the estimate
those inputs and shows families the evidence behind it.

## Quad's estimate is proprietary
Owner decision, 2026-10-10: **how Quad turns inputs into Reach, Target, or Likely is a trade secret**, like Zillow's
Zestimate. It will change as the site collects more data and outcomes.

| Shown on the site | Never shown on the site |
|---|---|
| The **kinds of inputs** the estimate uses (below), and which of the student's inputs were used for a given college | How inputs are weighted, combined, or thresholded; rules, cutoffs, models, and their parameters |
| The **output**: Reach, Target, or Likely, with the labels "Reach for everyone" and "Guaranteed for you" | Training data, tuning, and the method's version history |
| The **college facts** shown beside it, each cited as everywhere on the site (admit rates, ranges, factor ratings, required courses) | Internal accuracy diagnostics beyond the published summary |
| A **published accuracy summary** each season ([calibration.md](calibration.md)), as Zillow publishes its error rates | |
| The **commitments**: never a percentage; never race, ethnicity, sex, legacy, or high school identity as inputs | |

What follows from it:
- **On the site, inputs and outputs only.** Pages, release notes, and the glossary say what kinds of information the
  estimate uses and which of the student's inputs it used, never how they are combined.
- **The estimate is computed on the server.** No method code ships to the browser; pages and the planner ask an
  endpoint for the result ([estimate.md](estimate.md#architecture)).
- **Until launch, the method lives in this repository**, in [method/](method/standing.md) and server-only code. Owner
  decision, 2026-10-10: the repository stays public before launch (no paid GitHub plan yet) and nobody is expected
  to look; the method is not hidden for now.
- **At launch, it moves to a private repository** and reaches the site as a private package behind the same
  interface ([the launch step](estimate.md#at-launch-move-the-method-private)). Keeping the interface, the
  server-only rule, and the note catalog from the start is what makes that move a small change.
- The site's citation rule still holds for every *fact* shown with the estimate; the estimate itself is labeled
  **Quad's estimate** with its inputs listed, never presented as a college's figure.

### The method (until launch)
| File | What it holds |
|---|---|
| [method/standing.md](method/standing.md) | The rules: which evidence counts at a college, GPA crowding, the rigor, rank, and major positions, the pool's rate, the thresholds, pinned examples |
| [method/rigor-reading.md](method/rigor-reading.md) | How a schedule maps to a rigor reading, and the grades rule |
| [method/major-effects.md](method/major-effects.md) | How a unit's major review changes the estimate |
| [method/outcomes.md](method/outcomes.md) | How outcomes are measured each season, threshold changes, and the gate any trained model must pass |
| [method/proposal-review.md](method/proposal-review.md) | The review of the owner's grade-inflation model: what was adopted, adapted, and rejected, with measurements and sources |
| [method/ideas/grade-inflation-acceptance-model.md](method/ideas/grade-inflation-acceptance-model.md) | The owner's input document, as written |

## The inputs
| Kind | Examples | Spec |
|---|---|---|
| The student's academics | Unweighted GPA (built), one test score and its sections (built), class rank (built), the advanced courses taken and planned with grades, math and science grades for STEM majors | [rigor-in-context.md](rigor-in-context.md), [major-and-grades.md](major-and-grades.md) |
| The student's context | State, intended major, application round, high school (for what it offers) | [base-rates.md](base-rates.md) |
| The high school | Advanced courses offered (CRDC for 13,191 high schools; school profiles), grading scale, rank policy | [rigor-in-context.md](rigor-in-context.md#the-schools-offering) |
| The college's own filings | Admit rates (overall, by residency, by major where published), test and GPA ranges and bands, factor ratings (CDS C7, IPEDS), class rank tiers, required and recommended courses, how the major is reviewed, automatic-admission programs | [how-colleges-read.md](how-colleges-read.md), [base-rates.md](base-rates.md), [major-and-grades.md](major-and-grades.md) |
| Outcomes | Admission results students choose to share, counselor uploads | [calibration.md](calibration.md) |

## What the site has today (measured 2026-10-10)
| Evidence | Colleges or schools | Where it comes from |
|---|---|---|
| Admit rate | 1,547 of 1,893 colleges | IPEDS, newer CDS where published |
| SAT or ACT middle 50% (math sections: 931 SAT, 846 ACT) | 931 | IPEDS, CDS C9 |
| Admission factors | 1,586 (IPEDS scale); 147 with the CDS C7 four-level grid | IPEDS ADM; CDS C7 |
| GPA bands | 116 with any column, 71 with all first-years | CDS C11 |
| Class rank tiers | 117 | CDS C10 |
| Course units required and recommended | 156 | CDS C8 |
| Early decision counts | 42 | CDS C21 |
| Admit rates by residency | 71 | CDS C1 grid |
| AP courses offered | 13,191 of 35,390 high schools (median 9) | CRDC 2023–24 |
| School profile (scale, rank policy, AP list) | the 100 pilot high schools | School profile PDFs |

The CDS-based rows grow with every college-reported run without code changes.

## The parts
| Part | Spec | Adds | Profile | Planner | Complexity |
|---|---|---|---|---|---|
| 1 | [how-colleges-read.md](how-colleges-read.md) | "How this college reads a record": its factor ratings in words, how crowded its first-years' GPAs are, tests, class rank, courses expected | Top of "What they look at"; a Compare row | Linked from each row's ⓘ | Small |
| 2 | [rigor-in-context.md](rigor-in-context.md) | A course list (each AP, IB, dual-enrollment, and honors course with year, status, grades, optional exam score), the AP catalog, the school's offering, a plain reading of the schedule against it | A courses line in the standing card; a You column in "What you'll need in high school" | Optional "Add your courses"; a Courses section in Scores | Medium |
| 3 | [base-rates.md](base-rates.md) | The admit rate for the student's own pool (automatic admission, major, residency), shown with its source | The rate that applies to you; the guarantee line | "Guaranteed for you" where a published program applies | Large |
| 4 | [estimate.md](estimate.md) | Quad's estimate: the interface, server-side computation, the open baseline, the "what went into it" panel; the move to a private package at launch | "Where you stand" chip and card | Automatic groups, retake and course suggestions, balance line | Medium |
| 5 | [calibration.md](calibration.md) | Outcomes shared with consent, the published accuracy summary, "students like you" counts | Counts under the estimate when a cell has enough outcomes | Outcome snapshots on "applied" | Large |
| 6 | [course-plan.md](course-plan.md) | Next year's advanced courses: up to two suggestions from the school's list, with guardrails for grades and load; the course-registration and AP-exam dates | One "you're on track for 3 of 4 years" line | A Next year card in Courses; calendar tasks; "send AP scores for credit" | Medium |
| 7 | [major-and-grades.md](major-and-grades.md) | How each college says the intended major is reviewed (the pool, subject emphasis, required courses, score requirements), quoted per unit; math and science grades for STEM majors | A Major line; the unit's required courses | Requirements in the course plan; score requirements in Scores | Medium |

## Build order
```
how-colleges-read ─────────┐
rigor-in-context ──────────┼──► estimate ──► calibration (first season after launch)
base-rates ────────────────┤        │
major-and-grades ──────────┘        │
rigor-in-context ──► course-plan ◄──┘ (its "what it changes" line)
```
- `how-colleges-read` first: profile-only, small, no account.
- `rigor-in-context`, `base-rates`, and `major-and-grades` collect and show inputs; they are useful on the profile
  before the estimate reads them.
- `estimate` after them, and **after PR #105 merges**: it moves the planner's standing behind the server-side
  interface and implements [method/standing.md](method/standing.md).
- `course-plan` after `rigor-in-context`; ship it before February so the first course-registration season uses it.
- `calibration`'s outcome snapshots ship with `estimate`; the first summary runs after that season's decisions.
- Build with the `build-roadmap-section` skill, one unit per part; the units that touch the estimate read the method
  files.

## What happens to existing specs
| Spec | Change |
|---|---|
| [chances-and-fit.md](../product/chances-and-fit.md) | Its **Display**, **Fit**, and **Caveats** stay its own work item. Its published rules become the open baseline (development and, after launch, anywhere the private package isn't installed) ([estimate.md](estimate.md#architecture)); "published on the glossary" no longer applies to the production method |
| [../planner/redesign/standing.md](../planner/redesign/standing.md) | Unchanged in PR #105; [estimate.md](estimate.md) later moves `standingFor` behind the server-side interface |
| [getting-into-the-major.md](../ideas/getting-into-the-major.md) | Stays an idea; base-rates and major-and-grades promote a first wave of its data |
| [scattergrams.md](../product/scattergrams.md) | Unchanged; its uploads become an outcome source |

## Shared rules
- **Never a percentage.** Reach, Target, or Likely, with labels; facts shown beside it are what they are (the share of a
  pool admitted, with its year).
- **Inputs, not method, on the site.** Pages say what kinds of information the estimate uses and which of the
  student's inputs it used; never how they are combined. The method's files are for building it, not for display.
- **Every fact cited.** College and high school facts keep their lineage; the estimate is labeled Quad's estimate.
- **No protected traits, no high school identity** as inputs, ever (a public commitment).
- **Encourage, don't grade**: the planner redesign's principles apply to every planner surface.
