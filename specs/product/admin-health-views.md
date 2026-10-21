# Data health: two views

Status: built 2026-10-19 (owner request); see [As built](#as-built-2026-10-19). Changes the Health page of the [admin console](admin.md#health).

## Goal
The Health page today judges each college by four data groups (federal, college-reported, identity, campus life).
That answers "when did we last collect something for this college", not the question the owner cares about most:
**is the data our estimate runs on current, and where does each piece come from?** A college can be Fresh on every
group while its estimate reads a two-year-old admit rate, or no GPA at all.

The page becomes two views:

1. **Estimate inputs** (the default): health as a function of the college facts the admission estimate reads
   (Reach / Target / Likely, including the selectivity tier). For each input, where it came from, the year it
   describes, when its source published it, and when we collected it.
2. **Files**: every file we read, with the year it describes, when it was published, and its health. The
   per-college table that exists now (the four groups) stays here, as each college's own documents.

Owner decisions (2026-10-19): "ranking algorithm" means the admission estimate; "year published" means both the year
the data describes and the date the source released it; spec first, then build.

## Proprietary method
Both views are admin only (`requireAdmin()`, server-rendered, `robots: noindex`). They list *which* facts the
estimate reads, which is already public (`ESTIMATE_FACT_PATHS` ships in a client bundle and every fact is cited on
the estimate's panel). They never show how the facts are combined: no weights, thresholds, or rules from
`lib/chances/model.ts`. The health thresholds below are about the data's age, not the estimate's method.

## View 1: Estimate inputs

### The inputs
The estimate's facts (`ESTIMATE_FACT_PATHS`, lib/chances/what-went-in.ts) are grouped into twelve inputs. Five are
**core**: the estimate leans on them for every student, and only they decide a college's status. The rest are
**supporting**: they apply to some colleges or some students. They are listed with their sources and years but never
change the status, because their absence is normal (most colleges have no guaranteed-admission program).

| Input | Fields | Kind |
|---|---|---|
| Admit rate | `admissions.acceptance_rate` | core |
| Test scores | `derived.sat_total`, `admissions.act_composite_25_75` | core |
| GPA | `reported.admission_profile.gpa.average`, `derived.gpa_band_mean`, `derived.gpa_middle_half`, `derived.gpa_top_share`, `derived.gpa_estimate` | core |
| Academic factors | `admissions.factors`, `reported.admission_profile.factors.{gpa,rigor,class_rank,test_scores}` | core |
| Selectivity tier | `selectivity.tier`, `selectivity.in_state`, `selectivity.out_of_state` | core |
| Test policy | `admissions.test_policy` | supporting |
| Admit rate by residency | `derived.admit_rate_{in_state,out_of_state,international}` | supporting |
| Early decision | `derived.ed_admit_rate`, `reported.admission_profile.early_decision.applicants` | supporting |
| Class rank | `reported.admission_profile.class_rank.{submitted_share,top_tenth,top_quarter}` | supporting |
| Other factors | `reported.admission_profile.factors.{extracurriculars,talent,work_experience,alumni_relation,interest,first_generation}` | supporting |
| Admission by major | `reported.major_admission.*` | supporting |
| Guaranteed admission | `reference.guaranteed_admission.*` | supporting |

The grouping lives in one file (`lib/admin/estimate-inputs.ts`). A test fails when a path in `ESTIMATE_FACT_PATHS`
is in no input, so a new estimate fact can't go unjudged.

### What each field shows
For each field the college has a value for:
- **Value**, formatted as the site shows it.
- **Source**: the citation's label ("Georgia Tech Common Data Set 2025–26", "IPEDS Admissions survey"). For a derived
  value, its inputs' sources ("from: Common Data Set 2025–26, Fall 2025; College Scorecard"), because the field's
  own label can name a default source that wasn't used (seen 2026-10-19: Georgia Tech's selectivity tier is cited as
  "IPEDS Admissions survey, Fall 2024" while its inputs are Common Data Set 2025–26 figures).
- **Describes**: the year the data is about ("Fall 2025"; "Year not stated by the source" when lineage has none).
- **Published**: when the source released the file it came from (from the files list, [View 2](#view-2-files)).
  For a college's own document, the edition ("2025–26 edition") and no date, since colleges don't date their CDS.
- **Collected**: the citation's `retrieved` date.

A field the college has no value for shows **Not reported** and no source. Today lineage still names a source for a
missing value ("Harvard University (college-reported)" for an early-decision rate Harvard doesn't publish); the
view must not repeat that.

### Status per input
A core input's status comes from its presence and its age. **Age** is how many admission cycles the value is behind
the current one: the current cycle's fall (`CURRENT_CDS_EDITION_START`, lib/admin/health-rules.ts, 2025 in
October 2026) minus the fall the value describes ("Fall 2024" → 1 behind; "2025–26" → 0).

| Input | Fresh | Watch | Stale |
|---|---|---|---|
| Admit rate | current cycle, or none because the college is open admission | 1 cycle behind, no year stated, or missing with no open-admission answer | 2+ behind |
| Test scores | current cycle | 1 behind, or missing (unless the college doesn't consider scores) | 2+ behind |
| GPA | a reported figure (average or bands) from the current cycle | 1 behind, or only the model's estimate | 2+ behind |
| Academic factors | current cycle | 1 behind, or missing | 2+ behind |
| Selectivity tier | rated | not rated | — |

**Open admission** (owner, 2026-10-19). The estimate reads a college with no admit rate as open admission (Likely for
everyone, lib/chances/baseline.ts). That is right for an open-admission college and wrong for a selective one whose
rate is missing, so the dataset records IPEDS's answer, `admissions.open_admission` (IC `OPENADMP`;
lib/open-admission.ts), and a missing admit rate is judged by it:
- **Open admission**: the admit rate is Fresh, and so is every other core input, since the estimate reads nothing else
  ("Not needed: the college is open admission").
- **Fewer than 10 applicants** (`MIN_APPLICANTS_FOR_RATE`, lib/derive.ts): Watch, "Too few applicants to give an admit
  rate". The sync leaves the rate blank on purpose below 10 applicants; a tiny pool isn't a gap (owner, 2026-10-20,
  after reviewing the 42 colleges first marked Failing: 40 reported 0–9 applicants).
- **Not open admission**, with no applicant count either: **Failing**, the only Failing in this view: the rate is
  genuinely missing and the estimate reads the college wrong (2 colleges on 2026-10-20: Montana Bible College and NewU
  University).
- **No answer**: Watch, as before.

A new IC file leaves `OPENADMP` blank until NCES revises it (IC2025 was blank in October 2026), so the sync takes the
newest IC file that answers it. That file is its own release in `data/meta.json`, `ipeds-ic-open` ("2024–25 (IC2024)"),
so the value cites the right file and year, the Files view lists it, and the release calendar's July directory release
`updates` it.

An input with several fields is judged by the field the estimate prefers: the college's own figure over the model's
estimate, and the newest year among the fields it has. The selectivity tier is judged on whether it is present: its
age follows the admit rate, and its other inputs (retention, graduation) describe older classes by nature.

A college's **overall** status for this view is its worst core input (Failing > Stale > Watch > Fresh). Each input
has a one-sentence reason ("Fall 2024 (IPEDS Admissions survey): one cycle behind; 2025–26 Common Data Sets are out").

The thresholds go in `lib/admin/health-rules.ts` beside the existing ones (`ESTIMATE_INPUT_RULES`), so the owner can
tune them in one place.

### The page
`/admin/health`, the default view (two tabs link the views; each is its own route):
- **Stat row**: colleges by overall status, then per core input how many are not Fresh. Each count links to the
  filtered table.
- **Filters** (in the URL, like today): `status`, `input` (with `status`, that input's status; alone, colleges where
  that input isn't Fresh), `state`, `tier`, `family=1`, `sort` (`worst`, `name`), `page`.
- **Table**: one row per college. Name (links to the college's admin page), tier, overall, one cell per core input
  with its status chip and the year it describes (the reason is the tooltip). On phones, cards.
- **CSV** at `/admin/health/inputs-csv` (same query string): one line per college, per core input its status, the year
  it describes, and the reason.
- Computed once per server instance from the dataset (`getData()`), like the overview. No new files to deploy.

### On a college's admin page
`/admin/colleges/[unit]` gains an **Estimate inputs** panel at the top of the main column: the overall chip, then
the twelve inputs, core first, each with its status and every field's value, source, describes, published, and
collected. The existing health card stays in the side column, renamed **Files and collection**.

## View 2: Files

`/admin/health/files`. Old bookmarks that filtered the per-college table (`/admin/health?group=…` or `?reason=…`)
are redirected here with their query.

### Published files
One row per source file in `data/meta.json` `sources` that names files: the IPEDS surveys (the file names in each
edition, e.g. `SFA2324` and `COST2_2024`) and College Scorecard.

| Column | From |
|---|---|
| Source and file | `meta.sources[key].label`, the file names in its `edition` |
| Describes | `meta.vintages[key]`, or the year in `edition` |
| Published | the file's date on the publisher's server (`data/source-files.json`, below) |
| Collected | `meta.retrieved` (the last full sync) |
| Feeds the estimate | the estimate inputs whose fields cite this source, or "No" |
| Next release | the release in `data/release-calendar.json` that `updates` this key: its label and expected month |
| Health | below |

**Health of a file:**
- **Fresh**: no newer release is out.
- **Watch**: the next release's expected month has passed and it hasn't been found yet (nothing to do but watch
  for it), or the file has no published date on record.
- **Stale**: a release that updates this source is marked published in the calendar, so a newer file is out and the
  site doesn't use it yet. The reason says to run `npm run sync-data`.
- **Failing**: the publisher's server no longer has the file (the last dating run got a 404).

Rows that feed the estimate come first.

### When a file was published: `data/source-files.json`
Nothing records today when a publisher released the files we use. NCES and the Scorecard download host both send a
`Last-Modified` date (checked 2026-10-19: ADM2024 is dated Dec 11, 2025; HD2025 Jul 21, 2026). `npm run
source-files` sends a HEAD request for each file and writes:

```json
{ "checked": "2026-10-19", "files": { "ADM2024": { "source": "ipeds-adm", "url": "…/ADM2024.zip", "published": "2025-12-11", "status": 200 } } }
```

- IPEDS file URLs follow `https://nces.ed.gov/ipeds/complete-data-files/<FILE>.zip`.
- The Scorecard sync reads the API, which has no file date. Its date is the Field of Study file's
  (`meta.sources["scorecard-fos"].url`), which comes from the same release.
- `Last-Modified` is the date of the file's newest revision: a provisional file NCES revised later shows the revision
  date. The view labels it "Published (file dated)".
- Run it after `npm run sync-data`. `npm run verify` (`check:source-files`, no network) fails when a file in
  `meta.json` has no entry, so a sync that brings in a new file can't merge undated.

### College documents
Below the published files: the **per-college table that exists today** (the four groups, its stat row, filters, and
CSV at `/admin/health/csv`), unchanged. Its College-reported counts are the summary of the Common Data Sets: Fresh is
the current edition, Watch one behind, Stale two or more or none, Failing an open failure. That table is each
college's own files and collection dates, so it belongs in this view.

## Files

| File | What |
|---|---|
| `lib/admin/estimate-inputs.ts` | Pure: the twelve inputs and their fields, each fact's value, `collegeInputs(school, cite, ctx, publishedFor)`, counts |
| `lib/admin/estimate-inputs-load.ts` | Server only: every college once per instance from `getData()` and the GPA models; the published files; which inputs each source feeds; the CSV |
| `lib/admin/source-files.ts` | Pure: the file rows (meta sources × source-files.json × release calendar), their health |
| `lib/admin/health-rules.ts` | Gains `ESTIMATE_INPUT_RULES` |
| `lib/admin/inputs-view.ts` | Pure: the Estimate inputs view's URL filters, filter, sort, and the old-bookmark test |
| `scripts/source-files.mts`, `scripts/check-source-files.mts` | The dating run and its verify check |
| `data/source-files.json` | Each file's published date |
| `app/admin/health/page.tsx` | Estimate inputs (the default) |
| `app/admin/health/files/page.tsx` | Files: published files, then the per-college table (moved from `/admin/health`) |
| `app/admin/health/inputs-csv/route.ts` | The Estimate inputs CSV |
| `components/admin/ops/HealthTabs.tsx`, `EstimateInputs{Stats,FilterForm,Table}.tsx`, `SourceFilesTable.tsx` | The tabs and the two views |
| `components/admin/EstimateInputsPanel.tsx` | The college page's panel |
| `app/admin/colleges/[unit]/page.tsx` | The Estimate inputs panel |

`data/source-files.json` (a few KB) is imported as a JSON module, so nothing new is traced for `/admin/**`.

## Tests
- Every `ESTIMATE_FACT_PATHS` path is in exactly one input.
- The status table above, case by case: missing admit rate is Watch with the open-admission reason; Fall 2024 is Watch and Fall 2023 Stale with
  the current cycle at 2025; GPA from the model only is Watch; a test-blind college with no scores isn't marked down;
  supporting inputs never change the overall.
- A missing value has no source.
- File health: a published calendar release that updates the key is Stale; an overdue one is Watch; a 404 is Failing.
- The dating check fails on a `meta.json` file with no entry in `source-files.json`.
- The URL filters for `view` and `input` round-trip, and bad values are dropped.

## Decisions (owner, 2026-10-19)
- **Supporting inputs never count toward the status.**
- **Record open admission**, so a missing admit rate at a college that isn't open admission is Failing (above).
- **Fix the tier's public citation.** Quad's selectivity was cited by its field's default source ("IPEDS Admissions
  survey, Fall 2024") whenever its inputs came from more than one source, even where it read a college's newer
  figures. A derived field may now name a `primary` input (lib/fields.ts) that cites it when its inputs come from
  several sources; the tier and its pools (and the hidden band and scores) name the admit rate they read, so the tier
  cites what `selectivity.year` says it read. On 2026-10-19 that changed the public citation at 143 colleges (Georgia
  Tech: "Fall 2025, the college's own figures"); every rated college's citation now matches its `selectivity.year`
  (tested).

## Open questions
- **The estimate itself.** It still reads a college with no admit rate as open admission, including the 42 that say
  they aren't. This view flags them; whether the estimate should treat them differently (no level, or "can't tell") is
  a method question for specs/chances/.

## As built (2026-10-19)
- **After the small-pool rule** (2026-10-20): 292 Fresh, 1,534 Watch, 65 Stale, 2 Failing.
- **After open admission** (1,893 colleges): 292 Fresh, 1,494 Watch, 65 Stale, 42 Failing. IC2024: 235 open
  admission, 1,588 not, 70 no answer.
- **First measurement**, before open admission: 57 Fresh, 1,769 Watch, 67 Stale. By input, not Fresh: admit rate 1,751
  (1,403 of them the IPEDS Fall 2024 rate, a cycle behind, because no newer CDS is on hand; 346 with no rate), test
  scores 1,286, GPA 1,757 (827 the model's estimate only, 856 no GPA at all), academic factors 1,740, tier 347 not
  rated. The quickest way to move a college to Fresh is its current Common Data Set.
- **Published files**: all 17 files dated on the first run; every one Fresh (no newer release out yet; the IPEDS
  winter release is expected 2026-12). `IC2023_AY` and `IC2023` show 2025 and 2026 dates: NCES revised them after
  release, which is why the column says "file dated".
- **GPA**: a college whose only average is weighted (Georgia Tech, Harvard) is Watch, because the estimate reads the
  model's unweighted estimate there, not the weighted figure.
- **Routes, not `?view=`**: each view is its own route so the existing components' links stay simple and a view can
  be bookmarked; the old per-college filters redirect to `/admin/health/files`.
- The college page's health card is renamed **Files and collection**; the new panel opens the main column.
