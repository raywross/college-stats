"use server";
/**
 * The essay workspace's Server Actions (specs/product/essays/workspace.md "The editor", "The model", "Reuse"): create,
 * save (the body, its count, and a version when one is due), rename, status, link, variant, comment, resolve, restore,
 * and delete. Each on the planner's `ready(capability)` pattern (lib/planner/store-list.ts): sign in, the entitlement
 * check (`advisor.essays`), then the write with the caller's own session so row-level security decides
 * (supabase/migrations/20261029120000_essays.sql): only the student writes a draft; a guardian in the household reads
 * and comments.
 *
 * Autosave calls `saveEssay` without revalidating the page (a refresh would reset the field under the student's
 * fingers); every other action refreshes the workspace's pages.
 *
 * A "use server" module exports only async functions; the rules are pure, in lib/essays/{count,normalize,prompts,
 * rows,variants}.ts.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, currentStudent, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { isUuid } from "@/lib/planner/plan-writes";
import { countText, type CountKind, type EssayLimit } from "./count";
import { normalizeText } from "./normalize";
import { KIND_LABEL, MAIN_REF, parsePromptRef, resolvePrompt, type EssayKind, type ResolvedPrompt } from "./prompts";
import { isMissingTable, promptLookup } from "./load";
import { shouldVersion, ESSAY_STATUSES, VERSION_SOURCES, type CommentAnchor, type EssayStatus, type VersionSource } from "./rows";
import { changesBetween, planDecision, suggestionLabel, type Decision } from "./suggestions";
import { spanOffsets, type NoteSpan } from "./notes-view";
import { namesFor } from "@/lib/lists";
import { textFromUpload, uploadKindOf } from "./docx";
import { tickEssaysMove } from "./move-tick";
import { trackServer } from "@/lib/analytics-server";
import { profileFor } from "@/lib/student-profile-store";
import { effectiveGradYear } from "@/lib/student-profile";
import { loadCycle } from "@/lib/planner/cycle";
import { planCycleKey, planSchools, todayIso } from "@/lib/planner/context";

export type EssayActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const STUDENT_ONLY = "Only the student writes their essays.";
const LIMIT = "That's 200 drafts, the most one student can keep. Delete one to start another.";
const MAX_BODY = 100_000;

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;
type Ready = { userId: string; supabase: Supabase };
type Fail = { ok: false; message: string };

async function ready(): Promise<Ready | Fail> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, "advisor.essays"))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): Fail {
  if (error?.message?.includes("essay_limit")) return { ok: false, message: LIMIT };
  if (error) console.error(`essays: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

function refresh() {
  try {
    revalidatePath("/advisor/essays", "layout");
    revalidatePath("/advisor");
  } catch (err) {
    console.error(`essays: revalidate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * After a write that can finish the essays (essays-next brief "Shared contracts"; specs/product/essays/moves.md
 * "Done"): read the student's progress and tick `{list}:essays:next` when every essay is ready
 * (lib/essays/move-tick.ts tickEssaysMove). Never fails the write it follows: an error is logged. Not exported (a
 * "use server" module's exports are callable from the browser).
 */
