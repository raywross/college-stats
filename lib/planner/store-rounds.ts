"use server";
/**
 * The rounds stage's Server Actions (specs/planner/early-rounds.md "What it writes"). Same pattern as
 * lib/planner/store.ts: `ready(capability)` (signed in, allowed, the user's own session), then the write with that
 * session so row-level security decides; `{ ok: true } | { ok: false; message }`; the household pages revalidate.
 *
 * - acceptRoundsPlan: `round` and `priority` on every item, `lists.rounds_plan_accepted_at`, then regenerate (the
 *   timeline's dates follow the rounds) and tick the decide-rounds step.
 * - setPriorityOrder / restorePriorityOrder: the ranking, with who changed it (supabase/migrations/
 *   20261008133000_planner_rounds.sql sets `priority_by` from the session) and the order before, for "Put it back".
 * - priorityAttribution: the "Reordered by Dad" line. myPlanRound: the profile's "On your plan: EA" line.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { isListRound, type ListRound } from "@/lib/list-rules";
import { namesFor } from "@/lib/lists";
import { isUnitId } from "@/lib/follow-state";
import { regenerate, type PlanActionResult } from "./store";
import { taskKey } from "./tasks";

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const NO_EDIT = "Only someone who can edit this list can change it.";

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

function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isMissingColumn = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /does not exist|schema cache/i.test(e.message ?? "");

/** The list's item ids, or null when the list isn't readable. */
async function itemsOf(r: Ready, listId: string): Promise<{ id: string; priority: number | null }[] | null> {
  const { data, error } = await r.supabase.from("list_items").select("id, priority").eq("list_id", listId);
  if (error) {
    console.error(`planner: reading the list's colleges failed: ${error.message}`);
    return null;
  }
  return data as { id: string; priority: number | null }[];
}

/** Writes priority = position + 1 for each id, in parallel; false when any write was refused. */
async function writePriorities(r: Ready, listId: string, rows: { id: string; priority: number | null; round?: ListRound | null }[]): Promise<boolean> {
  const results = await Promise.all(
    rows.map((row) =>
      r.supabase
        .from("list_items")
        .update(row.round === undefined ? { priority: row.priority } : { priority: row.priority, round: row.round })
        .eq("id", row.id)
        .eq("list_id", listId)
        .select("id"),
    ),
  );
  for (const res of results) {
    if (res.error) {
      console.error(`planner: writing a priority failed: ${res.error.message}`);
      return false;
    }
    if (!res.data?.length) return false;
  }
  return true;
}

export interface AcceptRoundsInput {
  listId: string;
  /** Item ids in priority order (1 first); every item on the list. */
  order: string[];
  /** The round per item id (null clears it). */
  rounds: Record<string, ListRound | null>;
}

/**
 * Accepts the rounds plan: writes `round` and `priority` on every item, stamps `lists.rounds_plan_accepted_at`, then
 * regenerates the list's tasks and ticks the decide-rounds step. A plan with a red conflict can still be saved (the
 * student may know something the data doesn't); the strip keeps counting it.
 */
export async function acceptRoundsPlan(input: AcceptRoundsInput): Promise<PlanActionResult> {
  const listId = input?.listId;
  if (!isUuid(listId) || !Array.isArray(input.order) || !input.rounds || typeof input.rounds !== "object") return { ok: false, message: FAILED };
  const r = await ready("planner.rounds");
  if (!("supabase" in r)) return r;
  const items = await itemsOf(r, listId);
  if (!items) return { ok: false, message: FAILED };
  const ids = new Set(items.map((i) => i.id));
  const order = input.order.filter((id) => ids.has(id));
  if (order.length !== ids.size || new Set(order).size !== order.length) return { ok: false, message: "The list changed while you were choosing. Reload and try again." };
  for (const id of order) {
    const round = input.rounds[id] ?? null;
    if (round !== null && !isListRound(round)) return { ok: false, message: FAILED };
  }
  const ok = await writePriorities(
    r,
    listId,
    order.map((id, i) => ({ id, priority: i + 1, round: input.rounds[id] ?? null })),
  );
  if (!ok) return { ok: false, message: NO_EDIT };
  const stamp = await r.supabase.from("lists").update({ rounds_plan_accepted_at: new Date().toISOString() }).eq("id", listId).select("id");
  if (stamp.error) return fail(stamp.error, "acceptRoundsPlan");
  await regenerate(listId);
  await r.supabase
    .from("plan_tasks")
    .update({ done_at: new Date().toISOString() })
    .eq("list_id", listId)
    .eq("key", taskKey(listId, "decide_rounds"))
    .is("done_at", null);
  refresh();
  return { ok: true };
}

