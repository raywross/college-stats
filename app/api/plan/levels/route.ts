import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { gradeNow } from "@/lib/chances/courses";
import { hasNumbers } from "@/lib/chances/what-went-in";
import type { StandingLevel } from "@/lib/chances/types";
import { hooksFromPlan } from "@/lib/planner/hooks";
import { loadPlanFor } from "@/lib/planner/load";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_IDS = 12;

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_IDS && v.every((id) => typeof id === "string" && id.length > 0);

/**
 * POST /api/plan/levels (specs/planner/record/reading.md "Beside a college you might add"): the level (or none) a
 * live estimate would give up to 12 colleges the student is looking at, not yet on the list — for the add-college
 * search's chip (`components/planner/AddCollegeBox.tsx`). Signed in only; `loadPlanFor` is the access check (a
 * student the caller can't see, or one with no list yet, is a 404), the same pattern as `/api/plan/list-guide`. The
 * response carries the level alone, never a group's closeness, notes, or any other estimate field — a candidate
 * college isn't on the list, so nothing beyond "which level" belongs beside it. `sorted` is false (and every level
 * null) when the record has no grades or test yet (`hasNumbers`): the chip then reads "Add your grades to sort".
 *
 *   body:     { studentId: string, unitIds: string[] }   (≤ 12 ids)
 *   response: { levels: Record<string, StandingLevel | null>, sorted: boolean }
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to see this." }, { status: 401, headers: NO_STORE });

  const body = (await request.json().catch(() => null)) as { studentId?: unknown; unitIds?: unknown } | null;
  if (!body || typeof body.studentId !== "string" || !isIdList(body.unitIds)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  }
  const unitIds = [...new Set(body.unitIds)];

  const load = await loadPlanFor(body.studentId);
  if (load.kind !== "ready") return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  const { ctx } = load;

  const student = estimateInputFromProfile(ctx.profile, "", null).student;
  if (!hasNumbers(student)) {
    return NextResponse.json({ levels: Object.fromEntries(unitIds.map((id) => [id, null])), sorted: false }, { headers: NO_STORE });
  }

  const estimateCtx = await estimateContext(student, { coreAtTopLevel: ctx.profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(ctx.gradYear, new Date().toISOString().slice(0, 10)) });
  const hooks = hooksFromPlan(ctx.items, ctx.visits, ctx.profile);
  const results = estimateMany(student, unitIds, estimateCtx, hooks);
  const levels: Record<string, StandingLevel | null> = {};
  for (const id of unitIds) levels[id] = results[id]?.group ?? null;
  return NextResponse.json({ levels, sorted: true }, { headers: NO_STORE });
}
