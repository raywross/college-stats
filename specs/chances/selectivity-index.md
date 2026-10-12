# Quad's Selectivity: One Number per College, Five Tiers, Elite at the Top

> Status: **built** 2026-10-12 on `feature/chances` (see "As built"; planned 2026-10-11) from the owner's review ("we should have a number behind the scenes… 5 levels with
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

> The first version, below, was replaced on 2026-10-12 by the second version (see "Second version" at the end):
> continuous scales instead of percentiles, retention and graduation added, the trend and the minor inputs dropped.
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

> Second version cutoffs: Elite 80, Highly selective 55, Selective 42, Accessible 33 on the new score, with no
> admit-rate condition for Elite (see "Second version").
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

## As built (2026-10-12, first version; superseded by "Second version" below)
- **Storage:** tiers only, on each college as `school.selectivity: { tier, in_state?, out_of_state?, year? }` (type
  `SchoolSelectivity`), not the `school.derived.selectivity_*` fields named under "Data and lineage". The 0–100 index
  is written to `data/selectivity-index.json`, read only by the build (`npm run build-selectivity`, also run by
  `sync-data`) and its check; it is never in `public/`, `search-index.json`, the data API, or client code
  (`check:selectivity` in verify; tests/selectivity.test.mts).
- **Code:** the method in `lib/selectivity.ts` (server and scripts); `tierForStudent` and the chip helpers in the
  client-safe `lib/selectivity-tier.ts`. A test fails if a client file reaches the method or the panel's facts builder.
- **`ELITE_INDEX` = 94:** Elite holds 33 colleges (2026-10-12), in effect "admit rate under 10%". Tier counts for all
  applicants: Elite 33, Highly selective 134, Selective 348, Accessible 597, Open 435; 346 unrated (no admit rate).
  Hysteresis moves a tier at exactly 2 points either way. Georgia Tech is Highly selective in both pools (out-of-state
  admit rate 10.12%); 9 publics differ by pool (Purdue: Selective in-state, Highly selective out of state).
- **Surfaces:** the chip and its panel on the profile hero and the Getting in card (the card's old admit-rate pill and
  its "Most selective" summary give way to the tier where a college is rated); the Explore facet ("Quad's selectivity",
  all-applicants tier) and sort (tier, then admit rate); Compare's "Quad's selectivity" row with per-pool tiers.
- **Open for the owner:** a minimum-evidence rule for Elite (two very small colleges qualify on admit rate and yield
  alone); yield's weight when a college reports only rate and yield (puts a few 26–38% colleges in Highly selective);
  the index saturating at 100 (open question 1). `.github/workflows/college-reported.yml` needs a
  `npm run build-selectivity` step after "Re-merge the directory listings into schools.json" in both jobs, or a
  college-reported PR that changes admissions figures fails `check:selectivity`.

## Second version (2026-10-12)

The owner's review of the first build: 22 colleges tied at 100, NYU and Northeastern above MIT, Stanford, Yale and
Columbia, and two tiny colleges in Elite. "We shouldn't have something that has so many tied at the top"; the goal is a
better ranking of every college, not a particular Elite count.

**What was wrong.** Percentiles squash the top (a 2.6% and a 9% admit rate are both above the 97th percentile), and
the trend points were added after the mean and then capped at 100; nearly every top college's admit rate is falling,
so nearly all of them hit the cap. Colleges that report only an admit rate and yield had yield's weight renormalized
up, and nothing guarded against a tiny class or figures that can't describe one class.

**The method now** (`lib/selectivity.ts`):
- Five inputs, each on a continuous scale and standardized over the colleges that report it (higher = harder): the
  admit rate (log-odds), the SAT 75th percentile (ACT through the concordance), yield, first-year retention, and the
  six-year graduation rate (log-odds). Weights 45, 20, 10, 10, 5.
- A missing SAT (test-blind and test-free colleges: Caltech, the UCs) is filled by a least-squares fit on the other
  four, so a college that keeps and graduates its students reads stronger than one that doesn't. A missing yield,
  retention, or graduation rate reads as the middle.
- Evidence: the result is pulled toward the middle by admitted ÷ (admitted + 50), so a class of 26 or 30 can't top
  the scale.
- Figures that can't describe one class (more first-years enrolled than undergraduates) leave a college unrated
  (UNT Health Science Center, the one such record).
