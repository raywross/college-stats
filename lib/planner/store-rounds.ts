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