async function afterEssayWrite(r: Ready, studentId: string | null | undefined): Promise<void> {
  if (!studentId) return;
  try {
    const result = await tickEssaysMove(r.supabase, studentId, { schools: (ids) => studentSchools(r.supabase, studentId, ids) });
    if (result.ticked) {
      await trackServer("essays_move_done", { by: "store" }, r.userId);
      try {
        revalidatePath("/advisor");
      } catch {
        /* outside a request: nothing to refresh */
      }
    }
  } catch (err) {
    console.error(`essays: ticking the essays move failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The plan's colleges in the student's cycle (their effective graduation year), as the plan load builds them. */
async function studentSchools(supabase: Supabase, studentId: string, unitIds: string[]) {
  const [profile, student] = await Promise.all([profileFor(studentId), supabase.from("students").select("grad_year").eq("id", studentId).maybeSingle()]);
  const stored = (student.data as { grad_year: number | null } | null)?.grad_year ?? null;
  const gradYear = profile ? effectiveGradYear(profile.data.basics, stored) : stored;
  const cycle = loadCycle(planCycleKey(gradYear, todayIso()));
  return planSchools(unitIds, cycle.startYear, null);
}

/** Whose draft this is (for the tick after a link or an unlink). */
async function studentOfEssay(r: Ready, id: string): Promise<string | null> {
  const { data } = await r.supabase.from("essays").select("student_id").eq("id", id).maybeSingle();
  return (data as { student_id: string } | null)?.student_id ?? null;
}

const limitOf = (p: ResolvedPrompt): EssayLimit | null => p.limit;
const countKindOf = (p: ResolvedPrompt): CountKind => p.limit?.kind ?? "words";

async function resolved(ref: string): Promise<ResolvedPrompt> {
  return resolvePrompt(ref, await promptLookup());
}

/** The draft's columns that follow from its prompt. */
function promptColumns(p: ResolvedPrompt, fallbackKind: EssayKind = "other") {
  const limit = limitOf(p);
  return {
    count_kind: countKindOf(p),
    limit_max: limit?.max ?? null,
    limit_min: limit?.min ?? null,
    kind: p.found ? p.kind : fallbackKind,
  };
}

const titleFor = (p: ResolvedPrompt) => (p.college ? `${p.college.name}: ${p.title}` : p.title).slice(0, 200);

/**
 * A new draft for a prompt. The student's own only. The Common App's main essay is one draft for every college: asking
 * for it again opens the one that exists.
 */
export async function createEssay(promptRef: string): Promise<{ ok: true; id: string; kind: EssayKind } | Fail> {
  if (!parsePromptRef(promptRef)) return { ok: false, message: "That prompt isn't one we know." };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const own = await currentStudent();
  if (!own) return { ok: false, message: STUDENT_ONLY };

  if (promptRef === MAIN_REF) {
    const [direct, linked] = await Promise.all([
      r.supabase.from("essays").select("id").eq("student_id", own.id).eq("prompt_ref", MAIN_REF).limit(1),
      r.supabase.from("essay_links").select("essay_id, essays!inner(student_id)").eq("prompt_ref", MAIN_REF).eq("essays.student_id", own.id).limit(1),
    ]);
    const existing = (direct.data as { id: string }[] | null)?.[0]?.id ?? (linked.data as { essay_id: string }[] | null)?.[0]?.essay_id ?? null;
    if (existing) return { ok: true, id: existing, kind: "personal" };
  }

  const p = await resolved(promptRef);
  const cols = promptColumns(p, promptRef === "free" ? "free" : "other");
  const { data, error } = await r.supabase
    .from("essays")
    .insert({ student_id: own.id, prompt_ref: promptRef, title: titleFor(p), body: "", count: 0, ...cols })
    .select("id")
    .single();
  if (error || !data) return fail(error, "createEssay");
  await afterEssayWrite(r, own.id);
  refresh();
  return { ok: true, id: (data as { id: string }).id, kind: cols.kind };
}

export type SaveResult =
  | { ok: true; updated: string; count: number; versioned: boolean }
  | { ok: false; conflict: { body: string; updated: string } }
  | Fail;

type BodyRow = { id: string; student_id: string; body: string; count_kind: CountKind; updated: string };

/**
 * Writes a new body over `row` (the draft as just read) with the student's session, and a version when one is due
 * (rows.ts shouldVersion; `forceVersion` for the first accepted change of a suggestion). Not exported: the actions
 * below call it after their own checks.
 */
async function storeBody(
  r: Ready,
  row: BodyRow,
  text: string,
  opts: { source: VersionSource; label: string | null; forceVersion?: boolean },
): Promise<{ ok: true; updated: string; count: number; versioned: boolean } | Fail> {
  const count = countText(text, row.count_kind);
  const changed = row.body !== text;
  let updated = row.updated;
  if (changed) {
    const { data, error } = await r.supabase.from("essays").update({ body: text, count }).eq("id", row.id).select("updated");
    if (error) return fail(error, "saveEssay");
    if (!data?.length) return { ok: false, message: STUDENT_ONLY };
    updated = (data[0] as { updated: string }).updated;
  }
  const last = await r.supabase.from("essay_versions").select("created").eq("essay_id", row.id).order("created", { ascending: false }).limit(1);
  const lastVersionAt = (last.data as { created: string }[] | null)?.[0]?.created ?? null;
  const versioned = (opts.forceVersion === true && changed) || shouldVersion({ lastVersionAt, now: Date.now(), source: opts.source, mark: opts.label !== null, changed });
  if (versioned) {
    const { error } = await r.supabase.from("essay_versions").insert({ essay_id: row.id, body: text, count, source: opts.source, label: opts.label });
    if (error) return fail(error, "saveEssay version");
  }
  return { ok: true, updated, count, versioned };
}

/**
 * Saves the body. `expectedUpdated` is the server copy's `updated` the editor last saw: when the server's is newer
 * (another device saved since), nothing is written and the server copy comes back, for the student to choose
 * (workspace.md: "the server copy wins on a conflict only by the student's choice"); `force` writes anyway. A version
 * is added after ten minutes since the last one, on every import (`source` other than typed), and on `mark`.
 */
export async function saveEssay(
  id: string,
  body: string,
  opts: { expectedUpdated?: string | null; source?: VersionSource; mark?: string | null; force?: boolean } = {},
): Promise<SaveResult> {
  if (!isUuid(id) || typeof body !== "string") return { ok: false, message: FAILED };
  const text = normalizeText(body);
  if (text.length > MAX_BODY) return { ok: false, message: "That's longer than a draft can be here." };
  const source: VersionSource = opts.source && VERSION_SOURCES.includes(opts.source) ? opts.source : "typed";
  const label = typeof opts.mark === "string" ? opts.mark.trim().slice(0, 80) || "Marked" : null;
  const r = await ready();
  if (!("supabase" in r)) return r;

  const current = await r.supabase.from("essays").select("id, student_id, body, count_kind, updated").eq("id", id).maybeSingle();
  if (current.error) return fail(current.error, "saveEssay");
  const row = current.data as BodyRow | null;
  if (!row) return { ok: false, message: FAILED };
  if (!opts.force && opts.expectedUpdated && Date.parse(row.updated) > Date.parse(opts.expectedUpdated) && row.body !== text) {
    return { ok: false, conflict: { body: row.body, updated: row.updated } };
  }

  const stored = await storeBody(r, row, text, { source, label });
  if (!stored.ok) return stored;
  const { updated, count, versioned } = stored;
  if (label !== null || source !== "typed") refresh();
  return { ok: true, updated, count, versioned };
}

export async function renameEssay(id: string, title: string): Promise<EssayActionResult> {
  if (!isUuid(id) || typeof title !== "string") return { ok: false, message: FAILED };
  const t = title.trim().slice(0, 200);
  if (!t) return { ok: false, message: "Give it a name." };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essays").update({ title: t }).eq("id", id).select("id");
  if (error) return fail(error, "renameEssay");
  if (!data?.length) return { ok: false, message: STUDENT_ONLY };
  refresh();
  return { ok: true };
}

export async function setEssayStatus(id: string, status: EssayStatus): Promise<EssayActionResult> {
  if (!isUuid(id) || !ESSAY_STATUSES.includes(status)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essays").update({ status }).eq("id", id).select("id, student_id");
  if (error) return fail(error, "setEssayStatus");
  if (!data?.length) return { ok: false, message: STUDENT_ONLY };
  await afterEssayWrite(r, (data[0] as { student_id?: string }).student_id);
  refresh();
  return { ok: true };
}

/** The draft serves another prompt too (the same text expected: the main essay for another Common App college). */
export async function linkEssay(id: string, promptRef: string): Promise<EssayActionResult> {
  if (!isUuid(id) || !parsePromptRef(promptRef) || promptRef === "free") return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase.from("essay_links").upsert({ essay_id: id, prompt_ref: promptRef }, { onConflict: "essay_id,prompt_ref", ignoreDuplicates: true });
  if (error) {
    if (/row-level security/i.test(error.message ?? "")) return { ok: false, message: STUDENT_ONLY };
    return fail(error, "linkEssay");
  }
  await afterEssayWrite(r, await studentOfEssay(r, id));
  refresh();
  return { ok: true };
}

export async function unlinkEssay(id: string, promptRef: string): Promise<EssayActionResult> {
  if (!isUuid(id) || typeof promptRef !== "string") return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase.from("essay_links").delete().eq("essay_id", id).eq("prompt_ref", promptRef);
  if (error) return fail(error, "unlinkEssay");
  await afterEssayWrite(r, await studentOfEssay(r, id));
  refresh();
  return { ok: true };
}

/** A copy of the draft for another prompt, remembering its base (workspace.md "Reuse": a variant). */
export async function makeVariant(id: string, promptRef: string): Promise<{ ok: true; id: string; kind: EssayKind } | Fail> {
  if (!isUuid(id) || !parsePromptRef(promptRef)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const own = await currentStudent();
  if (!own) return { ok: false, message: STUDENT_ONLY };
  const base = await r.supabase.from("essays").select("id, student_id, title, body, kind").eq("id", id).maybeSingle();
  if (base.error) return fail(base.error, "makeVariant");
  const b = base.data as { id: string; student_id: string; title: string; body: string; kind: EssayKind } | null;
  if (!b || b.student_id !== own.id) return { ok: false, message: STUDENT_ONLY };
  const p = await resolved(promptRef);
  const cols = promptColumns(p, b.kind);
  const count = countText(b.body, cols.count_kind);
  const { data, error } = await r.supabase
    .from("essays")
    .insert({ student_id: own.id, prompt_ref: promptRef, title: titleFor(p), body: b.body, count, base_id: b.id, ...cols })
    .select("id")
    .single();
  if (error || !data) return fail(error, "makeVariant");
  const newId = (data as { id: string }).id;
  await r.supabase.from("essay_versions").insert({ essay_id: newId, body: b.body, count, source: "typed", label: `Copied from ${b.title || KIND_LABEL[b.kind]}`.slice(0, 80) });
  refresh();
  return { ok: true, id: newId, kind: cols.kind };
}

const isAnchor = (a: unknown): a is CommentAnchor => {
  if (typeof a !== "object" || a === null) return false;
  const { paragraph, start, end } = a as Record<string, unknown>;
  return [paragraph, start, end].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0) && (end as number) >= (start as number);
};

/** A comment on the draft, by the student or a guardian in the household; anchored to a span, or general. */
export async function addComment(
  essayId: string,
  body: string,
  opts: { anchor?: CommentAnchor | null; versionId?: string | null } = {},
): Promise<{ ok: true; role: "student" | "guardian" | "counselor" } | Fail> {
  if (!isUuid(essayId) || typeof body !== "string") return { ok: false, message: FAILED };
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, message: "Write a comment first." };
  const anchor = opts.anchor && isAnchor(opts.anchor) ? { paragraph: opts.anchor.paragraph, start: opts.anchor.start, end: opts.anchor.end } : null;
  const versionId = opts.versionId && isUuid(opts.versionId) ? opts.versionId : null;
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essay_comments").insert({ essay_id: essayId, body: text, anchor, version_id: versionId }).select("author_role").single();
  if (error || !data) {
    if (/row-level security/i.test(error?.message ?? "")) return { ok: false, message: "Only the student and their family can comment on this draft." };
    return fail(error, "addComment");
  }
  refresh();
  return { ok: true, role: (data as { author_role: "student" | "guardian" | "counselor" }).author_role };
}

/** The student marks a comment resolved (or opens it again). */
export async function resolveComment(commentId: string, resolved: boolean): Promise<EssayActionResult> {
  if (!isUuid(commentId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase
    .from("essay_comments")
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq("id", commentId)
    .select("id");
  if (error) return fail(error, "resolveComment");
  if (!data?.length) return { ok: false, message: "Only the student resolves a comment." };
  refresh();
  return { ok: true };
}

/** The author removes their own comment. */
export async function deleteComment(commentId: string): Promise<EssayActionResult> {
  if (!isUuid(commentId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essay_comments").delete().eq("id", commentId).select("id");
  if (error) return fail(error, "deleteComment");
  if (!data?.length) return { ok: false, message: "Only the comment's author can remove it." };
  refresh();
  return { ok: true };
}

/** One version's text, for opening it read-only. */
export async function openVersion(essayId: string, versionId: string): Promise<{ ok: true; body: string } | Fail> {
  if (!isUuid(essayId) || !isUuid(versionId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essay_versions").select("body").eq("id", versionId).eq("essay_id", essayId).maybeSingle();
  if (error) return fail(error, "openVersion");
  if (!data) return { ok: false, message: FAILED };
  return { ok: true, body: (data as { body: string }).body };
}

/**
 * Restores a version: its text becomes the draft's, and a new version with source `restored` records that. The text
 * it replaces is kept as a version first when it isn't one already, so nothing is overwritten silently.
 */
export async function restoreVersion(essayId: string, versionId: string): Promise<{ ok: true; body: string; count: number; updated: string } | Fail> {
  if (!isUuid(essayId) || !isUuid(versionId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const [essay, version, last] = await Promise.all([
    r.supabase.from("essays").select("body, count, count_kind").eq("id", essayId).maybeSingle(),
    r.supabase.from("essay_versions").select("body").eq("id", versionId).eq("essay_id", essayId).maybeSingle(),
    r.supabase.from("essay_versions").select("body").eq("essay_id", essayId).order("created", { ascending: false }).limit(1),
  ]);
  if (essay.error || version.error) return fail(essay.error ?? version.error, "restoreVersion");
  const e = essay.data as { body: string; count: number; count_kind: CountKind } | null;
  const v = version.data as { body: string } | null;
  if (!e || !v) return { ok: false, message: FAILED };
  const lastBody = (last.data as { body: string }[] | null)?.[0]?.body ?? null;
  if (lastBody !== e.body && e.body !== "") {
    const kept = await r.supabase.from("essay_versions").insert({ essay_id: essayId, body: e.body, count: e.count, source: "typed", label: "Before a restore" });
    if (kept.error) return /row-level security/i.test(kept.error.message ?? "") ? { ok: false, message: STUDENT_ONLY } : fail(kept.error, "restoreVersion keep");
  }
  const count = countText(v.body, e.count_kind);
  const { data, error } = await r.supabase.from("essays").update({ body: v.body, count }).eq("id", essayId).select("updated");
  if (error) return fail(error, "restoreVersion");
  if (!data?.length) return { ok: false, message: STUDENT_ONLY };
  const added = await r.supabase.from("essay_versions").insert({ essay_id: essayId, body: v.body, count, source: "restored", label: null });
  if (added.error) return fail(added.error, "restoreVersion version");
  refresh();
  return { ok: true, body: v.body, count, updated: (data[0] as { updated: string }).updated };
}

export async function deleteEssay(id: string): Promise<EssayActionResult> {
  if (!isUuid(id)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essays").delete().eq("id", id).select("id, student_id");
  if (error) return fail(error, "deleteEssay");
  if (!data?.length) return { ok: false, message: STUDENT_ONLY };
  await afterEssayWrite(r, (data[0] as { student_id?: string }).student_id);
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* U4: the round trip (workspace.md "The round trip", phase 1)         */
/* ------------------------------------------------------------------ */

/** A `.docx` upload's largest size this reads (no embedded media is expected in an essay). */
const MAX_UPLOAD_BYTES = 10_000_000;

export type ImportResult = { ok: true; versionId: string; count: number } | Fail;

/**
 * An import never overwrites the current text (workspace.md: "an import or a pull never overwrites the current
 * text; it makes a version the student picks"): a new `essay_versions` row only, left for `restoreVersion` to bring
 * across once the student compares it with what's there.
 */
async function insertImportedVersion(supabase: Supabase, id: string, text: string, source: "uploaded" | "pasted"): Promise<ImportResult> {
  const current = await supabase.from("essays").select("id, count_kind").eq("id", id).maybeSingle();
  if (current.error) return fail(current.error, "insertImportedVersion");
  const row = current.data as { id: string; count_kind: CountKind } | null;
  if (!row) return { ok: false, message: FAILED };
  const count = countText(text, row.count_kind);
  const { data, error } = await supabase.from("essay_versions").insert({ essay_id: id, body: text, count, source, label: null }).select("id").single();
  if (error || !data) {
    if (/row-level security/i.test(error?.message ?? "")) return { ok: false, message: STUDENT_ONLY };
    return fail(error, "insertImportedVersion");
  }
  return { ok: true, versionId: (data as { id: string }).id, count };
}

/** A paste from the clipboard (Notes, a phone's Docs app) imported as a new version, source `pasted`. */
export async function importPastedText(id: string, text: string): Promise<ImportResult> {
  if (!isUuid(id) || typeof text !== "string") return { ok: false, message: FAILED };
  const body = normalizeText(text);
  if (!body.trim()) return { ok: false, message: "That paste has no text in it." };
  if (body.length > MAX_BODY) return { ok: false, message: "That's longer than a draft can be here." };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const result = await insertImportedVersion(r.supabase, id, body, "pasted");
  if (result.ok) refresh();
  return result;
}

/**
 * A `.docx` or `.txt` upload (the file picker on desktop; the share sheet on a phone), read server-side (`mammoth`
 * for `.docx`, text only — a comment or a tracked change is dropped, which the import sheet says in its own copy)
 * and imported as a new version, source `uploaded`. A form post: `essayId`, `file`.
 */
export async function importUploadedFile(form: FormData): Promise<ImportResult> {
  const id = String(form.get("essayId") ?? "");
  const file = form.get("file");
  if (!isUuid(id)) return { ok: false, message: FAILED };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file first." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "That file is too large." };
  const kind = uploadKindOf(file.name, file.type);
  if (kind === "unsupported") return { ok: false, message: "Upload a .docx or a .txt file." };
  let text: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    text = normalizeText(await textFromUpload(buffer, kind));
  } catch (err) {
    console.error(`essays: importUploadedFile failed to read the file: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, message: "That file couldn't be read. Try downloading it as a .docx or a .txt, or paste the text instead." };
  }
  if (!text.trim()) return { ok: false, message: "That file has no text in it." };
  if (text.length > MAX_BODY) return { ok: false, message: "That's longer than a draft can be here." };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const result = await insertImportedVersion(r.supabase, id, text, "uploaded");
  if (result.ok) refresh();
  return result;
}

