import type { ExploreView, SchoolType, SearchFilters, SizeBucket, SortKey } from "./types";
import { INDICATORS, INDICATOR_KEYS, isDirection, type Direction, type IndicatorKey } from "./indicators.ts";
import { isGenderBalance } from "./student-body.ts";

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
  "men_share", "part_time", "men_share_change", "admit_gap", "loan_rate", "loan_rate_change",
];
const VIEWS: ExploreView[] = ["grid", "table", "chart"];

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
    minCost: n(params.minCost),
    maxCost: n(params.maxCost),
    trends: parseTrends(params),
    balance: (() => {
      const b = list(params.balance)?.filter(isGenderBalance);
      return b?.length ? [...new Set(b)] : undefined;
    })(),
    fullTime: str(params.fullTime) === "1" || undefined,
    fewLoans: str(params.fewLoans) === "1" || undefined,
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
  "minCost",
  "maxCost",
  "balance",
  "fullTime",
  "fewLoans",
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
