# High School Data: Rigor, Outcomes, and Where Graduates Go

> Status: **planned** (not built). Independent of accounts; [scattergrams.md](scattergrams.md),
> [student-profile.md](student-profile.md) (high school picker), and [counselor-portal.md](counselor-portal.md)
> build on it. Expands the idea document's pipeline with verified public sources. Part of [product](README.md).

## Goal
Give every public high school (and later private ones) a page and a record the rest of the site can join to: how
rigorous it is (AP/IB access and pass rates), how its graduates do (graduation rate, share going to college), its
grading scale, and which colleges its graduates attend. Families ask "do kids from *our* school get into
Michigan?" and admissions officers read applications in the context of the school profile; the site should be able
to show both.

The same rules as colleges: cited, dated, no grades or ranks. Niche grades high schools and sells college leads
against them; Quad describes.

## Sources (research 2026-10-02)
| Tier | Source | What | Access | Coverage and refresh |
|---|---|---|---|---|
| **1** | **NCES Common Core of Data (CCD)** | Canonical `ncessch` id, name, district, address, lat/lng, grades served, enrollment by grade/race/sex, charter/magnet, Title I, student-teacher ratio | Bulk CSV from NCES, or the **Urban Institute Education Data API** (`schools/ccd/directory`, `schools/ccd/enrollment`), free, no key | ~24,000 public high schools; annual |
| **1** | **EDFacts** via the same API | Adjusted cohort graduation rate per school | `schools/edfacts/grad-rates` | Annual, ~1 year lag |
| **1** | **Civil Rights Data Collection (CRDC)** | AP course enrollment, AP exam takers and passers, IB enrollment, dual enrollment, by school; also discipline and staffing | Public-use file from civilrightsdata.ed.gov, or the API (`schools/crdc/…`) | Biennial (2021–22 latest at research time; 2023–24 expected) |
| **1** | **NCES Private School Survey (PSS)** | Directory and enrollment for private schools | Bulk CSV | Biennial |
| **2** | **State report cards** | Test proficiency, AP pass rates, college-going rate, chronic absence; some states (e.g. California's CDE, Texas TEA, New York's NYSED, Florida) publish downloadable files | One adapter per state, bulk CSV/XLSX | Annual; start with 4–5 large states |
| **2** | **National Student Clearinghouse** district reports | College enrollment, persistence, and completion by high school; the most complete source for "where graduates go" | Not public as data; districts receive StudentTracker reports and some post them (school board packets, state portals: South Carolina's EOC and Connecticut's EdSight publish them for every public high school) | Opportunistic; state-level adapters where a state publishes |
| **3** | **School profile PDFs** | GPA scale and distribution, weighting, AP/IB courses offered, SAT/ACT ranges, college matriculation list, class size | Crawled from the school's site with the [college-reported engine](../college-reported-data.md#how-it-works) (a recipe per school, cheap re-extraction when the file changes) | Annual (Sept–Nov); the highest-value source and the hardest |
| **3** | Matriculation lists → `unit_id` | "Where the class of 2025 enrolled" matched to IPEDS ids | Name matching against `schools.json` with a review queue for ambiguous names | Per profile |

Not used: Niche or other ratings (proprietary, graded), GreatSchools (licensed), test-prep company data.

## Pipeline
```
CCD / EDFacts / CRDC / PSS ──► data/high-schools/schools.json (one row per school; ~24K public + private later)
state report cards ───────────► data/high-schools/state/{xx}.json (merged by ncessch)
school profile PDFs ─────────► data/high-schools/detail/{ncessch}.json (GPA scale, courses, matriculation)
```
- `npm run sync-high-schools`: fetches the tier 1 sources (API or bulk), normalizes codes, writes the files; the
  same lineage rules as colleges (`lib/fields.ts` registration, `SourceKey`s `nces-ccd`, `edfacts`, `crdc`,
  `nces-pss`, `state-{xx}`, `hs-profile`; `npm run check:lineage` validates).
