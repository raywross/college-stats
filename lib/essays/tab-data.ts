import "server-only";
/**
 * The Essays tab's reads (specs/product/essays/tab.md "Files": "the tab's data is read in app/advisor/page.tsx next
 * to the plan read, `readEssays` by the plan's student"): the drafts (no bodies), their links, the open-comment counts,
 * the prompt picker's groups, and the names of every college a draft is written for. Read only when the open tab is
 * Essays. Runs with the viewer's session, so row-level security decides what comes back.
 */
import type { PlanContext } from "@/lib/planner/types";
import { promptLookup, readEssays } from "./load";
import { parsePromptRef, pickerGroups } from "./prompts";
import type { EssaysTabData } from "./tab-view";

export async function essaysTabData(ctx: PlanContext, viewer: "student" | "guardian"): Promise<EssaysTabData | null> {
  const studentId = ctx.student?.id;
  if (!studentId) return null;
  const [read, lookup] = await Promise.all([readEssays(studentId, { role: viewer }), promptLookup()]);
  const colleges = ctx.items.flatMap((i) => {
    const s = ctx.schools[i.unit_id];
    return s ? [{ unit_id: i.unit_id, name: s.name }] : [];
  });
  const picker = pickerGroups(colleges, lookup);
  if (read.kind === "setup-missing") return { kind: "setup-missing", rows: [], links: [], openComments: {}, picker, collegeNames: {} };
  const collegeNames: Record<string, string> = Object.fromEntries(colleges.map((c) => [c.unit_id, c.name]));
  for (const ref of [...read.essays.map((e) => e.prompt_ref), ...read.links.map((l) => l.prompt_ref)]) {
    const p = parsePromptRef(ref);
    if (p?.kind === "college" && !collegeNames[p.unitId]) collegeNames[p.unitId] = lookup.schoolRecord(p.unitId)?.name ?? "A college";
  }
  return { kind: "ready", rows: read.essays, links: read.links, openComments: read.openComments, picker, collegeNames };
}
