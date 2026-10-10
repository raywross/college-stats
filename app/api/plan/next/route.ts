import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { loadPlanFor, planViewer } from "@/lib/planner/load";
import { todayIso } from "@/lib/planner/context";
import { hasDueSoon } from "@/lib/planner/plan-frame";

export const dynamic = "force-dynamic";

const json = (dueSoon: boolean) => NextResponse.json({ dueSoon }, { headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/plan/next (specs/planner/redesign/page.md "Navigation"): whether the header's Plan dot should light up —
 * a deadline within 7 days on the signed-in student's plan, or on any child a signed-in guardian can see. Fetched
 * client-side after mount (components/layout/{Header,BottomNav}.tsx), never computed on the server, so the public
 * pages stay static. Signed out or any error: false.
 */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) return json(false);
    const viewer = await planViewer();
    const studentIds = viewer.kind === "self" ? [viewer.student.id] : viewer.kind === "guardian" ? viewer.children.map((c) => c.studentId) : [];
    if (studentIds.length === 0) return json(false);
    const today = todayIso();
    const loads = await Promise.all(studentIds.map((id) => loadPlanFor(id)));
    const dueSoon = loads.some((l) => l.kind === "ready" && hasDueSoon(l.view, today));
    return json(dueSoon);
  } catch {
    return json(false);
  }
}
