# Method: the Estimate's Rules (Standing, Third Version)

> Method (not a work item). The rules [Quad's estimate](../estimate.md) computes until a trained model replaces them.
> Kept here until launch; moves to a private repository then. Never shown on the site.
> **Third version, specified 2026-10-11** from the owner's review of the second (below, "What changed"): five levels
> instead of three, a measured academic position instead of three buckets, the college's
> [selectivity tier](../selectivity-index.md) in place of the 20% cutoff, and the new inputs from
> [depth.md](../depth.md) and [inputs-beyond-academics.md](../inputs-beyond-academics.md). Built as
> [levels.md](../levels.md). The second version (built 2026-10-11, `MODEL_VERSION 20261011.1`) is the yardstick its
> pinned examples are checked against.

## Goal
Admission at a selective college is **a threshold, then a lottery**: first, are the student's academics in the pool
the college admits from; second, how many applicants in *the student's* pool get in. The second version made the two
stages explicit. This version makes the first stage a measurement (how far in or out of range, not just which side),
lets what the student did outside the numbers move the odds where the college says it weighs that, and reads the
result on a five-step scale, so a student with top grades and a C student no longer see the same word at a college
admitting 4%.

```
Stage 1  HOW FAR IN THE POOL?          Stage 2  THE POOL'S ODDS            Stage 3  THE LEVEL
score distance   ─┐                    base rate for this student ─┐       hidden odds = rate × multipliers
GPA distance     ─┼─► academic         × academic multiplier       ├─►      capped by the college's tier
rank distance*   ─┤   distance d       × depth, hooks, interest*   ─┘       floored by guarantees and support
subject distance*─┘        │                                                → High reach / Reach / Target / Likely / Safe
                           └─► never shown; the level and the sentences are
* only where the college says it weighs them (C7) and the data exists
```

The hidden odds are an ordering device, never a prediction shown to anyone: no page, API response, export, or
telemetry event carries them (`estimate.md` "Results carry no internals"). They are stored, binned, in the outcome
snapshot for the season measurements only.

## Stage 1: the academic distance

### Which measures count
Unchanged from the second version. A measure counts at a college only when the college says it weighs that evidence,
from C7 when present, else the IPEDS factors:

| Measure | Counts when |
|---|---|
| **Score** | Test policy required or recommended; or test-optional and C7 rates tests at least *considered*. Test-blind, or test-optional with C7 *not considered* → unused. The "withheld" rule stays: test-optional and the score is below the range → assumed withheld, used only when nothing else can be placed |
| **GPA** | C7 GPA at least *considered*, or IPEDS GPA required/considered |
| **Rigor** | C7 rigor at least *important*, or IPEDS high school record *required*; fills the GPA slot at a crowded college, as before |
| **Class rank** | C7 rank at least *considered*, the student gave a rank (or a [class standing](../inputs-beyond-academics.md#class-standing)), and C10 `submitted_share ≥ 0.15` |
| **Major subjects** | The unit the student would apply to says it reads math or science grades, requires courses, or has a gate ([major-effects.md](major-effects.md)); extended by the [course track](../depth.md#course-tracks) of the major's subjects |

### The distance of each measure
Each counted measure becomes a number `d` on one scale: **0 at the college's 25th percentile, 1 at its 75th**, so one
unit is the width of the middle 50%. Clamped to [−2, 2.5].

| Measure | `d` |
|---|---|
| Score (SAT total, or ACT composite; the other test through the concordance, as before) | `(score − p25) / (p75 − p25)` |
| GPA, where the college reports C11 bands | The share of first-years **below** the student's GPA (`pct`, 0–1, from the cumulative bands with an even spread inside the student's band), then `d = (pct − 0.25) / 0.5`. A 4.0 at a college where 48% of first-years had a 4.0: `pct = 0.52 + 0.48/2 = 0.76`, `d = 1.02` |
| GPA, where only the fitted middle 50% exists (`derived.gpa_estimate`) | `(gpa − p25) / (p75 − p25)` |
| GPA, where only an average is reported | The second version's ±0.15 rule, then the categorical mapping below |
| Class rank, through C10 | `shareAtOrAbove` as before (share of ranked first-years at the student's rank or higher); `d = (0.75 − shareAtOrAbove) / 0.5` so the 25th-from-the-top is `d = 1` |
| Rigor slot, major subjects, and any measure with only a position | **above → 1.25, in → 0.5, below → −0.5** |

GPA crowding stays: at a college with `derived.gpa_top_share ≥ 0.5`, a GPA `d ≥ 0` is read as "meets the bar" and
set to 0.5 unless the rigor reading is *most* (then 1.25) or, once `RIGOR_CAN_LOWER` flips, *some* (then −0.5). A
GPA `d < 0` keeps its measured value.

### Combining
```
d = 0.6 × min(d_i) + 0.4 × mean(d_i)      over the counted measures
```
The weakest measure carries most of the weight: admissions readers treat one low measure as a flag and one high measure
as a tiebreaker. With one measure, `d` is that measure. With none, no level (the chip says "Add a number"), unless a
guarantee or open admission applies.

The summary position the sentences use ("Your academics: above / in the middle of / below admitted students") is
`d ≥ 1 → above`, `d < 0 → below`, else `in`.

## Stage 2: the pool's odds
`poolRateFor(student, school)` from [base-rates.md](../base-rates.md) gives the rate and its kind, unchanged:
automatic admission > the major's published rate > residency (in-state, out-of-state, international) > overall.

### The academic multiplier
The rate is multiplied by `M_acad(d)`, piecewise linear between these points:

| `d` | −1.5 | −1 | −0.5 | 0 | 0.5 | 1 | 1.5 | 2 |
|---|---|---|---|---|---|---|---|---|
| `M_acad` | 0.08 | 0.15 | 0.40 | 0.75 | 1.10 | 1.60 | 2.20 | 2.50 |

Below −1.5 and above 2 the ends hold. The multiplier is 1.1, not 1.0, at the admitted class's median (`d = 0.5`)
because the ranges describe *admitted* students: a student at their median is above the typical *applicant*, so their
odds run a little above the overall rate. The shape follows the Harvard trial exhibits (applicants in the top academic
decile admitted at several times the overall rate, the bottom deciles almost never) and the second version's cutoffs
(which this reproduces within one level at every pinned example; see the tests). The points live in one constants
object, `ODDS_V3`, and change only with a season measurement ([outcomes.md](outcomes.md)).

### The other multipliers
Each applies only where the college says it weighs the thing (C7), and each is `1` with a "not used here" sentence
otherwise. None lowers a student below `1` (the redesign's "encourage, don't grade"), except the major-subjects
distance, which is part of Stage 1 because the college itself states the requirement.

| Multiplier | From | C7 gate | Value |
|---|---|---|---|
| `M_depth` | The [activities reading](../depth.md#activities) and highest recognition tier | `extracurriculars` or `talent` at least *important* (half the effect at *considered*: `1 + (M − 1)/2`) | Focused 1.3 · Building 1.1 · Sampling 1.0; recognition tier 1 → 1.8, tier 2 → 1.25; **the larger of the two**, not the product |
| `M_work` | [Work and family responsibilities](../inputs-beyond-academics.md#work-and-family-responsibilities) | `work_experience` at least *considered* | 10+ hours a week in the school year 1.1; 20+ hours 1.2. Where `M_depth` already counts the work entry (it is one of the top two activities), `M_work` is 1 |
| `M_legacy` | The list row's [legacy toggle](../inputs-beyond-academics.md#legacy) | `alumni_relation`: *very important* or *important* 2.5; *considered* 1.5; *not considered* or no C7 1.0 | 1.0 with the "This state bars legacy preference" sentence where `data/reference/legacy-bans.json` covers the college's state and sector |
| `M_interest` | A visit, interview, or information request logged in the planner for this college | `interest` *very important* or *important* 1.15; *considered* 1.05 | |
| `M_recruit` | The list row's [recruited-athlete pick](../inputs-beyond-academics.md#recruited-athlete) at "a coach has contacted me" | none (the coach's interest is the evidence) | 1.5. Pre-read and likely letter are floors, below |
| `M_ed` | The college's C21 early-decision counts | **for the ED advice sentence only**, never in the level | `1 + 0.5 × (edRate / overallRate − 1)`, at most 2; half the raw ratio because ED pools hold recruited athletes and other hooked applicants |

```
odds = min(0.97, rate × M_acad × M_depth × M_work × M_legacy × M_interest × M_recruit)
```

## Stage 3: the level

### Cutoffs
| Hidden odds | Level |
|---|---|
| under 5% | **High reach** |
| 5% to under 25% | **Reach** |
| 25% to under 55% | **Target** |
| 55% to under 80% | **Likely** |
| 80% and up | **Safe** |

### Caps, from the college's selectivity tier
The college's [selectivity tier](../selectivity-index.md) for the student's pool (an out-of-state applicant uses the
out-of-state tier where the college has one) caps the level. This replaces the second version's "under 20% → Reach
for everyone":

| Tier | Highest level | Rule inside the tier |
|---|---|---|
| **Ultra selective** (key `elite`; "Elite" before 2026-10-12) | Reach | **Reach when no counted measure has `d < 0`; else High reach.** The odds are not used: at a 4% college the multiplier table alone would put even a top student under 5%, and the owner's rule is that an Elite college is a reach for everyone and a possibility for a student in its range |
| **Highly selective** | Target | By the odds |
| **Very selective** (added 2026-10-12) | Likely | By the odds |
| **Selective** | Likely, or Safe when `rate ≥ 0.5` | By the odds |
| **Accessible**, **Open** | Safe | By the odds |

**Safe** additionally requires `rate ≥ 0.5`, open admission, or a guarantee: a college admitting under half of a
student's pool is never called Safe, however strong the student.

### Floors, from facts the college states
Applied after the caps (they are the college's own statements, so they beat a tier):

| Fact | Floor | Label |
|---|---|---|
| A published automatic-admission program the student meets | Safe | "Guaranteed for you" |
| No admit rate on record (open admission) | Safe | "Admits everyone who applies" |
| Recruited: a likely letter | Likely, at any tier | "Recruited" |
| Recruited: a pre-read came back positive, and `d ≥ −0.5` | Target at Elite, Likely elsewhere | "Recruited" |

The "Reach for everyone" label becomes **"Elite: a reach for everyone"** and is set whenever the tier is Elite (both
High reach and Reach there).

### The move-up
`moveUp` (the fewest points on the student's test that raise the level one step) runs across the five levels and
respects the caps: no move-up is offered at an Elite college beyond Reach, and none when the test isn't counted.

### The ED sentence
Where the student's round is ED (or the planner asks "would ED help here?"), the sentence is chosen by
`rate × M_ed × (the other multipliers)` against the cutoffs:
- level unchanged → "Early decision doesn't change where this college stands for you."
- one level up → "Early decision would move this toward {level}; it's binding, so check the cost first."
- High reach, any multiplier → "Early decision is binding and helps most where you're already in range; this college
  isn't one of them yet." ([rounds.md](../../planner/redesign/rounds.md) "The ED guard")

## Pinned examples
`tests/chances-model.test.mts`. The second version's table must still hold within one level with every new input
empty (a test runs it through and asserts the level is within one step and the direction of any change is up for
students above range, down for students below). Fixtures copy the colleges' figures as fixed inputs.

| Student | College | `d` | Rate | Odds | Level | Why |
|---|---|---|---|---|---|---|
| SAT 1560, GPA 4.0 at a college where 48% had a 4.0, rigor *most* | Harvard-like: Elite, 3.5% | ≈ 1.1 | 3.5% | — | **Reach**, "Elite: a reach for everyone" | Elite; nothing below range |
| SAT 1100, GPA 2.6 | same | ≈ −1.6 | 3.5% | — | **High reach** | Elite; measures below range |
| SAT 1500, Georgia resident | Georgia Tech: 29% in-state, SAT 1370–1530, weighted GPA reporter → GPA unplaced; in-state tier Highly selective | 0.81 | 29% | 29 × 1.41 = 41% | **Target** | Capped at Target by the tier anyway |
| Same student from Florida | 10% out-of-state; out-of-state tier Elite | 0.81 | 10% | — | **Reach**, "Elite: a reach for everyone" | Elite rule |
| SAT 1500 (`d_sat = 0.83`), GPA 3.7 (`d_gpa ≈ −0.3`) | 15% college, SAT 1400–1520, Highly selective | 0.6 × (−0.3) + 0.4 × 0.27 = −0.07 | 15% | 15 × 0.70 = 10% | **Reach** | One weak measure keeps it under Target |
| SAT 1100, GPA 2.6 | 15% college | −1.6 | 15% | 15 × 0.08 = 1.2% | **High reach** | |
| Indiana, SAT 1300, GPA 3.85 (`d_gpa ≈ 0.5`) | Purdue: 71% in-state, SAT 1220–1470 | 0.6 × 0.32 + 0.4 × 0.41 = 0.36 | 71% | 71 × 1.00 = 71% | **Likely** | Same as the second version |
| Same from Ohio | 44% out-of-state | 0.36 | 44% | 44% | **Target** | Same as the second version |
| SAT 1450 | 45% college, SAT 1280–1450 | 1.0 | 45% | 45 × 1.6 = 72% | **Likely** | Was Target (second version's "all above, under 50%"): a score at the 75th percentile at a college admitting almost half is more likely than not; the change is deliberate and measured |
| ACT 24 | 40%, ACT 28–33, test required | −0.8 | 40% | 40 × 0.25 = 10% | **Reach** | Same |
| SAT 1450 | 78%, SAT 1100–1300, Accessible | 1.75 | 78% | 78 × 2.35 → 97% | **Safe** | Was Likely; rate ≥ 50% so Safe is allowed |
| No test, GPA 3.9 | 35%, average GPA 3.7 (above by the ±0.15 rule → 1.25) | 1.25 | 35% | 35 × 1.9 = 66% | **Likely** | Was Target; one measure, and it's a strong one |
| SAT 1200, GPA 3.8 | test-optional 45%, SAT 1280–1450, average 3.75 (in → 0.5); score withheld | 0.5 | 45% | 45 × 1.1 = 50% | **Target** | Same |
| GPA 3.90, 8 of 9 APs (*most*), not sending; Focused activities (4 years soccer, captain; 3 years robotics) | Elon: 63%, 70% at 3.75+, rigor *very important*, extracurriculars *important*, tests not considered; Selective | GPA meets the bar, rigor fills the slot → 1.25 | 63% | 63 × 1.9 × 1.3 → 97% | **Safe** | Rate ≥ 50% |
| GPA 3.90, no courses, no activities | Elon | 0.5 | 63% | 63 × 1.1 = 69% | **Likely** | Was Target |
| Texas, top 4%, SAT 1350 | UT Austin, automatic admission top 5% | — | guarantee | — | **Safe**, "Guaranteed for you" | Floor; the reason adds that the major isn't guaranteed |
| GPA 3.90, 2 of 14 APs (*some*) | a crowded college admitting 45% | GPA → 0.5 (rigor below is shown, not used) | 45% | 50% | **Target** | `RIGOR_CAN_LOWER = false` |
| SAT 1450, GPA 3.9, legacy toggled | 12% college, C7 alumni relation *considered*, Highly selective, Massachusetts | 0.9 | 12% | 12 × 1.5 × 1.5 = 27% | **Target** | Legacy lifts one level inside the cap |
| Same, college in Maryland | same | 0.9 | 12% | 12 × 1.5 = 18% | **Reach** | Maryland bars legacy preference at public and private colleges; the sentence says so |
| SAT 1300, GPA 3.6, recruited with a likely letter | 6% college, Elite | 0.3 | 6% | — | **Likely**, "Recruited" | Floor beats the cap |

## What the student enters
Nothing new is required; each input improves the level where it applies and the "what went into it" panel says which:
state, intended major, class standing or rank, courses (with grades and AP scores), activities and awards, work hours,
and per college on the list: legacy, recruited, and logged interest.

## What changed from the second version
| Second version | Third version | Why |
|---|---|---|
| Three positions per measure (below / in / above) | A distance `d` on the range's scale | 10 points under the 25th percentile and 300 points under were the same word |
| Admit rate under 20% → "Reach for everyone", whatever the numbers | The college's selectivity tier caps the level; inside Elite, in range → Reach, below → High reach | A 4.0/1560 and a C student saw the same Reach at Harvard, and the planner then started the Dream in ED for both |
| Cutoffs at 50/60/70% on the rate by position pattern | Hidden odds `rate × multipliers`, five cutoffs | One ordering the list, the ED advice, and the balance line all read |
| Likely at the top | Likely, then Safe with a strict bar | Counselors avoid "safety" short of a guarantee; Safe requires one, open admission, or ≥ 50% with the student clearly above range |
| Rigor, rank, residency, major subjects | Plus depth (course tracks, activities), awards, work, legacy, recruited, interest | What colleges say they read, gated by their own C7 ratings |
| No legacy, ever (public commitment) | Legacy as a per-college toggle, weighted where the college weighs it, zero where state law bars it | Owner decision 2026-10-11; the commitment now excludes race, ethnicity, sex, and religion, and anonymizes every individual |
| No high school identity, ever | Not used in this version; reserved for a later season ("how many students does this college take from your school") once outcomes exist | Owner decision 2026-10-11 |

## As built (third version, `MODEL_VERSION 20261012.1`)
Built 2026-10-12 in `lib/chances/model.ts` (constants in `ODDS_V3`), `lib/chances/hooks.ts` (`HOOKS_V3`,
`legacyMultiplier`, `interestMultiplier`, `recruitMultiplier`, `recruitedFloor`), pinned in
`tests/chances-model.test.mts` and `tests/chances-hooks.test.mts`. Choices the rules above left open:
- **GPA distance source order**: the C11 bands (share below, even spread in the student's band, half the 4.0 band below
  a 4.0), else the middle 50% (exact or fitted; an uncertain end read at its midpoint), else the position's fixed
  value. Where the second version's reading can't place the GPA (a weighted range spanning the college's), it isn't
  a measure.
- **The major-track slot** counts only where the unit says what it reads (math or science emphasis, required courses,
  or a gate), and is taken only when it raises `d` (depth never lowers a level).
- **`M_depth`'s gate** is the higher of the college's extracurriculars and talent ratings; `M_work` is 1 when the work
  entry is one of the top two activities at a college that weighs activities at all.
- **Elite with no counted measure**: no level ("Add a number"), like any college, unless a floor applies.
- **Floors**: the recruited label is set whenever a floor applies (even when the level is already above it); a
  pre-read without numbers that place the student is no floor.
- **`closeness`** is null at Elite, and wherever a cap (including the Safe rule) or a floor (a guarantee, open
  admission, a recruited floor) set the level.
- **ED**: `M_ed` is held between 1 and 2 (ED never lowers); the verdict is computed for every result with a level
  (the planner reads it), `not_advised` at High reach whatever the data, null without C21 counts; the sentence shows
  only when the student's round is ED or ED II.
- **Snapshots** record the hidden odds binned to 0.005, the tier, and the level with depth, hooks (legacy and
  recruited), and interest switched off. The Depth readings (`depthSnapshot`, no names) are in the method's detail;
  the table has no column for them yet.
