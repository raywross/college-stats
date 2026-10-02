# Graduation by Group: Pell and Race/Ethnicity (IPEDS GR)

> Status: **built** 2026-10-02. Wave 2. New file: `GR{Y}_PELL_SSL`; race/ethnicity from Scorecard. Research
> 2026-09-28; files and API probed 2026-10-02. See [As built](#as-built). Part of [data-expansion](README.md).

## Question it answers
*Do lower-income students graduate as often as everyone else here? Do Black and Hispanic students?* Gaps say more
about how a college supports students than the overall rate does.

## Source
**Pell: `GR{Y}_PELL_SSL`** (6-year, 150% of normal time, first-time full-time; one row per college per cohort type).
Three groups: Pell recipients (`PG*`), subsidized-loan recipients without Pell (`SS*`), neither (`NR*`), plus total
(`TT*`). Present from **GR2016** (GR2015 doesn't exist).

Vanderbilt GR2024: Pell 218 of 244 finished a bachelor's (89.3%); neither Pell nor subsidized loan 1,240 of 1,316
(94.2%); all students 1,491 of 1,594 (93.5%). Gap: 4.9 points.

**Race/ethnicity: Scorecard** `latest.completion.completion_rate_4yr_150_{white, black, hispanic, asian, …}`
(coverage for Black students 1,575, Hispanic 1,614 of 1,893; year keys from 2010/2011 to 2024). The same numbers are
in IPEDS `GR{Y}` by `GRTYPE`, but the Scorecard fields are already per-college rates, and history comes from the same
batches as `grad_rate`.

Rejected: Scorecard `completion.title_iv.pell_recip.*` (stops at the 2019 key).

## Ingest
- `sync-data` loads `GR{Y}_PELL_SSL` newest-first; rates = completers ÷ adjusted cohort. Suppress under 30 in the
  adjusted cohort.
- Race fields join the Scorecard call; history adds them to `scorecard.mts` (year Y = entering Y − 6, like `grad_rate`).

## Store
```ts
outcomes.grad_rate_pell: number | null
outcomes.grad_rate_no_pell_no_loan: number | null
outcomes.grad_rate_by_race: { white, black, hispanic, asian, two_or_more, … } | null
```
Plus cohort sizes for the suppression rule and for tooltips. `SourceKey` `ipeds-gr`.

## Display
- **Cost & outcomes:** a dot plot with the overall rate and each group's rate on one line, gaps labeled
  ("Pell recipients: 89%, 5 points below students with no need-based aid"). Groups under 30 are hidden, with a note.
- **Explore:** "Pell graduation gap" sort; filter "Pell gap under 5 points".
- **Compare:** rows for Pell and for each race group.
- **Glossary:** `pell-graduation-gap`, `adjusted-cohort`.

## Keep history?
**Series, yes.** Pell rate from entering fall 2010 (GR2016) on; race rates from ~2004 entering cohorts via Scorecard.
Small groups swing year to year; chart with a 3-cohort rolling average option and always show cohort sizes.

## Top-level trend?
- **Hero: no.** The gap direction is noisy at small colleges.
- **Home fact: candidate.** "The Pell graduation gap nationally": fixed panel, entering 2010 → newest; is it
  narrowing? Compute first.
- **"Known for":** "Pell students graduate at the same rate" (gap ≤ 2 points, 100+ Pell students in the cohort,
  overall rate ≥ 60%).
- **Explore change column:** Pell gap change.

## As built
Built 2026-10-02 (`feature/wave-2-graduation-by-group`). Data: GR2024_PELL_SSL (the class that entered fall 2018) and
Scorecard's latest completion fields (the same class).

### What the files showed
- **Cohort type.** `GR{Y}_PELL_SSL` has one row per college per `PSGRTYPE`: 1 = total cohort at a 4-year college, 2 =
  bachelor's-seeking, 3 = other degree-seeking, 4 = less-than-4-year. Type 1 with `…CMTOT` (any award within 150%)
  equals Scorecard's `completion_rate_4yr_150nt` for all 1,767 colleges compared (type 2 matched 1,305), so it's the
  row we read, and the overall rate on the profile's chart matches the existing "Graduated within 6 years" history.
  Vanderbilt: Pell 218 of 244 (89.3%), neither 1,240 of 1,316 (94.2%), all 1,491 of 1,594 (93.5%), as researched.
- **Files.** GR2016–GR2023 at `/ipeds/datacenter/data/`, GR2024 at `/ipeds/complete-data-files/`; GR2015 and GR2025 don't
  exist yet. Same columns in every year. GR2023 has an `_RV` CSV; GR2024 doesn't, so the class of 2018 is provisional.
- **Race keys.** Scorecard's `completion_rate_4yr_150_{white,black,hispanic,asian,aian,nhpi,2ormore,nonresident.alien}`
  plus `completion_cohort_4yr_150_*` (cohort sizes, which sum to the total cohort) exist from key 2011 (entering 2005)
  to 2024. Keys 1997–2010 have only the old categories (`*_pre2010`, Asian and Pacific Islander combined), a break, so
  history starts with the class of 2005, not ~2004.
- **Coverage** (rates on 30+ students): Pell 1,477 colleges, neither 1,401; White 1,392, Hispanic 971, Black 925, two or
  more 573, Asian 501, international 398, American Indian 33, Pacific Islander 8. Median Pell gap 10.8 points; 357
  colleges under 5 points.
- **Implausible gaps.** About 20 colleges report gaps beyond 40 points either way (Trinity Christian: Pell 99%,
  neither 0 of 49; Tuskegee: Pell 98%, neither 26%). That almost always means students were sorted into the groups
  inconsistently. `MAX_PLAUSIBLE_GAP` (40 points): the rates are still stored and shown, with a caution on the
  profile, but the gap isn't ranked, filtered, chipped, or measured as a change.

### Store (`lib/graduation-groups.ts` readers, shared by sync-data and sync-history)
`outcomes.grad_rate_pell`, `grad_rate_no_pell_no_loan` (as specced), plus `grad_rate_loan_no_pell`, `grad_rate_ftft`
(all students in the same file), `grad_cohorts` `{ pell, loan_no_pell, no_pell_no_loan, total }`, `grad_rate_by_race`
and `grad_cohorts_by_race` (`white, asian, hispanic, black, two_or_more, international, aian, nhpi`). Rates are null
under 30 students in the adjusted cohort; cohort sizes are always kept. New `SourceKey`/`VintageKey` `ipeds-gr`
(vintage "Entered fall 2018"); the race fields cite Scorecard (`scorecard-latest`). `derived.pell_grad_gap` (computed).

### Display
- **Cost & outcomes** (`components/school/GraduationByGroup.tsx`, `components/charts/GroupDotPlot.tsx`): two dot plots,
  Pell/loan status (IPEDS) and race/ethnicity (Scorecard), each cited on its own. One dot per group on a shared scale,
  the comparison group ("neither") hollow, the overall rate as a dashed line, class sizes under each label, and every
  value and gap printed ("89% · 5 points below students with neither"), so no hover. Groups under 30 read "Not shown:
  under 30 students". The overall line on the race chart is labeled as IPEDS with its entering class.
- **Explore:** sorts "Pell graduation gap (lowest)" and "Pell gap change, 10 yrs (most narrowed)"; a "Graduation"
  filter section with "Pell gap under 5 points" (`pellGap=1`; Pell recipients ahead count as under); a table column
  "Grad rate, Pell / neither" with the gap, and a "Pell gap, then → now" change column.
- **Compare:** rows for Pell, neither, the gap, and each of six race groups ("Under 30 students" when suppressed).
- **Glossary:** `pell-graduation-gap`, `adjusted-cohort`.
- **"Known for":** "Pell students graduate at the same rate": gap ≤ 2 points, 100+ Pell students, overall ≥ 60%
  (69 colleges; `SAME_RATE`).
- **Over time:** an Outcomes subsection "Graduation by group" with an "Each class / 3-class average" switch (average
  weighted by class size; `rollingRate`), a Pell chart (Pell, neither, all students) and a race chart (six groups in the
  demographic colors). Class sizes are in each chart's tooltip and table.

### History
Family `gr-pell` (`GR{Y+6}_PELL_SSL`, entering classes 2010–2018, registry era with `keepRow` for the cohort type and
`lag: 6` so the newest files refresh weekly) and API family `scorecard-completion-race` (its own field list and cache
file, so adding it didn't invalidate the existing Scorecard cache). Series: `grad_rate_pell`,
`grad_rate_no_pell_no_loan`, `grad_cohort_pell`, `grad_cohort_no_pell_no_loan`, and `grad_rate_*`/`grad_cohort_*` for
White, Asian, Hispanic, Black, two or more, international (American Indian and Pacific Islander groups stay
snapshot-only: they rarely reach 30). Rule 1 for these series is `gradByGroupMismatches`
(scripts/history/graduation-groups.mts), run with the other checks by sync-history and the tests. `school.trends.pell_gap`
(`pellGapChange`): the gap's change over the cohort window, only with 100+ Pell recipients at both ends (974 colleges).

### Regenerate
`npm run sync-data` (adds the GR file and the race fields to the Scorecard call), then `npm run sync-history` (the race
history is ~80 Scorecard requests the first time; cached in `.cache/scorecard/` for a week).

### Deviations
- Stored more than specced: the subsidized-loan group, the overall rate from the same file, and race cohort sizes.
- Race history starts with the class of 2005 (the 2010 categories), not ~2004.
- The 40-point plausibility rule (above) is new.
- The Explore "Pell gap change" column was built (the change-column machinery made it cheap).

### Follow-ups
- **Home fact** (candidate): the national Pell graduation gap, entering 2010 → newest, on a fixed panel. Compute first.
- Mark the newest class provisional on the group charts (`provisional["gr-pell"]` is recorded but not passed to them).
- A "Then & now" Compare row for the Pell gap.
- Possible glossary collision: outcome-measures may also add an `adjusted-cohort` term; keep one.
