# Where Students Come From (IPEDS EF part C)

> Status: **built** 2026-10-02. Wave 2. New files: `EF{Y}C` (by state) and `DRVEF{Y}` (derived totals, used only as a
> check). Research 2026-09-28; files probed 2026-10-02. See [As built](#as-built).
> Part of [data-expansion](README.md).

## Question it answers
*Is it a local college or a national one? How many first-years are from my state? From abroad?*

## Source
- **`DRVEF{Y}`** (derived, one row per college): first-time degree-seeking undergrads by residence:
  `RMINSTTN` in-state, `RMOUSTTN` out-of-state, `RMFRGNCN` foreign countries, `RMUNKNWN` unknown.
  Vanderbilt fall 2024: 208 / 1,195 / 222 / 5.
- **`EF{Y}C`** (one row per college × state): `EFCSTATE` (state FIPS), `EFRES01` first-time students from that state,
  `EFRES02` of those, recent high school graduates. EF2024C has 70,119 rows.
- **Even years only for full coverage:** EF2023C has 40,395 rows vs 70,119 in EF2024C, consistent with IPEDS requiring
  residence in even years and making it optional in odd years. Use even years; take an odd year only for a college that
  reported it, labeled with its own year.
- History reaches back: EF2004C has `EFCSTATE`; EF2000C has only `LINE` (the form line number) and needs a
  line → state crosswalk.

Among site colleges (fall 2024), the median share of US-resident first-years from out of state is **26.4%**
(1,804 colleges).

CDS F1 has "percent from out of state" for first-years and all undergrads (Vanderbilt 85% / 88%), a useful check on
the federal number.

## Ingest
- `sync-data` loads the newest even-year `DRVEF{Y}` for the three counts, and `EF{Y}C` for the per-state table.
- Validate: the sum of `EFRES01` across states ≈ the DRVEF total (within 1%).

## Store
- **Snapshot:** `demographics.residence: { in_state, out_of_state, international, year }` as shares of first-years.
- **Detail file:** `home_states: { [fips]: count }` (only states with ≥1 student; ~30 entries average). Too big for
  the snapshot × 1,893 colleges; goes in the per-college detail file ([majors.md](majors.md#store-and-the-detail-file)); if this spec ships before majors, it builds that file.
- `SourceKey` `ipeds-ef`, `VintageKey` `ipeds-ef-residence` (even year, e.g. "Fall 2024").

## Display
- **Profile, Students:** 3-part bar (in-state / other states / international) and a US choropleth or "Top 5 home
  states" list; "12 first-years from your state" if the user has set a home state (later).
- **Explore:** "Out-of-state share" sort and filter ("Draws nationally": 50%+).
- **Compare:** rows for the three shares.
- **Glossary:** `in-state-student`, `first-time-student`.

## Keep history?
**Series: out-of-state share and international share**, every even year from fall 2004 (11 points). Per-state history:
none (too big, low value).

## Top-level trend?
- **Hero: no.** Only interesting at some colleges.
- **"Known for":** "Draws students nationally" (top 5% out-of-state share, 500+ first-years), and "Most students are
  from {state}".
- **"Over time" → Students:** out-of-state and international lines. International first-year counts moved sharply
  around 2020; mark 2020 like other pandemic years.
- **Home fact: possible** ("Public flagships enroll more out-of-state students than 10 years ago"), only if a fixed-panel
  computation shows a clear change.

## As built
- **Source.** New `SourceKey`/`VintageKey` **`ipeds-ef-c`** ("Fall 2024", edition EF2024C), not the spec's `ipeds-ef` /
  `ipeds-ef-residence`: `ipeds-ef` already cites EF{Y}D (the student-faculty ratio), and one key can carry one file URL
  and edition, so residence citations would have linked to the wrong file. Next release on the calendar: EF2026C
  (winter 2027–28).
- **Probe (2026-10-02).** `EFCSTATE`/`EFRES01` exist with the same codes in every file EF2002C–EF2024C (EF2025C isn't
  published). Codes: 1–56 states and DC, 57 state unknown, 58 U.S. total (includes 57), 60–78 territories, 89
  territories total, 90 foreign countries, 98 residence not reported, 99 total. Site colleges covered: ~1,600–1,810 in
  even years, ~930–1,040 in odd years, so **even years only**, from fall 2004.
- **Reader** (`lib/residence.ts`, shared by sync-data, history, and tests): in-state = the college's own state's row;
  out-of-state = U.S. total − state unknown + territories − in-state; international = code 90; unknown = 57 + 98.
  This reproduces DRVEF2024's `RMINSTTN`/`RMOUSTTN`/`RMFRGNCN` exactly for 1,807 of 1,810 site colleges; sync-data fails
  if more than 1% differ (stronger than the spec's "sum within 1%"). Rows are pivoted to one per college with a new
  `wide` option on `fetchIpedsTable` (`EFRES01_{code}` columns).
- **Shares are of every first-year** (DRVEF's `RM*P` percent columns use the same denominator), so in-state + other
  states + abroad + not reported = 100%. CDS F1's "percent from out of state" leaves international students out of both
  numerator and denominator (Vanderbilt: CDS 85% vs. 73% here); the glossary says so.
- **Store.** Snapshot `demographics.residence: { in_state, out_of_state, international, first_years, top_state }`
  (1,810 of 1,893 colleges; `null` otherwise, never zeros). Deviations: no per-college `year` (the release year comes
  from lineage, like every other field), plus `first_years` (the denominator, for the 500+ rule) and `top_state` (for
  the "Most students are from" chip). Median out-of-state share 25% (1,810 colleges).
- **Detail file (built here for majors to reuse).** `data/detail/schools/{unit_id}.json`, 1,803 files:
  `{ unit_id, tables: { home_states: { source, vintage, year, rows: { TN: 208, CA: 145, … } } } }`. Keys are USPS codes
  (not FIPS) to match `location.state`; territories included. `lib/detail.ts`: `DETAIL_TABLES` (table → registered field
  `detail.home_states` + row check), `validateDetail()` (unknown table, source/vintage not the field's, year not
  `meta.vintages`, bad rows), `detailMismatches()` (vs. the snapshot: top state, totals), `formatDetail()` (one table per
  line). sync-data writes all files whole and deletes stale ones (`scripts/lib/residence-sync.mts`); `check:lineage` and
  `publish-data` run the same checks. `getDetail(unitId)` in `lib/data.ts` is fail-soft; `next.config.ts` ships
  `data/detail/**`. Deviations from majors.md: no per-file `built` date (it would rewrite all 1,800 files every sync),
  and Supabase publishes it like history (migration `20261002120000_school_details.sql`: `school_details` +
  `detail_staging`, `stage_details()` in batches, `publish_details_staged()` swaps in one transaction, read back), not
  inside `publish_dataset()`, which majors' size would push past the statement timeout.
  **The migration must be applied to dev (and prod) before the next `publish-data`, which stops without it.**
- **Display.**
  - Profile, Students: a "Where first-years come from" card: a sentence ("73% came from other states and 14% from
    abroad; 13% are from Tennessee", plus the national rank), the 3-part bar (sequential ramp, darkest = in-state;
    "not reported" muted), the top 5 home states with share and count, and a state tile map (reuses StateTileMap's
    layout) shaded by share of first-years with the home state ringed.
  - Explore: sort "First-years from other states (most)", a **Draws nationally** filter (`national=1`, 50%+ from other
    states; 377 colleges), and an "Out of state" table column.
  - Compare: in-state, other states, and abroad rows.
  - Glossary: `in-state-student` (all three terms) and `first-time-student`.
- **"Known for."** "Draws students nationally": top 5% out-of-state share among the 759 colleges with 500+ first-years
  (about 38 colleges, 78%+; metric `outOfStateLarge`). "Most students are from {state}": the spec didn't define it; built as
  a majority (50%+) of first-years from one state that isn't the college's own, with 100+ first-years (5 colleges:
  North Dakota State from Minnesota, Saint Anselm from Massachusetts, Carthage from Illinois, Martin Luther College
  from Wisconsin, Ana G. Méndez from Puerto Rico). The in-state version would be true at most publics, so it isn't a
  standout.
- **History.** Family `ef-c` (`step: 2`, even falls from 2004; 11 points), series `out_of_state_share` and
  `international_share` (shares of every first-year, read with the snapshot's reader; in-state is the college's state
  today). `validateHistoryMeta` and the coverage check accept a 2-year step for that family only; rule 1 compares the
  newest EF{Y}C fall. Over time → Students: "Where first-years come from" (other states with the national band, abroad
  dashed); `TrendLine`/`HistoryTable` take a `cadence` so lines connect across odd years, hover steps by two, and the
  table lists reported years only. The chart ends at its own newest fall. The pandemic year is shaded like the other
  charts (abroad dropped nationally from 64,316 in fall 2018 to 46,856 in fall 2020 at site colleges).
- Kept as reported: a few early files put students in odd codes (Vanderbilt fall 2004 shows 39 first-years from "U.S.
  territories" and none from abroad).
- Tests: `tests/residence.test.mts` (reader vs. DRVEF, filters, chips, every detail-file guard, the 2-year cadence in
  the coverage and metadata checks, committed data and history). Guards were broken on purpose to confirm they fail.

### Not built (follow-ups)
- **Odd-year fallback** ("take an odd year only for a college that reported it, labeled with its own year"): not built.
  No odd year newer than EF2024C exists yet (EF2025C comes winter 2026–27), and mixing years per college would need
  per-college lineage in the snapshot, the detail file, and history's last point. Revisit when EF2025C is out.
- **Home fact** (public flagships drawing more out-of-state students): compute on a fixed panel first; a separate spec.
- **"N first-years from your state"** once users can set a home state.
- CDS F1 out-of-state shares as a supplement (college-reported data).
