# Quad's Selectivity: One Number per College, Five Tiers, Elite at the Top

> Status: **planned** 2026-10-11 from the owner's review ("we should have a number behind the scenes… 5 levels with
> the top being something like Elite"). Part 12 of [admission chances](README.md). Uses only data the site holds;
> [levels.md](levels.md) reads the tier for its caps, so this ships first or with it.

## Goal
The site describes how hard a college is to get into with one figure, the admit rate, and a 10-year direction. One
figure misses what makes two 15% colleges different: how strong the admitted class is, how much of it was filled in
early decision, whether the college is getting harder every year, how much it says it reads beyond the numbers. A
hidden **selectivity index** (0–100) combines what the college publishes, and a public **tier** reads it in one word:
**Elite · Highly selective · Selective · Accessible · Open**. The tier caps the student's level, keys the admissions
guides, filters Explore, and sits on the profile with its inputs listed, not its weights, exactly as the estimate does.

## Inputs
Each input is turned into a **percentile among the colleges that report it** (0–100, higher = harder), then combined.
Nothing is typed in; every input is a field with lineage.

| Input | Field | Direction | Weight | Why |
|---|---|---|---|---|
| **Admit rate for the pool** | `admissions.acceptance_rate`; `derived.admit_rate_in_state` / `_out_of_state` where the college publishes them | lower → higher | **45** | The headline; per pool so a public gets a tier for each |
| **Strength of the admitted class** | SAT 75th percentile (`derived.sat_total` upper end), or the ACT 75th through the concordance where only ACT is reported | higher → higher | 20 | Independent of applicant volume; a college with 30% admits and a 1500 75th is harder than its rate |
| **GPA crowding** | `derived.gpa_top_share` | higher → higher | 5 | How wall-to-wall the top GPAs are |
| **Yield** | `derived.yield` | higher → higher | 10 | A college that gets who it wants needs fewer admits |
| **ED share of the class** | C21 `early_decision.admitted` ÷ first-year enrolled | higher → higher | 5 | A big ED class makes regular decision much harder than the overall rate shows |
| **Ten-year trend** | The built selectivity indicator (`trends.selectivity`: more / steady / less) and the applications indicator | more selective +5 points, steady 0, less −5; applications up +2, down −2 (added, not percentiled) | 5 | A college getting harder every year is placed above a steady one at the same rate |
| **What they say they read** | C7: the count of *very important* among essay, recommendations, interview, extracurriculars, talent, character; +1 for rigor *very important*; +1 for a required test policy (C8 / IPEDS) | count 0–8 scaled to 0–100 | 5 | Holistic breadth: more things read is harder to prepare for |
| **Waitlist use** | C2: `wait_list.offered` ÷ `admitted` | higher → higher | 5 | Heavy waitlisting is tight yield management |

- **Combining**: the weighted mean of the available inputs' percentiles, weights renormalized over what the college
  reports; the admit rate is required (no admit rate and not open admission → no index, tier "not rated", shown as
  nothing). The trend adjustment is added after the mean and the result clamped to 0–100.
- **Per pool**: a public university with residency rates gets an index and tier for in-state and out-of-state (only
  the admit-rate input differs). A student's estimate uses the tier for their pool; the profile shows both where they
  differ: "Highly selective from Georgia · Elite from out of state".
- Percentiles are computed over all colleges with the input at each publish, so a new CDS edition moves everyone a
  little; the tier hysteresis below absorbs that.

## Tiers
| Tier | Rule | About how many |
|---|---|---|
| **Elite** | index ≥ `ELITE_INDEX` **and** pool admit rate < 10% | 30–40 |
| **Highly selective** | index ≥ 85 | |
| **Selective** | index ≥ 60 | |
| **Accessible** | index ≥ 30 | |
| **Open** | index < 30, or open admission (no admit rate on record and `admissions.open_admission`) | |

- `ELITE_INDEX` is set once at build so Elite holds 30–40 colleges (expected near 96) and recorded as a constant with
  the count and date; it moves only by a deliberate change here.