/** Saves the ranking (item ids, 1 first) and who made it; the order before is kept for "Put it back". */
export async function setPriorityOrder(listId: string, order: string[]): Promise<PlanActionResult> {
  if (!isUuid(listId) || !Array.isArray(order) || !order.every(isUuid)) return { ok: false, message: FAILED };
  const r = await ready("planner.rounds");
  if (!("supabase" in r)) return r;
  const items = await itemsOf(r, listId);
  if (!items) return { ok: false, message: FAILED };
  const ids = new Set(items.map((i) => i.id));
  const next = order.filter((id) => ids.has(id));
  if (next.length !== ids.size || new Set(next).size !== next.length) return { ok: false, message: "The list changed. Reload and try again." };
  const previous = items.map((i) => ({ id: i.id, priority: i.priority }));
  if (!(await writePriorities(r, listId, next.map((id, i) => ({ id, priority: i + 1 }))))) return { ok: false, message: NO_EDIT };
  await stampOrder(r, listId, previous);
  refresh();
  return { ok: true };
}

/** "Put it back": restores the order before the last change (which then becomes the one to put back). */
export async function restorePriorityOrder(listId: string): Promise<PlanActionResult> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.rounds");
  if (!("supabase" in r)) return r;
  const list = await r.supabase.from("lists").select("priority_previous").eq("id", listId).maybeSingle();
  if (list.error) return fail(list.error, "restorePriorityOrder");
  const prev = (list.data as { priority_previous: { id: string; priority: number | null }[] | null } | null)?.priority_previous;
  if (!Array.isArray(prev) || prev.length === 0) return { ok: false, message: "There's no earlier order to put back." };
  const items = await itemsOf(r, listId);
  if (!items) return { ok: false, message: FAILED };
  const ids = new Set(items.map((i) => i.id));
  const rows = prev.filter((p) => ids.has(p.id) && (p.priority === null || Number.isInteger(p.priority)));
  const current = items.map((i) => ({ id: i.id, priority: i.priority }));
  if (!(await writePriorities(r, listId, rows))) return { ok: false, message: NO_EDIT };
  await stampOrder(r, listId, current);
  refresh();
  return { ok: true };
}

/** Records when the order changed and the order before (the trigger records who). Quiet when the columns aren't there yet. */
async function stampOrder(r: Ready, listId: string, previous: { id: string; priority: number | null }[]) {
  const { error } = await r.supabase.from("lists").update({ priority_at: new Date().toISOString(), priority_previous: previous }).eq("id", listId);
  if (error && !isMissingColumn(error)) console.error(`planner: recording the order's change failed: ${error.message}`);
}

export interface PriorityAttribution {
  /** The person who last reordered, when it wasn't the student; null otherwise. */
  byName: string | null;
  /** Whether an earlier order can be put back. */
  canRestore: boolean;
}

/**
 * Who last reordered the list, when it wasn't the student ("Reordered by Dad"); `studentUserId` is the student's
 * account (null for a managed student: then anyone's reorder is attributed). Null when nothing to say.
 */
export async function priorityAttribution(listId: string, studentUserId: string | null): Promise<PriorityAttribution | null> {
  if (!isUuid(listId)) return null;
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return null;
  const { data, error } = await r.supabase.from("lists").select("priority_by, priority_previous").eq("id", listId).maybeSingle();
  if (error || !data) return null;
  const row = data as { priority_by: string | null; priority_previous: unknown[] | null };
  if (!row.priority_by || row.priority_by === studentUserId) return null;
  const names = await namesFor([row.priority_by]);
  const first = names[row.priority_by]?.trim().split(/\s+/)[0] || null;
  return { byName: row.priority_by === r.userId ? "you" : (first ?? "a parent"), canRestore: Array.isArray(row.priority_previous) && row.priority_previous.length > 0 };
}

/**
 * The profile's "On your plan" line (components/school/EarlyRounds.tsx): for a signed-in student with this college on
 * one of their lists, its round (null when not chosen yet) and the link to the rounds stage. Null otherwise, and for
 * a guardian (the plan is the student's). Called from the browser after the page loads, so the profile stays static.
 */
export async function myPlanRound(unitId: string): Promise<{ round: ListRound | null; href: string } | null> {
  if (!isUnitId(unitId)) return null;
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return null;
  const student = await r.supabase.from("students").select("id").eq("user_id", r.userId).is("deleted_at", null).maybeSingle();
  const studentId = (student.data as { id: string } | null)?.id;
  if (student.error || !studentId) return null;
  const lists = await r.supabase.from("lists").select("id, is_default").eq("student_id", studentId);
  const rows = (lists.data ?? []) as { id: string; is_default: boolean }[];
  if (lists.error || rows.length === 0) return null;
  const items = await r.supabase.from("list_items").select("list_id, round").eq("unit_id", unitId).in("list_id", rows.map((l) => l.id));
  const found = (items.data ?? []) as { list_id: string; round: ListRound | null }[];
  if (items.error || found.length === 0) return null;
  const defaultId = rows.find((l) => l.is_default)?.id;
  const item = found.find((i) => i.list_id === defaultId) ?? found[0];
  return { round: isListRound(item.round) ? item.round : null, href: `/household/${studentId}/plan?stage=2` };
}