/* ------------------------------------------------------------------ */
/* Part 7: editors (specs/product/essays/editors.md)                   */
/* ------------------------------------------------------------------ */

const MAX_NOTE = 2000;
const NOTHING_CHANGED = "Nothing changed.";
const DRAFT_CHANGED = "The draft changed here.";
const SUGGESTIONS_MISSING = "Suggestions aren't set up yet.";

type SuggestionRead = {
  id: string;
  essay_id: string;
  base_body: string;
  proposed_body: string;
  status: "open" | "decided" | "withdrawn";
  decisions: Record<string, Decision>;
  author_id: string | null;
  author_role: "guardian" | "counselor";
};
const SUGGESTION_READ = "id, essay_id, base_body, proposed_body, status, decisions, author_id, author_role";

/** The database's refusals as words (supabase/migrations/20261101120000_essay_suggestions.sql). */
function suggestionFail(error: { code?: string; message?: string } | null | undefined, what: string): Fail {
  const m = error?.message ?? "";
  if (isMissingTable(error)) return { ok: false, message: SUGGESTIONS_MISSING };
  if (/essay_suggestions_one_open|duplicate key/i.test(m)) return { ok: false, message: "You already have suggestions waiting on this draft. Edit those instead." };
  if (/essay_suggestion_own/.test(m)) return { ok: false, message: "This is your own draft: write in it directly." };
  if (/essay_suggestion_decided/.test(m)) return { ok: false, message: "These can't be changed now: the student has started deciding on them." };
  if (/essay_suggestion_(not_yours|author|fixed)/.test(m)) return { ok: false, message: "Only the person who sent these suggestions can change them." };
  if (/essay_suggestion_(student|status)/.test(m)) return { ok: false, message: "Only the student decides on suggested changes." };
  if (/row-level security/i.test(m)) return { ok: false, message: "Only the student's family can suggest changes to this draft." };
  return fail(error, what);
}

