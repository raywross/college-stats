import "server-only";
/**
 * The essay workspace's reads (specs/product/essays/workspace.md "Where it lives"): who is looking (the plan's own
 * resolution: a student's own drafts, or for a guardian the child `?for=` names, else the last child viewed, the
 * `plan_child` cookie, else the first), the student's drafts, one draft with its versions, links, and comments, the
 * plan's colleges for the picker, and the prompt lookup. Every read runs with the viewer's own session, so row-level
 * security (supabase/migrations/20261029120000_essays.sql) decides what comes back.
 *
 * Server only (not a "use server" module): the pages call it while rendering.
 */
import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { getData, getPlatformPrompts } from "@/lib/data";
import { essayBundle, type EssayBundle } from "@/lib/bundles";
import { scheduleStudentReadLog } from "@/lib/households";
import { getListWithItems, myLists, namesFor } from "@/lib/lists";
import { createServerSupabase } from "@/lib/supabase-server";
import { counselorAccessFor, planViewer, type PlanChild } from "@/lib/planner/load";
import type { ViewerRole } from "@/lib/viewer-relation";
import { resolveSelectedChild } from "@/lib/planner/plan-frame";
import { isUuid } from "@/lib/planner/plan-writes";
import type { School } from "@/lib/types";
import { readEssayOverrides, withOverride } from "./overrides";
import { asPlatformPrompts, type PlatformPrompts, type PromptLookup } from "./prompts";
import { ESSAY_LIST_COLUMNS, essayReadFromBundle, isMissingTable, readEssayTables, type EssayRead } from "./essay-read";
import type { EssayLinkRow, EssayRow } from "./rows";
import { openCommentCounts, suggestionCounts, type OpenCommentRow, type SuggestionCountRow, type SuggestionCounts } from "./counts";

/** Set by PlanPeople.tsx on every pick (app/advisor/page.tsx reads it the same way). */
const PLAN_CHILD_COOKIE = "plan_child";

export type EssaysViewer =
  | { kind: "signed-out" }
  | { kind: "none" }
  | {
      kind: "ready";
      userId: string;
      student: { id: string; name: string | null };
      /** Only the student writes (owner, 2026-10-28: "student drafts only"). */
      canWrite: boolean;
      /** The student, a parent, or a counselor (lib/viewer-relation.ts): a parent and a counselor read and comment. */
      role: ViewerRole;
      /** The viewer's edit access to the student, for the counselor's banner (a parent's pages carry none here). */
      canEdit: boolean;
      /** The `?for=` a link keeps (null for a student's own drafts). */
      person: string | null;
      children: PlanChild[];
    };

/**
 * Who the workspace is for, resolved the way /advisor resolves it: a counselor's `?for=` first (counselorAccessFor:
 * a student on their caseload, who is never one of a household's children), then the household's.
 */
export async function essaysViewer(forParam: string | undefined): Promise<EssaysViewer> {
  const user = await getUser();
  if (!user) return { kind: "signed-out" };
  const counselor = await counselorAccessFor(forParam);
  if (counselor) {
    const student = { id: counselor.student.id, name: counselor.student.display_name };
    return { kind: "ready", userId: user.id, student, canWrite: false, role: "counselor", canEdit: counselor.canEdit, person: counselor.student.id, children: [] };
  }
  const viewer = await planViewer();
  if (viewer.kind === "none") return { kind: "none" };
  if (viewer.kind === "self") {
    return { kind: "ready", userId: user.id, student: { id: viewer.student.id, name: viewer.student.display_name }, canWrite: true, role: "student", canEdit: true, person: null, children: [] };
  }
  const lastViewed = (await cookies()).get(PLAN_CHILD_COOKIE)?.value ?? null;
  const selected = resolveSelectedChild({
    forParam: forParam && isUuid(forParam) ? forParam : null,
    children: viewer.children.map((c) => ({ studentId: c.studentId, nextDeadline: null })),
    lastViewed,
  });
  const child = viewer.children.find((c) => c.studentId === selected);
  if (!child) return { kind: "none" };
  return { kind: "ready", userId: user.id, student: { id: child.studentId, name: child.name }, canWrite: false, role: "guardian", canEdit: child.canEdit, person: child.studentId, children: viewer.children };
}

/** The platforms' prompts (data/reference/platform-prompts.json, traced in next.config.ts); null when the file is missing. */
export async function platformPrompts(): Promise<PlatformPrompts | null> {
  return asPlatformPrompts(await getPlatformPrompts());
}

/**
 * What prompts.ts resolves against: the dataset's colleges, each with the console's saved hand-read prompts laid over
 * its block (lib/essays/overrides.ts; one query for the open cycle's rows), and the platforms' file.
 */
export async function promptLookup(): Promise<PromptLookup & { schoolRecord: (unitId: string) => School | null }> {
  const [{ getSchoolById }, platform, overrides] = await Promise.all([getData(), platformPrompts(), readEssayOverrides(null)]);
  const record = (id: string) => {
    const s = getSchoolById(id);
    return s ? withOverride(s, overrides) : null;
  };
  return { school: record, schoolRecord: record, platform };
}

