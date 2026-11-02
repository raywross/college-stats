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
import type { CommentRow, EssayLinkRow, EssayRow, VersionRow } from "./rows";
import type { SuggestionRow } from "./suggestions";

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

/** The colleges on the student's default list, in the list's order (the picker's and the grouping's colleges). */
export async function planColleges(studentId: string): Promise<{ unit_id: string; name: string }[]> {
  try {
    const lists = await myLists({ kind: "student", id: studentId });
    const list = lists.find((l) => l.is_default) ?? lists[0];
    if (!list) return [];
    const withItems = await getListWithItems(list.id);
    if (!withItems) return [];
    const { getSchoolById } = await getData();
    return withItems.items.flatMap((i) => {
      const s = getSchoolById(i.unit_id);
      return s ? [{ unit_id: s.unit_id, name: s.name }] : [];
    });
  } catch (err) {
    console.error(`essays: reading the plan's colleges failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

const ESSAY_LIST_COLUMNS = "id, student_id, prompt_ref, title, count_kind, count, limit_max, limit_min, status, kind, base_id, created, updated";
const ESSAY_COLUMNS = `${ESSAY_LIST_COLUMNS}, body`;
const SUGGESTION_COLUMNS = "id, essay_id, base_version_id, base_body, author_id, author_role, proposed_body, note, status, decisions, created, updated, decided_at";

/** The table isn't there yet (the migration not applied). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? ""));
}

/** Open suggestions per draft, and a guardian's own newest suggestion's state per draft (editors.md "Where it shows"). */
export interface SuggestionCounts {
  openSuggestions: Record<string, number>;
  mySuggestions: Record<string, "open" | "decided">;
}

/**
 * The suggestion counts for the drafts `ids` (the Essays tab's rows): how many are open on each, and for a guardian
 * (`userId` given) the state of their own newest suggestion on each, withdrawn ones skipped. No table yet (the
 * migration not applied) or a failed read: no counts, never a failed page.
 */
export async function suggestionCounts(ids: readonly string[], viewer: { role: ViewerRole; userId?: string | null }): Promise<SuggestionCounts> {
  const out: SuggestionCounts = { openSuggestions: {}, mySuggestions: {} };
  if (ids.length === 0) return out;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("essay_suggestions").select("essay_id, author_id, status, created").in("essay_id", [...ids]).neq("status", "withdrawn").order("created", { ascending: false });
  if (error) {
    if (!isMissingTable(error)) console.error(`essays: reading suggestion counts failed: ${error.message}`);
    return out;
  }
  for (const s of (data ?? []) as { essay_id: string; author_id: string | null; status: "open" | "decided"; created: string }[]) {
    if (s.status === "open") out.openSuggestions[s.essay_id] = (out.openSuggestions[s.essay_id] ?? 0) + 1;
    if (viewer.role !== "student" && viewer.userId && s.author_id === viewer.userId && !out.mySuggestions[s.essay_id]) out.mySuggestions[s.essay_id] = s.status;
  }
  return out;
}

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
  const [links, comments, counts] = await Promise.all([
    supabase.from("essay_links").select("essay_id, prompt_ref, created").in("essay_id", ids),
    supabase.from("essay_comments").select("essay_id").in("essay_id", ids).is("resolved_at", null),
    suggestionCounts(ids, viewer),
  ]);
  const openComments: Record<string, number> = {};
  for (const c of (comments.data ?? []) as { essay_id: string }[]) openComments[c.essay_id] = (openComments[c.essay_id] ?? 0) + 1;
  return { kind: "ready", essays: rows, links: (links.data ?? []) as EssayLinkRow[], openComments, ...counts };
}

export type EssayRead =
  | {
      kind: "ready";
      essay: EssayRow & { body: string };
      versions: VersionRow[];
      links: EssayLinkRow[];
      comments: (CommentRow & { author_name: string | null })[];
      /** Every suggestion not withdrawn, newest first (editors.md "The model"). */
      suggestions: (SuggestionRow & { author_name: string | null })[];
      base: { id: string; title: string; updated: string } | null;
      variants: number;
    }
  | { kind: "not-found" }
  | { kind: "setup-missing" };

/** One draft, if the viewer may read it, with its versions (newest first), links, comments, base, and variant count. */
export async function readEssay(id: string, viewer: { role: ViewerRole }): Promise<EssayRead> {
  if (!isUuid(id)) return { kind: "not-found" };
  const supabase = await createServerSupabase();
  const essay = await supabase.from("essays").select(ESSAY_COLUMNS).eq("id", id).maybeSingle();
  if (essay.error) {
    if (isMissingTable(essay.error)) return { kind: "setup-missing" };
    throw new Error(`Reading the draft failed: ${essay.error.message}`);
  }
  if (!essay.data) return { kind: "not-found" };
  const row = essay.data as EssayRow & { body: string };
  if (viewer.role !== "student") void scheduleStudentReadLog(row.student_id, "essays");
  const [versions, links, comments, suggestions, base, variants] = await Promise.all([
    supabase.from("essay_versions").select("id, essay_id, count, source, label, created").eq("essay_id", id).order("created", { ascending: false }).limit(100),
    supabase.from("essay_links").select("essay_id, prompt_ref, created").eq("essay_id", id),
    supabase.from("essay_comments").select("id, essay_id, version_id, author_id, author_role, anchor, body, created, resolved_at").eq("essay_id", id).order("created"),
    supabase.from("essay_suggestions").select(SUGGESTION_COLUMNS).eq("essay_id", id).neq("status", "withdrawn").order("created", { ascending: false }),
    row.base_id ? supabase.from("essays").select("id, title, updated").eq("id", row.base_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("essays").select("id", { count: "exact", head: true }).eq("base_id", id),
  ]);
  const commentRows = (comments.data ?? []) as CommentRow[];
  // No suggestions table yet (the migration not applied): none, never a failed page.
  if (suggestions.error && !isMissingTable(suggestions.error)) console.error(`essays: reading suggestions failed: ${suggestions.error.message}`);
  const suggestionRows = (suggestions.error ? [] : (suggestions.data ?? [])) as SuggestionRow[];
  const names = await namesFor([...commentRows, ...suggestionRows].map((c) => c.author_id).filter((v): v is string => !!v));
  return {
    kind: "ready",
    essay: row,
    versions: (versions.data ?? []) as VersionRow[],
    links: (links.data ?? []) as EssayLinkRow[],
    comments: commentRows.map((c) => ({ ...c, author_name: c.author_id ? (names[c.author_id] ?? null) : null })),
    suggestions: suggestionRows.map((s) => ({ ...s, decisions: s.decisions ?? {}, author_name: s.author_id ? (names[s.author_id] ?? null) : null })),
    base: (base.data as { id: string; title: string; updated: string } | null) ?? null,
    variants: variants.count ?? 0,
  };
}

/** One version's text (the version list opens it read-only), if the viewer may read the draft. */
export async function readVersionBody(essayId: string, versionId: string): Promise<string | null> {
  if (!isUuid(essayId) || !isUuid(versionId)) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("essay_versions").select("body").eq("id", versionId).eq("essay_id", essayId).maybeSingle();
  return (data as { body: string } | null)?.body ?? null;
}