/** The editor's proposed text as stored, or a refusal. */
function proposedText(body: unknown): { text: string } | Fail {
  if (typeof body !== "string") return { ok: false, message: FAILED };
  const text = normalizeText(body);
  if (text.length > MAX_BODY) return { ok: false, message: "That's longer than a draft can be here." };
  return { text };
}

const noteText = (note: unknown): string | null => (typeof note === "string" && note.trim() ? note.trim().slice(0, MAX_NOTE) : null);

/**
 * An editor's suggestions for the whole draft (editors.md "How an editor suggests"): any reader of the draft who isn't
 * the student. The changes are computed against the draft's text now, which is stored with the suggestion
 * (`base_body`); the newest version is named too when its text is that one. Refused when nothing changed.
 */
export async function suggestChanges(essayId: string, proposedBody: string, note: string | null): Promise<{ ok: true; id: string; changes: number } | Fail> {
  if (!isUuid(essayId)) return { ok: false, message: FAILED };
  const p = proposedText(proposedBody);
  if ("ok" in p) return p;
  const r = await ready();
  if (!("supabase" in r)) return r;
  const [essay, last] = await Promise.all([
    r.supabase.from("essays").select("id, body").eq("id", essayId).maybeSingle(),
    r.supabase.from("essay_versions").select("id, body").eq("essay_id", essayId).order("created", { ascending: false }).limit(1),
  ]);
  if (essay.error) return fail(essay.error, "suggestChanges");
  const e = essay.data as { id: string; body: string } | null;
  if (!e) return { ok: false, message: FAILED };
  const changes = changesBetween(e.body, p.text).length;
  if (changes === 0) return { ok: false, message: NOTHING_CHANGED };
  const newest = (last.data as { id: string; body: string }[] | null)?.[0] ?? null;
  const { data, error } = await r.supabase
    .from("essay_suggestions")
    .insert({ essay_id: essayId, base_version_id: newest && newest.body === e.body ? newest.id : null, base_body: e.body, proposed_body: p.text, note: noteText(note) })
    .select("id, author_role")
    .single();
  if (error || !data) return suggestionFail(error, "suggestChanges");
  const row = data as { id: string; author_role: "guardian" | "counselor" };
  await trackServer("essay_suggestion_sent", { role: row.author_role, changes }, r.userId);
  refresh();
  return { ok: true, id: row.id, changes };
}

