import "server-only";
/**
 * What /admin/high-schools/[id] reads (specs/product/admin.md "A high school"): the school's record, its pooled course
 * counts in full (`school_course_counts`, through the console client and the table's "Admins read" policy, the only
 * read of it besides school_course_list()), the offering the course plan uses for it, its profile extraction status,
 * and its graduation rate with the year it describes (from lineage, never a hard-coded year). Callers check
 * requireAdmin() first (the page does).
 */
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { catalogCourse } from "@/lib/chances/catalog";
import { offeringFor } from "@/lib/chances/rigor-server";
import type { OfferingView } from "@/lib/chances/rigor-view";
import { getHighSchool } from "@/lib/high-schools";
import type { HighSchoolView } from "@/lib/high-school-types";
import { citeHsView } from "@/lib/hs-fields";
import { pct } from "@/lib/format";
import { courseCountRows, type CourseCountRow } from "./hidden";

export interface AdminHighSchool {
  view: HighSchoolView;
  /** Every pooled count, most students first, marked against the three-student line; null when the read failed. */
  counts: CourseCountRow[] | null;
  countsError: string | null;
  offering: OfferingView | null;
  /** The school's own profile, when the hs-profile pipeline read one: where, when retrieved, which edition. */
  profile: { url: string; retrieved: string; label: string } | null;
  /** The four-year graduation rate as shown, with the class it describes (lineage). */
  gradRate: { display: string; year: string | null; source: string } | null;
}

function gradRateText(g: HighSchoolView["school"]["grad_rate"]): string | null {
  if (!g) return null;
  if (g.value !== null) return pct(g.value);
  if (g.low !== null && g.high !== null) return `${pct(g.low)}–${pct(g.high)}`;
  if (g.low !== null) return `${pct(g.low)} or more`;
  if (g.high !== null) return `${pct(g.high)} or less`;
  return null;
}

/** The high school's console view, or null for an unknown id. */
export async function adminHighSchool(id: string): Promise<AdminHighSchool | null> {
  await requireAdmin();
  const view = await getHighSchool(id);
  if (!view) return null;
  const supabase = await adminSupabase();
  const [countsRes, offering] = await Promise.all([
    supabase.from("school_course_counts").select("course_key, students").eq("high_school_id", id),
    offeringFor(id).catch(() => ({ view: null })),
  ]);
  const counts = countsRes.error ? null : courseCountRows((countsRes.data ?? []) as { course_key: string; students: number }[], (key) => catalogCourse(key)?.name ?? null);
  const detail = view.detail;
  const grad = gradRateText(view.school.grad_rate);
  const gradCite = grad ? citeHsView("grad_rate", view) : null;
  return {
    view,
    counts,
    countsError: countsRes.error ? countsRes.error.message : null,
    offering: offering.view,
    profile: detail ? { url: detail.profile.url, retrieved: detail.profile.retrieved, label: `Profile ${detail.profile.edition}` } : null,
    gradRate: grad && gradCite ? { display: grad, year: gradCite.year, source: gradCite.label } : null,
  };
}
