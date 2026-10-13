import "server-only";
/**
 * The console's reads of college views (specs/product/college-views.md): what one person has opened, who has opened one
 * college, views per day, and the individual times behind a drill-in. Each goes through an admin_*() function (admin
 * at aal2 only) with the console header; college names come from the dataset. Server only.
 */
import { getData } from "@/lib/data";
import { adminSupabase } from "@/lib/admin/people";
import { requireAdmin } from "@/lib/admin/auth";

export interface ViewDay {
  day: string;
  signedIn: number;
  signedOut: number;
}

export interface CollegeViewRow {
  unitId: string;
  name: string;
  views: number;
  firstViewed: string;
  lastViewed: string;
}

export interface ViewerRow {
  /** Null for the one row that sums signed-out views. */
  userId: string | null;
  name: string | null;
  email: string | null;
  views: number;
  firstViewed: string;
  lastViewed: string;
}

export interface ViewTime {
  viewedAt: string;
  page: string;
}

/** Days the per-day chart covers. */
export const VIEW_CHART_DAYS = 30;

async function rpc<T>(what: string, fn: string, args: Record<string, unknown>): Promise<T[]> {
  await requireAdmin();
  const supabase = await adminSupabase();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return (data ?? []) as T[];
}

const toDays = (rows: { day: string; signed_in: number | string; signed_out: number | string }[]): ViewDay[] =>
  rows.map((r) => ({ day: r.day, signedIn: Number(r.signed_in), signedOut: Number(r.signed_out) }));

/** Every college one person has opened, most viewed first, and their views per day. */
export async function personCollegeViews(userId: string): Promise<{ colleges: CollegeViewRow[]; total: number; days: ViewDay[] }> {
  const [found, daily, data] = await Promise.all([
    rpc<{ unit_id: string; views: number | string; first_viewed: string; last_viewed: string }>("college views", "admin_user_college_views", { p_user: userId }),
    rpc<{ day: string; signed_in: number | string; signed_out: number | string }>("views per day", "admin_college_views_daily", { p_user: userId, p_days: VIEW_CHART_DAYS }),
    getData(),
  ]);
  const colleges = found.map((r) => ({
    unitId: r.unit_id,
    name: data.getSchoolById(r.unit_id)?.name ?? `College ${r.unit_id}`,
    views: Number(r.views),
    firstViewed: r.first_viewed,
    lastViewed: r.last_viewed,
  }));
  return { colleges, total: colleges.reduce((n, c) => n + c.views, 0), days: toDays(daily) };
}

/** Who has opened one college (signed-out views as one row, last), and its views per day. */
export async function collegeViewers(unitId: string): Promise<{ viewers: ViewerRow[]; total: number; signedOut: number; people: number; days: ViewDay[] }> {
  const [found, daily] = await Promise.all([
    rpc<{ user_id: string | null; name: string | null; email: string | null; views: number | string; first_viewed: string; last_viewed: string }>(
      "college viewers",
      "admin_college_viewers",
      { p_unit: unitId },
    ),
    rpc<{ day: string; signed_in: number | string; signed_out: number | string }>("views per day", "admin_college_views_daily", { p_unit: unitId, p_days: VIEW_CHART_DAYS }),
  ]);
  const viewers = found.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, views: Number(r.views), firstViewed: r.first_viewed, lastViewed: r.last_viewed }));
  return {
    viewers,
    total: viewers.reduce((n, v) => n + v.views, 0),
    signedOut: viewers.find((v) => v.userId === null)?.views ?? 0,
    people: viewers.filter((v) => v.userId !== null).length,
    days: toDays(daily),
  };
}

/** The individual views of one college by one person, or by signed-out visitors (userId null). Newest first. */
export async function viewTimes(unitId: string, userId: string | null): Promise<ViewTime[]> {
  const found = await rpc<{ viewed_at: string; page: string }>("view times", "admin_college_view_times", {
    p_unit: unitId,
    p_user: userId,
    p_signed_out: userId === null,
  });
  return found.map((r) => ({ viewedAt: r.viewed_at, page: r.page }));
}

export interface TopViewedRow {
  unitId: string;
  name: string;
  views: number;
  /** Distinct signed-in people. */
  people: number;
  signedOut: number;
  lastViewed: string;
}

/** The most viewed colleges over the last `days` days (null = all time), most views first. */
export async function topViewedColleges(days: number | null, limit = 10): Promise<TopViewedRow[]> {
  const [found, data] = await Promise.all([
    rpc<{ unit_id: string; views: number | string; people: number | string; signed_out: number | string; last_viewed: string }>("most viewed colleges", "admin_top_viewed_colleges", {
      p_days: days,
      p_limit: limit,
    }),
    getData(),
  ]);
  return found.map((r) => ({
    unitId: r.unit_id,
    name: data.getSchoolById(r.unit_id)?.name ?? `College ${r.unit_id}`,
    views: Number(r.views),
    people: Number(r.people),
    signedOut: Number(r.signed_out),
    lastViewed: r.last_viewed,
  }));
}
