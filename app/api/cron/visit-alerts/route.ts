import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient } from "@/lib/supabase";
import { emailConfigured, sendEmail } from "@/lib/email";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import { getHighSchool } from "@/lib/high-schools";
import { trackServer } from "@/lib/analytics-server";
import { selectAlerts, type AlertPlan } from "@/lib/visit-events/alerts";
import { buildVisitAlert, type VisitAlertCollegeInfo } from "@/lib/emails/visit-alert";
import { measuringPoint, type HighSchoolPoint, type HomePoint, type MeasuringPoint } from "@/lib/visit-events/measure";
import { VISIT_EVENT_COLUMNS, type MeasureFrom, type RadiusMiles, type VisitEventRow } from "@/lib/visit-events/types";

/**
 * The nightly visit alert (specs/product/visit-events.md, "Alerting"). Vercel Cron issues a GET with
 * `Authorization: Bearer $CRON_SECRET` at 13:00 UTC (vercel.json), after the night's read; POST is exported too so it
 * can be run by hand. Uses the secret key, like app/api/cron/digests/route.ts, because it reads every follower's rows.
 *
 * Reads the events first seen or changed in the last 24 hours, the follows of those colleges, the followers' mutes,
 * prefs, unsubscribe tokens, homes, and students' high schools; lib/visit-events/alerts.ts decides who gets what;
 * lib/emails/visit-alert.ts renders it; one email per person, recorded in `visit_alerts` only once sent. Nobody gets a
 * second alert within 20 hours, so a rerun (or a retry after a crash) never doubles up.
 *
 * When RESEND_API_KEY/EMAIL_FROM aren't set, it returns `{ configured: false }` without reading anything (like the
 * digest). `?dry=1` runs the selection and renders every email without sending or recording anything, and returns the
 * rendered messages (for QA; still needs the cron secret and the database key).
 */

/** Hours since a person's last visit alert before they can get another (a night is 24; this leaves slack for drift). */
const MIN_GAP_HOURS = 20;
const WINDOW_HOURS = 24;
/** Ids per `.in()` filter, so a long list never makes an over-long URL. */
const CHUNK = 200;

