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
import { promptLookup } from "./load";
import { shouldVersion, ESSAY_STATUSES, type CommentAnchor, type EssayStatus, type VersionSource } from "./rows";
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
  const source: VersionSource = opts.source && ["typed", "pasted", "uploaded", "docs", "restored"].includes(opts.source) ? opts.source : "typed";
  const label = typeof opts.mark === "string" ? opts.mark.trim().slice(0, 80) || "Marked" : null;
  const r = await ready();
  if (!("supabase" in r)) return r;

  const current = await r.supabase.from("essays").select("id, student_id, body, count_kind, updated").eq("id", id).maybeSingle();
  if (current.error) return fail(current.error, "saveEssay");
  const row = current.data as { id: string; student_id: string; body: string; count_kind: CountKind; updated: string } | null;
  if (!row) return { ok: false, message: FAILED };
  if (!opts.force && opts.expectedUpdated && Date.parse(row.updated) > Date.parse(opts.expectedUpdated) && row.body !== text) {
    return { ok: false, conflict: { body: row.body, updated: row.updated } };
  }

  const count = countText(text, row.count_kind);
  const changed = row.body !== text;
  let updated = row.updated;
  if (changed) {
    const { data, error } = await r.supabase.from("essays").update({ body: text, count }).eq("id", id).select("updated");
    if (error) return fail(error, "saveEssay");
    if (!data?.length) return { ok: false, message: STUDENT_ONLY };
    updated = (data[0] as { updated: string }).updated;
  }

  const last = await r.supabase.from("essay_versions").select("created").eq("essay_id", id).order("created", { ascending: false }).limit(1);
  const lastVersionAt = (last.data as { created: string }[] | null)?.[0]?.created ?? null;
  const versioned = shouldVersion({ lastVersionAt, now: Date.now(), source, mark: label !== null, changed });
  if (versioned) {
    const { error } = await r.supabase.from("essay_versions").insert({ essay_id: id, body: text, count, source, label });
    if (error) return fail(error, "saveEssay version");
  }
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
