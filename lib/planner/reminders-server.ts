import "server-only";
/**
 * The reminders' server side (specs/planner/timeline.md "Reminders", "Texts"): reads across users with the secret-key
 * client (the cron jobs, and the consent flow's confirmation text), so it never runs with a person's session and is
 * never imported by client code. The rules live in the pure modules (lib/planner/timeline.ts, lib/sms.ts); this file
 * only gathers rows and records what was sent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getData } from "@/lib/data";
import { canText, composeConfirmText, localDay, send, smsConfigured, timeZonesFor } from "@/lib/sms";
import { effectiveGradYear, type StudentProfileBasics } from "@/lib/student-profile";
import { shortDay } from "./generators/college";
import { readTaskRows } from "./read-plan";
import { seasonOf, type Season } from "./seasons";
import { changedCollegeMoves, collegeNames, dueSoon, outsideTitle } from "./timeline";
import type { PlanTask } from "./types";

export interface ListTasks {
  listId: string;
  tasks: PlanTask[];
  /** College name by item id. */
  names: Record<string, string>;
  /** College (unit id) by item id. */
  units: Record<string, string>;
}

/**
 * A list's tasks and its colleges' names (the dataset carries the names, not the database). Tasks are read with the
 * move columns, and without them before the next-steps migration (read-plan.ts readTaskRows).
 */
export async function readListTasks(client: SupabaseClient, listId: string): Promise<ListTasks> {
  const [tasks, items] = await Promise.all([readTaskRows(client, listId), client.from("list_items").select("id, unit_id").eq("list_id", listId)]);
  if (tasks.error) throw new Error(`reminders: reading tasks failed: ${tasks.error.message}`);
  if (items.error) throw new Error(`reminders: reading items failed: ${items.error.message}`);
  const rows = (items.data ?? []) as { id: string; unit_id: string }[];
  const { getSchoolsByIds } = await getData();
  const byUnit = Object.fromEntries(getSchoolsByIds(rows.map((r) => r.unit_id)).map((s) => [s.unit_id, s.name]));
  return { listId, tasks: tasks.data ?? [], names: collegeNames(rows, byUnit), units: Object.fromEntries(rows.map((r) => [r.id, r.unit_id])) };
}

export interface StudentMoves extends ListTasks {
  studentId: string;
  /** The effective class year: the profile's, else the student record's. */
  gradYear: number | null;
  season: Season;
}

/**
 * One student's moves across users (the weekly job): the default list's tasks and names, the class year the plan
 * uses (lib/planner/load.ts reads it the same way), and the season on `today`. Null without a default list.
 */
export async function readStudentMoves(client: SupabaseClient, student: { id: string; grad_year: number | null }, today: string): Promise<StudentMoves | null> {
  const [list, profile] = await Promise.all([
    client.from("lists").select("id").eq("student_id", student.id).eq("is_default", true).maybeSingle(),
    client.from("student_profiles").select("data").eq("student_id", student.id).maybeSingle(),
  ]);
  const listId = (list.data as { id: string } | null)?.id;
  if (!listId) return null;
  const basics = ((profile.data as { data: { basics?: Partial<StudentProfileBasics> } | null } | null)?.data?.basics ?? {}) as Pick<StudentProfileBasics, "gradYear">;
  const gradYear = effectiveGradYear({ gradYear: basics.gradYear ?? null }, student.grad_year);
  const plan = await readListTasks(client, listId);
  return { ...plan, studentId: student.id, gradYear, season: seasonOf(gradYear, today) };
}

/** The brief turns already sent to this person for this student (season_briefs_sent; season:cycle_start keys). Null when the table isn't there. */
export async function briefsSent(client: SupabaseClient, userId: string, studentId: string): Promise<Set<string> | null> {
  const { data, error } = await client.from("season_briefs_sent").select("season, cycle_start").eq("user_id", userId).eq("student_id", studentId);
  if (error) return null;
  return new Set(((data ?? []) as { season: string; cycle_start: number }[]).map((r) => `${r.season}:${r.cycle_start}`));
}

/** Records a sent brief (after the send). A duplicate is ignored: the turn is sent either way. */
export async function recordBriefSent(client: SupabaseClient, row: { userId: string; studentId: string; season: string; cycleStart: number }): Promise<void> {
  const { error } = await client
    .from("season_briefs_sent")
    .upsert({ user_id: row.userId, student_id: row.studentId, season: row.season, cycle_start: row.cycleStart }, { onConflict: "user_id,student_id,season,cycle_start", ignoreDuplicates: true });
  if (error) console.error(`reminders: recording a season brief failed: ${error.message}`);
}

