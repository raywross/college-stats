"use server";
/**
 * Stage 3's Server Actions (specs/planner/actions.md): recording a follow, marking information requested, and the
 * visit log. Copies lib/planner/store.ts's `ready(capability)` pattern (sign in, `allowed()`, then the write with
 * the user's own session so RLS decides). A write that can change which generated tasks should exist (follow,
 * request_info, write_visit_notes) calls `regenerate(listId)` afterward.
 *
 * Guardians can't mark a follow (actions.md "Rules": it's the student's account); they can log, edit, and delete
 * visits like any other editor (`can_edit_item`), and the row records them as the visit's creator.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { isoDateOrNull } from "@/lib/list-rules";
import { SOCIAL_NETWORKS } from "@/lib/social";
import type { SocialNetwork } from "@/lib/types";
import { firstPastVisitOn, isVisitKind } from "./actions";
import { todayIso } from "./context";
import { regenerate } from "./store";
import type { VisitKind, VisitNotes } from "./types";

export type PlanActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const STUDENT_ONLY = "Only the student can mark a follow.";

type Supa = Awaited<ReturnType<typeof createServerSupabase>>;
type Ready = { userId: string; supabase: Supa };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): PlanActionResult {
  if (error) console.error(`planner actions: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isNetwork = (v: unknown): v is SocialNetwork => typeof v === "string" && (SOCIAL_NETWORKS as readonly string[]).includes(v);

async function listOfItem(supabase: Supa, itemId: string): Promise<string | null> {
  const { data } = await supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  return (data as { list_id: string } | null)?.list_id ?? null;
}

/** Whether the signed-in user IS the student (not a guardian with edit access on the student's list). A guardian's
 *  own list (no student) is the guardian's own account, so always "themselves" there. */
async function isStudentSelf(supabase: Supa, listId: string, userId: string): Promise<boolean> {
  const list = await supabase.from("lists").select("student_id").eq("id", listId).maybeSingle();
  const studentId = (list.data as { student_id: string | null } | null)?.student_id ?? null;
  if (!studentId) return true;
  const student = await supabase.from("students").select("user_id").eq("id", studentId).maybeSingle();
  return ((student.data as { user_id: string | null } | null)?.user_id ?? null) === userId;
}

/** Ticks any open generated task of `kind` for this item (used when a direct write, not the task list, finishes it). */
async function completeGeneratedTask(supabase: Supa, itemId: string, kind: string): Promise<void> {
  await supabase.from("plan_tasks").update({ done_at: new Date().toISOString() }).eq("item_id", itemId).eq("kind", kind).is("done_at", null);
}

/* ------------------------------------------------------------------ */
/* Follow and request information                                     */
/* ------------------------------------------------------------------ */

/**
 * Records (or clears) a network as followed: `followed_networks` (which) and `follows_social` (any), so the
 * tracking row built in the hub keeps working. Only the student's own account may mark a follow.
 */
export async function recordFollow(itemId: string, network: SocialNetwork, followed: boolean): Promise<PlanActionResult> {
  if (!isUuid(itemId) || !isNetwork(network) || typeof followed !== "boolean") return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  if (!(await isStudentSelf(r.supabase, listId, r.userId))) return { ok: false, message: STUDENT_ONLY };
  const { data: current, error: readError } = await r.supabase.from("list_items").select("followed_networks").eq("id", itemId).maybeSingle();
  if (readError || !current) return fail(readError, "recordFollow");
  const existing = ((current as { followed_networks: string[] }).followed_networks ?? []) as SocialNetwork[];
  const next = followed ? [...new Set([...existing, network])] : existing.filter((n) => n !== network);
  const { error } = await r.supabase.from("list_items").update({ followed_networks: next, follows_social: next.length > 0 }).eq("id", itemId);
  if (error) return fail(error, "recordFollow");
  if (followed) await completeGeneratedTask(r.supabase, itemId, "follow");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** Marks (or clears) "Request information". The site never fills or submits a college's form; this records that the family did. */
export async function markInfoRequested(itemId: string, requested: boolean): Promise<PlanActionResult> {
  if (!isUuid(itemId) || typeof requested !== "boolean") return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ info_requested_on: requested ? todayIso() : null }).eq("id", itemId);
  if (error) return fail(error, "markInfoRequested");
  if (requested) await completeGeneratedTask(r.supabase, itemId, "request_info");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Visits                                                               */
/* ------------------------------------------------------------------ */

export interface VisitInput {
  kind: VisitKind;
  onDate: string;
  atTime?: string | null;
  registered?: boolean;
  registrationUrl?: string | null;
  who?: string[];
  rating?: number | null;
  notes?: VisitNotes;
}

const NOTE_TEXT_FIELDS = ["stood_out", "worried", "people", "questions", "live_here", "free", "interviewer"] as const;

function sanitizeNotes(notes: VisitNotes | undefined): VisitNotes {
  const out: VisitNotes = {};
  if (!notes) return out;
  for (const key of NOTE_TEXT_FIELDS) {
    const v = notes[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 2000);
  }
  if (notes.interviewer_kind === "alumni" || notes.interviewer_kind === "admissions") out.interviewer_kind = notes.interviewer_kind;
  return out;
}

function sanitizeWho(who: string[] | undefined): string[] {
  if (!Array.isArray(who)) return [];
  return who
    .map((w) => String(w).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8);
}