- **Hysteresis**: at a publish a tier changes only when the index crosses the cutoff by **2 points or more** (or the
  Elite rate condition flips). The previous tier is read from the last published dataset.
- The word "Elite" is the owner's pick (2026-10-11) and may change on feedback; the stored value `elite` doesn't.
  Alternatives considered for the lower end: "Welcoming", "Broad access".

## Where it shows
| Surface | What |
|---|---|
| Profile hero and overview admissions card | A chip, "Elite ⓘ", labeled **Quad's selectivity**; for a public with two tiers, both with their pools |
| The ⓘ panel | "How Quad reads {College}'s selectivity": the inputs above as cited facts with their values and years (admit rate, SAT 75th, yield, ED share, the 10-year direction, how many factors it rates very important, waitlist offered), and "Quad's selectivity is our own reading of these published figures; it isn't a ranking and it says nothing about quality or fit." Never the weights, the index, or the cutoffs |
| Explore | A **Selectivity** facet with the five tiers (replacing nothing; the acceptance-rate filter stays); a sort by tier then admit rate |
| Compare | A "Selectivity" row on Getting in with the chip per college and the ⓘ |
| The estimate | "Elite: a reach for everyone" on the chip at Elite colleges ([levels.md](levels.md)); the tier caps the level ([method](method/standing.md#caps-from-the-colleges-selectivity-tier)) |
| Guides | Guides are keyed by tier ("Applying to Elite colleges", "Highly selective publics from out of state"), which is how the owner wants admissions guidance matched to a list |
| Home facts, trends | A tier count ("37 Elite colleges") is a fact like any other; no new study |

## Data and lineage
- Computed by the sync (`scripts/…/selectivity.mts`, run in `sync-data` after derived fields and trends) into
  `school.derived.selectivity_tier` (public: `elite | highly_selective | selective | accessible | open | null`),
  `derived.selectivity_tier_in_state`, `derived.selectivity_tier_out_of_state` (where residency rates exist), and
  `derived.selectivity_index` (0–100, with the pool variants) kept **out of the data API, exports, and client bundles**
  (the index is an internal figure like the method's; the repo being public before launch is accepted as for the
  method).
- Registered in `lib/fields.ts` as derived fields citing their inputs; the chip's ⓘ lists the inputs through
  `citeField`. The constants (weights, cutoffs, `ELITE_INDEX`, hysteresis) live in `lib/selectivity.ts` with the
  pure `selectivityIndex(inputs)` and `selectivityTier(index, rate, previous)`.
- A guard in `npm run verify`: the Elite count stays within 25–50, every tier is non-empty, and no college changes
  tier without crossing the hysteresis band.

## Glossary
- `selectivity-tier` (new): "Quad's reading of how hard a college is to get into, in five steps from Elite to Open,
  from the figures it publishes: its admit rate (for your state where it publishes one), its admitted students'
  scores and grades, how many admitted students enroll, how much of the class it fills early, how it has changed over
  ten years, and how many things it says it weighs. It isn't a ranking and says nothing about quality or fit."
  Related: `acceptance-rate`, `yield`, `levels`, `early-decision`.

## Files (planned)
`lib/selectivity.ts` (pure: index, tier, hysteresis, constants), `scripts/lib/selectivity.mts` (the sync step),
`lib/fields.ts`, `lib/types.ts` (`derived.selectivity_*`), `lib/glossary.ts`, `components/school/SelectivityChip.tsx`
and its panel, Explore's facet (`lib/filters.ts`, `components/explore/FilterPanel.tsx`), Compare's row
(`lib/compare-cards.ts`), `tests/selectivity.test.mts` (percentiles, renormalization with missing inputs, per-pool
tiers, hysteresis, the Elite count guard on the real dataset, nothing in `search-index.json` or the data API).

## Open questions
1. Weights are a first judgment (admit rate 45, class strength 20, yield 10, the rest 5 each). Revisit once with the
   first season's outcomes: the tier should order colleges by observed difficulty for students at the same distance.
2. Should the Explore facet show counts per tier? Recommendation: yes, like other facets.
