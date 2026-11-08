/**
 * The Health page's two tabs (specs/product/admin-redesign.md "Data": "Health is one page with two tabs, Colleges and
 * Sources"): which tab a URL asks for, and each tab's link carrying the filters both tabs understand, so switching tabs
 * keeps the state, selectivity tier, family-list, status, and sort the admin chose. A filter only one tab has (the
 * Colleges tab's `input`; the Sources tab's `group` and `reason`) and the page number stay behind.
 *
 * Pure, so the page, the tab bar, and the tests share it. The old addresses (/admin/health, /admin/health/files) reach
 * the tabs by lib/admin/redirects.ts with their query strings passed through.
 */
import { HEALTH_STATUSES } from "./health-rules.ts";
import { HEALTH_SORTS } from "./health-view.ts";
import { INPUT_SORTS } from "./inputs-view.ts";

export const HEALTH_BASE = "/admin/data/health";

export type HealthTab = "colleges" | "sources";

export const HEALTH_TABS: readonly { key: HealthTab; label: string; hint: string }[] = [
  { key: "colleges", label: "Colleges", hint: "The facts the admission estimate reads, college by college" },
  { key: "sources", label: "Sources", hint: "Every file we read, and each college's documents" },
];

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function first(params: Params, key: string): string | null {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

/** The tab a URL asks for: `?tab=sources`, or the Colleges tab for anything else. */
export function healthTab(params: Params): HealthTab {
  return first(params, "tab") === "sources" ? "sources" : "colleges";
}

/** The filters both tabs read, in the order the links write them. */
export const SHARED_HEALTH_FILTERS = ["status", "state", "tier", "family", "sort"] as const;

/** Whether a shared filter's value means something on the tab (a status or sort only one tab has is dropped). */
function validOn(tab: HealthTab, key: (typeof SHARED_HEALTH_FILTERS)[number], value: string): boolean {
  switch (key) {
    case "status":
      return (HEALTH_STATUSES as readonly string[]).includes(value);
    case "sort":
      return value !== "worst" && ((tab === "colleges" ? INPUT_SORTS : HEALTH_SORTS) as readonly string[]).includes(value);
    case "state":
      return /^[A-Za-z]{2}$/.test(value);
    case "tier":
      return /^[0-4]$/.test(value);
    case "family":
      return value === "1";
  }
}

/**
 * The link to a tab with the filters it shares with the current URL: `healthTabHref("sources", {state: "OH",
 * input: "gpa"})` → "/admin/data/health?tab=sources&state=OH".
 */
export function healthTabHref(tab: HealthTab, params: Params): string {
  const q = new URLSearchParams();
  if (tab === "sources") q.set("tab", "sources");
  for (const key of SHARED_HEALTH_FILTERS) {
    const v = first(params, key);
    if (v !== null && validOn(tab, key, v)) q.set(key, key === "state" ? v.toUpperCase() : v);
  }
  const s = q.toString();
  return s ? `${HEALTH_BASE}?${s}` : HEALTH_BASE;
}