function validRating(rating: number | null | undefined): rating is number | null {
  return rating === undefined || rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= 5);
}

/** Recomputes `list_items.visited_on` from every visit on the item (lib/planner/actions.ts firstPastVisitOn). */
async function syncVisitedOn(supabase: Supa, itemId: string): Promise<void> {
  const { data } = await supabase.from("plan_visits").select("on_date").eq("item_id", itemId);
  const dates = ((data ?? []) as { on_date: string }[]).map((v) => v.on_date);
  const visitedOn = firstPastVisitOn(dates, todayIso());
  await supabase.from("list_items").update({ visited_on: visitedOn }).eq("id", itemId);
}

/** Logs a visit (actions.md "Visits"): the first past visit on the item sets `visited_on`. */
export async function logVisit(itemId: string, input: VisitInput): Promise<PlanActionResult> {
  if (!isUuid(itemId) || !isVisitKind(input?.kind)) return { ok: false, message: FAILED };
  const onDate = isoDateOrNull(input.onDate);
  if (!onDate) return { ok: false, message: "That isn't a date." };
  if (!validRating(input.rating)) return { ok: false, message: FAILED };
  const r = await ready("planner.actions.visits");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("plan_visits").insert({
    item_id: itemId,
    kind: input.kind,
    on_date: onDate,
    at_time: input.atTime || null,
    registered: Boolean(input.registered),
    registration_url: input.registrationUrl || null,
    who: sanitizeWho(input.who),
    rating: input.rating ?? null,
    notes: sanitizeNotes(input.notes),
  });
  if (error) return fail(error, "logVisit");
  await syncVisitedOn(r.supabase, itemId);
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** Edits a visit (any field); recomputes `visited_on` and regenerates (a changed date or new notes move tasks). */
export async function updateVisit(visitId: string, patch: Partial<VisitInput>): Promise<PlanActionResult> {
  if (!isUuid(visitId)) return { ok: false, message: FAILED };
  if (!validRating(patch.rating)) return { ok: false, message: FAILED };
  const r = await ready("planner.actions.visits");
  if (!("supabase" in r)) return r;
  const current = await r.supabase.from("plan_visits").select("item_id").eq("id", visitId).maybeSingle();
  const itemId = (current.data as { item_id: string } | null)?.item_id ?? null;
  if (!itemId) return { ok: false, message: FAILED };

  const update: Record<string, unknown> = {};
  if (patch.kind !== undefined) {
    if (!isVisitKind(patch.kind)) return { ok: false, message: FAILED };
    update.kind = patch.kind;
  }
  if (patch.onDate !== undefined) {
    const d = isoDateOrNull(patch.onDate);
    if (!d) return { ok: false, message: "That isn't a date." };
    update.on_date = d;
  }
  if (patch.atTime !== undefined) update.at_time = patch.atTime || null;
  if (patch.registered !== undefined) update.registered = Boolean(patch.registered);
  if (patch.registrationUrl !== undefined) update.registration_url = patch.registrationUrl || null;
  if (patch.who !== undefined) update.who = sanitizeWho(patch.who);
  if (patch.rating !== undefined) update.rating = patch.rating;
  if (patch.notes !== undefined) update.notes = sanitizeNotes(patch.notes);

  const { error } = await r.supabase.from("plan_visits").update(update).eq("id", visitId);
  if (error) return fail(error, "updateVisit");
  await syncVisitedOn(r.supabase, itemId);
  const listId = await listOfItem(r.supabase, itemId);
  if (listId) await regenerate(listId);
  refresh();
  return { ok: true };
}

/** Appends one "before you go" question (or any text) to a visit's own questions note. */
export async function addVisitQuestion(visitId: string, question: string): Promise<PlanActionResult> {
  const text = String(question ?? "").trim();
  if (!isUuid(visitId) || !text) return { ok: false, message: FAILED };
  const r = await ready("planner.actions.visits");
  if (!("supabase" in r)) return r;
  const current = await r.supabase.from("plan_visits").select("notes").eq("id", visitId).maybeSingle();
  if (!current.data) return { ok: false, message: FAILED };
  const notes = ((current.data as { notes: VisitNotes }).notes ?? {}) as VisitNotes;
  const joined = [notes.questions, text].filter(Boolean).join("\n");
  const { error } = await r.supabase.from("plan_visits").update({ notes: { ...notes, questions: joined.slice(0, 2000) } }).eq("id", visitId);
  if (error) return fail(error, "addVisitQuestion");
  refresh();
  return { ok: true };
}

/** Removes a visit and recomputes `visited_on` from what's left. */
export async function deleteVisit(visitId: string): Promise<PlanActionResult> {
  if (!isUuid(visitId)) return { ok: false, message: FAILED };
  const r = await ready("planner.actions.visits");
  if (!("supabase" in r)) return r;
  const current = await r.supabase.from("plan_visits").select("item_id").eq("id", visitId).maybeSingle();
  const itemId = (current.data as { item_id: string } | null)?.item_id ?? null;
  const { error } = await r.supabase.from("plan_visits").delete().eq("id", visitId);
  if (error) return fail(error, "deleteVisit");
  if (itemId) {
    await syncVisitedOn(r.supabase, itemId);
    const listId = await listOfItem(r.supabase, itemId);
    if (listId) await regenerate(listId);
  }
  refresh();
  return { ok: true };
}