type Client = SupabaseClient;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** Runs `query` for each chunk of ids and concatenates the rows; throws with the table name on an error. */
async function readIn<T>(
  table: string,
  ids: readonly string[],
  query: (ids: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await query(part);
    if (error) throw new Error(`visit-alerts: reading ${table} failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

interface PrefsRow {
  user_id: string;
  email_visit_alerts: boolean;
  radius_miles: RadiusMiles;
  measure_from: MeasureFrom;
  include_online: boolean;
  updated: string;
}

/**
 * Each user's measuring points: the household home (the newest, if they belong to more than one household) and the
 * high schools of their students: their own student record's for a student, every household student's for a
 * guardian. measuringPoint() applies `measure_from` to each pair; a guardian with no home and two located schools
 * gets two points (the alert takes the union).
 */
async function pointsFor(
  client: Client,
  userIds: string[],
  prefs: Map<string, PrefsRow>,
): Promise<{ points: Map<string, MeasuringPoint[]>; homesSetAt: Map<string, string> }> {
  const points = new Map<string, MeasuringPoint[]>();
  const homesSetAt = new Map<string, string>();
  if (!userIds.length) return { points, homesSetAt };

  const ownStudents = await readIn<{ id: string; user_id: string }>("students", userIds, (ids) =>
    client.from("students").select("id, user_id").in("user_id", ids).is("deleted_at", null),
  );
  const ownStudentOf = new Map(ownStudents.map((s) => [s.user_id, s.id]));
  const userOfStudent = new Map(ownStudents.map((s) => [s.id, s.user_id]));

  type Member = { household_id: string; user_id: string | null; student_id: string | null; role: "guardian" | "student" };
  const asGuardian = await readIn<Member>("household_members", userIds, (ids) =>
    client.from("household_members").select("household_id, user_id, student_id, role").eq("status", "active").in("user_id", ids),
  );
  const asStudent = await readIn<Member>("household_members", [...userOfStudent.keys()], (ids) =>
    client.from("household_members").select("household_id, user_id, student_id, role").eq("status", "active").in("student_id", ids),
  );
  const householdsOf = new Map<string, Set<string>>();
  const add = (user: string, household: string) => {
    if (!householdsOf.has(user)) householdsOf.set(user, new Set());
    householdsOf.get(user)!.add(household);
  };
  for (const m of asGuardian) if (m.user_id) add(m.user_id, m.household_id);
  for (const m of asStudent) if (m.student_id && userOfStudent.has(m.student_id)) add(userOfStudent.get(m.student_id)!, m.household_id);
  const householdIds = [...new Set([...householdsOf.values()].flatMap((s) => [...s]))];

  const homes = await readIn<{ household_id: string; lat: number; lng: number; place: string; updated_at: string }>("household_homes", householdIds, (ids) =>
    client.from("household_homes").select("household_id, lat, lng, place, updated_at").in("household_id", ids),
  );
  const homeOf = new Map(homes.map((h) => [h.household_id, h]));

  // Guardians measure from every student in their households; a student from their own record.
  const householdStudents = await readIn<Member>("household_members", householdIds, (ids) =>
    client.from("household_members").select("household_id, user_id, student_id, role").eq("status", "active").eq("role", "student").in("household_id", ids),
  );
  const studentsOfHousehold = new Map<string, string[]>();
  for (const m of householdStudents) if (m.student_id) studentsOfHousehold.set(m.household_id, [...(studentsOfHousehold.get(m.household_id) ?? []), m.student_id]);

  const studentIds = [...new Set([...ownStudents.map((s) => s.id), ...householdStudents.flatMap((m) => (m.student_id ? [m.student_id] : []))])];
  const profiles = await readIn<{ student_id: string; hs: string | null }>("student_profiles", studentIds, (ids) =>
    client.from("student_profiles").select("student_id, hs:data->basics->>highSchoolId").in("student_id", ids),
  );
  const schoolIdOf = new Map(profiles.filter((p) => p.hs).map((p) => [p.student_id, p.hs!]));
  const schoolPoint = new Map<string, HighSchoolPoint | null>();
  for (const id of new Set(schoolIdOf.values())) {
    const view = await getHighSchool(id);
    const s = view?.school;
    schoolPoint.set(id, s && s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng, name: s.name, city: s.city, state: s.state } : null);
  }

  for (const userId of userIds) {
    const households = [...(householdsOf.get(userId) ?? [])];
    const home = households
      .map((h) => homeOf.get(h))
      .filter((h): h is NonNullable<typeof h> => Boolean(h))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const homePoint: HomePoint | null = home ? { lat: home.lat, lng: home.lng, place: home.place } : null;
    if (home) homesSetAt.set(userId, home.updated_at);

    const own = ownStudentOf.get(userId);
    const students = own ? [own] : households.flatMap((h) => studentsOfHousehold.get(h) ?? []);
    const schools = [...new Set(students.map((s) => schoolIdOf.get(s)).filter((s): s is string => Boolean(s)))]
      .map((id) => schoolPoint.get(id))
      .filter((p): p is HighSchoolPoint => Boolean(p));

    const measureFrom = prefs.get(userId)?.measure_from ?? "auto";
    const candidates = (schools.length ? schools : [null]).map((school) => measuringPoint(measureFrom, homePoint, school));
    const seen = new Set<string>();
    const unique: MeasuringPoint[] = [];
    for (const p of candidates) {
      if (!p) continue;
      const key = `${p.lat},${p.lng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }
    if (unique.length) points.set(userId, unique);
  }
  return { points, homesSetAt };
}

async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  // No email, nothing to do: stop before touching the database (the secret key stays out of Vercel until email is set up).
  if (!dry && !emailConfigured()) {
    console.info("visit-alerts: email not configured; nothing to do.");
    return Response.json({ configured: false });
  }

  try {
    return Response.json(await alert(supabaseClient("publish"), request.nextUrl.origin, dry));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;

async function alert(client: Client, siteUrl: string, dry: boolean) {
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
  const sinceIso = since.toISOString();

  const { data: eventRows, error: eventsError } = await client
    .from("visit_events")
    .select(VISIT_EVENT_COLUMNS)
    .is("removed_at", null)
    .neq("kind", "staff")
    .gte("starts_at", now.toISOString())
    .or(`first_seen.gte.${sinceIso},changed_at.gte.${sinceIso}`);
  if (eventsError) throw new Error(`visit-alerts: reading visit_events failed: ${eventsError.message}`);
  const events = (eventRows ?? []) as unknown as VisitEventRow[];
  const unitIds = [...new Set(events.map((e) => e.unit_id))];

  const empty = { configured: !dry, dry, events: events.length, candidates: 0, sent: 0, recorded: 0, errors: 0, skipped: { noPoint: 0, unsubscribed: 0, firstNight: 0, nothingNear: 0, alreadySent: 0 } };
  if (!unitIds.length) return empty;

  const [follows, hosts] = await Promise.all([
    readIn<{ user_id: string; unit_id: string }>("follows", unitIds, (ids) => client.from("follows").select("user_id, unit_id").in("unit_id", ids)),
    readIn<{ unit_id: string; first_seen: string }>("slate_hosts", unitIds, (ids) => client.from("slate_hosts").select("unit_id, first_seen").in("unit_id", ids)),
  ]);
  const userIds = [...new Set(follows.map((f) => f.user_id))];
  if (!userIds.length) return empty;

  const [mutes, prefRows, tokenRows, recent] = await Promise.all([
    readIn<{ user_id: string; unit_id: string }>("visit_alert_mutes", userIds, (ids) => client.from("visit_alert_mutes").select("user_id, unit_id").in("user_id", ids)),
    readIn<PrefsRow>("visit_alert_prefs", userIds, (ids) =>
      client.from("visit_alert_prefs").select("user_id, email_visit_alerts, radius_miles, measure_from, include_online, updated").in("user_id", ids),
    ),
    readIn<{ user_id: string; unsubscribe_token: string }>("notification_prefs", userIds, (ids) => client.from("notification_prefs").select("user_id, unsubscribe_token").in("user_id", ids)),
    readIn<{ user_id: string }>("visit_alerts", userIds, (ids) =>
      client.from("visit_alerts").select("user_id").gte("sent_at", new Date(now.getTime() - MIN_GAP_HOURS * 3_600_000).toISOString()).in("user_id", ids),
    ),
  ]);
  const prefs = new Map(prefRows.map((p) => [p.user_id, p]));
  const { points, homesSetAt } = await pointsFor(client, userIds, prefs);

  const selection = selectAlerts({
    now,
    since,
    events,
    follows,
    mutes,
    prefs: prefRows,
    points,
    homesSetAt,
    unsubscribeTokens: new Map(tokenRows.map((t) => [t.user_id, t.unsubscribe_token])),
    hostsFirstSeen: new Map(hosts.map((h) => [h.unit_id, h.first_seen])),
  });

  const alreadySent = new Set(recent.map((r) => r.user_id));
  const plans: AlertPlan[] = [];
  let skippedRecent = 0;
  for (const plan of selection.plans) {
    if (alreadySent.has(plan.userId)) skippedRecent++;
    else plans.push(plan);
  }

  // College names come from the dataset the deploy carries (lib/data.ts), like the digest.
  const { getSchoolsByIds } = await getData();
  const names = new Map<string, VisitAlertCollegeInfo>(
    getSchoolsByIds([...new Set(plans.flatMap((p) => p.colleges.map((c) => c.unitId)))]).map((s) => [s.unit_id, { name: s.name, short: shortName(s) }]),
  );

  let sent = 0;
  let recorded = 0;
  let errors = 0;
  const previews: { userId: string; subject: string; text: string; html: string }[] = [];

  for (const plan of plans) {
    const built = buildVisitAlert({ plan, colleges: names, siteUrl });
    if (dry) {
      previews.push({ userId: plan.userId, subject: built.subject, text: built.text, html: built.html });
      continue;
    }
    const { data: userRes, error: userError } = await client.auth.admin.getUserById(plan.userId);
    const email = userError ? null : (userRes.user?.email ?? null);
    if (!email) {
      console.error(`visit-alerts: no email for user ${plan.userId}: ${userError?.message ?? "no email on the account"}.`);
      errors++;
      continue;
    }
    const result = await sendEmail({ to: email, subject: built.subject, html: built.html, text: built.text, headers: built.headers });
    if (!result.sent) {
      // Logged by sendEmail; tomorrow's run looks at tomorrow's window, so a failed send is not retried.
      errors++;
      continue;
    }
    sent++;
    const { error: insertError } = await client.from("visit_alerts").insert({
      user_id: plan.userId,
      sent_at: new Date().toISOString(),
      event_ids: plan.eventIds,
      college_count: built.collegeCount,
      provider_message_id: result.id,
    });
    if (insertError) console.error(`visit-alerts: sent to ${plan.userId} but recording it failed: ${insertError.message}`);
    else recorded++;
    await trackServer("visit_alert_sent", { college_count: built.collegeCount, event_count: built.eventCount }, plan.userId);
  }

  return {
    ...empty,
    candidates: selection.candidates,
    sent,
    recorded,
    errors,
    skipped: { ...selection.skipped, alreadySent: skippedRecent },
    ...(dry ? { previews } : {}),
  };
}
