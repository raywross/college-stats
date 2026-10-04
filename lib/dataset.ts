import type { DatasetMeta, School, SearchFilters, SchoolType, SortKey } from "./types";
import type { FieldPath } from "./fields";
import { lineageFor, sourcesForFields as sourcesForFieldsPure, type Cited, type CitedSource } from "./lineage";
import type { ReleaseCalendar } from "./releases";
import { crestBrand, type CrestBrand } from "./brand";
import { compareMatches, scoreSchool, type AliasRow } from "./aliases";
import { matchesIndicators } from "./indicators";
import { genderBalanceOf, isMostlyFullTime } from "./student-body";
import { matchesPolicy } from "./test-policy";
import { hasFewLoans } from "./repayment";
import { hasTuitionGuarantee, noApplicationFee, requiresLiveOn } from "./housing";
import { FACTOR_FILTERS } from "./factors";
import { RESIDENCY_FILTERS } from "./cds/residency-display";
import { hasHonorsProgram } from "./cds/academics-display";
import { TRANSFER_FILTER } from "./cds/transfer-display";
import { meetsGreekThreshold } from "./cds/greek-display";
import { LOGISTICS_FILTERS } from "./cds/application-logistics-display";
import { matchesCampus } from "./campus-profile";
import { matchesFaith } from "./religion.ts";
import { matchesServices } from "./campus-services.ts";
import { withinMaxRatio, withinMinFullTimeFaculty } from "./academics.ts";
import { hasSmallPellGap } from "./graduation-groups.ts";
import { drawsNationally } from "./residence.ts";
import { matchesField } from "./majors.ts";
import { noCssProfile, offersInternationalAid } from "./cds/financial-aid.ts";
import {
  METRICS,
  SIZE_BUCKETS,
  aidGenerosity,
  diversityIndex,
  median,
  percentileRankSorted,
  satComposite,
  satMid,
  type MetricKey,
} from "./metrics";

/**
 * Queries over one loaded copy of the dataset. Pure: `lib/data.ts` loads the files (from data/*.json or
 * Supabase; see specs/data-layer.md) and calls `createDataset` once per load, so every query below runs in
 * memory and gives the same answer whichever store served the rows.
 */

/** Everything a dataset load returns: the colleges plus the files that describe them. */
export interface DatasetFiles {
  schools: School[];
  meta: DatasetMeta;
  releaseCalendar: ReleaseCalendar;
  /** Short names and nicknames (specs/school-identity/aliases.md); absent/empty when none loaded (fail-soft). */
  aliases?: AliasRow[];
}

/** Lightweight shape sent to the browser. */
export interface SchoolIndexEntry {
  id: string;
  name: string;
  city: string;
  state: string;
  type: SchoolType;
  acceptance: number | null;
  /** The crest's colors and mark (specs/school-identity/brand.md), when the college has them. */
  brand?: CrestBrand;
  /** The alias' display form that matched a search query ("Georgia Tech"), when one did (lib/aliases.ts). */
  matched?: string;
}

export function toIndexEntry(s: School): SchoolIndexEntry {
  const brand = crestBrand(s);
  return {
    id: s.unit_id,
    name: s.name,
    city: s.location.city,
    state: s.location.state,
    type: s.type,
    acceptance: s.admissions.acceptance_rate,
    ...(brand ? { brand } : {}),
  };
}

export function paginate<T>(items: T[], page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * perPage, current * perPage), page: current, pages, total: items.length };
}

/** Generic scatter point: x/y meaning is set by the chart's axis config. */
export interface ScatterPointData {
  id: string;
  name: string;
  x: number;
  y: number;
  enrollment: number;
  type: SchoolType;
  city: string;
  state: string;
}

