import type { ExploreView, SchoolType, SearchFilters, SizeBucket, SortKey } from "./types";
import { INDICATORS, INDICATOR_KEYS, isDirection, type Direction, type IndicatorKey } from "./indicators.ts";
import { isGenderBalance } from "./student-body.ts";
import { isDesignation, isResearchTier, isSettingGroup } from "./campus-profile.ts";
import { isDivisionFilter, isRotcBranch } from "./campus-services.ts";
import { conferenceName } from "./conferences.ts";
import { isMajorFamily } from "./majors.ts";

/** Unique values, or undefined when none remain. */
const uniq = <T,>(v: T[] | undefined): T[] | undefined => (v?.length ? [...new Set(v)] : undefined);

type Params = Record<string, string | string[] | undefined>;

const str = (v: Params[string]) => (typeof v === "string" && v !== "" ? v : undefined);
const list = (v: Params[string]) => str(v)?.split(",").filter(Boolean);
const n = (v: Params[string]) => {
  const s = str(v);
  if (s === undefined) return undefined;
  const x = Number(s);
  return Number.isFinite(x) ? x : undefined;
};

const SORT_KEYS: SortKey[] = [
  "applicants", "name", "acceptance_rate", "enrollment", "sat", "pell", "first_gen", "diversity", "avg_cost", "aid_generosity", "net_price", "earnings", "grad_rate",
  "avg_cost_change", "admit_rate_change", "size_change", "apps_change", "diversity_change",
  "men_share", "part_time", "men_share_change", "admit_gap", "loan_rate", "loan_rate_change", "student_faculty", "completion_8yr", "completion_4yr",
  "pell_gap", "pell_gap_change", "full_time_faculty", "out_of_state", "transfer_share", "instruction_spending", "endowment_per_student", "bachelors",
];
const VIEWS: ExploreView[] = ["grid", "table", "chart", "map"];

/** Trend indicator filters: `costTrend=down,steady` and so on (lib/indicators.ts); unknown directions are dropped. */
function parseTrends(params: Params): SearchFilters["trends"] {
  const out: Partial<Record<IndicatorKey, Direction[]>> = {};
  for (const k of INDICATOR_KEYS) {
    const dirs = list(params[INDICATORS[k].param])?.filter(isDirection);
    if (dirs?.length) out[k] = [...new Set(dirs)];
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseFilters(params: Params): SearchFilters {
  const sortBy = str(params.sortBy) as SortKey | undefined;
  return {
    q: str(params.q),
    states: list(params.states),
    regions: list(params.regions),
    types: list(params.types) as SchoolType[] | undefined,
    sizes: list(params.sizes) as SizeBucket[] | undefined,
    minAR: n(params.minAR),
    maxAR: n(params.maxAR),
    minSAT: n(params.minSAT),
    maxSAT: n(params.maxSAT),
    minACT: n(params.minACT),
    maxACT: n(params.maxACT),
    minEnroll: n(params.minEnroll),
    maxEnroll: n(params.maxEnroll),
    maxRatio: ((v) => (v !== undefined && v > 0 ? v : undefined))(n(params.maxRatio)),
    // Stored as a share (0–1); the URL holds a percent (minFullTimeFaculty=70).
    minFullTimeFaculty: ((v) => (v !== undefined && v > 0 ? v / 100 : undefined))(n(params.minFullTimeFaculty)),
    minCost: n(params.minCost),
    maxCost: n(params.maxCost),
    trends: parseTrends(params),
    balance: (() => {
      const b = list(params.balance)?.filter(isGenderBalance);
      return b?.length ? [...new Set(b)] : undefined;
    })(),
    fullTime: str(params.fullTime) === "1" || undefined,
    fewLoans: str(params.fewLoans) === "1" || undefined,
    pellGap: str(params.pellGap) === "1" || undefined,
    national: str(params.national) === "1" || undefined,
    // Only a bachelor's field the site knows (lib/majors.ts): anything else is ignored rather than matching nothing.
    field: ((f) => (f && isMajorFamily(f) ? f : undefined))(str(params.field)),
    fieldMin: ((v) => (v !== undefined && Number.isInteger(v) && v > 1 ? v : undefined))(n(params.fieldMin)),
    liveOn: str(params.liveOn) === "1" || undefined,
    noFee: str(params.noFee) === "1" || undefined,
    guarantee: str(params.guarantee) === "1" || undefined,
    noLegacy: str(params.noLegacy) === "1" || undefined,
    setting: uniq(list(params.setting)?.filter(isSettingGroup)),
    research: uniq(list(params.research)?.filter(isResearchTier)),
    designation: uniq(list(params.designation)?.filter(isDesignation)),
    opportunity: str(params.opportunity) === "1" || undefined,
    division: uniq(list(params.division)?.filter(isDivisionFilter)),
    // Only a current or retired IPEDS code: anything else is ignored rather than matching nothing.
    conference: ((c) => (c !== undefined && Number.isInteger(c) && conferenceName(c) !== null ? c : undefined))(n(params.conference)),
    football: str(params.football) === "1" || undefined,
    rotc: uniq(list(params.rotc)?.filter(isRotcBranch)),
    ugResearch: str(params.ugResearch) === "1" || undefined,
    studyAbroad: str(params.studyAbroad) === "1" || undefined,
    noEssay: str(params.noEssay) === "1" || undefined,
    gpaRequired: str(params.gpaRequired) === "1" || undefined,
    gpa: str(params.gpa) === "1" || undefined,
    sortBy: sortBy && SORT_KEYS.includes(sortBy) ? sortBy : "applicants",
    // Default direction: most-applied-to first; everything else ascending.
    sortDir: params.sortDir === "desc" || params.sortDir === "asc" ? params.sortDir : sortBy && sortBy !== "applicants" ? "asc" : "desc",
  };
}

export function parseView(params: Params): ExploreView {
  const v = str(params.view) as ExploreView | undefined;
  return v && VIEWS.includes(v) ? v : "grid";
}

/** Keys that narrow results (sorting and view don't count). */
export const FILTER_KEYS = [
  "q",
  "states",
  "regions",
  "types",
  "sizes",
  "minAR",
  "maxAR",
  "minSAT",
  "maxSAT",
  "minACT",
  "maxACT",
  "minEnroll",
  "maxEnroll",
  "maxRatio",
  "minFullTimeFaculty",
  "minCost",
  "maxCost",
  "balance",
  "fullTime",
  "fewLoans",
  "pellGap",
  "national",
  "field",
  "liveOn",
  "noFee",
  "guarantee",
  "noLegacy",
  "setting",
  "research",
  "designation",
  "opportunity",
  "division",
  "conference",
  "football",
  "rotc",
  "ugResearch",
  "studyAbroad",
  "noEssay",
  "gpaRequired",
  "gpa",
  ...INDICATOR_KEYS.map((k) => INDICATORS[k].param),
] as const;

export function countActiveFilters(params: Params): number {
  let count = 0;
  for (const k of FILTER_KEYS) if (str(params[k])) count++;
  // Paired min/max count once.
  if (str(params.minAR) && str(params.maxAR)) count--;
  if (str(params.minSAT) && str(params.maxSAT)) count--;
  if (str(params.minCost) && str(params.maxCost)) count--;
  return count;
}
