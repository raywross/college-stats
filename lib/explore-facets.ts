import type { School } from "./types";
import { offersMerit, type MeritInfo } from "./merit.ts";
import type { FilterFacets } from "../components/explore/FilterPanel";
import { INDICATOR_KEYS, indicatorOf, type Direction } from "./indicators.ts";
import { median, sizeBucket, type MetricKey } from "./metrics.ts";
import { typeLabel } from "./format.ts";
import { genderBalanceOf, isMostlyFullTime } from "./student-body.ts";
import { hasFewLoans } from "./repayment.ts";
import { hasSmallPellGap } from "./graduation-groups.ts";
import { HOUSING_FILTERS } from "./housing.ts";
import { FACTOR_FILTERS } from "./factors.ts";
import { RESIDENCY_FILTERS } from "./cds/residency-display.ts";
import { hasHonorsProgram } from "./cds/academics-display.ts";
import { TRANSFER_FILTER } from "./cds/transfer-display.ts";
import { GREEK_COUNCIL_FILTERS, MIN_GREEK_OPTIONS, hasGreekCouncil, meetsGreekThreshold } from "./cds/greek-display.ts";
import { LOGISTICS_FILTERS } from "./cds/application-logistics-display.ts";
import { DESIGNATION_KEYS, RESEARCH_TIERS, SETTING_GROUPS, designationsOf, isOpportunityCollege } from "./campus-profile.ts";
import { DIVISION_FILTERS, ROTC_BRANCHES, divisionFilterOf } from "./campus-services.ts";
import { MAX_RATIO_OPTIONS, MIN_FULL_TIME_FACULTY_OPTIONS } from "./academics.ts";
import { drawsNationally } from "./residence.ts";
import { noCssProfile, offersInternationalAid } from "./cds/financial-aid.ts";
import { fieldFacets } from "./majors.ts";
import { policyBucket } from "./test-policy.ts";
import { FAITH_FILTERS, faithFilterOf } from "./religion.ts";
import { TRADITIONS } from "./directories.ts";
import { hasLgbtqCenter, policyIsYes } from "./lgbtq-policy.ts";

/**
 * Explore's filter-panel counts (specs/serving-architecture.md section 5). They describe the whole dataset, not the
 * filtered list, so `createDataset` computes them once per load and serves the same object after that
 * (`facets()` in lib/dataset.ts). Pure: no fs, no Next.
 */

/** The two dataset queries the facets read; `createDataset` passes its own closures. */
export interface FacetSource {
  getAllSchools(): School[];
  histogram(key: MetricKey, bins: number, range: [number, number]): number[];
  /** The college's merit class (lib/merit.ts), memoized by the dataset. */
  meritInfoFor(school: School): MeritInfo;
}

