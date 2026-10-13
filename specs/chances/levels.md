# Five Levels: High Reach, Reach, Target, Likely, Safe

> Status: **built** 2026-10-12 on `feature/chances` (see "As built"; planned 2026-10-11) from the owner's review of the built estimate (PR #105, `feature/chances`). Part 8 of
> [admission chances](README.md). The rules are the method's third version,
> [method/standing.md](method/standing.md); this spec is everything public: the words, the screens, the database, the
> planner's advice, and the season measurements. Needs [selectivity-index.md](selectivity-index.md) (the caps) and
> [pool-explainer.md](pool-explainer.md) (the wording); [depth.md](depth.md) and
> [inputs-beyond-academics.md](inputs-beyond-academics.md) add inputs and can ship after.

## Goal
Three groups can't carry the advice the planner gives. A college admitting 4% was "Reach for everyone" for a 4.0/1560
student and for a C student alike, and the planner started a Dream in early decision for both. With five levels the
list orders itself for the student: a top student sees an Elite college as a **Reach** (possible, and a reach for
everyone), a C student sees it as a **High reach**, and the ED advice, the balance line, and the retake suggestions
read the same scale. Nothing on the site says "no chance", and nothing shows a percentage.

## The levels
| Level | Stored as | Means, in the row's drawer | Chip |
|---|---|---|---|
| **High reach** | `high_reach` | "Your record is below the students this college admits. It's fine to have one or two on the list; a higher {test} or another year of grades would move it." | A calm tint: never red or orange, and lighter than Reach, so it reads as "further", not "worse" |
| **Reach** | `reach` | "Possible. This college turns down most applicants like you." | violet (today's) |
| **Target** | `target` | "Your record looks like the students they admit." | sky (today's) |
| **Likely** | `likely` | "More likely than not, from your record and how many applicants like you get in." | emerald (today's) |
| **Safe** | `safe` | "A guarantee, open admission, or a record clearly above the students admitted at a college that admits most applicants like you." | a deeper green, apart from Likely |

- Chip colors come from the design palette and are validated all-pairs in both themes like the round colors
  (`lib/planner/colors.ts`, the dataviz validator). Every chip also carries its word, so color is never the only cue.
- The labels on top stay and gain one: **"Elite: a reach for everyone"** (the college's tier is Elite; replaces "Reach
  for everyone"), **"Guaranteed for you"** (unchanged), **"Recruited"** (new, [inputs-beyond-academics.md](inputs-beyond-academics.md#recruited-athlete)).
- `likely` keeps its stored value and its meaning moves up one step; nothing is renamed in the database.
- Order everywhere: High reach, Reach, Target, Likely, Safe, then Not sorted yet.

### Why these words
"High reach" (owner, 2026-10-11) over "Long shot", "Far reach", and "Unlikely": it says further than Reach without a
verdict. Likely then Safe (owner, 2026-10-11): with five steps, Likely takes its plain meaning (more likely than not)
and Safe sits above it with a strict bar. Scoir uses Far Reach / Reach / Level / Likely / Very Likely; CollegeVine
Hard Reach / Reach / Hard Target / Target / Safety; College Kickstart adds Unlikely below Reach. The labels may change
on user feedback; the stored values don't.

## Where the levels show
| Surface | Today | Change |
|---|---|---|
| Planner list ([../planner/redesign/list.md](../planner/redesign/list.md)) | Three sections | Five sections in the order above, each heading with its count; empty sections left out |
| Planner row drawer | Group reasons | The level's meaning line (table above), then the two stage lines in the [pool explainer's](pool-explainer.md) words, then the reasons |
| Profile "Where you stand" chip and card, Compare's row | Reach / Target / Likely | The five levels and the three labels |
| Balance line | "at least two Likely" | "Counselors suggest at least two colleges that are Likely or Safe for you." (fewer than 2); "One or two High reaches is fine; three or more crowd out colleges you'd get into." (3+ High reach); "A Target or two would balance the Reaches." (Reach + High reach more than half); "Most students apply to 6 to 12." (unchanged) |
| Within a section | Dream first, then the student's order | Dream first, then **closest first** (by the hidden odds, descending), then the student's order among ties. The order is the only thing the odds do on screen |
| Retake card and the course plan's "what it changes" | "A 1420 would make this a Target" | Across five levels: "60 more points moves X from High reach to Reach" |
| Signed-out plan, intake's Done screen | Three words | Five, same copy rules |
| Telemetry `estimate_shown`, `plan_group_changed` | `group` | `group` takes the five values; never the odds |
| Glossary | `reach-target-likely` | Rewritten as `levels` with the five words; `standing` links to it |

The method is never described; the glossary and the drawer say what kinds of inputs the level uses
([README.md](README.md#quads-estimate-is-proprietary)).

## The planner's advice
- **The ED guard** ([../planner/redesign/rounds.md](../planner/redesign/rounds.md#the-ed-guard)): a Dream at High reach
  doesn't start in ED. It starts in EA where offered, else RD, with one line in its drawer, and the plan suggests the
  college where ED would help most.
- **ED II** is never suggested for a High reach.
- **Retakes** use the move-up across the five levels.

## Database
One migration, `…_five_levels.sql`:
- `list_items.category` check → `('high_reach','reach','target','likely','safe','unsorted')`.
- `application_snapshots.estimate_group`, `student_group`, and every `without_*` column → the same five values.
- `application_snapshots` adds `hidden_odds numeric(4,3)` (the odds binned to 0.005; measurement only, under the same
  rule as the other method columns: readable through RLS, never exported, displayed, or returned), `selectivity_tier
  text`, and the new ablation columns `without_depth`, `without_hooks` (legacy and recruited), `without_interest`.
- `chances_summary.estimate_group` → the five values; its band cells are unchanged.
- No data rewrite: stored `likely` rows stay `likely`. Rows whose stored category the model now reads differently are
  rewritten on the next plan open as today (groups are Quad's only since 2026-10-11).
- The `account-export` and the planner's print read the new values through `LIST_CATEGORIES` in `lib/list-rules.ts`;
  nothing else enumerates them.

## The estimate's contract
`EstimateResult.group` becomes `"high_reach" | "reach" | "target" | "likely" | "safe" | null`; `label` adds
`"elite"` (replacing `"reach-for-everyone"`) and `"recruited"`; `moveUp.to` takes any level above the current one.
`InputKind` adds `"activities"`, `"awards"`, `"work"`, `"legacy"`, `"recruited"`, `"interest"`, `"class_standing"`.
The API response shape (`lib/chances/estimate-request.ts`) validates the new values; the open baseline
(`lib/chances/baseline.ts`) keeps its three groups and is mapped (`reach → reach`, `target → target`, `likely →
likely`) so development without the model still runs.

## Season measurements
[calibration.md](calibration.md) and [method/outcomes.md](method/outcomes.md):
- Cells are level × base-rate band; the order check runs across five (Safe > Likely > Target > Reach > High reach).
- The miss rules: **Safe wrong more than 10%** of the time in a band, or **Likely wrong more than 30%**, moves that
  band's cutoff up; **High reach admitted more than 15%** of the time moves it down.
- The hidden odds, binned, give a proper calibration curve (observed admitted share per odds decile) and a Brier score
  per season; this is the first version that can be measured that way.
- Ablations: each multiplier switched off, as the existing ones are.

## Files (planned)
`lib/list-rules.ts` (`LIST_CATEGORIES`, labels, order), `lib/planner/colors.ts` (two new chips), `lib/chances/types.ts`
(the contract), `lib/chances/model.ts` (`MODEL_VERSION` → `20261101.1` or the build's date; the third version),
`lib/chances/notes.ts` (the new sentences), `lib/chances/estimate-request.ts`, `lib/chances/calibration.ts`,
`lib/chances/snapshot.ts`, `lib/planner/plan-view.ts` (sections and order), `lib/planner/auto-rounds.ts` (the ED
guard), `components/planner/PlanList.tsx`, `components/planner/ListNotices.tsx` (balance line),
`components/chances/StandingChip.tsx`, `StandingBadge.tsx`, `lib/glossary.ts`, the migration, and the tests:
`tests/chances-model.test.mts` (the pinned table and the within-one-level check against the second version),
`tests/planner-standing.test.mts` (sections, order, balance line), `tests/chances-calibration.test.mts` (five-level
cells, the miss rules, the calibration curve), `tests/lists-policies.test.mts` (the check constraints).

## Decisions taken (owner, 2026-10-11)
- Five levels, named as above; "Elite" for the top tier (may change on feedback).
- Safe and Likely both used; Safe with the strict bar.
- Legacy approved as an input; the commitment rewritten ([README.md](README.md#quads-estimate-is-proprietary)).
- The tier is shown on the site with its inputs, not its weights.
- Recruited athlete included, capped as the method says; first generation collected and shown, not in the level
  ([inputs-beyond-academics.md](inputs-beyond-academics.md)).

## Open questions
1. The exact two new chip colors: pick with the validator at build; the spec fixes only the relations (High reach
   lighter than Reach, Safe deeper than Likely).
2. Whether the signed-out plan shows all five levels or collapses High reach into Reach for a visitor with only a
   score: recommendation, show all five; the copy is the same.

## As built (2026-10-12)
- **Migration** `supabase/migrations/20261012100000_five_levels.sql`, not yet applied to dev: the five-level checks,
  `list_items.legacy` and `recruited`, the snapshot columns (`hidden_odds`, `selectivity_tier`, `without_depth`,
  `without_hooks`, `without_interest`), and `record_application_snapshot()` re-created to write them. Snapshots stored
  with the old `reach-for-everyone` label stay valid (no data rewrite). Until it's applied the planner reads without the
  new columns, the legacy and recruited controls fail to save with "That didn't work", and writing suggested groups
  logs a check-constraint error.
- **Model:** the third version in `lib/chances/model.ts` (`MODEL_VERSION` 20261012.1); see
  [method/standing.md](method/standing.md) "As built".
- **Planner:** five sections, the Dream first, then closest first by `closeness`, then the student's order; the ED
  guard (a High-reach Dream starts EA/RD; no ED II at High reach); an "ED would help most" notice where `ed` is
  `helps` (copy is a first draft); the balance line across five.
- **Chips:** High reach `#ec4899` (pink), Safe `#166534` light / `#15803d` dark beside Likely's emerald; validated
  all-pairs in both themes, with Likely/Safe the one deliberate near pair in dark mode (one green at two depths, each
  chip carrying its word). The signed-out plan's example rows still show three words (open question 2).
- **Glossary:** `levels` (the old `reach-target-likely` kept as an alias).