/** The lists a user's digest covers: their own and their student record's (the lists they follow colleges from). */
export async function listsForUser(client: SupabaseClient, userId: string): Promise<string[]> {
  const student = await client.from("students").select("id").eq("user_id", userId).is("deleted_at", null).maybeSingle();
  const studentId = (student.data as { id: string } | null)?.id ?? null;
  const filter = studentId ? `user_id.eq.${userId},student_id.eq.${studentId}` : `user_id.eq.${userId}`;
  const { data, error } = await client.from("lists").select("id").or(filter);
  if (error) throw new Error(`reminders: reading lists failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * The digest's "Coming up" lines for a user: tasks due within seven days on their lists, titles and dates only. With
 * the publish's changed colleges (next-steps notifications.md "Channels"), a move that change created or closed for
 * one of them comes first, its title as the line; the digest keeps its five-line cap (lib/digest.ts).
 */
export async function digestTaskLines(
  client: SupabaseClient,
  userId: string,
  today: string,
  changed?: { unitIds: readonly string[]; since: string },
): Promise<{ title: string; when: string }[]> {
  const moveLines: { title: string; when: string }[] = [];
  const lines: { title: string; when: string; date: string }[] = [];
  const changedSet = new Set(changed?.unitIds ?? []);
  for (const listId of await listsForUser(client, userId)) {
    const { tasks, names, units } = await readListTasks(client, listId);
    const shown = new Set<string>();
    const nameOf = (t: PlanTask) => (t.item_id ? (names[t.item_id] ?? null) : null);
    if (changed && changedSet.size) {
      for (const { task, closed } of changedCollegeMoves(tasks, units, changedSet, changed.since, today)) {
        shown.add(task.id);
        const d = task.due_on ?? task.window_end;
        moveLines.push({ title: outsideTitle(task, nameOf(task)), when: closed ? "no longer needed" : d ? shortDay(d) : "new in your advisor" });
      }
    }
    for (const t of dueSoon(tasks, today)) {
      if (shown.has(t.id)) continue;
      const date = t.due_on ?? t.window_end!;
      lines.push({ title: outsideTitle(t, nameOf(t)), when: shortDay(date), date });
    }
  }
  return [...moveLines, ...lines.sort((a, b) => a.date.localeCompare(b.date)).map(({ title, when }) => ({ title, when }))];
}

/* ------------------------------------------------------------------ */
/* Texts                                                               */
/* ------------------------------------------------------------------ */

export interface ConsentRow {
  id: string;
  user_id: string | null;
  student_id: string | null;
  phone: string;
  revoked_at: string | null;
  provider_opt_out_at: string | null;
}

export const CONSENT_COLUMNS = "id, user_id, student_id, phone, revoked_at, provider_opt_out_at";

/** The time zones a person's texts respect: their household's home address, else their phone's area code. */
export async function zonesForConsent(client: SupabaseClient, consent: ConsentRow): Promise<string[]> {
  const member = consent.student_id
    ? await client.from("household_members").select("household_id").eq("student_id", consent.student_id).eq("status", "active").limit(1).maybeSingle()
    : await client.from("household_members").select("household_id").eq("user_id", consent.user_id!).eq("status", "active").limit(1).maybeSingle();
  const householdId = (member.data as { household_id: string } | null)?.household_id ?? null;
  let home: { label: string | null; place: string | null } | null = null;
  if (householdId) {
    const { data } = await client.from("household_homes").select("label, place").eq("household_id", householdId).maybeSingle();
    home = (data as { label: string | null; place: string | null } | null) ?? null;
  }
  return timeZonesFor({ homeLabel: home?.label, homePlace: home?.place, phone: consent.phone });
}

export type DeliverResult = { sent: boolean; kind: "confirm" | "week" | "day_before" | "nudge" | "parent" | null; reason?: string };

/**
 * Sends one text under every rule: an active consent, outside quiet hours, the first text being the confirmation, and
 * at most one a day (claimed in sms_sends by its unique (consent, day) index before sending, released if the send
 * fails). Dormant without the Twilio env: logs and records nothing, so nothing is skipped once texts are set up.
 */
export async function deliverText(
  client: SupabaseClient,
  consent: ConsentRow,
  /** "confirm" sends only the confirmation (right after consent); the others send it first when it hasn't gone yet. */
  kind: "confirm" | "week" | "day_before" | "nudge" | "parent",
  body: string,
  opts: { now?: Date; taskId?: string | null; forName?: string | null } = {},
): Promise<DeliverResult> {
  if (!smsConfigured()) {
    console.info(`sms: not configured; would send a ${kind} text.`);
    return { sent: false, kind: null, reason: "not_configured" };
  }
  const now = opts.now ?? new Date();
  const zones = await zonesForConsent(client, consent);
  const day = localDay(now, zones);
  const sends = await client.from("sms_sends").select("kind, sent_on").eq("consent_id", consent.id);
  if (sends.error) return { sent: false, kind: null, reason: sends.error.message };
  const rows = (sends.data ?? []) as { kind: string; sent_on: string }[];
  const verdict = canText({ consent, now, zones, sentDays: rows.map((r) => r.sent_on) });
  if (!verdict.ok) return { sent: false, kind: null, reason: verdict.reason };

  const confirmed = rows.some((r) => r.kind === "confirm");
  if (kind === "confirm" && confirmed) return { sent: false, kind: null, reason: "already_confirmed" };
  const actualKind = confirmed ? kind : "confirm";
  const text = confirmed ? body : composeConfirmText(opts.forName ?? null);
  const claim = await client
    .from("sms_sends")
    .insert({ consent_id: consent.id, kind: actualKind, sent_on: day, task_id: confirmed ? (opts.taskId ?? null) : null })
    .select("id")
    .single();
  if (claim.error) return { sent: false, kind: null, reason: "already_today" };
  const result = await send({ to: consent.phone, body: text });
  const id = (claim.data as { id: number }).id;
  if (!result.sent) {
    await client.from("sms_sends").delete().eq("id", id);
    return { sent: false, kind: null, reason: result.reason };
  }
  if (result.sid) await client.from("sms_sends").update({ provider_sid: result.sid.slice(0, 64) }).eq("id", id);
  return { sent: true, kind: actualKind };
}
