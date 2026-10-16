import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { planBundle } from "@/lib/bundles";
import { planViewer } from "@/lib/planner/load";
import { todayIso } from "@/lib/planner/context";
import { hasNewMove, tasksDueSoon } from "@/lib/planner/plan-frame";
import type { PlanTask } from "@/lib/planner/types";
import { createServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** `dueSoon` is the dot (lit for either reason, the name the header has always read); `deadline` and `newMove` say why, for the dot's accessible name. */
const json = (deadline: boolean, newMove = false) => NextResponse.json({ dueSoon: deadline || newMove, deadline, newMove }, { headers: { "Cache-Control": "no-store" } });

/** When this viewer last opened each student's Next steps tab (own rows only, by RLS). A failed read: never opened. */
async function lastOpens(userId: string, studentIds: string[]): Promise<Map<string, string>> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("plan_opens").select("student_id, last_at").eq("user_id", userId).in("student_id", studentIds);
    if (error) return new Map();
    return new Map(((data ?? []) as { student_id: string; last_at: string }[]).map((r) => [r.student_id, r.last_at]));
  } catch {
    return new Map();
  }
}

/**
 * GET /api/plan/next (specs/planner/redesign/page.md "Navigation"; next-steps notifications.md "Channels"): whether
 * the header's Plan dot should light up — a deadline within 7 days, or a move added since this viewer last opened the
 * student's Next steps tab (plan_opens.last_at), on the signed-in student's plan or on any child a signed-in guardian
 * can see. Fetched client-side after mount (components/layout/usePlanDot.ts), never computed on the server, so the
 * public pages stay static. Signed out or any error: false.
 *
 * Performance pass (2026-10-16): this used to run the whole plan load per student (the dataset, the estimate, the
 * suggestion sync, the regenerated tasks) on every page view, a second full plan computation beside the page's own.
 * Now it reads each student's stored plan bundle (one call each, side by side) and decides from the tasks alone
 * (lib/planner/plan-frame.ts tasksDueSoon, hasNewMove).
 */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) return json(false);
    const viewer = await planViewer();
    const studentIds = viewer.kind === "self" ? [viewer.student.id] : viewer.kind === "guardian" ? viewer.children.map((c) => c.studentId) : [];
    if (studentIds.length === 0) return json(false);
    const today = todayIso();
    const [bundles, opens] = await Promise.all([Promise.all(studentIds.map((id) => planBundle(id))), lastOpens(user.id, studentIds)]);
    const tasksOf = (i: number): PlanTask[] => (bundles[i]?.tasks ?? []) as PlanTask[];
    const deadline = studentIds.some((_, i) => tasksDueSoon(tasksOf(i), today));
    const newMove = studentIds.some((id, i) => hasNewMove(tasksOf(i), opens.get(id) ?? null, today));
    return json(deadline, newMove);
  } catch {
    return json(false);
  }
}