/** The author edits their open suggestion (its proposed text and note) while the student hasn't decided anything. */
export async function updateSuggestion(id: string, proposedBody: string, note: string | null): Promise<{ ok: true; changes: number } | Fail> {
  if (!isUuid(id)) return { ok: false, message: FAILED };
  const p = proposedText(proposedBody);
  if ("ok" in p) return p;
  const r = await ready();
  if (!("supabase" in r)) return r;
  const read = await r.supabase.from("essay_suggestions").select(SUGGESTION_READ).eq("id", id).maybeSingle();
  if (read.error) return suggestionFail(read.error, "updateSuggestion");
  const s = read.data as SuggestionRead | null;
  if (!s) return { ok: false, message: FAILED };
  if (s.status !== "open") return { ok: false, message: "These suggestions are closed." };
  const changes = changesBetween(s.base_body, p.text).length;
  if (changes === 0) return { ok: false, message: NOTHING_CHANGED };
  const { data, error } = await r.supabase.from("essay_suggestions").update({ proposed_body: p.text, note: noteText(note) }).eq("id", id).select("id");
  if (error) return suggestionFail(error, "updateSuggestion");
  if (!data?.length) return { ok: false, message: "Only the person who sent these suggestions can change them." };
  await trackServer("essay_suggestion_updated", { role: s.author_role }, r.userId);
  refresh();
  return { ok: true, changes };
}