/**
 * The colleges on the student's default list, in the list's order (the picker's and the grouping's colleges). With
 * `unitIds` (essay_bundle()'s `list_unit_ids`, the same list's items by position) no table is read.
 */
export async function planColleges(studentId: string, unitIds?: string[] | null): Promise<{ unit_id: string; name: string }[]> {
  try {
    let ids = unitIds ?? null;
    if (!ids) {
      const lists = await myLists({ kind: "student", id: studentId });
      const list = lists.find((l) => l.is_default) ?? lists[0];
      if (!list) return [];
      const withItems = await getListWithItems(list.id);
      if (!withItems) return [];
      ids = withItems.items.map((i) => i.unit_id);
    }
    const { getSchoolById } = await getData();
    return ids.flatMap((unitId) => {
      const s = getSchoolById(unitId);
      return s ? [{ unit_id: s.unit_id, name: s.name }] : [];
    });
  } catch (err) {
    console.error(`essays: reading the plan's colleges failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// The draft's read, both paths (essay_bundle() and the per-table fallback), is pure in ./essay-read.ts.
export { isMissingTable, type EssayRead } from "./essay-read";

// The counts are pure over rows (lib/essays/counts.ts): the Essays tab counts the rows the plan loader read in its first
// wave; readEssays (below) counts the rows it reads by id.
export { suggestionCounts, type SuggestionCounts } from "./counts";

export type EssaysRead =
  | ({ kind: "ready"; essays: EssayRow[]; links: EssayLinkRow[]; openComments: Record<string, number> } & SuggestionCounts)
  | { kind: "setup-missing" };

/** Every draft of the student's (no bodies), its links, how many comments and suggestions each has open, and a guardian's own. */
export async function readEssays(studentId: string, viewer: { role: ViewerRole; userId?: string | null }): Promise<EssaysRead> {
  const supabase = await createServerSupabase();
  const essays = await supabase.from("essays").select(ESSAY_LIST_COLUMNS).eq("student_id", studentId).order("updated", { ascending: false });
  if (essays.error) {
    if (isMissingTable(essays.error)) return { kind: "setup-missing" };
    throw new Error(`Reading the drafts failed: ${essays.error.message}`);
  }
  const rows = (essays.data ?? []) as EssayRow[];
  const ids = rows.map((e) => e.id);
  // A parent's or a counselor's read goes in the student's access log.
  if (viewer.role !== "student") void scheduleStudentReadLog(studentId, "essays");
  if (ids.length === 0) return { kind: "ready", essays: [], links: [], openComments: {}, openSuggestions: {}, mySuggestions: {} };
  const [links, comments, suggestions] = await Promise.all([
    supabase.from("essay_links").select("essay_id, prompt_ref, created").in("essay_id", ids),
    supabase.from("essay_comments").select("essay_id").in("essay_id", ids).is("resolved_at", null),
    supabase.from("essay_suggestions").select("essay_id, author_id, status, created").in("essay_id", ids).neq("status", "withdrawn").order("created", { ascending: false }),
  ]);
  // No suggestions table yet (the migration not applied) or a failed read: no counts, never a failed page.
  if (suggestions.error && !isMissingTable(suggestions.error)) console.error(`essays: reading suggestion counts failed: ${suggestions.error.message}`);
  const counts = suggestionCounts(suggestions.error ? [] : ((suggestions.data ?? []) as SuggestionCountRow[]), viewer);
  return { kind: "ready", essays: rows, links: (links.data ?? []) as EssayLinkRow[], openComments: openCommentCounts((comments.data ?? []) as OpenCommentRow[]), ...counts };
}

/**
 * essay_bundle(id) for a signed-in viewer (null signed out, for an id that isn't one, or when the bundle doesn't answer).
 * The page starts it before the viewer check (it needs only the id; specs/serving-architecture.md), and readEssay then
 * finds the same call in flight (React `cache` in essayBundle and getUser). Never throws.
 */
export function essayBundleFor(id: string): Promise<EssayBundle | null> {
  if (!isUuid(id)) return Promise.resolve(null);
  return getUser()
    .then((user) => (user ? essayBundle(id) : null))
    .catch(() => null);
}

/**
 * One draft, if the viewer may read it, with its versions (newest first), links, comments, base, and variant count:
 * from essay_bundle() in one call (which also carries the draft's reviews and the plan's list for the page), else
 * table by table as before. A parent's or a counselor's read goes in the student's access log either way.
 */
export async function readEssay(id: string, viewer: { role: ViewerRole }): Promise<EssayRead> {
  if (!isUuid(id)) return { kind: "not-found" };
  const bundle = await essayBundleFor(id);
  const read = bundle ? essayReadFromBundle(bundle) : await readEssayTables(await createServerSupabase(), id, namesFor);
  if (read.kind === "ready" && viewer.role !== "student") void scheduleStudentReadLog(read.essay.student_id, "essays");
  return read;
}

/** One version's text (the version list opens it read-only), if the viewer may read the draft. */
export async function readVersionBody(essayId: string, versionId: string): Promise<string | null> {
  if (!isUuid(essayId) || !isUuid(versionId)) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("essay_versions").select("body").eq("id", versionId).eq("essay_id", essayId).maybeSingle();
  return (data as { body: string } | null)?.body ?? null;
}
