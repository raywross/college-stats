import type { ExploreView, SchoolType, SearchFilters, SizeBucket, SortKey } from "./types";

type Params = Record<string, string | string[] | undefined>;

const str = (v: Params[string]) => (typeof v === "string" && v !== "" ? v : undefined);
const list = (v: Params[string]) => str(v)?.split(",").filter(Boolean);
const n = (v: Params[string]) => {
  const s = str(v);
  if (s === undefined) return undefined;
  const x = Number(s);
  return Number.isFinite(x) ? x : undefined;
};

const SORT_KEYS: SortKey[] = ["applicants", "name", "acceptance_rate", "enrollment", "sat", "pell", "first_gen", "diversity", "net_price", "earnings", "grad_rate"];
const VIEWS: ExploreView[] = ["grid", "table", "chart"];

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
    minNP: n(params.minNP),
    maxNP: n(params.maxNP),
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
  "minNP",
  "maxNP",
] as const;

export function countActiveFilters(params: Params): number {
  let count = 0;
  for (const k of FILTER_KEYS) if (str(params[k])) count++;
  // Paired min/max count once.
  if (str(params.minAR) && str(params.maxAR)) count--;
  if (str(params.minSAT) && str(params.maxSAT)) count--;
  if (str(params.minNP) && str(params.maxNP)) count--;
  return count;
}
