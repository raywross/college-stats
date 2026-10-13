import "server-only";
/**
 * Visit events: server reads (specs/product/visit-events.md "Display", "People's data"). Every read runs with the
 * signed-in user's own Supabase session (`createServerSupabase()`, RLS applies: `visit_events` is signed-in only,
 * never staff, never past), except `countForUnit`, which uses the read client so a signed-out college page can still
 * learn the public count through `visit_event_count()`.
 *
 * The pure pieces (grouping by day, the kind chips, nearest-first, the read-time and signed-out lines) live in
 * ./view.ts, re-exported here so one import path covers both; components/visits/** import ./view.ts directly so
 * client components never pull in Supabase or next/headers.
 */
import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { supabaseClient } from "@/lib/supabase";
import { myFollows } from "@/lib/follows";
import { myHome } from "@/lib/home-store";
import { getHighSchool } from "@/lib/high-schools";
import { profilesICanSee } from "@/lib/student-profile-store";
import {
  DEFAULT_VISIT_ALERT_PREFS,
  VISIT_ALERT_PREFS_COLUMNS,
  VISIT_EVENT_COLUMNS,
  type VisitAlertPrefs,
  type VisitEventRow,
} from "@/lib/visit-events/types";
import { eventDistance, measuringPoint, type HighSchoolPoint, type HomePoint, type MeasuringPoint } from "@/lib/visit-events/measure";

export * from "./view.ts";

/** One `visit_events` row plus the distance from the viewer's measuring point (null: online, or no point). */
export interface EventWithDistance extends VisitEventRow {
  distanceMiles: number | null;
}

/** How many upcoming (non-staff) events a college lists, the one figure a signed-out page may show. */
export async function countForUnit(unitId: string): Promise<number> {
  try {
    const supabase = supabaseClient("read");
    const { data, error } = await supabase.rpc("visit_event_count", { p_unit_id: unitId });
    if (error) {
      console.error(`visit_event_count(${unitId}) failed: ${error.message}`);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error(`visit_event_count(${unitId}): Supabase isn't configured`, err);
    return 0;
  }
}

/** One college's upcoming events, oldest first; `[]` when signed out (RLS lets only `authenticated` read them). */
export async function eventsForUnit(unitId: string, opts: { limit?: number } = {}): Promise<VisitEventRow[]> {
  if (!authConfigured()) return [];
  const user = await getUser();
  if (!user) return [];
  const supabase = await createServerSupabase();
  let query = supabase.from("visit_events").select(VISIT_EVENT_COLUMNS).eq("unit_id", unitId).order("starts_at", { ascending: true });
  if (opts.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) {
    console.error(`visit_events: reading ${unitId} failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as VisitEventRow[];
}

/** The latest `last_seen` among a college's events: "Read from UF's calendar at 3:10 am". Null before any sync. */
export async function readAt(unitId: string): Promise<string | null> {
  if (!authConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("visit_events").select("last_seen").eq("unit_id", unitId).order("last_seen", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    console.error(`visit_events: reading last_seen for ${unitId} failed: ${error.message}`);
    return null;
  }
  return (data as { last_seen: string } | null)?.last_seen ?? null;
}

/** The signed-in user's visit-alert preferences, or the defaults when no row exists yet (the trigger creates one on a first follow). */
export async function myVisitPrefs(): Promise<VisitAlertPrefs> {
  const defaults = (userId: string): VisitAlertPrefs => ({ user_id: userId, ...DEFAULT_VISIT_ALERT_PREFS });
  if (!authConfigured()) return defaults("");
  const user = await getUser();
  if (!user) return defaults("");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("visit_alert_prefs").select(VISIT_ALERT_PREFS_COLUMNS).eq("user_id", user.id).maybeSingle();
  if (error) {
    console.error(`visit_alert_prefs: reading failed: ${error.message}`);
    return defaults(user.id);
  }
  return (data as VisitAlertPrefs | null) ?? defaults(user.id);
}

/** Unit ids the signed-in user has muted from visit alerts. */
export async function myVisitMutes(): Promise<string[]> {
  if (!authConfigured()) return [];
  const user = await getUser();
  if (!user) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("visit_alert_mutes").select("unit_id").eq("user_id", user.id);
  if (error) {
    console.error(`visit_alert_mutes: reading failed: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r: { unit_id: string }) => r.unit_id);
}

/** The student's high school, located, through the profile's highSchoolId; for a guardian, each student in turn (first with a located school wins). */
async function highSchoolPointFor(): Promise<HighSchoolPoint | null> {
  const profiles = await profilesICanSee().catch(() => []);
  for (const p of profiles) {
    const hsId = p.data.basics.highSchoolId;
    if (!hsId) continue;
    const view = await getHighSchool(hsId).catch(() => null);
    const school = view?.school;
    if (school && typeof school.lat === "number" && typeof school.lng === "number") {
      return { lat: school.lat, lng: school.lng, name: school.name, city: school.city, state: school.state };
    }
  }
  return null;
}

/**
 * Where the signed-in user's visit-alert radius is measured from (home, else the student's high school, else null:
 * no radius, pages only). Settings and the college page name the point in use ("Measuring 30 miles from home in
 * Marietta, GA").
 */
export async function myMeasuringPoint(): Promise<MeasuringPoint | null> {
  if (!authConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const [prefs, home, highSchool] = await Promise.all([myVisitPrefs(), myHome(), highSchoolPointFor()]);
  const homePoint: HomePoint | null = home ? { lat: home.lat, lng: home.lng, place: home.place } : null;
  return measuringPoint(prefs.measure_from, homePoint, highSchool);
}

/** Every upcoming event at a college the signed-in user follows, with the distance from their measuring point attached. */
export async function eventsForMe(opts: { limit?: number } = {}): Promise<EventWithDistance[]> {
  if (!authConfigured()) return [];
  const user = await getUser();
  if (!user) return [];
  const follows = await myFollows();
  if (!follows.length) return [];
  const supabase = await createServerSupabase();
  let query = supabase
    .from("visit_events")
    .select(VISIT_EVENT_COLUMNS)
    .in(
      "unit_id",
      follows.map((f) => f.unit_id),
    )
    .order("starts_at", { ascending: true });
  if (opts.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) {
    console.error(`visit_events: reading events for your list failed: ${error.message}`);
    return [];
  }
  const point = await myMeasuringPoint();
  return (data as VisitEventRow[]).map((e) => ({ ...e, distanceMiles: point ? eventDistance(e, point) : null }));
}