- Score = 40 + 20 × the weighted mean, held to 0–100, two decimals; no college reaches 100. The build also stores each
  college's **rank** by the unrounded score, so every rated college has its own place.
- Dropped: trend points, the early-decision share, the top-GPA share, the waitlist share, and the C7 count. Each was
  tested as an addition and lowered the agreement with the benchmarks below (and the last four cover under 16% of
  colleges).
- Tiers from the score alone: Elite 80 (set at the gap below the 29th college), Highly selective 55, Selective 42,
  Accessible 33, chosen so each tier holds about as many colleges as before. The 10% admit-rate condition for Elite
  is gone: the score already weighs the rate, and the line put colleges ranked above Cornell outside Elite.
  Hysteresis (2 points) is unchanged; `npm run build-selectivity -- --fresh` rebuilds without it after a method change.

**Benchmark (2026-10-12).** Seven public rankings, collected to a local folder outside the repository (publishers'
lists, not redistributed): U.S. News 2027 National Universities and Liberal Arts Colleges (top ~50 each, the free
ceiling), Forbes 2027 (top 50), Niche 2027 Hardest Admissions (224) and Best Colleges (175), QS 2027 U.S. (100), and
WSJ/College Pulse 2026 (100). Rank correlation with each list, first version → second:

| List | Colleges | First | Second |
|---|---|---|---|
| U.S. News National | 51 | 0.74 | 0.92 |
| U.S. News Liberal Arts | 53 | 0.75 | 0.91 |
| Niche Hardest Admissions | 208 | 0.75 | 0.83 |
| Niche Best | 174 | 0.75 | 0.79 |
| Forbes | 50 | 0.25 | 0.80 |
| QS U.S. | 100 | 0.61 | 0.70 |
| WSJ | 100 | 0.31 | 0.41 |

WSJ ranks mostly on outcomes and value, so a low agreement is expected. The weights were checked by tuning on five
lists and testing on the sixth (held-out agreement 0.74–0.92); the average agreement moved by under 0.02 across
nearby weightings, so round weights were kept over the best fit (0.841 against 0.845). Tuning on Niche's hardest list
alone pushed the weights toward the admit rate only and lowered every other list, so no single list was fitted.

**Results.** Elite holds 29 colleges: Yale, Chicago, Harvard, Stanford, MIT, Princeton, Penn, Brown, Duke, Columbia,
Caltech, Dartmouth, Northwestern, Johns Hopkins, Vanderbilt, Notre Dame, Northeastern, Cornell, UCLA, Bowdoin, Pomona,
Minerva, Rice, Williams, Barnard, Berkeley, Amherst, Carnegie Mellon, NYU. Curtis ranks about 130th, Washington
University of Science and Technology about 230th. Tier counts: Elite 29, Highly selective 132, Selective 360,
Accessible 572, Open 453; 347 unrated.

**Open for the owner.** Retention and graduation are new inputs (outcomes, read here as the strength of the admitted
class); Minerva is Elite on a 3% admit rate and 98% retention; colleges for adult learners (Stanbridge: 10% admit
rate, 72% of students 25 or older) still score in the 60s.

**Six tiers and a new name (2026-10-12, owner).** The top tier is called **Ultra selective** on the site (its stored
key stays `elite`, so snapshots and the estimate label keep their values), and the old Highly selective band (55–80)
is split: **Highly selective** 68–80 (at the score gap near 68) and **Very selective** 52–68, which also takes the
top of the old Selective band. Cutoffs: Ultra selective 80, Highly selective 68, Very selective 52, Selective 42,
Accessible 33. Counts: 29, 44, 120, 328, 572, 453. Very selective caps the estimate at Likely
([method/standing.md](method/standing.md) "Caps"). Migration `20261012110000_selectivity_six_tiers.sql` widens the
snapshot column's check. Wherever this spec says Elite, read Ultra selective.

## The top band (2026-10-12)
Ultra selective colleges with a score for all applicants of `TOP_BAND_SCORE` (90, `lib/selectivity.ts`) or more are
stored with `selectivity.band: "top"` beside the tier (a word, never the score; enter at 90, leave 2 points below,
like the tiers' hysteresis). Seven on 2026-10-12: Yale, Chicago, Harvard, Stanford, MIT, Princeton, Penn. Only the
estimate reads it ([method Revision 3, rule 8](method/standing.md#rule-8-the-top-band-of-ultra-selective)); no page
shows it. `npm run check:selectivity` checks each band against the index.
