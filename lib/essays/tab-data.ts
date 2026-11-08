import "server-only";
/**
 * The Essays tab's reads (specs/product/essays/tab.md "Files": "the tab's data is read in app/advisor/page.tsx next
 * to the plan read"). The drafts, their links, their open comments, and their suggestions come with the plan
 * (`ctx.essays`, read by loadPlanFor in its first wave; lib/planner/read-plan.ts readPlanEssays), so the tab only counts
 * them (lib/essays/counts.ts) and adds the prompt lookup (the picker's groups, the names of colleges a draft is for that
 * are off the list), whose one read, the open cycle's hand-read prompts, the loader also started in its first wave
 * (specs/serving-architecture.md: /advisor in two database waves). When the plan carries no drafts (`ctx.essays` null:
 * the tables aren't there, or the read failed) or no counts' rows, it falls back to `readEssays`, which says whether the
 * workspace is set up. Read with every plan, whatever tab opens (round 4: the tabs switch in place; a guardian's or a
 * counselor's read is logged each time, since the drafts' list ships with the page). Runs with the viewer's session,
 * so row-level security decides.
 */
import type { PlanContext } from "@/lib/planner/types";
import { scheduleStudentReadLog } from "@/lib/households";
import { getUser } from "@/lib/auth";
import { promptLookup, readEssays } from "./load";
import { openCommentCounts, suggestionCounts, type SuggestionCounts } from "./counts";
import { parsePromptRef, pickerGroups } from "./prompts";
import type { EssayLinkRow, EssayRow } from "./rows";
import type { EssaysTabData } from "./tab-view";
import type { ViewerRole } from "@/lib/viewer-relation";

export async function essaysTabData(ctx: PlanContext, viewer: ViewerRole): Promise<EssaysTabData | null> {
  const studentId = ctx.student?.id;
  if (!studentId) return null;
  const colleges = ctx.items.flatMap((i) => {
    const s = ctx.schools[i.unit_id];
    return s ? [{ unit_id: i.unit_id, name: s.name }] : [];
  });

  let rows: EssayRow[];
  let links: EssayLinkRow[];
  let openComments: Record<string, number>;
  let counts: SuggestionCounts;
  let lookup: Awaited<ReturnType<typeof promptLookup>>;
  // A guardian's own suggestions are found by their user id (the "Waiting for {first}" rows).
  const userId = viewer !== "student" ? ((await getUser())?.id ?? null) : null;
  const essays = ctx.essays;
  if (essays?.comments && essays.suggestions) {
    rows = essays.rows;
    links = essays.links;
    // The household's read log, as readEssays keeps it (a guardian opening the student's drafts).
    if (viewer !== "student") void scheduleStudentReadLog(studentId, "essays");
    lookup = await promptLookup();
    openComments = openCommentCounts(essays.comments);
    counts = suggestionCounts(essays.suggestions, { role: viewer, userId });
  } else {
    const [read, l] = await Promise.all([readEssays(studentId, { role: viewer, userId }), promptLookup()]);
    lookup = l;
    if (read.kind === "setup-missing") return { kind: "setup-missing", rows: [], links: [], openComments: {}, openSuggestions: {}, mySuggestions: {}, picker: pickerGroups(colleges, lookup), collegeNames: {} };
    rows = read.essays;
    links = read.links;
    openComments = read.openComments;
    counts = { openSuggestions: read.openSuggestions, mySuggestions: read.mySuggestions };
  }

  const collegeNames: Record<string, string> = Object.fromEntries(colleges.map((c) => [c.unit_id, c.name]));
  for (const ref of [...rows.map((e) => e.prompt_ref), ...links.map((l) => l.prompt_ref)]) {
    const p = parsePromptRef(ref);
    if (p?.kind === "college" && !collegeNames[p.unitId]) collegeNames[p.unitId] = lookup.schoolRecord(p.unitId)?.name ?? "A college";
  }
  return { kind: "ready", rows, links, openComments, ...counts, picker: pickerGroups(colleges, lookup), collegeNames };
}