- **Entity resolution:** `ncessch` is the key everywhere. State files map state ids to `ncessch` with the CCD
  crosswalk; profiles are keyed by the school's `ncessch` in its recipe.
- **Normalization:** GPA scales recorded as the school states them (unweighted 4.0, weighted 5.0, 100-point) with
  the conversion rule in the detail file; the student profile uses it
  ([student-profile.md](student-profile.md#fields)). Never convert a weighted GPA to unweighted without the
  school's rule.
- **Small cells:** any count under 5 (CRDC and state files already suppress) is `null` with a `suppressed` flag;
  the site shows "fewer than 5".
- **Size:** 24K rows × ~1 KB is ~25 MB, too big for the in-memory dataset pattern. Store in Supabase
  `high_schools` (and `high_school_details`) and query by id and by search; no in-memory copy. Git keeps the files
  for review and diffs, published like history ([supabase.md](../supabase.md)).
- **Profile PDFs** reuse the recipe store, conditional fetching, and the review queue of the college-reported
  agent, with a `kind: "hs-profile"` extraction schema (GPA scale, GPA distribution bands, AP/IB list, score ranges,
  matriculation entries with counts). Checks: distribution sums to 100% ± 2; matriculation counts ≤ class size;
  every matched college is a real `unit_id`.

## Display
- **`/high-schools/{ncessch}`** (public): name, district, type, enrollment; **Rigor** (AP/IB courses offered, share
  of students in an AP course, AP exam pass rate, dual enrollment, each against the state median); **Outcomes**
  (graduation rate, college-going rate where the state has it, persistence where a Clearinghouse report exists);
  **Grading** (the school's scale, from its profile); **Where graduates go** (matriculation list with links to
  college profiles, counts when the profile gives them); sources and dates at the bottom.
- **Search:** `/high-schools` with a name and state search, and a picker component used by the student profile.
- **On a college profile** (for a signed-in student with a high school): "From your high school: 6 enrolled in
  2023–2025 (school profile, 2025)", and the scattergram when it exists ([scattergrams.md](scattergrams.md)).
- **Glossary:** `ncessch`, `adjusted-cohort-graduation-rate`, `ap-access`, `college-going-rate`, `school-profile`,
  `weighted-gpa`.

## Phases
1. **Tier 1 for all public high schools** (CCD, EDFacts, CRDC): sync, tables, pages, search, picker. No crawling.
2. **State report cards** for California, Texas, New York, Florida, Illinois (one adapter each; add states by
   demand), and the two states that publish Clearinghouse reports for every school.
3. **School profile pilot:** 100 high schools in three metro areas (chosen for coverage of the site's early users),
   measuring findability, extraction accuracy against hand-read profiles, matriculation match rate, and cost per
   school. Then expand by the high schools of signed-in students (demand-driven crawl), never all 24K at once.
4. Private schools (PSS) and their profiles.

## Rules
- Describe, don't grade: no composite score, no rank, no "A+". Comparisons are to the state median, labeled.
- Never show student-level data; profile distributions are the school's own published aggregates.
- Access rules of the college-reported engine apply (robots.txt, crawl delays, no bypassing protections).

## Files (planned)
- `scripts/sync-high-schools.mts`, `scripts/lib/education-data-api.mts`, `data/high-schools/**`,
  `lib/high-schools.ts` (server queries), `app/high-schools/`, `components/high-schools/`, migration
  `…_high_schools.sql`, `tests/high-schools.test.mts` (normalization, suppression, matriculation matching).

## Open questions
1. Is the Urban Institute API reliable enough for a scheduled sync, or should the sync use NCES bulk files with the
   API as a probe? Recommendation: bulk files for the sync (same approach as IPEDS), API for ad-hoc checks.
2. Which metro areas for the profile pilot? Depends on where early users are ([telemetry.md](telemetry.md) will
   show state distribution of signed-in students).
3. Private schools' profiles are often behind counselor-only pages; expect lower coverage.
