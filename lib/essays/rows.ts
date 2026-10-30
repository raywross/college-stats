/**
 * The essay tables' rows as the app reads them (supabase/migrations/20261029120000_essays.sql) and the list page's
 * pure helpers (specs/product/essays/workspace.md "Where it lives": "drafts grouped by college with status and
 * counts, the main essay first"). Pure; safe in server code, client components, and tests.
 */
import type { CountKind } from "./count.ts";
import { planHref } from "../planner/plan-tabs.ts";
import { MAIN_REF, parsePromptRef, type EssayKind } from "./prompts.ts";

export type EssayStatus = "draft" | "ready" | "submitted";
export const ESSAY_STATUSES: readonly EssayStatus[] = ["draft", "ready", "submitted"];
export const STATUS_LABEL: Record<EssayStatus, string> = { draft: "Draft", ready: "Ready", submitted: "Submitted" };

export type VersionSource = "typed" | "pasted" | "uploaded" | "docs" | "restored";
export const VERSION_SOURCES: readonly VersionSource[] = ["typed", "pasted", "uploaded", "docs", "restored"];

export interface EssayRow {
  id: string;
  student_id: string;
  prompt_ref: string;
  title: string;
  count_kind: CountKind;
  count: number;
  limit_max: number | null;
  limit_min: number | null;
  status: EssayStatus;
  kind: EssayKind;
  base_id: string | null;
  created: string;
  updated: string;
}
export interface EssayLinkRow {
  essay_id: string;
  prompt_ref: string;
  created: string;
}
export interface VersionRow {
  id: string;
  essay_id: string;
  count: number;
  source: VersionSource;
  label: string | null;
  created: string;
}
export interface CommentAnchor {
  paragraph: number;
  start: number;
  end: number;
}
export interface CommentRow {
  id: string;
  essay_id: string;
  version_id: string | null;
  author_id: string | null;
  author_role: "student" | "guardian" | "counselor";
  anchor: CommentAnchor | null;
  body: string;
  created: string;
  resolved_at: string | null;
}

/**
 * The essays list, which is the advisor's Essays tab since essays-next (specs/product/essays/tab.md): `/advisor?tab=
 * essays`, with the guardian's child (`for`) and, for one college, its card's anchor (`#college-<unit id>`).
 */
export function essaysHref(opts: { college?: string | null; person?: string | null } = {}): string {
  return planHref({ tab: "essays", person: opts.person ?? null, college: opts.college ?? null });
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Where the old list page's address goes (app/advisor/essays/page.tsx, a 308): the Essays tab, keeping a well-formed
 * `?for=` (a student id) and turning a well-formed `?college=` (a unit id) into the card's anchor; anything else is
 * dropped rather than carried into the URL.
 */
export function essaysListRedirect(sp: { for?: string | string[]; college?: string | string[] }): string {
  const person = one(sp.for);
  const college = one(sp.college);
  return essaysHref({
    person: person && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(person) ? person : null,
    college: college && /^\d{1,12}$/.test(college) ? college : null,
  });
}

/** Every prompt a draft serves: its own and the ones linked to it. */
export function refsOf(essay: Pick<EssayRow, "id" | "prompt_ref">, links: readonly EssayLinkRow[]): string[] {
  const refs = [essay.prompt_ref, ...links.filter((l) => l.essay_id === essay.id).map((l) => l.prompt_ref)];
  return [...new Set(refs)];
}

/** Whether the draft is (or is linked as) the Common App's main essay. */
export const isMainEssay = (essay: Pick<EssayRow, "id" | "prompt_ref">, links: readonly EssayLinkRow[]) => refsOf(essay, links).includes(MAIN_REF);

export interface EssayGroup {
  /** "main", a college's unit id, or "other". */
  key: string;
  label: string;
  unitId: string | null;
  essays: EssayRow[];
}

const KIND_ORDER: readonly EssayKind[] = ["personal", "why_us", "program", "essay", "short_answer", "activity", "optional", "other", "free"];

/** Within a group: the main essay first, then by kind, then the most recently edited. */
function sortInGroup(essays: EssayRow[], links: readonly EssayLinkRow[]): EssayRow[] {
  return [...essays].sort((a, b) => {
    const ma = isMainEssay(a, links) ? 0 : 1;
    const mb = isMainEssay(b, links) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    const ka = KIND_ORDER.indexOf(a.kind);
    const kb = KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id);
  });
}

