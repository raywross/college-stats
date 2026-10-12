/**
 * The Health overview's view logic (specs/product/admin.md "The overview"): the URL's filters parsed and validated,
 * the filter and sort over the table's rows, the filter option lists, a page of rows, and the links the stat row and
 * the CSV button build. Pure (no fs, no server-only imports), so `tests/admin-ops.test.mts` pins it and
 * `app/admin/health/page.tsx` and `app/admin/health/csv/route.ts` share one definition of "which colleges".
 *
 * The filters live in the URL so a view can be bookmarked or sent: `?status=stale&group=reported&reason=fetch_failed`.
 * - `status` alone judges the overall status. With `group`, it judges that group's status (`unjudged` is the group's
 *   files not being in this deploy). `group` alone lists colleges where that group is not Fresh.
 * - `reason` is an open failure's reason code, `state` a two-letter state, `tier` a selectivity level (0 to 4), and
 *   `family=1` keeps colleges on any family's list (offered only when `familyListUnits()` could be read).
 */
import { HEALTH_GROUPS, HEALTH_STATUSES, statusRank, type HealthGroup, type HealthStatus } from "./health-rules.ts";
import type { CollegeHealth } from "./health.ts";

/** What a table row shows besides the health model: the college as the site shows it. */
export interface HealthRowView {
  health: CollegeHealth;
  name: string;
  /** Two-letter state, "" when unknown. */
  state: string;
  /** The admit rate as the site cites it (`admissions.acceptance_rate`), a fraction; null when not reported. */
  admitRate: number | null;
  /** The site's selectivity tier for that rate (lib/metrics.ts `selectivityTier`). */
  tier: { label: string; level: number };
}

export const HEALTH_SORTS = ["worst", "name", "failures", "queue"] as const;
export type HealthSort = (typeof HEALTH_SORTS)[number];

export const SORT_LABELS: Readonly<Record<HealthSort, string>> = {
  worst: "Worst first",
  name: "Name",
  failures: "Most open failures",
  queue: "Most review-queue items",
};

export type StatusFilter = HealthStatus | "unjudged";

export interface HealthFilters {
  status: StatusFilter | null;
  group: HealthGroup | null;
  reason: string | null;
  state: string | null;
  tier: number | null;
  family: boolean;
  sort: HealthSort;
  page: number;
}

