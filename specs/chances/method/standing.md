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
| **Ultra selective** (key `elite`; "Elite" before 2026-10-12) | Reach | **Reach when no counted measure has `d < 0`; else High reach** (replaced by [Revision 1](#revision-1-consistency-and-completeness-2026-10-12): Reach only when every signal is consistent). The odds are not used: at a 4% college the multiplier table alone would put even a top student under 5%, and the owner's rule is that an Elite college is a reach for everyone and a possibility for a student in its range |
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
students above range, down for students below). Fixtures copy the colleges' figures as fixed inputs. This is the table
as built at `20261012.1`; [Revision 1](#revision-1-consistency-and-completeness-2026-10-12) moves six rows and holds
the within-one-level check on complete records.

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

## Revision 1: consistency and completeness (2026-10-12)
`MODEL_VERSION 20261012.2`, in `lib/chances/model.ts` (constants in `ODDS_V3`), pinned in
`tests/chances-model.test.mts`. The owner's rules, as given:

1. "A top tier student in terms of rigor and class rank with a great SAT score would be slightly better than that
   same student with a worse score, but a better SAT score wouldn't make a top tier student worse than a non top tier
   student with a better SAT. Standardized test scores fit into this consistency area: we expect great scores aligned
   with other great data, but not overweighted."
2. "For an Ultra selective school to be listed as Reach instead of High reach, all signals must be consistent that the
   student is academically excellent and well rounded." The class-standing bar is **top 5%** (owner, 2026-10-12).
3. "Only entering a standardized test score should harm our score. Gaps in data lower our confidence and therefore
   lower our score. We should build such that we require more data."

### The test as a consistency check (rule 1)
The core distance is `d_core = combine(core)` over every measure but the test: the GPA slot after crowding and rigor,
class rank, and the major's subjects (with the course track as before). Then:

```
d = d_core + clamp(testPull × (d_test − d_core), −testDown, +testUp)    where the test is counted and d_core exists
d = d_test                                                              where the test is the only measure
```

| Constant | Value |
|---|---|
| `testPull` | 0.25 |
| `testDown` | 0.30 |
| `testUp` | 0.20 |

The withheld and unused rules stay (test-optional and below the range → assumed withheld, the distance only when
nothing else can be placed; tests not considered → unused). A test in line with the record confirms it; one out of
line moves it at most 0.3 down or 0.2 up, so a strong record with a weak score stays ahead of a middling record with a
top score at every tier (tested at every tier and five rates).

### Ultra selective: Reach only on consistent excellence (rule 2)
At tier `elite` the level is **Reach** only when all of these hold, else **High reach** (the odds still aren't used):

| Signal | Passes | Missing (named to the student) |
|---|---|---|
| GPA slot | `d ≥ 0` after crowding and rigor | No GPA entered. A GPA the college's data can't place fails as short |
| Rigor | Reading `most` or `much` | No courses entered; courses the reading can't place (no school offering) ask for the high school |
| Class standing | `top1` or `top5`, or a typed rank in the top 5%; "My school doesn't rank" passes | No answer |
| Test | Counted and `d_test ≥ 0`; not counted (withheld, unused, or none at a test-optional college) passes | None where the college requires one |
| Well rounded | Activities reading Focused or Building, or recognition tier 1 or 2 from activities or awards | No activities or awards |

This replaces "no counted measure below the range". Recruited floors and guarantees still beat it. The move-up at an
Ultra selective college now finds a score only where every other signal already passes.

### Completeness (rule 3)
The inputs a college can expect are the ones it weighs, read as the measures are (C7, else the federal factors):

| Input | Weight | Expected where | Present when |
|---|---|---|---|
| GPA | 3 | The GPA counts (`weighsGpa`) | A GPA is entered |
| Courses (rigor) | 2 | Rigor counts (`weighsRigor`: C7 at least *important*, or IPEDS record *required*) | Courses or core answers are entered |
| Class rank / standing | 1 | C7 class rank at least *considered* | A rank or any class-standing pick, `no_rank` included |
| Test | 1 | Test policy required, required-some, or recommended; or the student has a test and the college weighs it. Never at test-blind colleges or where C7 says tests aren't considered | A test is entered |
| Activities | 1 | C7 extracurriculars or talent at least *considered* | Any activity or award |

```
completeness = present weight ÷ expected weight        (1 when nothing is expected)
d_eff        = min(d, completeness × d + (1 − completeness) × gapPrior)      gapPrior = −0.5
odds         = rate × M_acad(d_eff) × the other multipliers
```

An unknown reads as below the middle of admitted students, so a score alone is mostly gap and reads low, and a GPA
alone reads well under the full record. The `min` keeps a gap from ever raising a record already below the prior (the
formula alone would lift a student below range who leaves inputs out, against rule 3); it is what makes "an
incomplete record is never placed above the same record completed" hold.

What the student sees: every expected input not entered joins `missing` (at an Ultra selective college, every input its
rule needs too); the one prompt picks the heaviest gap first (GPA, courses, class rank, then the others, the test
last); and a new catalog sentence names the gaps in words: "Not in this estimate yet: your courses, class standing,
and activities. Adding what you have gives a fuller picture and could change where this college stands for you."
(`estimate.incomplete`, shown in "What went into this estimate" above the prompt). Neither completeness, `d`, the
prior, nor any number from this reaches a result, a sentence, an API response, an export, telemetry, or a client
bundle; the leak guards check the new names. The summary sentence ("Your academics: in the middle of admitted
students") reads the measured `d`, not `d_eff`: it describes the record entered, and the gaps are named separately.

Snapshots: no column records completeness yet (follow-up: `completeness` binned to 0.05 in the snapshot detail once a
column exists). Done in [Revision 2](#completeness-recorded).

### Pinned examples, Revision 1
`d` is the measured distance (the test as a consistency check); `c` is completeness.

| Student | College | `d` | `c` | Odds | Level | Change |
|---|---|---|---|---|---|---|
| SAT 1560, GPA 4.0, rigor *most*; no class standing, no activities | Harvard-like, Ultra selective, 3.5% | ≈ 1.1 | 1 | — | **High reach**, "Elite" | Was Reach: class standing and activities missing (rule 2). With top 5% and Focused: Reach; top 10%: High reach |
| SAT 1100, GPA 2.6 | same | −0.8 | 0.67 | — | **High reach** | Same |
| SAT 1500 only, Georgia resident | Georgia Tech in-state, Highly selective, 29% | 0.81 | 1/7 | 15% | **Reach** | Was Target: a score alone is mostly gap |
| Same from Florida | Ultra selective out of state | 0.81 | 1/7 | — | **High reach**, "Elite" | Was Reach: no signal but the test |
| SAT 1500 (0.83), GPA 3.7 (−0.3) | 15%, Highly selective | −0.3 + 0.2 = −0.10 | 1 | 10% | **Reach** | Same |
| SAT 1100, GPA 2.6 | 15% | −2.0 | 1 | 1.2% | **High reach** | Same |
| Indiana, SAT 1300, GPA 3.85 | Purdue, 71% in-state | 0.55 | 4/7 | 58% | **Likely** | Same (courses and class standing missing) |
| Same from Ohio | 44% out-of-state | 0.55 | 4/7 | 36% | **Target** | Same |
| SAT 1450 only | 45%, SAT 1280–1450 | 1.0 | 1/4 | 30% | **Target** | Was Likely: no GPA (Likely with one) |
| ACT 24 only | 40%, ACT 28–33 | −0.8 | 1/4 | 10% | **Reach** | Same (a gap doesn't lift a record below the prior) |
| SAT 1450 only | 78%, Accessible | 1.75 | 1/4 | 62% | **Likely** | Was Safe: no GPA (Safe with one) |
| No test, GPA 3.9 | 35%, average 3.7, test-optional | 1.25 | 1 | 66% | **Likely** | Same (no test is no gap at a test-optional college) |
| SAT 1200 (withheld), GPA 3.8 | test-optional 45% | 0.5 | 1 | 50% | **Target** | Same |
| GPA 3.90, 8 of 9 APs, Focused | Elon, 63%, Selective | 1.25 | 6/7 | 97% | **Safe** | Same (class standing missing) |
| GPA 3.90 only | Elon | 0.5 | 3/7 | 44% | **Target** | Was Likely: courses, class standing, activities missing |
| Texas, top 4%, SAT 1350 | UT Austin | — | — | guarantee | **Safe**, "Guaranteed" | Same |
| GPA 3.90, 2 of 14 APs (*some*) | crowded 45% | 0.5 | 5/7 | 41% | **Target** | Same |
| SAT 1450, GPA 3.9, legacy | 12%, Massachusetts | 0.9 | 1 | 27% | **Target** | Same |
| Same, Maryland | 12% | 0.9 | 1 | 18% | **Reach** | Same |
| SAT 1300, GPA 3.6, likely letter | 6%, Ultra selective | 0.3 | 1 | — | **Likely**, "Recruited" | Same |

The within-one-level check against the second version now runs on complete records (every expected input entered,
activities Building); a separate test checks that leaving out courses, activities, or class standing never places a
record above the same record completed.

Across the 1,893 colleges (2026-10-12), against `20261012.1`: a student with only a GPA 3.8 and an SAT 1350 sees 336
of 1,378 placed colleges move down a level (Safe → Likely mostly), 4 up; a complete record (GPA 3.9, SAT 1450, eight
APs, top 10%, Building) sees 27 move, 13 of them Ultra selective colleges down to High reach for the top-5% bar.

## Revision 2: depth, rank and rigor nudges (2026-10-12)
`MODEL_VERSION 20261012.3`, in `lib/chances/model.ts` (constants in `ODDS_V3`) and `lib/chances/depth.ts`
(`courseThemes`), pinned in `tests/chances-model.test.mts`. The owner's words, as given:

1. Valedictorian and salutatorian "should be viewed as an expectation… but this expectation should nudge scores up; top
   5% a little, the absolute top a bit more."
2. "Having a weighted grade higher than an unweighted one is a good measure of rigor… should nudge up."
3. "Someone taking a lot of art courses and doing art clubs would increase depth." "Depth should nudge up scores, and
   having it across the different things we track should amplify."
4. "For the top schools, to be listed as Reach you would need depth, great academics, consistency in things like APs,
   great grades in your APs, clubs that overlap with your academics."

### Rank nudges (rule 1)
Only where the college weighs class rank or GPA (`weighsRank` or `weighsGpa`, read as Stage 1 reads them). The highest
that applies, never stacked:

| From | `M_rank` |
|---|---|
| Class standing Top 5% (the pick, or a typed rank at or under 5) | 1.05 |
| Class standing Top 1% (the pick, or a typed rank at or under 1) | 1.08 |
| `rankExpectation` salutatorian | 1.10 |
| `rankExpectation` valedictorian | 1.15 |

"My school doesn't rank" is no standing nudge (an expectation still counts). An expectation is stated, not known: its
sentence says so ("Class standing: expects to be valedictorian, an expectation until it's official. {College} weighs
grades and class standing, so it counts here.", `estimate.rank_expectation`); a top standing without a C10 rank
sentence gets `estimate.rank_top`. Where the college weighs neither, a stated expectation shows "Not used here: class
standing". Switched off with the `rank` ablation.

### Weighted over unweighted (rule 2)
Only where the college weighs rigor or GPA. The lead of the weighted GPA (`EstimateStudent.weightedGpa`, as the school
reports it) over the unweighted one, on the student's own scale:

| Scale | Unweighted read as | Lead ≥ | `M_weighted` |
|---|---|---|---|
| 4.0 | `gpa` | 0.3 / 0.6 | 1.04 / 1.08 |
| 5.0 | `gpa × 5/4` (the 4.0 conversion read back) | 0.3 / 0.6 | 1.04 / 1.08 |
| 100 | the top of the 4.0 conversion's 100-point band (4.0 → 100, 3.7 → 96, 3.3 → 92, …) | 3 / 6 points | 1.04 / 1.08 |

Nothing when the weighted GPA is missing or not above by the first step; nothing when a 4.0-scale GPA was itself entered
above 4.0 (read as a range, so the unweighted one isn't known); nothing for a weighted figure above 6 on a 4- or
5-point scale (`weightedMaxPoints`, another scale or a typo). The 100-point steps are the "equivalent gap": weighting
adds about ten points a course on a 100-point scale where it adds one on a 4-point scale. Sentence:
`estimate.weighted_above` ("Your weighted GPA (4.5) sits well above your unweighted one, a sign of demanding courses,
which {College} weighs."). Switched off with the `rigor` ablation.

### Themes: depth across what we track (rule 3)
A **theme** is a course family whose [course track](../depth.md#course-tracks) reads Deep or Steady **and** that at least
one activity of two or more years shares through `ActivityEntry.family` (else, for a catalog pick, the catalog entry's
family, `activityByKey(catalogKey)`). An activity with no family never counts; activity families with no course
(athletics, service, leadership…) never make one.

| Themes | `M_theme` |
|---|---|
| 1 | 1.10 |
| 2 or more | 1.18 |

`M_theme` applies where the college rates extracurriculars or talent at least *considered* (the full value at
*considered*, unlike `M_depth`'s half), multiplies with `M_depth`, and is switched off with the `depth` ablation:

```
odds = min(0.97, rate × M_acad(d_eff) × M_depth × M_theme × M_work × M_legacy × M_interest × M_recruit × M_rank × M_weighted)
```

Sentences (`depth.theme.*`, family words only, never an activity's name): "Your math and science courses and your math
and science activities line up: depth in one thing, in and out of class."; an activity with no track behind it: "You
keep up art outside class; an honors or advanced art course each year would tie it to your schedule."; a track with no
activity, only while there is no theme yet, deepest track first: "Your science courses run through high school; a club,
team, or program in science would tie them to what you do outside class."; and with no theme and an activity of two or
more years with no family: "Pick what each activity is about (art, science, a sport…) so it can line up with your
courses."

### Ultra selective: Reach also needs depth and consistency (rule 4)
Revision 1's conditions stay. Reach at tier `elite` now also needs all of:

| Signal | Passes | Missing (named to the student) |
|---|---|---|
| Depth | Activities reading Focused or Building **and** at least one theme | No activities. Without a theme the theme suggestions show |
| Consistency in advanced courses | An advanced course (AP, IB, dual) in every year from the first year with one through the current year (the student's grade, else the latest year with a course taken or in progress), and at least three in all | When the only gap is the current year: "advanced courses this year" |
| Grades in advanced courses | `advancedGpa` (the unweighted 4-point average the snapshot already bins) at least 3.7 | A taken advanced course with no grade: "advanced-course grades" |

The missing pieces join the incomplete sentence ("Not in this estimate yet: your advanced courses this year…"), so the
drawer shows the "part of your record isn't here yet" line. A recruited floor and a guarantee still beat the rule.

### Completeness, recorded
Revision 1's completeness is unchanged; activities of any kind (sports, clubs, work, family, other) count as activities
present. It is now a snapshot column: `application_snapshots.completeness numeric(3,2)`, 0–1 in steps of 0.05
(`supabase/migrations/20261012120000_snapshot_completeness.sql`, which re-creates `record_application_snapshot()` with
it), written from the method's detail (`SnapshotDetail.completeness`, binned by `binCompleteness`). The account export
includes it with the student's own snapshots; no page, result, sentence, or telemetry event carries it.

### Constants (`ODDS_V3`)
| Name | Value |
|---|---|
| `rankNudge` | top5 1.05 · top1 1.08 · salutatorian 1.10 · valedictorian 1.15 |
| `weightedGap` | ≥ 0.6 → 1.08 · ≥ 0.3 → 1.04 |
| `weightedGap100` | ≥ 6 → 1.08 · ≥ 3 → 1.04 |
| `weightedMaxPoints` | 6 |
| `theme` | one 1.10 · two 1.18 |
| `ultraAdvancedCount` | 3 |
| `ultraAdvancedGpa` | 3.7 |
| `THEME_TRACKS`, `THEME_ACTIVITY_YEARS` (depth.ts) | Deep, Steady · 2 |

### Pinned examples, Revision 2
Every Revision 1 row keeps its level and odds (none of them enters a weighted GPA, an expectation, a top-5% standing at
a college weighing rank or GPA, or an activity family). One footnote moves, and four rows are added:

| Student | College | Odds | Level | Change |
|---|---|---|---|---|
| SAT 1560, GPA 4.0, eight APs all in 11th grade, top 5%, Focused (soccer, robotics, no family) | Harvard-like, Ultra selective | — | **High reach** | Was Reach (Revision 1's "with top 5% and Focused"): no theme and no advanced course before 11th grade |
| SAT 1560, GPA 4.0, nine APs over 10th–12th (science deep), top 5%, soccer captain and three years of Science Olympiad (science) | same | — | **Reach**, "Elite" | New: every signal, with a theme and an advanced course every year |
| SAT 1350 (`d = 0.5`), GPA entered, valedictorian expected | 20%, weighs GPA | 22 × 1.15 = 25.3% | **Target** | New: Reach (22%) without the expectation; top 5% gives 23.1%, still Reach |
| Same, valedictorian and a weighted 4.5 over an unweighted 3.9 | same | 22 × 1.15 × 1.08 = 27.3% | **Target** | New: the two nudges multiply (they're different things); the rank nudges never stack with each other |
| GPA 3.9, nine APs over 10th–12th, "doesn't rank", Science Olympiad (3 years, science) and math team (2 years, math) | Elon at 25%, Selective | 52.3% → 57.5% (one theme) → 61.7% (two) | **Likely** | New: Target without the families; one theme lifts it a level |

Tests: each nudge on, off where the college doesn't weigh it, and highest only; themes one, two, none, an activity
without a family, a catalog pick's family; each new Ultra selective condition alone; completeness in the detail, the
row, and the database (a PGlite test shows the column written and updated, and that the five-levels function body
leaves it null). The leak guards name the new constants (`rankNudge`, `weightedGap`, `M_theme`, …) and check no result
carries any of their values; each new rule was removed in turn and its test failed.

## Revision 3: the estimate reads the record the way the owner does (2026-10-12)
`MODEL_VERSION 20261012.4`, in `lib/chances/model.ts` (constants in `ODDS_V3`, the reading in `ownerReading`),
`lib/chances/depth.ts` (`groupTrack`, `courseThemes`, `activityFamilyMatch`), `lib/chances/depth-groups.ts` and
`data/reference/depth-groups.json` (checked by `npm run check:depth-groups` in verify), pinned in
`tests/chances-model.test.mts` and `tests/chances-owner-reading.test.mts`. Written after the owner entered a real
junior (class of 2028) they expect to be a Reach at Vanderbilt; Revision 2 said High reach because it read APs with
exam scores but no letter grades as ungraded and because a business club (DECA) couldn't line up with any course.

### The owner's words, as given
1. "APs are graded on a scale of 1 to 5."
2. "Business has ties in with math, statistics, computer science. We should more loosely have concepts of STEM vs
   arts… a good way to loosely group will make it easier to draw a depth conclusion; that's how a student's essays and
   recommendations tie things together, and we don't have those."
3. "For a student at this point in the timeline, we should assume their target ACT or SAT score is the score. Once
   they've completed junior year we should use their actual score."
4. "We should assume for a junior that they'll continue on with a trend on their APs." "APs can't be taken until
   sophomore year, so we shouldn't penalize not starting until then."
5. "We're not asking for actual, we're asking for their perceived place amongst their peers… a proxy in a similar way
   as weighted GPA."
6. "Connected to my major" is computed, not asked.
7. The state comes from the high school when the student hasn't entered one.
8. "A student like Hayden would be a reach at Vandy, but Harvard and Princeton would still be a high reach. Harvard and
   Princeton are at the very top of our schools, whereas Vanderbilt is somewhere closer to the middle of the top."

### Rule 1: exam scores are grades
For the Ultra selective "grades in advanced courses" signal (Revision 2), a **completed** advanced course reads the
better of its letter grade and its exam score:

| AP exam | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|
| Reads as | 4.0 | 3.7 | 3.0 | 2.0 | 1.0 |

| IB exam | 7 | 6 | 5 | 4 | 3 | 2, 1 |
|---|---|---|---|---|---|---|
| Reads as | 4.0 | 3.7 | 3.3 | 3.0 | 2.0 | 1.0 |

- **The better reading** where both exist: a B+ with a 5 reads 4.0, an A with a 2 reads 4.0. The owner's sentence
  makes the exam a grade, not a check on one; taking the better one never punishes a student for a hard exam or a hard
  grader, matching "encourage, don't grade".
- **Courses in progress and planned have no grade yet and never count against.** A semester grade in a course in
  progress is read only where it raises the average of the completed ones; with nothing completed and nothing graded,
  the signal passes. A completed course with neither a letter grade nor an exam score is still a gap
  ("advanced-course grades").
- The signal is `max(mean(completed), mean(completed + in-progress semester grades)) ≥ 3.7`.
- Scope: only this signal. The rigor reading (`rigor.ts`), the track's grades, and the snapshot's `advanced_gpa`
  keep reading letter grades, as before. IB exam scores aren't stored yet (the profile keeps exam scores for AP only,
  1–5); the IB table is ready for when they are.

### Rule 2: broad groups for depth themes
`data/reference/depth-groups.json`, reviewed, with its sources (the College Board's AP categories, meta-majors as
WestEd and Florida colleges define them, the federal STEM designated-degree list, the NSF's science-and-engineering
fields, the Advance CTE career clusters, the Common App's activity types). The groups:

| Group | Courses (by subject family) | Activity families |
|---|---|---|
| **STEM** | math, science, computer science | math, science, cs, engineering, health, business |
| **Humanities & social sciences** | English, history and social science, world language | English, history, language, media, leadership, business |
| **Arts** | arts | arts |
| *(outside every group)* | | athletics, service, faith |

Courses placed by name (each with its reason in the file):

| Course | Groups | Why |
|---|---|---|
| AP Macroeconomics, AP Microeconomics | Humanities & social sciences, STEM | A social science (College Board, NSF), with a quantitative side (econometrics is on the federal STEM list) that business shares with math |
| AP Psychology | Humanities & social sciences, STEM | College Board files it with the social sciences; the NSF counts psychology a science, and cognitive and research psychology are on the federal STEM list |
| AP Statistics | STEM, Humanities & social sciences | College Board's Math and Computer Science; also the shared method of the social sciences and business |
| AP Art History | Arts, Humanities & social sciences | Read and written like a history course |
| AP Seminar | Humanities & social sciences | Argument and writing across subjects |
| AP Research | Humanities & social sciences, STEM | A research project in any field |
| AP Business with Personal Finance | STEM, Humanities & social sciences | Business, which the owner groups with both |

**A theme is now a group** whose courses, **taken together**, read at least Steady by the track rules (years with an
advanced or honors course, plus the checked core years; Deep is three or more years, rising, with a senior-year
course; Steady two or more), **and** that at least one activity of two or more years belongs to (its `family`, else
its catalog entry's). One activity can make two themes (a business club in STEM and the social sciences). The
per-family course tracks stay for the major's checks (the major-track slot, the track sentences); only themes use
groups. `M_theme` (one 1.10, two or more 1.18) and the Ultra selective depth condition read the group themes.
Sentences (`depth.theme.*`) now name groups: "Your courses and activities line up in STEM and the humanities and
social sciences: depth in one area, in and out of class."

### Rule 3: the target score until junior year ends
`EstimateStudent` gains `testTarget` (the profile's `tests.target` on `tests.focus`) and `gradYear`
(`basics.gradYear`); `estimateInputFromProfile` passes both as entered and `estimate-request.ts` validates them (the
target within its test's range, the year 2000–2100). The model resolves them (it knows the date, `ModelInput.asOf`,
today by default):

```
junior year open = asOf ≤ June 30 of (gradYear − 1)      else, without a graduation year, grade ≤ 11
test read        = target   when junior year is open and the target is on the same test and higher than the score
                                 (or there is no score)
                 = the actual score otherwise
```

Every reading of the test (the range position, the consistency check, completeness, the Ultra selective test
signal) reads the target then, and the sentence says so: "Reading your target ACT of 34 until junior year ends;
after that, your actual score." (`estimate.test_target`). The move-up keeps searching from the score read but counts
its points from the actual score ("6 more points" from a 29, not from the 34). Snapshots keep the actual score.

### Rule 4: a junior's trend, and nothing before 10th grade
- Consistency runs from 10th grade or the first advanced course, whichever is later, through now (`firstAdvancedYear`
  10). Revision 2 already started at the first advanced course, so this only makes explicit that 9th grade is never
  required.
- Before junior year ends (rule 3's test), the count assumes senior year continues at junior year's number:
  `count + max(0, count(11th) − count(12th))`, against the same `ultraAdvancedCount` 3. A count only: no projected
  grades, no projected years.

### Rule 5: class standing is perceived
The pick is the student's own read of where they stand, used as a proxy the way weighted GPA is: its percentile feeds
the rank distance and the nudges as before. "My school doesn't rank" is leaving the form (U16); a stored `no_rank` now
reads as **unanswered** (completeness counts it missing where the college weighs rank, and the Ultra selective
class-standing signal is missing, not passed). The Ultra selective bar stays top 5% or better.

### Rule 6: connected to the major, computed
The stored `relatedToMajor` is ignored. An activity is connected when there is no intended major, when its group or
the major's isn't known, or when they share a group (the major's groups are its expected subjects' groups,
major-course-expectations.json). Athletics, service, and faith are never connected. A connected activity of three or
more years still adds a year to the major's track in its course family: its own family when that's a course family
the major expects; business to math; with no family or an engineering or health one, the old kind rule (research →
the major's science family, a club → computer science or science). It stays a nudge.

### Rule 7: the high school's state
`estimateContext` reads the student's high school's state (its record, else a public NCES id's FIPS prefix) and the
model uses it where the student entered no state of residence: the pool's residency rate and the tier's pool both
read it, the sentence says "Using your high school's state, New York; add yours if different."
(`estimate.state_from_school`), and `state` is not listed as missing. The snapshot's `state` column records the state
used (`SnapshotDetail.stateUsed`) when the student entered none.

### Rule 8: the top band of Ultra selective
Ultra selective colleges whose [selectivity score](../selectivity-index.md) for all applicants is at least
`TOP_BAND_SCORE` (90, in `lib/selectivity.ts`) form a **top band**: on 2026-10-12 Yale, Chicago, Harvard, Stanford,
MIT, Princeton, and Penn (Brown is next at 89.6; Duke 87.6, Vanderbilt 85.2). The selectivity build stores it as a
word beside the tier, `school.selectivity.band: "top"` (registered as `selectivity.band` in `lib/fields.ts`), never the
score; a college enters at 90 and leaves only when its score falls the hysteresis band (2 points) below, as tiers do;
`npm run check:selectivity` checks every band against the index.

In the top band, **Reach** needs every Ultra selective condition (Revisions 1 and 2) **plus one standout**:

| Standout | Passes |
|---|---|
| The test | The score read (a junior's target, rule 3) at or above the college's 75th percentile (`d_test ≥ 1`) |
| Recognition | Tier 1 or 2 (national, or state and regional) from an activity or an award |
| The top of the class | A valedictorian or salutatorian expectation, the Top 1% pick, or a typed rank in the top 1% |

With none it is **High reach**, and the sentence names what would lift it, in words only: "At the very top colleges,
Reach also takes one standout: a test score at the top of their range, a state or national honor, or the top of your
class." (`estimate.top_band`). The band reads the score for all applicants; it applies wherever the student's tier is
Ultra selective. Floors (a recruited athlete's, a guarantee) still beat it.

### Constants (`ODDS_V3`)
| Name | Value |
|---|---|
| `TOP_BAND_SCORE` (`lib/selectivity.ts`) | 90 |
| `examPoints.ap` | 5 → 4.0 · 4 → 3.7 · 3 → 3.0 · 2 → 2.0 · 1 → 1.0 |
| `examPoints.ib` | 7 → 4.0 · 6 → 3.7 · 5 → 3.3 · 4 → 3.0 · 3 → 2.0 · 2, 1 → 1.0 |
| `firstAdvancedYear` | 10 |
| `juniorYearEnds` | 06-30 (of the year before graduation) |
| Groups | `data/reference/depth-groups.json` |

### Pinned examples, Revision 3
| Student | College | Odds | Level | Change |
|---|---|---|---|---|
| The owner's junior: GPA 4.0, weighted above, top 5%, ACT 29 with a target of 34, class of 2028; APs in 10th grade with exams 4, 5, 5 and no letter grades, four in progress in 11th; tennis and flag football four years (captain), DECA four years (vice president, president), a job; no state, a New York high school | Vanderbilt-like, Ultra selective, 5.4%, ACT 34–35, test-optional | — | **Reach**, "Elite" | Was High reach: the exam scores read as grades (rule 1) and DECA lines up with STEM and the social sciences (rule 2: two themes). Without either, or with "doesn't rank" in place of top 5%, High reach. The target changes only the sentences at a test-optional college (the 29 below range reads as withheld); at a test-requiring one it is what keeps the record consistent, and after June 30, 2027 the 29 gives High reach |
| The same junior | Harvard (top band, ACT 33–35, required) and Princeton (top band, 34–35) | — | **High reach**, with the top-band sentence | Rule 8: Ultra selective in the top band, and none of the standouts: the target 34 is under both 75th percentiles (35), only school-level recognition, top 5%. With a state honor, or a target of 35, Reach |
| The same junior | Duke (Ultra selective, score 87.6, ACT 34–35) | — | **Reach** | Was High reach; not in the top band |
| GPA 3.9, nine APs over 10th–12th, top 10%, Science Olympiad (3 years, science) | Elon at 25%, Selective | 48.3% → 53.1% | **Target** | New row: one theme (STEM) |
| Same, Science Olympiad and math team (2 years, math) | same | 53.1% | **Target** | Revision 2's row (with "doesn't rank": Likely, 61.7%, two themes) moves: science and math are one group, and "doesn't rank" is unanswered (48.4%, Target) |
| Same, Science Olympiad and debate (2 years, English) beside the English and history APs | same | 57.0% | **Likely** | New: STEM and the humanities, two themes; Target without depth |
| Excellent record at an Ultra selective college, "my school doesn't rank" | Ultra selective | — | **High reach** | Was Reach (Revision 1's "doesn't rank passes"): rule 5 |
| Excellent record, two advanced courses (10th, 11th), a junior | Ultra selective | — | **Reach** | Was High reach (fewer than three): rule 4 projects one more in senior year; a senior with the same two stays High reach |
| Excellent record, exam scores of 4 and no letter grades | Ultra selective | — | **Reach** | Was High reach ("advanced-course grades" missing); threes read 3.0, High reach |

Every other Revision 1 and Revision 2 row keeps its level and odds. The within-one-level check against the second
version now completes a record with a class-standing pick (top quarter) where it used "doesn't rank".

Across the 1,893 colleges (2026-10-12), against `20261012.3`, with `chances-build/analysis/impact.mts`'s three
students (GPA and test only; a complete strong record; a complete average record): no college moves for any of them
(none enters exam scores without grades, a business activity, a target, or "doesn't rank"; the complete strong record
has a state-level honor, so the top band doesn't move it). The owner's junior moves at 39: 20 High reach → Reach (19)
or Target (1), 7 Reach → Target, 8 Target → Likely, 1 Likely → Safe; the seven top-band colleges stay High reach
(rule 8); 3 move down because the New York residency rate now applies (Illinois Urbana-Champaign Likely → Target;
Florida Atlantic and Tennessee-Chattanooga Safe → Likely). Levels for the junior, before → after: High reach 27 → 7,
Reach 10 → 22, Target 46 → 47, Likely 132 → 140, Safe 1,164 → 1,163.

Tests: each rule on and off (exam readings and the better reading; in-progress grades never lowering; group tracks,
business in two groups, AP Psychology in two; the target by date, by grade, only higher, only the same test, the
move-up's points; the junior projection, and a senior without it; "doesn't rank" unanswered; computed connection;
the high school's state and the snapshot; each top-band standout alone, a school-level honor and top 5% not, the
target as the test; the band's build, its hysteresis, and its check). The groups file has its own check with a test that each kind of mistake
is caught. The leak guards name the new constants (`examPoints`, `firstAdvancedYear`, `juniorYearEnds`, `TOP_BAND_SCORE`). Each rule was
removed in turn and its tests failed (rule 4's 10th-grade start is the one exception: Revision 2 already started at
the first advanced course, so removing it changes nothing).
