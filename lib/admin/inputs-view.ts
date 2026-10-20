/**
 * The Estimate inputs view's URL filters (specs/product/admin-health-views.md "The page"): parsed and validated, the
 * filter and sort over the rows, and the links the stat row and the CSV button build. Pure, so the tests pin it and
 * `app/admin/health/page.tsx` and its CSV route share one definition of "which colleges".
 *
 * `?status=watch&input=gpa&state=GA&tier=1&family=1&sort=name&page=2`:
 * - `status` alone judges the overall status; with `input`, that input's status. `input` alone lists colleges where that
 *   input isn't Fresh.
 * - `state`, `tier` (0 to 4, the site's selectivity tiers), and `family=1` work as on the Files view's college table.
 */
import { HEALTH_STATUSES, statusRank, type HealthStatus } from "./health-rules.ts";
import { CORE_INPUT_KEYS, type EstimateInputKey } from "./estimate-inputs.ts";

export const INPUT_SORTS = ["worst", "name"] as const;
export type InputSort = (typeof INPUT_SORTS)[number];
export const INPUT_SORT_LABELS: Readonly<Record<InputSort, string>> = { worst: "Worst first", name: "Name" };

export interface InputFilters {
  status: HealthStatus | null;
  input: EstimateInputKey | null;
  state: string | null;
  tier: number | null;
  family: boolean;
  sort: InputSort;
  page: number;
}

/** What filtering needs of a row (lib/admin/estimate-inputs-load.ts InputRowView). */
export interface FilterableInputRow {
  inputs: { unitId: string; overall: HealthStatus; inputs: { key: string; status: HealthStatus | null }[] };
  name: string;
  state: string;
  tier: { level: number };
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function first(params: Params, key: string): string | null {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

/** The filters in a URL's query. Anything unrecognized is dropped, never an error. */
export function parseInputFilters(params: Params): InputFilters {
  const status = first(params, "status");
  const input = first(params, "input");
  const state = first(params, "state");
  const tier = first(params, "tier");
  const sort = first(params, "sort");
  const page = Number(first(params, "page"));
  return {
    status: (HEALTH_STATUSES as readonly string[]).includes(status ?? "") ? (status as HealthStatus) : null,
    input: (CORE_INPUT_KEYS as readonly string[]).includes(input ?? "") ? (input as EstimateInputKey) : null,
    state: state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null,
    tier: tier !== null && /^[0-4]$/.test(tier) ? Number(tier) : null,
    family: first(params, "family") === "1",
    sort: (INPUT_SORTS as readonly string[]).includes(sort ?? "") ? (sort as InputSort) : "worst",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The query string (no leading "?"; empty for the defaults), in a fixed order so links are stable. */
export function inputsQuery(f: Partial<InputFilters>): string {
  const q = new URLSearchParams();
  if (f.status) q.set("status", f.status);
  if (f.input) q.set("input", f.input);
  if (f.state) q.set("state", f.state);
  if (f.tier !== null && f.tier !== undefined) q.set("tier", String(f.tier));
  if (f.family) q.set("family", "1");
  if (f.sort && f.sort !== "worst") q.set("sort", f.sort);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  return q.toString();
}

/** `base` plus the filters' query. Changing a filter resets the page. */
export function inputsHref(base: string, filters: Partial<InputFilters>, change: Partial<InputFilters> = {}): string {
  const q = inputsQuery({ ...filters, page: 1, ...change });
  return q ? `${base}?${q}` : base;
}

export function isInputFiltered(f: InputFilters): boolean {
  return Boolean(f.status || f.input || f.state || f.tier !== null || f.family);
}

/** The rows that pass every filter, in the order given. `family` null (unreadable) ignores the family filter. */
export function filterInputRows<T extends FilterableInputRow>(rows: readonly T[], f: InputFilters, family: ReadonlySet<string> | null): T[] {
  return rows.filter((r) => {
    if (f.input) {
      const i = r.inputs.inputs.find((x) => x.key === f.input);
      if (!i || !i.status) return false;
      if (f.status ? i.status !== f.status : i.status === "fresh") return false;
    } else if (f.status && r.inputs.overall !== f.status) {
      return false;
    }
    if (f.state && r.state !== f.state) return false;
    if (f.tier !== null && r.tier.level !== f.tier) return false;
    if (f.family && family && !family.has(r.inputs.unitId)) return false;
    return true;
  });
}

/** `worst` keeps the overview's order (it arrives worst first); `name` sorts by name, then worst. */
export function sortInputRows<T extends FilterableInputRow>(rows: readonly T[], sort: InputSort): T[] {
  if (sort === "worst") return [...rows];
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "en") || statusRank(b.inputs.overall) - statusRank(a.inputs.overall));
}

/** Old Health bookmarks (`?group=…`, `?reason=…`) filtered the per-college table, which now lives on the Files view. */
export function isFilesQuery(params: Params): boolean {
  return first(params, "group") !== null || first(params, "reason") !== null;
}
