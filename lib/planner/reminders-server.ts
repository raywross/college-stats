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
import { PLAN_TASK_COLUMNS } from "./context";
import { shortDay } from "./generators/college";
import { collegeNames, dueSoon, outsideTitle } from "./timeline";
import type { PlanTask } from "./types";

export interface ListTasks {
  listId: string;
  tasks: PlanTask[];
  /** College name by item id. */
  names: Record<string, string>;
}

/** A list's tasks and its colleges' names (the dataset carries the names, not the database). */
export async function readListTasks(client: SupabaseClient, listId: string): Promise<ListTasks> {
  const [tasks, items] = await Promise.all([
    client.from("plan_tasks").select(PLAN_TASK_COLUMNS).eq("list_id", listId),
    client.from("list_items").select("id, unit_id").eq("list_id", listId),
  ]);
  if (tasks.error) throw new Error(`reminders: reading tasks failed: ${tasks.error.message}`);
  if (items.error) throw new Error(`reminders: reading items failed: ${items.error.message}`);
  const rows = (items.data ?? []) as { id: string; unit_id: string }[];
  const { getSchoolsByIds } = await getData();
  const byUnit = Object.fromEntries(getSchoolsByIds(rows.map((r) => r.unit_id)).map((s) => [s.unit_id, s.name]));
  return { listId, tasks: (tasks.data ?? []) as PlanTask[], names: collegeNames(rows, byUnit) };
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

/** The digest's "Coming up" lines for a user: tasks due within seven days on their lists, titles and dates only. */
export async function digestTaskLines(client: SupabaseClient, userId: string, today: string): Promise<{ title: string; when: string }[]> {
  const lines: { title: string; when: string; date: string }[] = [];
  for (const listId of await listsForUser(client, userId)) {
    const { tasks, names } = await readListTasks(client, listId);
    for (const t of dueSoon(tasks, today)) {
      const date = t.due_on ?? t.window_end!;
      lines.push({ title: outsideTitle(t, t.item_id ? (names[t.item_id] ?? null) : null), when: shortDay(date), date });
    }
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date)).map(({ title, when }) => ({ title, when }));
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