const SORTERS: Record<SortKey, (s: School) => number | string | null> = {
  applicants: (s) => s.admissions.applicants,
  name: (s) => s.name,
  acceptance_rate: (s) => s.admissions.acceptance_rate,
  enrollment: (s) => s.demographics.undergrad_enrollment,
  sat: satMid,
  pell: (s) => s.demographics.pell_grant_percent,
  first_gen: (s) => s.demographics.first_gen_percent,
  diversity: diversityIndex,
  avg_cost: (s) => s.cost?.avg_paid_all ?? null,
  aid_generosity: aidGenerosity,
  net_price: (s) => s.cost?.aided_net_price ?? null,
  earnings: (s) => s.outcomes?.median_earnings_10yr ?? null,
  grad_rate: (s) => s.outcomes?.graduation_rate ?? null,
  avg_cost_change: METRICS.avgCostChange.get,
  // Points, so a drop from 40% to 20% ranks with one from 25% to 5%. Only with 200+ applicants at both ends: a rate
  // on a handful of applicants swings on a few decisions.
  admit_rate_change: (s) => {
    const a = s.trends?.applicants;
    return a && Math.min(a.from, a.to) >= 200 ? (s.trends?.acceptance_rate?.change ?? null) : null;
  },
  size_change: METRICS.sizeChange.get,
  apps_change: METRICS.applicantsChange.get,
  diversity_change: METRICS.diversityChange.get,
  men_share: METRICS.menShare.get,
  part_time: METRICS.partTime.get,
  men_share_change: METRICS.menShareChange.get,
  admit_gap: METRICS.admitGap.get,
  loan_rate: METRICS.loanRate.get,
  loan_rate_change: METRICS.loanRateChange.get,
  student_faculty: METRICS.studentFaculty.get,
  completion_8yr: METRICS.completion8.get,
  completion_4yr: METRICS.completion4.get,
  pell_gap: METRICS.pellGap.get,
  pell_gap_change: METRICS.pellGapChange.get,
  full_time_faculty: METRICS.facultyFullTime.get,
  out_of_state: METRICS.outOfState.get,
  transfer_share: METRICS.transferShare.get,
  // Endowment reuses the FASB-only getter: Explore's endowment sort defaults to private nonprofits (specs/data-expansion/finances.md).
  instruction_spending: METRICS.financesInstruction.get,
  endowment_per_student: METRICS.endowmentFasb.get,
  bachelors: (s) => s.academics?.bachelors_awarded ?? null,
};

function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

export type Dataset = ReturnType<typeof createDataset>;

/**
 * Query functions bound to one dataset. They are closures, not methods, so callers can destructure:
 * `const { rankOf } = await getData();`.
 */
