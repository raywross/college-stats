"use server";
/**
 * The Good ED opportunity sheet's Server Actions (specs/planner/next-steps/ed-opportunities.md "The sheet"):
 * - `startEd(itemId, round)`: "Start it in ED" / "Start it in ED II" / "Keep ED". Sets the round as the student's own
 *   choice through the built `setPlanRound` (round_source 'student', then the sync and regeneration: the cost check
 *   follows the round, and `ed_decide` stops being generated, lib/planner/ed-opportunities.ts). Ticks the open
 *   `ed_decide` (and this college's `ed2_decide`) first so the move reads as done. Only the student themselves: a
 *   guardian gets "{First} picks the round."
 * - `dismissEd(itemId)`: "Not for me". Sets `list_items.ed_dismissed_at` (student only; final for the cycle) and
 *   regenerates, so the pill goes and the next candidate moves up.
 * - `setEdChecks(itemId, checks)`: the sheet's three questions, merged into `list_items.ed_checks` (any editor; RLS
 *   decides who can edit the row).
 * Copies store-actions.ts's `ready` and `isStudentSelf` pattern (sign in, `allowed()`, the user's own session).
 * A "use server" module exports only async functions.
 */
import { ADVISOR_PATH } from "./advisor";
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { regenerate } from "./store";
import { setPlanRound } from "./store-plan";

export type EdActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const CHECK_KEYS = ["attend", "cost", "ready"] as const;

type Supa = Awaited<ReturnType<typeof createServerSupabase>>;
type Ready = { userId: string; supabase: Supa };

async function ready(): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, "planner.tab"))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function listOfItem(supabase: Supa, itemId: string): Promise<string | null> {
  const { data } = await supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  return (data as { list_id: string } | null)?.list_id ?? null;
}

/**
 * Whether the signed-in user IS the student (store-actions.ts isStudentSelf), plus the student's first name for the
 * guardian's message. A guardian's own list (no student) is their own account.
 */
async function studentSelf(supabase: Supa, listId: string, userId: string): Promise<{ self: boolean; first: string | null }> {
  const list = await supabase.from("lists").select("student_id").eq("id", listId).maybeSingle();
  const studentId = (list.data as { student_id: string | null } | null)?.student_id ?? null;
  if (!studentId) return { self: true, first: null };
  const student = await supabase.from("students").select("user_id, display_name").eq("id", studentId).maybeSingle();
  const row = student.data as { user_id: string | null; display_name: string | null } | null;
  return { self: (row?.user_id ?? null) === userId, first: row?.display_name?.trim().split(/\s+/)[0] || null };
}

const picksTheRound = (first: string | null) => `${first ?? "Your student"} picks the round.`;

/** "Start it in ED" / "Start it in ED II" / "Keep ED": the student's own round. */
export async function startEd(itemId: string, round: "ed" | "ed2"): Promise<EdActionResult> {
  if (!isUuid(itemId) || (round !== "ed" && round !== "ed2")) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const who = await studentSelf(r.supabase, listId, r.userId);
  if (!who.self) return { ok: false, message: picksTheRound(who.first) };
  const now = new Date().toISOString();
  await r.supabase.from("plan_tasks").update({ done_at: now, done_by: r.userId }).eq("list_id", listId).eq("kind", "ed_decide").is("done_at", null);
  if (round === "ed2") {
    await r.supabase.from("plan_tasks").update({ done_at: now, done_by: r.userId }).eq("list_id", listId).eq("kind", "ed2_decide").eq("item_id", itemId).is("done_at", null);
  }
  return setPlanRound(itemId, round);
}

/** "Not for me": the pill goes for the cycle, and the next candidate moves up. */
export async function dismissEd(itemId: string): Promise<EdActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const who = await studentSelf(r.supabase, listId, r.userId);
  if (!who.self) return { ok: false, message: `${who.first ?? "Your student"} decides whether it's for them.` };
  const { data, error } = await r.supabase.from("list_items").update({ ed_dismissed_at: new Date().toISOString() }).eq("id", itemId).select("id");
  if (error || !data?.length) {
    if (error) console.error(`planner ed: dismissEd failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  await regenerate(listId);
  revalidatePath(ADVISOR_PATH);
  revalidatePath("/household", "layout");
  return { ok: true };
}

/** The sheet's three questions, merged into what's stored. Unknown keys and non-boolean values are ignored. */
export async function setEdChecks(itemId: string, checks: { attend?: boolean; cost?: boolean; ready?: boolean }): Promise<EdActionResult> {
  if (!isUuid(itemId) || typeof checks !== "object" || checks === null) return { ok: false, message: FAILED };
  const patch: Record<string, boolean> = {};
  for (const k of CHECK_KEYS) if (typeof checks[k] === "boolean") patch[k] = checks[k]!;
  if (Object.keys(patch).length === 0) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data: current, error: readError } = await r.supabase.from("list_items").select("ed_checks").eq("id", itemId).maybeSingle();
  if (readError || !current) {
    if (readError) console.error(`planner ed: setEdChecks read failed: ${readError.message}`);
    return { ok: false, message: FAILED };
  }
  const stored = ((current as { ed_checks: Record<string, boolean> | null }).ed_checks ?? {}) as Record<string, boolean>;
  const { data, error } = await r.supabase.from("list_items").update({ ed_checks: { ...stored, ...patch } }).eq("id", itemId).select("id");
  if (error || !data?.length) {
    if (error) console.error(`planner ed: setEdChecks failed: ${error.message}`);
    return { ok: false, message: error ? FAILED : "Only someone who can edit this plan can change it." };
  }
  revalidatePath(ADVISOR_PATH);
  return { ok: true };
}
