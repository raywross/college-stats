/**
 * STUB (U2, essays-next build): the brief's "Shared contracts" signatures for `essayProgress`, with a straightforward
 * implementation so the Essays tab can be built and tested before U1's module lands. U1 owns this file; its version
 * replaces this one at merge (specs/product/essays/moves.md "What counts as work left").
 *
 * Pure, no I/O; safe in client components.
 */
import { applyDate } from "../planner/generators/college.ts";
import type { PlanEssays, PlanItem, PlanSchool } from "../planner/types.ts";
import type { ListRound } from "../list-rules.ts";
import type { EssayPrompt } from "../types.ts";
import { MAIN_LIMIT, MAIN_REF, collegeRef, KIND_LABEL, type EssayKind } from "./prompts.ts";
import { refsOf, type EssayRow } from "./rows.ts";

export type PromptState = "not_started" | "draft" | "ready";
export interface PromptProgress {
  ref: string;
  title: string;
  kind: EssayKind;
  limit: EssayPrompt["limit"];
  state: PromptState;
  essayId: string | null;
  count: number | null;
  chooseGroup?: { n: number; of: number };
}
export interface CollegeEssayProgress {
  unit_id: string;
  item_id: string;
  name: string;
  round: ListRound | null;
  deadline: string | null;
  onFile: "published" | "none" | "refers_to_form" | "not_on_file";
  required: PromptProgress[];
  optional: PromptProgress[];
  own: { id: string; title: string; state: PromptState; count: number | null }[];
  ready: number;
  total: number;
  takesCommonApp: boolean;
}
export interface EssayProgress {
  main: { state: PromptState; essayId: string | null; count: number; limit: number } | null;
  colleges: CollegeEssayProgress[];
  remaining: number;
  total: number;
  next: CollegeEssayProgress | null;
  notOnFile: number;
}

const stateOf = (e: EssayRow | null): PromptState => (!e ? "not_started" : e.status === "draft" ? "draft" : "ready");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

function out(item: PlanItem, items: readonly PlanItem[]): boolean {
  if (item.withdrawn_on) return true;
  if (item.outcome === "denied") return true;
  if (item.status === "decided" && !item.enrolling && items.some((i) => i.enrolling)) return true;
  return false;
}

export function essayProgress(input: { items: PlanItem[]; schools: Record<string, PlanSchool>; essays: PlanEssays | null; mainLimit?: number }): EssayProgress {
  const rows = input.essays?.rows ?? [];
  const links = input.essays?.links ?? [];
  const serving = (ref: string): EssayRow | null => rows.find((e) => refsOf(e, links).includes(ref)) ?? null;

  const colleges: CollegeEssayProgress[] = [];
  let anyCommonApp = false;
  for (const item of input.items) {
    if (out(item, input.items)) continue;
    const school = input.schools[item.unit_id];
    if (!school) continue;
    const takesCommonApp = item.application_platform === "common_app" || (!item.application_platform && !!school.apply?.common_app);
    if (takesCommonApp) anyCommonApp = true;
    const essays = school.essays ?? null;
    const onFile: CollegeEssayProgress["onFile"] = essays ? essays.status : "not_on_file";
    const required: PromptProgress[] = [];
    const optional: PromptProgress[] = [];
    if (essays?.status === "published") {
      for (const p of essays.prompts) {
        const ref = collegeRef(p.id);
        const e = serving(ref);
        const row: PromptProgress = { ref, title: KIND_LABEL[p.kind], kind: p.kind, limit: p.limit, state: stateOf(e), essayId: e?.id ?? null, count: e ? e.count : null };
        if (essays.choose && !p.required) required.push({ ...row, chooseGroup: { n: essays.choose.n, of: essays.choose.of } });
        else if (p.required && p.applies_to === "all") required.push(row);
        else optional.push(row);
      }
    }
    const dated = item.deadline_date ?? applyDate(school, item.round)?.date ?? null;
    const deadline = dated && /^\d{4}-\d{2}-\d{2}$/.test(dated) ? dated : null;
    const fixed = required.filter((r) => !r.chooseGroup);
    const chosen = required.filter((r) => r.chooseGroup);
    const chooseN = chosen[0]?.chooseGroup?.n ?? 0;
    const ready = fixed.filter((r) => r.state === "ready").length + Math.min(chooseN, chosen.filter((r) => r.state === "ready").length);
    const total = fixed.length + chooseN;
    colleges.push({ unit_id: item.unit_id, item_id: item.id, name: school.name, round: item.round, deadline, onFile, required, optional, own: [], ready, total, takesCommonApp });
  }
  colleges.sort((a, b) => (a.deadline && b.deadline ? a.deadline.localeCompare(b.deadline) : a.deadline ? -1 : b.deadline ? 1 : 0));

  const mainRow = serving(MAIN_REF);
  const main = anyCommonApp ? { state: stateOf(mainRow), essayId: mainRow?.id ?? null, count: mainRow?.count ?? 0, limit: input.mainLimit ?? MAIN_LIMIT.max } : null;
  const mainLeft = main && main.state !== "ready" ? 1 : 0;
  const total = (main ? 1 : 0) + colleges.reduce((s, c) => s + c.total, 0);
  const remaining = mainLeft + colleges.reduce((s, c) => s + (c.total - c.ready), 0);
  const known = colleges.find((c) => c.total > c.ready || (mainLeft > 0 && c.takesCommonApp)) ?? null;
  const next = known ?? colleges.find((c) => c.onFile === "not_on_file" || c.onFile === "refers_to_form") ?? null;
  return { main, colleges, remaining, total, next, notOnFile: colleges.filter((c) => c.onFile === "not_on_file").length };
}

export function progressLine(p: EssayProgress): string {
  if (p.total === 0 || (p.colleges.every((c) => c.onFile !== "published") && (!p.main || p.main.state === "not_started"))) {
    return "Your colleges' prompts arrive by August; the personal essay is the summer's work.";
  }
  if (p.remaining === 0) return `All ${p.total} ready. Paste each college's package into its form when you apply.`;
  const line = `${p.total - p.remaining} of ${p.total} ready`;
  if (!p.next) return line;
  return p.next.deadline ? `${line} · next: ${p.next.name}, ${dayLabel(p.next.deadline)}` : `${line} · next: ${p.next.name}`;
}