/** The author withdraws their open suggestion before the student has decided anything. It is kept, not deleted. */
export async function withdrawSuggestion(id: string): Promise<EssayActionResult> {
  if (!isUuid(id)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("essay_suggestions").update({ status: "withdrawn" }).eq("id", id).eq("status", "open").select("id, author_role");
  if (error) return suggestionFail(error, "withdrawSuggestion");
  if (!data?.length) return { ok: false, message: "These suggestions are closed." };
  await trackServer("essay_suggestion_withdrawn", { role: (data[0] as { author_role: "guardian" | "counselor" }).author_role }, r.userId);
  refresh();
  return { ok: true };
}

const CHANGE_KEY = /^[0-9a-f]{16}$/;

/** First name for the version list's line ("from Jane"), or the role's word. */
async function editorName(authorId: string | null, role: "guardian" | "counselor"): Promise<string> {
  const names: Record<string, string | null> = authorId ? await namesFor([authorId]).catch(() => ({})) : {};
  const first = (authorId ? names[authorId] : null)?.trim().split(/\s+/)[0];
  return first || (role === "counselor" ? "a counselor" : "a parent");
}

/**
 * The student accepts or rejects changes (editors.md "What accepting does"). The decisions are merged over the stored
 * ones (a change already decided stays decided); the newly accepted changes are applied to the draft's text as it is
 * now (not the text the editor saw), each found again by its words; one that no longer fits stays undecided and comes
 * back in `stale`. The body is saved as source `suggested`: a version on the first accepted change and, when the last
 * change is decided, one marked "Accepted 3 of 4 changes from Jane"; the ten-minute rule otherwise. Returns the new
 * body and `updated` so the editor swaps its text without a conflict.
 */
export async function decideSuggestion(
  id: string,
  decisions: Record<string, Decision>,
): Promise<{ ok: true; body: string; updated: string; applied: string[]; stale: string[]; status: "open" | "decided" } | Fail> {
  if (!isUuid(id) || typeof decisions !== "object" || decisions === null) return { ok: false, message: FAILED };
  const incoming: Record<string, Decision> = {};
  for (const [k, v] of Object.entries(decisions).slice(0, 1000)) if (CHANGE_KEY.test(k) && (v === "accepted" || v === "rejected")) incoming[k] = v;
  if (Object.keys(incoming).length === 0) return { ok: false, message: "Choose a change first." };
  const r = await ready();
  if (!("supabase" in r)) return r;

  const read = await r.supabase.from("essay_suggestions").select(SUGGESTION_READ).eq("id", id).maybeSingle();
  if (read.error) return suggestionFail(read.error, "decideSuggestion");
  const s = read.data as SuggestionRead | null;
  if (!s) return { ok: false, message: FAILED };
  if (s.status !== "open") return { ok: false, message: s.status === "withdrawn" ? "These suggestions were withdrawn." : "These suggestions are already decided." };
  const essay = await r.supabase.from("essays").select("id, student_id, body, count_kind, updated").eq("id", s.essay_id).maybeSingle();
  if (essay.error) return fail(essay.error, "decideSuggestion");
  const e = essay.data as BodyRow | null;
  if (!e) return { ok: false, message: FAILED };

  const stored = s.decisions ?? {};
  const plan = planDecision(e.body, s.base_body, s.proposed_body, stored, incoming);
  const track = () => trackServer("essay_suggestion_decided", { accepted: plan.applied.length, rejected: plan.rejected.length, stale: plan.stale.length, all: plan.all }, r.userId);
  if (plan.applied.length === 0 && plan.rejected.length === 0) {
    await track();
    return { ok: true, body: e.body, updated: e.updated, applied: [], stale: plan.stale, status: "open" };
  }

  // The decisions first (the trigger lets only the student write them), then the body.
  const decidedAt = plan.status === "decided" ? new Date().toISOString() : null;
  const wrote = await r.supabase.from("essay_suggestions").update({ decisions: plan.decisions, status: plan.status, decided_at: decidedAt }).eq("id", id).eq("status", "open").select("id");
  if (wrote.error) return suggestionFail(wrote.error, "decideSuggestion");
  if (!wrote.data?.length) return { ok: false, message: "Only the student decides on suggested changes." };

  let body = e.body;
  let updated = e.updated;
  const label = plan.status === "decided" && plan.accepted > 0 ? suggestionLabel(await editorName(s.author_id, s.author_role), plan.accepted, plan.total) : null;
  if (plan.applied.length > 0 || label !== null) {
    const firstAccept = plan.applied.length > 0 && !Object.values(stored).includes("accepted");
    const saved = await storeBody(r, e, plan.text, { source: "suggested", label, forceVersion: firstAccept });
    if (!saved.ok) {
      // Put the decisions back so no change is recorded as accepted without being in the draft.
      await r.supabase.from("essay_suggestions").update({ decisions: stored, status: "open", decided_at: null }).eq("id", id);
      return saved;
    }
    body = plan.text;
    updated = saved.updated;
  }
  await track();
  refresh();
  return { ok: true, body, updated, applied: plan.applied, stale: plan.stale, status: plan.status };
}

/**
 * The reader's corrected word, accepted (editors.md "The reader's fixes"): a mechanics note's `fix` replaces the words
 * at its span, when those words are still the ones the reader read (the reviewed version's text at the span); the
 * draft is saved as source `suggested` and the note marked done, as the notes route marks it.
 */
export async function acceptFix(noteId: string): Promise<{ ok: true; body: string; updated: string } | Fail> {
  if (!isUuid(noteId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const noteRead = await r.supabase.from("essay_notes").select("id, review_id, category, span, fix, state").eq("id", noteId).maybeSingle();
  if (noteRead.error) return fail(noteRead.error, "acceptFix");
  const note = noteRead.data as { id: string; review_id: string; category: string; span: NoteSpan | null; fix: string | null; state: string } | null;
  if (!note) return { ok: false, message: FAILED };
  if (note.category !== "mechanics" || !note.fix || !note.span || note.state !== "open") return { ok: false, message: "This note has no fix to accept." };
  const review = await r.supabase.from("essay_reviews").select("essay_id, version_id").eq("id", note.review_id).maybeSingle();
  const rv = review.data as { essay_id: string; version_id: string } | null;
  if (review.error || !rv) return fail(review.error, "acceptFix review");
  const [essay, version] = await Promise.all([
    r.supabase.from("essays").select("id, student_id, body, count_kind, updated").eq("id", rv.essay_id).maybeSingle(),
    r.supabase.from("essay_versions").select("body").eq("id", rv.version_id).maybeSingle(),
  ]);
  const e = essay.data as BodyRow | null;
  if (essay.error || !e) return fail(essay.error, "acceptFix");
  const at = spanOffsets(e.body, note.span);
  if (!at) return { ok: false, message: DRAFT_CHANGED };
  const read = (version.data as { body: string } | null)?.body ?? null;
  const was = read !== null ? spanOffsets(read, note.span) : null;
  if (read !== null && (!was || read.slice(was.start, was.end) !== e.body.slice(at.start, at.end))) return { ok: false, message: DRAFT_CHANGED };

  const text = normalizeText(e.body.slice(0, at.start) + note.fix + e.body.slice(at.end));
  const saved = await storeBody(r, e, text, { source: "suggested", label: null });
  if (!saved.ok) return saved;
  const marked = await r.supabase.from("essay_notes").update({ state: "done" }).eq("id", noteId).select("id");
  if (marked.error) console.error(`essays: marking a fixed note done failed: ${marked.error.message}`);
  await trackServer("essay_fix_accepted", { category: "mechanics" }, r.userId);
  refresh();
  return { ok: true, body: text, updated: saved.updated };
}