/**
 * The list's groups: the platforms' essays first ("Common App and Coalition", the main essay at the top), then each
 * plan college in the plan's order, then colleges no longer on the plan (by name), then drafts for no college yet.
 * A draft linked to several colleges shows under each. `college` narrows to one college's group, with the
 * platforms' group kept when `withPlatform` (the college takes the Common App or the Coalition). Empty groups drop
 * out, except the one college asked for (its empty state is the page's).
 */
export function groupEssays(
  essays: readonly EssayRow[],
  links: readonly EssayLinkRow[],
  planColleges: readonly { unit_id: string; name: string }[],
  nameOf: (unitId: string) => string | null,
  opts: { college?: string | null; withPlatform?: boolean } = {},
): EssayGroup[] {
  const platform: EssayRow[] = [];
  const byCollege = new Map<string, EssayRow[]>();
  const loose: EssayRow[] = [];
  for (const e of essays) {
    const refs = refsOf(e, links);
    const units = new Set<string>();
    let onPlatform = false;
    for (const ref of refs) {
      const p = parsePromptRef(ref);
      if (p?.kind === "college") units.add(p.unitId);
      else if (p?.kind === "main" || p?.kind === "coalition") onPlatform = true;
    }
    if (onPlatform) platform.push(e);
    for (const u of units) {
      const list = byCollege.get(u) ?? [];
      list.push(e);
      byCollege.set(u, list);
    }
    if (!onPlatform && units.size === 0) loose.push(e);
  }

  const groups: EssayGroup[] = [];
  const main: EssayGroup = { key: "main", label: "Common App and Coalition", unitId: null, essays: sortInGroup(platform, links) };
  const planIds = planColleges.map((c) => c.unit_id);
  const off = [...byCollege.keys()].filter((u) => !planIds.includes(u)).map((u) => ({ unit_id: u, name: nameOf(u) ?? "A college" }));
  off.sort((a, b) => a.name.localeCompare(b.name));
  const colleges = [...planColleges, ...off];

  if (opts.college) {
    if (opts.withPlatform && main.essays.length > 0) groups.push(main);
    const c = colleges.find((x) => x.unit_id === opts.college);
    const name = c?.name ?? nameOf(opts.college) ?? "This college";
    groups.push({ key: opts.college, label: name, unitId: opts.college, essays: sortInGroup(byCollege.get(opts.college) ?? [], links) });
    return groups;
  }

  if (main.essays.length > 0) groups.push(main);
  for (const c of colleges) {
    const list = byCollege.get(c.unit_id);
    if (list?.length) groups.push({ key: c.unit_id, label: c.name, unitId: c.unit_id, essays: sortInGroup(list, links) });
  }
  if (loose.length > 0) groups.push({ key: "other", label: "Not for a college yet", unitId: null, essays: sortInGroup(loose, links) });
  return groups;
}

/** A draft's list-row count: "412 of 650 words", or "412 words" without a limit. */
export function rowLimit(e: Pick<EssayRow, "count_kind" | "limit_max" | "limit_min">) {
  return e.limit_max ? { kind: e.count_kind, max: e.limit_max, ...(e.limit_min ? { min: e.limit_min } : {}) } : null;
}

/** Whether a new save should also make a version (workspace.md "Versions": after a pause of ten minutes, an import, a mark). */
export const VERSION_PAUSE_MS = 10 * 60 * 1000;
export function shouldVersion(opts: { lastVersionAt: string | null; now: number; source: VersionSource; mark: boolean; changed: boolean }): boolean {
  if (opts.mark) return true;
  if (opts.source !== "typed") return true;
  if (!opts.changed) return false;
  if (opts.lastVersionAt === null) return true;
  return opts.now - Date.parse(opts.lastVersionAt) >= VERSION_PAUSE_MS;
}