export function buildFacets({ getAllSchools, histogram, meritInfoFor }: FacetSource): FilterFacets {
  const all = getAllSchools();
  const tally = (get: (s: (typeof all)[number]) => string) =>
    all.reduce<Record<string, number>>((acc, s) => ((acc[get(s)] = (acc[get(s)] ?? 0) + 1), acc), {});

  const states = tally((s) => s.location.state);
  const regions = tally((s) => s.location.region);
  const types = tally((s) => s.type);
  const sizes = tally((s) => sizeBucket(s.demographics.undergrad_enrollment).key);

  const trends = Object.fromEntries(
    INDICATOR_KEYS.map((k) => {
      const counts: Record<Direction, number> = { up: 0, steady: 0, down: 0 };
      for (const s of all) {
        const i = indicatorOf(s, k);
        if (i) counts[i.direction]++;
      }
      return [k, counts];
    })
  ) as FilterFacets["trends"];

  const balance: FilterFacets["balance"] = { women: 0, balanced: 0, men: 0 };
  for (const s of all) {
    const b = genderBalanceOf(s);
    if (b) balance[b]++;
  }

  // Test policy (lib/test-policy.ts): each college's newest policy.
  const policy: FilterFacets["policy"] = { required: 0, optional: 0, blind: 0 };
  for (const s of all) {
    const b = policyBucket(s.admissions.test_policy);
    if (b) policy[b]++;
  }

  const campus: FilterFacets["campus"] = {
    setting: Object.fromEntries(SETTING_GROUPS.map((g) => [g.key, 0])) as FilterFacets["campus"]["setting"],
    research: Object.fromEntries(RESEARCH_TIERS.map((r) => [r, 0])) as FilterFacets["campus"]["research"],
    designation: Object.fromEntries(DESIGNATION_KEYS.map((d) => [d, 0])) as FilterFacets["campus"]["designation"],
    opportunity: all.filter(isOpportunityCollege).length,
  };
  for (const s of all) {
    if (s.campus?.setting) campus.setting[s.campus.setting.group]++;
    if (s.campus?.carnegie?.research) campus.research[s.campus.carnegie.research]++;
    for (const d of designationsOf(s)) campus.designation[d]++;
  }

  // Religious affiliation (lib/religion.ts): colleges per faith family, and with none.
  const faith = Object.fromEntries(FAITH_FILTERS.map((f) => [f.key, 0])) as FilterFacets["faith"];
  for (const s of all) {
    const f = faithFilterOf(s);
    if (f) faith[f]++;
  }

  // Faith communities (specs/campus-directories.md): colleges with a named group of this tradition.
  const faithGroup = Object.fromEntries(Object.keys(TRADITIONS).map((t) => [t, 0])) as FilterFacets["faithGroup"];
  for (const s of all) for (const t of s.directories?.faith ?? []) if (t in faithGroup) faithGroup[t as keyof typeof faithGroup]++;
  // LGBTQ+ policy facts only (lib/lgbtq-policy.ts); the gender-identity counts are never a facet.
  const lgbtq: FilterFacets["lgbtq"] = {
    center: all.filter(hasLgbtqCenter).length,
    housing: all.filter((s) => policyIsYes(s, "inclusive_housing")).length,
    nondiscrimination: all.filter((s) => policyIsYes(s, "nondiscrimination_identity")).length,
  };

  const ratios = all.map((s) => s.academics?.student_faculty_ratio).filter((v): v is number => v != null);
  const maxRatio = Object.fromEntries(MAX_RATIO_OPTIONS.map((n) => [n, ratios.filter((v) => v <= n).length]));

  const ftShares = all.map((s) => s.academics?.faculty?.full_time_share).filter((v): v is number => v != null);
  const minFullTimeFaculty = Object.fromEntries(MIN_FULL_TIME_FACULTY_OPTIONS.map((n) => [n, ftShares.filter((v) => v >= n).length]));

  const services: FilterFacets["services"] = {
    division: Object.fromEntries(DIVISION_FILTERS.map((d) => [d, 0])) as FilterFacets["services"]["division"],
    football: all.filter((s) => s.campus?.athletics?.sports.includes("football")).length,
    rotc: Object.fromEntries(ROTC_BRANCHES.map((b) => [b, all.filter((s) => s.campus?.programs?.rotc.includes(b)).length])) as FilterFacets["services"]["rotc"],
    ugResearch: all.filter((s) => s.campus?.programs?.undergrad_research).length,
    studyAbroad: all.filter((s) => s.campus?.programs?.study_abroad).length,
  };
  for (const s of all) {
    const d = divisionFilterOf(s);
    if (d) services.division[d]++;
  }

  const satRange: [number, number] = [800, 1600];
  return {
    maxRatio,
    medianRatio: median(ratios),
    minFullTimeFaculty,
    medianFullTimeFaculty: median(ftShares),
    services,
    balance,
    policy,
    fullTime: all.filter(isMostlyFullTime).length,
    fewLoans: all.filter(hasFewLoans).length,
    pellGap: all.filter(hasSmallPellGap).length,
    national: all.filter(drawsNationally).length,
    aidNoCss: all.filter(noCssProfile).length,
    intlAid: all.filter(offersInternationalAid).length,
    fields: fieldFacets(all),
    housing: Object.fromEntries(HOUSING_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["housing"],
    factors: Object.fromEntries(FACTOR_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["factors"],
    residency: Object.fromEntries(RESIDENCY_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["residency"],
    honors: all.filter(hasHonorsProgram).length,
    transfers: all.filter(TRANSFER_FILTER.test).length,
    minGreek: Object.fromEntries(MIN_GREEK_OPTIONS.map((n) => [n, all.filter((s) => meetsGreekThreshold(s, n)).length])),
    greekCouncils: Object.fromEntries(GREEK_COUNCIL_FILTERS.map((f) => [f.key, all.filter((s) => hasGreekCouncil(s, f.key)).length])) as FilterFacets["greekCouncils"],
    logistics: Object.fromEntries(LOGISTICS_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["logistics"],
    merit: all.filter((s) => offersMerit(meritInfoFor(s))).length,
    campus,
    faith,
    faithGroup,
    lgbtq,
    states: Object.keys(states).sort().map((value) => ({ value, count: states[value] })),
    regions: Object.keys(regions).sort().map((value) => ({ value, count: regions[value] })),
    types: Object.keys(types).map((value) => ({ value, label: typeLabel(value), count: types[value] })),
    sizes,
    arBins: histogram("acceptance", 20, [0, 1]),
    satBins: histogram("sat", 32, satRange),
    costBins: histogram("avgCost", 32, [0, 80000]),
    satRange,
    trends,
  };
}
