# Metro Area (IPEDS HD)

> Status: **deferred** 2026-09-30. Split out of [campus-profile.md](campus-profile.md), which built everything else from
> the directory file. Parked until a feature needs it. Part of [data-expansion](README.md).

## Question it answers
*Which metro area is it in? What other colleges are in the same metro?*

## Why it's deferred
Storing it alone adds nothing a reader can see. It pays off only with one of the uses below, so build it together
with the first of them.

## Source
The directory file the site already reads (`HD2025`, cited as `ipeds-hd`):

| Column | What | Vanderbilt |
|---|---|---|
| `CBSA` | Core-Based Statistical Area code (Census) | 34980 |
| `CBSATYPE` | 1 metropolitan, 2 micropolitan, −2 not in a CBSA | 1 |
| `CSA` | Combined Statistical Area code, for linked metros | 400 |
| `COUNTYNM`, `COUNTYCD` | County name and FIPS code | Davidson County |

`CBSA` is a numeric code, so a name ("Nashville-Davidson–Murfreesboro–Franklin, TN") needs a label table.
*Unverified:* whether the HD2025 dictionary lists every CBSA's label. If it doesn't, use the Census delineation file
(list 1, the OMB bulletin in force for the HD year) and cite it as a second source.

## Store
```ts
location.metro: { cbsa: number; name: string; type: "metro" | "micro" } | null
location.county: string | null
```
Registered in `lib/fields.ts` with source `ipeds-hd` (and the Census file, if the names come from there).

## Uses (build with the first)
- **Nearby colleges:** "Other colleges in the Nashville metro" on the profile, beside Similar schools.
- **Explore filter:** a metro search or chips for the largest metros; the map view zooms to the filtered set.
- **National trends:** metro vs micro vs rural as a breakdown in [national-trends.md](../national-trends.md), next
  to the locale setting.

## Keep history?
No. A college's metro changes only when OMB redraws the areas, and that's a definition change rather than news.

## Open questions
1. The label source (the dictionary or the Census file) decides whether this is one source or two.
2. Whether profiles should say "Nashville metro" (short) or the full CBSA title; the full titles run long.
