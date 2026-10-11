"use server";
/**
 * The planner's core Server Actions (specs/planner/model.md "Shared code"). Every function: `ready()` (signed in,
 * the user's own Supabase session), `allowed(user, capability)` (lib/entitlements.ts), then the read or write with
 * that session so row-level security decides (supabase/migrations/20261008120000_planner.sql). Returns
 * `{ ok: true } | { ok: false; message }` and revalidates the household pages. A write that can change which tasks
 * should exist (Dream, round) regenerates the list's tasks after it.
 *
 * The stage units add their own actions in lib/planner/store-{list,rounds,actions,timeline,apply,offers,parents}.ts
 * and call `regenerate(listId)` from here after a write that moves tasks.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { myHome } from "@/lib/home-store";
import { profileFor } from "@/lib/student-profile-store";
import { effectiveGradYear, GRAD_YEAR_MAX, GRAD_YEAR_MIN } from "@/lib/student-profile";
import { isListRound, isoDateOrNull, type ListRound } from "@/lib/list-rules";
import { generatorInputFor, readPlan, todayIso, writeMerge, type PlanData } from "./context";
import { generateTasks, mergeTasks } from "./tasks";
import type { Assignee } from "./types";

export type PlanActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): PlanActionResult {
  if (error) console.error(`planner: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

/** Every person page and the hub's caption read the plan, so the household layout and everything under it refresh. */
function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ASSIGNEES: readonly Assignee[] = ["student", "guardian", "either"];

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** A list's plan in one read (list, items, tasks, visits, offers, nudges), as the signed-in user may see it. */
export async function planFor(listId: string): Promise<PlanData | null> {
  if (!isUuid(listId)) return null;
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return null;
  return readPlan(r.supabase, listId);
}

/* ------------------------------------------------------------------ */
/* Regeneration                                                        */
/* ------------------------------------------------------------------ */

/** The grad year and numbers a list's generators read: the student's, or none for a guardian's own list. */
async function studentFacts(supabase: Ready["supabase"], studentId: string | null) {
  if (!studentId) return { gradYear: null, profile: null };
  const [profile, student] = await Promise.all([
    profileFor(studentId),
    supabase.from("students").select("grad_year").eq("id", studentId).maybeSingle(),
  ]);
  const stored = (student.data as { grad_year: number | null } | null)?.grad_year ?? null;
  return { gradYear: profile ? effectiveGradYear(profile.data.basics, stored) : stored, profile: profile?.data ?? null };
}

/**
 * Runs every generator for the list and writes the difference (lib/planner/tasks.ts mergeTasks): new and changed
 * generated tasks are upserted on (list_id, key) with only their generated fields, so ticks, snoozes, and dismissals
 * stay; tasks whose source disappeared are marked orphaned. Idempotent and cheap when nothing changed (no writes).
 * A reader who can't edit the list writes nothing (RLS); the result says so without failing the page.
 */
export async function regenerate(listId: string): Promise<PlanActionResult & { changed?: number }> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const plan = await readPlan(r.supabase, listId);
  if (!plan) return { ok: false, message: FAILED };
  const facts = await studentFacts(r.supabase, plan.list.student_id);
  const home = await myHome();
  const input = await generatorInputFor(plan, { ...facts, home, today: todayIso() });
  const merge = mergeTasks(plan.tasks, generateTasks(input));
  const wrote = await writeMerge(r.supabase, listId, merge);
  return { ok: true, changed: wrote ? merge.upserts.length + merge.orphans.length : 0 };
}

