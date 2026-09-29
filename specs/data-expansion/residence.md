# Where Students Come From (IPEDS EF part C)

> Status: **planned**. Wave 2. New files: `EF{Y}C` (by state) and `DRVEF{Y}` (derived totals). Research 2026-09-28.
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
