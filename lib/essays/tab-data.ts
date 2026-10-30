import "server-only";
/**
 * The Essays tab's reads (specs/product/essays/tab.md "Files": "the tab's data is read in app/advisor/page.tsx next
 * to the plan read"). The drafts and their links come with the plan (`ctx.essays`, read by loadPlanFor), so beside
 * the plan this reads only what the plan doesn't carry: the prompt lookup (the picker's groups, the names of colleges
 * a draft is for that are off the list) and the open-comment counts. When the plan carries no drafts (`ctx.essays`
 * null: the tables aren't there, or the read failed) it falls back to `readEssays`, which says whether the workspace is
 * set up. Read only when the open tab is Essays. Runs with the viewer's session, so row-level security decides.
 */
import type { PlanContext } from "@/lib/planner/types";
import { scheduleStudentReadLog } from "@/lib/households";
import { createServerSupabase } from "@/lib/supabase-server";
import { promptLookup, readEssays } from "./load";
import { parsePromptRef, pickerGroups } from "./prompts";
import type { EssayLinkRow, EssayRow } from "./rows";
import type { EssaysTabData } from "./tab-view";

/** Open (unresolved) comments per draft. A failed read is no counts, never a failed tab. */
async function openCommentCounts(ids: readonly string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("essay_comments").select("essay_id").in("essay_id", ids).is("resolved_at", null);
  if (error) {
    console.error(`essays tab: reading open comments failed: ${error.message}`);
    return {};
  }
  const out: Record<string, number> = {};
  for (const c of (data ?? []) as { essay_id: string }[]) out[c.essay_id] = (out[c.essay_id] ?? 0) + 1;
  return out;
}

export async function essaysTabData(ctx: PlanContext, viewer: "student" | "guardian"): Promise<EssaysTabData | null> {
  const studentId = ctx.student?.id;
  if (!studentId) return null;
  const colleges = ctx.items.flatMap((i) => {
    const s = ctx.schools[i.unit_id];
    return s ? [{ unit_id: i.unit_id, name: s.name }] : [];
  });

  let rows: EssayRow[];
  let links: EssayLinkRow[];
  let openComments: Record<string, number>;
  let lookup: Awaited<ReturnType<typeof promptLookup>>;
  if (ctx.essays) {
    rows = ctx.essays.rows;
    links = ctx.essays.links;
    // The household's read log, as readEssays keeps it (a guardian opening the student's drafts).
    if (viewer === "guardian") void scheduleStudentReadLog(studentId, "essays");
    [lookup, openComments] = await Promise.all([promptLookup(), openCommentCounts(rows.map((r) => r.id))]);
  } else {
    const [read, l] = await Promise.all([readEssays(studentId, { role: viewer }), promptLookup()]);
    lookup = l;
    if (read.kind === "setup-missing") return { kind: "setup-missing", rows: [], links: [], openComments: {}, picker: pickerGroups(colleges, lookup), collegeNames: {} };
    rows = read.essays;
    links = read.links;
    openComments = read.openComments;
  }

  const collegeNames: Record<string, string> = Object.fromEntries(colleges.map((c) => [c.unit_id, c.name]));
  for (const ref of [...rows.map((e) => e.prompt_ref), ...links.map((l) => l.prompt_ref)]) {
    const p = parsePromptRef(ref);
    if (p?.kind === "college" && !collegeNames[p.unitId]) collegeNames[p.unitId] = lookup.schoolRecord(p.unitId)?.name ?? "A college";
  }
  return { kind: "ready", rows, links, openComments, picker: pickerGroups(colleges, lookup), collegeNames };
}