export function createDataset({ schools, meta, releaseCalendar, aliases = [] }: DatasetFiles) {
  const byId = new Map(schools.map((s) => [s.unit_id, s]));

  /** The alias key index beside the school index (specs/school-identity/aliases.md#store): each school's own rows. */
  const aliasesByUnitId = new Map<string, AliasRow[]>();
  for (const row of aliases) aliasesByUnitId.set(row.unit_id, [...(aliasesByUnitId.get(row.unit_id) ?? []), row]);

  /* ---------------------------------------------------------------- */
  /* Sources & citations                                               */
  /* ---------------------------------------------------------------- */

  function getMeta(): DatasetMeta {
    return meta;
  }

  /** Full citation for one value: source, year, method, formula and inputs. Default source without a school. */
  function citeField(path: FieldPath, school?: School): Cited {
    return lineageFor(path, school, meta);
  }

  /** Distinct sources behind the values a section shows (derived values cite their inputs). */
  function sourcesForFields(paths: readonly FieldPath[], school?: School): CitedSource[] {
    return sourcesForFieldsPure(paths, school, meta);
  }

  /** Union of sources across several schools (Compare). */
  function sourcesForSchools(paths: readonly FieldPath[], list: School[]): CitedSource[] {
    const out = new Map<string, CitedSource>();
    for (const s of list) for (const src of sourcesForFieldsPure(paths, s, meta)) out.set(`${src.key}|${src.url}|${src.year ?? ""}`, src);
    return [...out.values()];
  }

  /** When each source is expected to publish newer data (data/release-calendar.json; see lib/releases.ts). */
  function getReleaseCalendar(): ReleaseCalendar {
    return releaseCalendar;
  }

  /** Schools whose data includes their own Common Data Set. */
  function cdsSchools(): School[] {
    return schools.filter((s) => s.cds).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  function getAllSchools(): School[] {
    return schools;
  }

  function getSchools(filters: SearchFilters = {}): School[] {
    let results = schools;

    if (filters.q) {
      // Shares lib/aliases.ts's scorer with searchSchools, so "uga" lists the University of Georgia here too
      // (specs/school-identity/aliases.md#search). An exact alias match wins outright; substring matches (the
      // existing name/city/state rules, all part of the same scorer) still appear below it, ties broken by
      // applicants — the same order the typeahead uses, kept stable into whatever sort the caller applies next.
      const matches = results
        .map((s) => ({ s, m: scoreSchool(s, filters.q!, aliasesByUnitId.get(s.unit_id)) }))
        .filter((x): x is { s: School; m: NonNullable<typeof x.m> } => x.m !== null);
      matches.sort((a, b) => compareMatches({ match: a.m, school: a.s }, { match: b.m, school: b.s }));
      results = matches.map((x) => x.s);
    }
    if (filters.states?.length) results = results.filter((s) => filters.states!.includes(s.location.state));
    if (filters.regions?.length) results = results.filter((s) => filters.regions!.includes(s.location.region));
    if (filters.types?.length) results = results.filter((s) => filters.types!.includes(s.type));
    if (filters.sizes?.length) {
      const buckets = SIZE_BUCKETS.filter((b) => filters.sizes!.includes(b.key));
      results = results.filter((s) =>
        buckets.some((b) => s.demographics.undergrad_enrollment >= b.min && s.demographics.undergrad_enrollment <= b.max)
      );
    }

    // Range filters exclude schools that don't report the metric.
    const ar = (s: School) => s.admissions.acceptance_rate;
    if (filters.minAR !== undefined) results = results.filter((s) => ar(s) !== null && ar(s)! >= filters.minAR! / 100);
    if (filters.maxAR !== undefined) results = results.filter((s) => ar(s) !== null && ar(s)! <= filters.maxAR! / 100);

    // SAT/ACT filters keep schools whose middle-50% range overlaps the chosen window.
    if (filters.minSAT !== undefined) results = results.filter((s) => (satComposite(s)?.[1] ?? -1) >= filters.minSAT!);
    if (filters.maxSAT !== undefined) results = results.filter((s) => (satComposite(s)?.[0] ?? Infinity) <= filters.maxSAT!);
    const act = (s: School) => s.admissions.act_composite_25_75;
    if (filters.minACT !== undefined) results = results.filter((s) => (act(s)?.[1] ?? -1) >= filters.minACT!);
    if (filters.maxACT !== undefined) results = results.filter((s) => (act(s)?.[0] ?? Infinity) <= filters.maxACT!);

    const cost = (s: School) => s.cost?.avg_paid_all ?? null;
    if (filters.minCost !== undefined) results = results.filter((s) => cost(s) !== null && cost(s)! >= filters.minCost!);
    if (filters.maxCost !== undefined) results = results.filter((s) => cost(s) !== null && cost(s)! <= filters.maxCost!);

    if (filters.minEnroll !== undefined) results = results.filter((s) => s.demographics.undergrad_enrollment >= filters.minEnroll!);
    if (filters.maxEnroll !== undefined) results = results.filter((s) => s.demographics.undergrad_enrollment <= filters.maxEnroll!);
    // Unreported ratios never match (a missing value isn't a small one).
    if (filters.maxRatio !== undefined) results = results.filter((s) => withinMaxRatio(s, filters.maxRatio!));
    if (filters.minFullTimeFaculty !== undefined) results = results.filter((s) => withinMinFullTimeFaculty(s, filters.minFullTimeFaculty!));

    // Trend indicators drop colleges without enough history to say.
    if (filters.trends) results = results.filter((s) => matchesIndicators(s, filters.trends!));

    // Student body (lib/student-body.ts); colleges that don't report the share are left out while set.
    if (filters.balance?.length) results = results.filter((s) => filters.balance!.includes(genderBalanceOf(s)!));
    if (filters.fullTime) results = results.filter(isMostlyFullTime);
    // Test policy (lib/test-policy.ts): each college's newest policy; colleges with none are left out while set.
    if (filters.policy?.length) results = results.filter((s) => matchesPolicy(s, filters.policy!));
    if (filters.fewLoans) results = results.filter(hasFewLoans);
    // Graduation by group: colleges without both Pell and "neither" rates are left out while set.
    if (filters.pellGap) results = results.filter(hasSmallPellGap);
    if (filters.national) results = results.filter(drawsNationally);
    // Majors: colleges that don't report degrees by field are left out while set.
    if (filters.field) results = results.filter((s) => matchesField(s, filters.field!, filters.fieldMin));
    if (filters.liveOn) results = results.filter(requiresLiveOn);
    if (filters.noFee) results = results.filter(noApplicationFee);
    if (filters.guarantee) results = results.filter(hasTuitionGuarantee);
    for (const f of FACTOR_FILTERS) if (filters[f.param]) results = results.filter(f.test);
    // Where applicants live: colleges without a residency grid never match (cds-residency-admissions.md).
    for (const f of RESIDENCY_FILTERS) if (filters[f.param]) results = results.filter(f.test);
    // Honors program (cds-academics.md): narrows only toward colleges whose CDS marks one; nothing excludes for its absence.
    if (filters.honors) results = results.filter(hasHonorsProgram);
    if (filters.transfers) results = results.filter(TRANSFER_FILTER.test);
    // Greek life, phase 1 (specs/greek-life.md): colleges that report neither percentage never match (minGreek).
    if (filters.minGreek !== undefined) results = results.filter((s) => meetsGreekThreshold(s, filters.minGreek!));
    // Gap year (LOGISTICS_FILTERS, cds-application-logistics.md): colleges without a CDS answer never match.
    for (const f of LOGISTICS_FILTERS) if (filters[f.param]) results = results.filter(f.test);
    if (filters.setting || filters.research || filters.designation || filters.opportunity) results = results.filter((s) => matchesCampus(s, filters));
    // Religious affiliation (lib/religion.ts): colleges IPEDS has no answer for never match.
    if (filters.faith?.length) results = results.filter((s) => matchesFaith(s, filters.faith!));
    if (filters.division || filters.conference !== undefined || filters.football || filters.rotc || filters.ugResearch || filters.studyAbroad)
      results = results.filter((s) => matchesServices(s, filters));
    // CDS financial aid: colleges without the college's own report never match.
    if (filters.aidForms === "no-css") results = results.filter(noCssProfile);
    if (filters.intlAid) results = results.filter(offersInternationalAid);

    const sortBy: SortKey = filters.sortBy && filters.sortBy in SORTERS ? filters.sortBy : "applicants";
    const multiplier = (filters.sortDir ?? (sortBy === "applicants" ? "desc" : "asc")) === "asc" ? 1 : -1;
    const get = SORTERS[sortBy];

    return [...results].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      // Missing values always sink to the bottom, whichever direction.
      if (av === null && bv === null) return a.name.localeCompare(b.name);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * multiplier;
      return ((av as number) - (bv as number)) * multiplier || a.name.localeCompare(b.name);
    });
  }

  function getSchoolById(id: string): School | null {
    return byId.get(id) ?? null;
  }

  function getSchoolsByIds(ids: string[]): School[] {
    return ids.map((id) => byId.get(id)).filter((s): s is School => !!s);
  }

  function getStates(): string[] {
    return [...new Set(schools.map((s) => s.location.state))].sort();
  }

  /* ---------------------------------------------------------------- */
  /* Search (typeahead + compare picker, served by /api/schools)       */
  /* ---------------------------------------------------------------- */

  /**
   * Alias-exact matches first, then name-prefix, alias-prefix, word-prefix, then anywhere; ties go to bigger
   * applicant pools (lib/aliases.ts#scoreSchool; specs/school-identity/aliases.md#search). "UGA" finds the
   * University of Georgia; "ASU" lists Arizona State first among the five colleges that share the alias.
   */
  function searchSchools(q: string, limit = 8, exclude: string[] = []): SchoolIndexEntry[] {
    if (!q.trim()) return [];
    const skip = new Set(exclude);
    const scored: { s: School; m: NonNullable<ReturnType<typeof scoreSchool>> }[] = [];
    for (const s of schools) {
      if (skip.has(s.unit_id)) continue;
      const m = scoreSchool(s, q, aliasesByUnitId.get(s.unit_id));
      if (m) scored.push({ s, m });
    }
    return scored
      .sort((a, b) => compareMatches({ match: a.m, school: a.s }, { match: b.m, school: b.s }))
      .slice(0, limit)
      .map(({ s, m }) => ({ ...toIndexEntry(s), ...(m.matched ? { matched: m.matched } : {}) }));
  }

  /* ---------------------------------------------------------------- */
  /* Dataset-level statistics (cached per metric)                      */
  /* ---------------------------------------------------------------- */

  const sortedCache = new Map<MetricKey, number[]>();

  /** All reported values for a metric, ascending. Missing values are excluded. */
  function metricValues(key: MetricKey): number[] {
    let sorted = sortedCache.get(key);
    if (!sorted) {
      sorted = schools
        .map(METRICS[key].get)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      sortedCache.set(key, sorted);
    }
    return sorted;
  }

  function metricMedian(key: MetricKey): number | null {
    return median(metricValues(key));
  }

  /** 0..1 share of other reporting schools below this value; null if not reported. */
  function rankOf(school: School, key: MetricKey): number | null {
    const v = METRICS[key].get(school);
    return v === null ? null : percentileRankSorted(v, metricValues(key));
  }

  function reportingCount(key: MetricKey): number {
    return metricValues(key).length;
  }

  /** Short names and nicknames (specs/school-identity/aliases.md), for the /data page: row and college counts. */
  function aliasStats(): { rows: number; colleges: number } {
    return { rows: aliases.length, colleges: aliasesByUnitId.size };
  }

  function getDatasetSummary() {
    const counted = schools.filter((s) => s.admissions.applicants && s.admissions.admitted !== null);
    const totalApplicants = counted.reduce((a, s) => a + (s.admissions.applicants ?? 0), 0);
    const totalAdmitted = counted.reduce((a, s) => a + (s.admissions.admitted ?? 0), 0);
    const years = schools.map((s) => s.admissions.year).filter((y): y is number => y !== null);
    return {
      count: schools.length,
      states: getStates().length,
      totalApplicants,
      totalAdmitted,
      totalUndergrads: schools.reduce((a, s) => a + s.demographics.undergrad_enrollment, 0),
      overallAdmitRate: totalApplicants ? totalAdmitted / totalApplicants : 0,
      /** Most common admissions year across the dataset. */
      year: mode(years),
      medianAcceptance: metricMedian("acceptance"),
      medianSat: metricMedian("sat"),
    };
  }

  function countByState(): Record<string, number> {
    return schools.reduce<Record<string, number>>((acc, s) => {
      acc[s.location.state] = (acc[s.location.state] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Top N on a metric. `minApplicants` / `minUndergrads` keep tiny programs
   * (e.g. 12 applicants) from topping "most selective"-style lists.
   */
  function topBy(
    key: MetricKey,
    dir: "asc" | "desc",
    n = 5,
    opts: { minApplicants?: number; minUndergrads?: number } = {}
  ): School[] {
    const get = METRICS[key].get;
    return schools
      .filter(
        (s) =>
          get(s) !== null &&
          (s.admissions.applicants ?? 0) >= (opts.minApplicants ?? 0) &&
          s.demographics.undergrad_enrollment >= (opts.minUndergrads ?? 0)
      )
      .sort((a, b) => (dir === "asc" ? get(a)! - get(b)! : get(b)! - get(a)!))
      .slice(0, n);
  }

  /** Histogram of a metric over a fixed range (missing values excluded). */
  function histogram(key: MetricKey, bins: number, [lo, hi]: [number, number]): number[] {
    const counts = new Array(bins).fill(0);
    for (const v of metricValues(key)) {
      const i = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
      counts[i]++;
    }
    return counts;
  }

  /* ---------------------------------------------------------------- */
  /* Chart helpers                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Points for the admissions landscape: schools reporting both acceptance
   * rate and SAT, capped to the most-applied-to `limit` (plus any `ensure` ids)
   * so the chart stays readable and the page payload small.
   */
  function landscapePoints(pool: School[] = schools, limit = 400, ensure: string[] = []): ScatterPointData[] {
    const eligible = pool.filter((s) => s.admissions.acceptance_rate !== null && satMid(s) !== null);
    const top = [...eligible].sort((a, b) => (b.admissions.applicants ?? 0) - (a.admissions.applicants ?? 0)).slice(0, limit);
    const ids = new Set(top.map((s) => s.unit_id));
    for (const id of ensure) {
      const s = byId.get(id);
      if (s && !ids.has(id) && s.admissions.acceptance_rate !== null && satMid(s) !== null) top.push(s);
    }
    return top.map((s) => ({
      id: s.unit_id,
      name: s.name,
      x: s.admissions.acceptance_rate!,
      y: satMid(s)!,
      enrollment: s.demographics.undergrad_enrollment,
      type: s.type,
      city: s.location.city,
      state: s.location.state,
    }));
  }

  /**
   * Points for the "cost vs. earnings" chart: x = estimated average cost for all students,
   * y = median earnings 10 years after entry.
   */
  function valuePoints(pool: School[] = schools, limit = 400, ensure: string[] = []): ScatterPointData[] {
    const ok = (s: School) => s.cost?.avg_paid_all != null && s.outcomes?.median_earnings_10yr != null;
    const top = [...pool.filter(ok)].sort((a, b) => (b.admissions.applicants ?? 0) - (a.admissions.applicants ?? 0)).slice(0, limit);
    const ids = new Set(top.map((s) => s.unit_id));
    for (const id of ensure) {
      const s = byId.get(id);
      if (s && !ids.has(id) && ok(s)) top.push(s);
    }
    return top.map((s) => ({
      id: s.unit_id,
      name: s.name,
      x: s.cost!.avg_paid_all!,
      y: s.outcomes!.median_earnings_10yr!,
      enrollment: s.demographics.undergrad_enrollment,
      type: s.type,
      city: s.location.city,
      state: s.location.state,
    }));
  }

  /** Points for "sticker price vs. what students actually pay": x = full price, y = average total cost. */
  function stickerPoints(pool: School[] = schools, limit = 400, ensure: string[] = []): ScatterPointData[] {
    const ok = (s: School) => !!s.cost?.breakdown && s.cost.avg_paid_all != null;
    const top = [...pool.filter(ok)].sort((a, b) => (b.admissions.applicants ?? 0) - (a.admissions.applicants ?? 0)).slice(0, limit);
    const ids = new Set(top.map((s) => s.unit_id));
    for (const id of ensure) {
      const s = byId.get(id);
      if (s && !ids.has(id) && ok(s)) top.push(s);
    }
    return top.map((s) => ({
      id: s.unit_id,
      name: s.name,
      x: s.cost!.breakdown!.full_price,
      y: s.cost!.avg_paid_all!,
      enrollment: s.demographics.undergrad_enrollment,
      type: s.type,
      city: s.location.city,
      state: s.location.state,
    }));
  }

  function stickerEligibleCount(pool: School[] = schools): number {
    return pool.filter((s) => !!s.cost?.breakdown && s.cost.avg_paid_all != null).length;
  }

  function valueEligibleCount(pool: School[] = schools): number {
    return pool.filter((s) => s.cost?.avg_paid_all != null && s.outcomes?.median_earnings_10yr != null).length;
  }

  function landscapeEligibleCount(pool: School[] = schools): number {
    return pool.filter((s) => s.admissions.acceptance_rate !== null && satMid(s) !== null).length;
  }

  /**
   * Distribution of a metric across all reporting schools, for the
   * "where it sits" strips. Uses the 1st–99th percentile as the axis so a few
   * outliers don't squash everyone else into one bin.
   */
  function distribution(key: MetricKey, bins = 40): { bins: number[]; min: number; max: number; n: number } {
    const sorted = metricValues(key);
    const scale = METRICS[key].scale;
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
    let min = sorted.length ? p(0.01) : 0;
    let max = sorted.length ? p(0.99) : 1;
    if (scale && key !== "sat") {
      min = Math.max(scale[0], min);
      max = Math.min(scale[1], max);
    }
    if (max <= min) max = min + 1;
    const counts = new Array(bins).fill(0);
    for (const v of sorted) {
      const i = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / (max - min)) * bins)));
      counts[i]++;
    }
    return { bins: counts, min, max, n: sorted.length };
  }

  return {
    getMeta,
    citeField,
    sourcesForFields,
    sourcesForSchools,
    getReleaseCalendar,
    cdsSchools,
    getAllSchools,
    getSchools,
    getSchoolById,
    getSchoolsByIds,
    getStates,
    searchSchools,
    metricValues,
    metricMedian,
    rankOf,
    reportingCount,
    getDatasetSummary,
    aliasStats,
    countByState,
    topBy,
    histogram,
    landscapePoints,
    valuePoints,
    stickerPoints,
    stickerEligibleCount,
    valueEligibleCount,
    landscapeEligibleCount,
    distribution,
  };
}
