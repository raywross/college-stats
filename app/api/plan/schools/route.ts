import { NextResponse } from "next/server";
import { getData } from "@/lib/data";
import { planSchoolFor } from "@/lib/planner/context";
import { currentCycle, cycleStartOf } from "@/lib/planner/cycle";
import type { PlanSchool } from "@/lib/planner/types";
import { isUnitId } from "@/lib/follow-state";

const MAX_IDS = 20;

/**
 * GET /api/plan/schools?ids=166027,110635 (build-plan.md "U7 Signed-out Plan"): the minimal `PlanSchool` slice the
 * standing model needs — SAT/ACT ranges, admit rate, test policy, GPA average, round dates — with citations, for
 * up to 20 colleges at once. Read only, no session: everything it returns is already public on a college's own
 * page. Backs the signed-out plan's live rows (and anything else client-side that wants `planView`'s inputs); it
 * doesn't touch Supabase, so it stays safe for `/plan` to call without affecting that page's own rendering.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isUnitId)
    .slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ schools: {} });

  const { getSchoolById, citeField } = await getData();
  const today = new Date().toISOString().slice(0, 10);
  const studentCycleStart = cycleStartOf(currentCycle(today)) ?? Number(today.slice(0, 4));

  const schools: Record<string, PlanSchool> = {};
  for (const id of ids) {
    const school = getSchoolById(id);
    if (school) schools[id] = planSchoolFor(school, citeField, { studentCycleStart, home: null });
  }
  // Cached per id set: the data behind it (CDS scores, admit rate, round dates) changes at most once a day.
  return NextResponse.json({ schools }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