/** The list an item belongs to (for regenerating after an item write). */
async function listOfItem(supabase: Ready["supabase"], itemId: string): Promise<string | null> {
  const { data } = await supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  return (data as { list_id: string } | null)?.list_id ?? null;
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

async function updateTask(taskId: string, patch: Record<string, unknown>, what: string): Promise<PlanActionResult> {
  if (!isUuid(taskId)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_tasks").update(patch).eq("id", taskId).select("id");
  if (error) return fail(error, what);
  if (!data?.length) return { ok: false, message: "Only someone who can edit this plan can change it." };
  refresh();
  return { ok: true };
}

/** Ticks a task done; the database records who (done_by) and keeps it through every regeneration. */
export async function tick(taskId: string): Promise<PlanActionResult> {
  return updateTask(taskId, { done_at: new Date().toISOString() }, "tick");
}

export async function untick(taskId: string): Promise<PlanActionResult> {
  return updateTask(taskId, { done_at: null }, "untick");
}

/** Hides a task until a day (yyyy-mm-dd); null brings it back now. */
export async function snooze(taskId: string, until: string | null): Promise<PlanActionResult> {
  const day = until === null ? null : isoDateOrNull(until);
  if (until !== null && day === null) return { ok: false, message: "That isn't a date." };
  return updateTask(taskId, { snoozed_until: day }, "snooze");
}

/** Dismisses a task ("not for us"), or brings it back. A dismissed generated task stays dismissed after a regeneration. */
export async function dismiss(taskId: string, dismissed = true): Promise<PlanActionResult> {
  return updateTask(taskId, { dismissed: Boolean(dismissed) }, "dismiss");
}

/** The family's own task: a title, an optional date and college, and who it's for (timeline.md "own"). */
export async function addOwnTask(input: { listId: string; title: string; dueOn?: string | null; itemId?: string | null; assignee?: Assignee }): Promise<PlanActionResult> {
  const title = String(input?.title ?? "").trim().slice(0, 200);
  if (!title) return { ok: false, message: "Give the task a name." };
  if (!isUuid(input.listId) || (input.itemId != null && !isUuid(input.itemId))) return { ok: false, message: FAILED };
  const due = input.dueOn ? isoDateOrNull(input.dueOn) : null;
  if (input.dueOn && !due) return { ok: false, message: "That isn't a date." };
  const assignee = input.assignee && ASSIGNEES.includes(input.assignee) ? input.assignee : "student";
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase.from("plan_tasks").insert({
    list_id: input.listId,
    item_id: input.itemId ?? null,
    key: null,
    kind: "own",
    source: "own",
    title,
    due_on: due,
    date_note: due ? "own" : null,
    assignee,
  });
  if (error) return fail(error, "addOwnTask");
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

async function updateItem(itemId: string, patch: Record<string, unknown>, what: string, capability: Capability, regen: boolean): Promise<PlanActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready(capability);
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("list_items").update(patch).eq("id", itemId).select("list_id");
  if (error) return fail(error, what);
  if (!data?.length) return { ok: false, message: "Only someone who can edit this list can change it." };
  if (regen) {
    const listId = (data[0] as { list_id: string }).list_id ?? (await listOfItem(r.supabase, itemId));
    if (listId) await regenerate(listId);
  }
  refresh();
  return { ok: true };
}

/** Marks (or clears) the Dream; the database moves it off any other college on the list. */
export async function setDream(itemId: string, dream: boolean): Promise<PlanActionResult> {
  return updateItem(itemId, { dream: Boolean(dream) }, "setDream", "planner.tab", true);
}

/** The student's own rank (1 = would go first), or null. */
/** The application round; tasks follow the round, so the list regenerates. */
export async function setRound(itemId: string, round: ListRound | null): Promise<PlanActionResult> {
  if (round !== null && !isListRound(round)) return { ok: false, message: FAILED };
  return updateItem(itemId, { round }, "setRound", "planner.rounds", true);
}

/* ------------------------------------------------------------------ */
/* The student                                                         */
/* ------------------------------------------------------------------ */

/** The grad year the Plan tab asks for when it's missing (one field, saved on the student record). */
export async function setGradYear(studentId: string, gradYear: number): Promise<PlanActionResult> {
  if (!isUuid(studentId)) return { ok: false, message: FAILED };
  const year = Number(gradYear);
  if (!Number.isInteger(year) || year < GRAD_YEAR_MIN || year > GRAD_YEAR_MAX) return { ok: false, message: "Pick a class year." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("students").update({ grad_year: year }).eq("id", studentId).select("id");
  if (error) return fail(error, "setGradYear");
  if (!data?.length) return { ok: false, message: "Only the student or a guardian who can edit can set this." };
  const lists = await r.supabase.from("lists").select("id").eq("student_id", studentId);
  for (const l of (lists.data ?? []) as { id: string }[]) await regenerate(l.id);
  refresh();
  return { ok: true };
}
