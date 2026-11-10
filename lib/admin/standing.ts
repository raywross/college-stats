import "server-only";
/**
 * The standing panel's data (specs/product/admin.md "A student's standing"): for every college on every list of one
 * student, what Quad's estimate returns for them there with the method's private detail, from the server-only
 * estimateWithDetail() (lib/chances/estimate.ts), plus the open baseline's answer for comparison. No `admin` option on
 * estimate(): the detail comes from the same function the outcome snapshots use, and the public endpoint never calls
 * it directly (tests/admin-hidden.test.mts).
 *
 * Mirrors the planner's own estimate (lib/planner/plan-estimates.ts): the saved profile, no round, the core-subject
 * answers and the grade, and each list's hooks (legacy, sibling, recruited, shown interest) from its rows and visits.
 * Reads go through the console client (adminSupabase, the x-quad-console header). Memoized per request with React's
 * cache(), so the student page's many slots read and compute once. The student page has already written the access
 * row before any slot renders; this adds no second one.
 */
import { cache } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase, readStudentItems, readStudentLists, readStudentProfile, readStudentRecord, readStudentVisits } from "@/lib/admin/people";
import { baselineEstimate } from "@/lib/chances/baseline";
import { gradeNow } from "@/lib/chances/courses";
import { estimateContext, estimateWithDetail } from "@/lib/chances/estimate";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { hooksFromPlan, type HooksItem } from "@/lib/planner/hooks";
import { effectiveGradYear, sanitizeProfile, withHomeState } from "@/lib/student-profile";
import { homeStateForStudent } from "@/lib/home-state";
import { standingPanel, type StandingPanelView } from "./hidden";

export type StudentStanding = { ok: true; byItem: ReadonlyMap<string, StandingPanelView> } | { ok: false; reason: string };

/** Today in the site's home zone (lib/planner/context.ts todayIso, which is server-only alongside the planner's reads). */
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * Two waves of reads, then the estimate (specs/product/admin-speed.md "Waves"; it was five): the profile, record,
 * lists, and the household's home state at once; then the estimate's context beside the items and their visits (the
 * context needs the profile, the items only the lists). The profile, record, lists, items, and visits are the student
 * page's own reads (lib/admin/people.ts readStudent*, cache()d per request), so the page and this panel read each once.
 */
async function compute(studentId: string): Promise<StudentStanding> {
  await requireAdmin();
  const supabase = await adminSupabase();
  const [profileRes, studentRes, listsRes, homeState] = await Promise.all([
    readStudentProfile(studentId),
    readStudentRecord(studentId),
    readStudentLists(studentId),
    homeStateForStudent(supabase, studentId),
  ]);
  const failed = profileRes.error ?? studentRes.error ?? listsRes.error;
  if (failed) return { ok: false, reason: `Reading the student's profile or lists failed: ${failed.message}` };
  const listIds = (listsRes.data ?? []).map((l) => l.id);
  if (listIds.length === 0) return { ok: true, byItem: new Map() };

  // Residency from the household's address when the record has none (owner, 2026-10-16), as profilesICanSee does.
  const profileData = profileRes.data ? withHomeState(sanitizeProfile((profileRes.data as { data: unknown }).data), homeState) : null;
  const gradYear = (studentRes.data as { grad_year: number | null } | null)?.grad_year ?? null;
  const grade = gradeNow(profileData ? effectiveGradYear(profileData.basics, gradYear) : gradYear, todayIso());
  const student = estimateInputFromProfile(profileData, "", null).student;
  const [ctx, itemsRes, visitsRes] = await Promise.all([
    estimateContext(student, { coreAtTopLevel: profileData?.academics.coreAtTopLevel ?? null, grade }),
    readStudentItems(studentId),
    readStudentVisits(studentId),
  ]);
  if (itemsRes.error) return { ok: false, reason: `Reading the list's colleges failed: ${itemsRes.error.message}` };
  const items = (itemsRes.data ?? []) as unknown as (HooksItem & { list_id: string })[];
  if (visitsRes.error) return { ok: false, reason: `Reading the visits failed: ${visitsRes.error.message}` };
  const visits = (visitsRes.data ?? []) as { item_id: string }[];

  const byItem = new Map<string, StandingPanelView>();
  for (const listId of listIds) {
    const rows = items.filter((i) => i.list_id === listId);
    // Each list is a plan of its own: its hooks come from its own rows and visits, as the planner reads them.
    const hooks = hooksFromPlan(rows, visits, profileData);
    for (const item of rows) {
      const school = ctx.schoolById(item.unit_id);
      if (!school) continue;
      const applied = estimateWithDetail({ student, unitId: item.unit_id, hooks: hooks[item.unit_id] }, ctx);
      const college = ctx.standingFor(school);
      byItem.set(item.id, standingPanel({ applied, baseline: baselineEstimate(student, college, item.unit_id), student, college }));
    }
  }
  return { ok: true, byItem };
}

/**
 * Every list college's standing for one student, by list item id. Never throws into the page: a failed read or
 * estimate comes back as `{ ok: false, reason }`, which the panel shows in place of the standing.
 */
export const standingForStudent = cache(async (studentId: string): Promise<StudentStanding> => {
  try {
    return await compute(studentId);
  } catch (err) {
    // requireAdmin()'s notFound() must still reach Next.js.
    if (err instanceof Error && "digest" in err) throw err;
    console.error(`[admin standing] computing the standing failed for a student: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: "The estimate couldn't be computed for this student." };
  }
});