/** Rows per page of the table (the cited admit rate and tier are rendered per row). */
export const HEALTH_PAGE_SIZE = 100;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function first(params: Params, key: string): string | null {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

/** The filters in a URL's query. Anything unrecognized is dropped, never an error: a stale bookmark still opens. */
export function parseHealthFilters(params: Params): HealthFilters {
  const status = first(params, "status");
  const group = first(params, "group");
  const reason = first(params, "reason");
  const state = first(params, "state");
  const tier = first(params, "tier");
  const sort = first(params, "sort");
  const page = Number(first(params, "page"));
  const parsedGroup = (HEALTH_GROUPS as readonly string[]).includes(group ?? "") ? (group as HealthGroup) : null;
  const parsedStatus = (HEALTH_STATUSES as readonly string[]).includes(status ?? "")
    ? (status as HealthStatus)
    : status === "unjudged" && parsedGroup
      ? "unjudged"
      : null;
  return {
    status: parsedStatus,
    group: parsedGroup,
    reason: reason && /^[a-z0-9_]{1,60}$/.test(reason) ? reason : null,
    state: state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null,
    tier: tier !== null && /^[0-4]$/.test(tier) ? Number(tier) : null,
    family: first(params, "family") === "1",
    sort: (HEALTH_SORTS as readonly string[]).includes(sort ?? "") ? (sort as HealthSort) : "worst",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The query string for filters (no leading "?"; empty for the defaults), in a fixed order so links are stable. */
export function healthQuery(filters: Partial<HealthFilters>): string {
  const q = new URLSearchParams();
  if (filters.status) q.set("status", filters.status);
  if (filters.group) q.set("group", filters.group);
  if (filters.reason) q.set("reason", filters.reason);
  if (filters.state) q.set("state", filters.state);
  if (filters.tier !== null && filters.tier !== undefined) q.set("tier", String(filters.tier));
  if (filters.family) q.set("family", "1");
  if (filters.sort && filters.sort !== "worst") q.set("sort", filters.sort);
  if (filters.page && filters.page > 1) q.set("page", String(filters.page));
  return q.toString();
}

/** `base` plus the filters' query: "/admin/health?status=stale". Changing a filter resets the page. */
export function healthHref(base: string, filters: Partial<HealthFilters>, change: Partial<HealthFilters> = {}): string {
  const next: Partial<HealthFilters> = { ...filters, page: 1, ...change };
  const q = healthQuery(next);
  return q ? `${base}?${q}` : base;
}

/** Whether any narrowing filter is on (sort and page don't narrow). */
export function isFiltered(f: HealthFilters): boolean {
  return Boolean(f.status || f.group || f.reason || f.state || f.tier !== null || f.family);
}

const notFresh = (c: CollegeHealth) => c.rows.filter((r) => r.status && r.status !== "fresh").length;
const byUnit = (a: HealthRowView, b: HealthRowView) => a.health.unitId.localeCompare(b.health.unitId, "en", { numeric: true });

/**
 * Sorts a copy of the rows. `worst` is the overview's own order (worst overall status, then the most groups not
 * Fresh, then unit id); the others break ties the same way, so the order is always stable.
 */
export function sortHealthRows(rows: readonly HealthRowView[], sort: HealthSort = "worst"): HealthRowView[] {
  const worst = (a: HealthRowView, b: HealthRowView) =>
    statusRank(b.health.overall) - statusRank(a.health.overall) || notFresh(b.health) - notFresh(a.health) || byUnit(a, b);
  const compare: Record<HealthSort, (a: HealthRowView, b: HealthRowView) => number> = {
    worst,
    name: (a, b) => a.name.localeCompare(b.name, "en") || byUnit(a, b),
    failures: (a, b) => b.health.failures.length - a.health.failures.length || worst(a, b),
    queue: (a, b) => b.health.queueItems - a.health.queueItems || worst(a, b),
  };
  return [...rows].sort(compare[sort]);
}

/**
 * The rows that pass every filter, in the order given. `family` is the set of units on any list, or null when it
 * could not be read, in which case the family filter is ignored (the page hides its control).
 */
export function filterHealthRows(rows: readonly HealthRowView[], f: HealthFilters, family: ReadonlySet<string> | null): HealthRowView[] {
  return rows.filter((r) => {
    const h = r.health;
    if (f.group) {
      const row = h.rows.find((x) => x.group === f.group);
      if (!row) return false;
      if (f.status === "unjudged") {
        if (row.status !== null) return false;
      } else if (f.status) {
        if (row.status !== f.status) return false;
      } else if (row.status === null || row.status === "fresh") {
        return false;
      }
    } else if (f.status && h.overall !== f.status) {
      return false;
    }
    if (f.reason && !h.failures.some((x) => x.reason === f.reason)) return false;
    if (f.state && r.state !== f.state) return false;
    if (f.tier !== null && r.tier.level !== f.tier) return false;
    if (f.family && family && !family.has(h.unitId)) return false;
    return true;
  });
}

export interface HealthPage<T> {
  rows: T[];
  page: number;
  pages: number;
  total: number;
  /** 1-based position of the first and last row shown (0 and 0 when there are none). */
  from: number;
  to: number;
}

/** One page of rows; a page past the end is the last page. */
export function pageOf<T>(rows: readonly T[], page: number, size: number = HEALTH_PAGE_SIZE): HealthPage<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const slice = rows.slice((at - 1) * size, at * size);
  return { rows: slice, page: at, pages, total: rows.length, from: slice.length ? (at - 1) * size + 1 : 0, to: (at - 1) * size + slice.length };
}

/** Open failures by reason code across the rows, most common first: the reason filter's options. */
export function reasonOptions(rows: readonly HealthRowView[]): { code: string; colleges: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const code of new Set(r.health.failures.map((f) => f.reason))) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, colleges]) => ({ code, colleges })).sort((a, b) => b.colleges - a.colleges || a.code.localeCompare(b.code));
}

/** States present among the rows, alphabetical: the state filter's options. */
export function stateOptions(rows: readonly HealthRowView[]): string[] {
  return [...new Set(rows.map((r) => r.state).filter(Boolean))].sort();
}

/** "fetch failed" for the reason code `fetch_failed`. */
export function reasonLabel(code: string): string {
  return code.replace(/_/g, " ");
}

/** Open failures by reason code for one college: "fetch failed ×2, read failed". */
export function failureSummary(failures: readonly { reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const f of failures) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  return [...counts].map(([code, n]) => `${reasonLabel(code)}${n > 1 ? ` ×${n}` : ""}`).join(", ");
}

/** Joins the health model to the dataset's college facts. A unit the dataset doesn't have keeps its id as its name. */
export function buildHealthRows(
  colleges: readonly CollegeHealth[],
  info: (unitId: string) => { name: string; state: string; admitRate: number | null; tier: { label: string; level: number } } | null,
): HealthRowView[] {
  return colleges.map((health) => {
    const i = info(health.unitId);
    return { health, name: i?.name ?? health.unitId, state: i?.state ?? "", admitRate: i?.admitRate ?? null, tier: i?.tier ?? { label: "Open or not reported", level: 0 } };
  });
}
