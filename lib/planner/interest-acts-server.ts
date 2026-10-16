import "server-only";
/**
 * Act tracking's writes (specs/planner/v3/guides/show-interest.md; build-plan.md "Act tracking"), shared by the three
 * ways an act is answered: the guide's Server Actions (lib/planner/store-interest.ts, the person's own session, so RLS
 * decides), and the email's token link and the morning job (the secret-key client; app/api/plan/interest/confirm,
 * app/api/cron/interest-confirm). Every function takes the client it writes with, so one code path writes a
 * confirmed act whichever way it was answered.
 *
 * What a confirmed act writes, through the same tables the built stores write (lib/planner/store-actions.ts):
 *   tour / info_session / open_house / fair / event → a `plan_visits` row (registered, the URL that was opened, the
 *     title and place in the notes) and `list_items.visited_on` recomputed; the act keeps the visit's id.
 *   info_request / mailing_list → `list_items.info_requested_on` (today, unless one is already recorded).
 *   follow → the network into `followed_networks` (and `follows_social`).
 *   test_register → the test date into the student's `tests.registeredDates` (and `plannedDates` when it wasn't
 *     there), and the matching `test_register` task ticked.
 * A declined act writes nothing but its own status. The regeneration that closes the interest move is the caller's
 * (a Server Action regenerates at once; after an email answer the plan regenerates on its next open).
 *
 * Imports are relative so tests load this file under plain node (tests/planner-interest-acts.test.mts stubs
 * `server-only`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeProfile } from "../student-profile.ts";
import type { SocialNetwork } from "../types.ts";
import { firstPastVisitOn } from "./actions.ts";
import {
  INTEREST_ACT_COLUMNS,
  isExpired,
  isVisitAct,
  resolutionPatch,
  selectForEmail,
  testOf,
  visitFromAct,
  type ActAnswer,
  type ActResolvedVia,
  type ActStatus,
  type InterestActRow,
} from "./interest-acts.ts";
import type { VisitKind, VisitNotes } from "./types.ts";

type Client = SupabaseClient;

/** What the person can add when confirming: the date they picked (and the rest of the visit form). */
export interface ConfirmExtra {
  visitDate?: string | null;
  visitTime?: string | null;
  kind?: VisitKind | null;
  who?: string[];
  notes?: VisitNotes;
}

export type ResolveOutcome =
  | { kind: "resolved"; answer: ActAnswer; row: InterestActRow; listId: string | null; visitId: string | null }
  | { kind: "already"; status: ActStatus }
  | { kind: "need_date" }
  | { kind: "error"; message: string };

const FAILED = "That didn't work. Try again in a moment.";

/** Each event's own zone (`visit_events.timezone`) by id, for printing and splitting an act's date and time. */
export async function zonesForEvents(client: Client, eventIds: readonly (string | null)[]): Promise<Record<string, string>> {
  const ids = [...new Set(eventIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return {};
  const { data, error } = await client.from("visit_events").select("id, timezone").in("id", ids);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { id: string; timezone: string | null }[]) if (r.timezone) out[r.id] = r.timezone;
  return out;
}

async function listOfItem(client: Client, itemId: string): Promise<string | null> {
  const { data } = await client.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  return (data as { list_id: string } | null)?.list_id ?? null;
}

/** Ticks any open generated task of `kind` for this item (store-actions.ts completeGeneratedTask's rule). */
async function completeGeneratedTask(client: Client, itemId: string, kind: string, now: Date): Promise<void> {
  await client.from("plan_tasks").update({ done_at: now.toISOString() }).eq("item_id", itemId).eq("kind", kind).is("done_at", null);
}

const NOTE_MAX = 2000;

function cleanNotes(notes: VisitNotes | undefined, free: string | null): VisitNotes {
  const out: VisitNotes = {};
  for (const [k, v] of Object.entries(notes ?? {})) {
    if (k === "interviewer_kind") {
      if (v === "alumni" || v === "admissions") out.interviewer_kind = v;
    } else if (typeof v === "string" && v.trim()) {
      (out as Record<string, string>)[k] = v.trim().slice(0, NOTE_MAX);
    }
  }
  if (!out.free && free) out.free = free.slice(0, NOTE_MAX);
  return out;
}

/** The first visit's date rule (lib/planner/actions.ts firstPastVisitOn), after a visit is added. */
async function syncVisitedOn(client: Client, itemId: string, today: string): Promise<void> {
  const { data } = await client.from("plan_visits").select("on_date").eq("item_id", itemId);
  const dates = ((data ?? []) as { on_date: string }[]).map((v) => v.on_date);
  await client.from("list_items").update({ visited_on: firstPastVisitOn(dates, today) }).eq("id", itemId);
}

/**
 * Writes what a confirmed act means (module comment). Returns the list to regenerate and the visit's id; `need_date`
 * when a visit act has no date (an undated tour confirmed without the date the family picked).
 */
export async function writeConfirmedAct(
  client: Client,
  row: InterestActRow,
  extra: ConfirmExtra,
  opts: { now: Date; today: string; timeZone?: string | null },
): Promise<{ ok: true; listId: string | null; visitId: string | null } | { ok: false; needDate?: true; message: string }> {
  if (isVisitAct(row.act)) {
    if (!row.item_id) return { ok: false, message: FAILED };
    const visit = visitFromAct(row, extra, opts.timeZone);
    if (!visit) return { ok: false, needDate: true, message: "Pick the date." };
    const url = /^https?:\/\//.test(row.url) && row.url.length <= 500 ? row.url : null;
    const { data, error } = await client
      .from("plan_visits")
      .insert({
        item_id: row.item_id,
        kind: visit.kind,
        on_date: visit.onDate,
        at_time: visit.atTime,
        registered: true,
        registration_url: url,
        who: (extra.who ?? []).map((w) => String(w).trim().slice(0, 80)).filter(Boolean).slice(0, 8),
        notes: cleanNotes(extra.notes, visit.notesFree),
        created_by: row.user_id,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: FAILED };
    await syncVisitedOn(client, row.item_id, opts.today);
    return { ok: true, listId: await listOfItem(client, row.item_id), visitId: (data as { id: string }).id };
  }

  if (row.act === "info_request" || row.act === "mailing_list") {
    if (!row.item_id) return { ok: false, message: FAILED };
    const { error } = await client.from("list_items").update({ info_requested_on: opts.today }).eq("id", row.item_id).is("info_requested_on", null);
    if (error) return { ok: false, message: FAILED };
    await completeGeneratedTask(client, row.item_id, "request_info", opts.now);
    return { ok: true, listId: await listOfItem(client, row.item_id), visitId: null };
  }

  if (row.act === "follow") {
    if (!row.item_id || !row.network) return { ok: false, message: FAILED };
    const current = await client.from("list_items").select("followed_networks").eq("id", row.item_id).maybeSingle();
    if (current.error || !current.data) return { ok: false, message: FAILED };
    const existing = ((current.data as { followed_networks: SocialNetwork[] | null }).followed_networks ?? []) as SocialNetwork[];
    const next = [...new Set([...existing, row.network])];
    const { error } = await client.from("list_items").update({ followed_networks: next, follows_social: true }).eq("id", row.item_id);
    if (error) return { ok: false, message: FAILED };
    await completeGeneratedTask(client, row.item_id, "follow", opts.now);
    return { ok: true, listId: await listOfItem(client, row.item_id), visitId: null };
  }

  // test_register: the actor's own student record (a test registration is the student's).
  const dateKey = row.event_id && /^(sat|act)_\d{4}_\d{2}$/.test(row.event_id) ? row.event_id : null;
  if (!dateKey || !testOf(row)) return { ok: true, listId: null, visitId: null };
  const student = await client.from("students").select("id").eq("user_id", row.user_id).is("deleted_at", null).maybeSingle();
  const studentId = (student.data as { id: string } | null)?.id ?? null;
  if (!studentId) return { ok: true, listId: null, visitId: null };
  const stored = await client.from("student_profiles").select("data").eq("student_id", studentId).maybeSingle();
  if (stored.error || !stored.data) return { ok: false, message: FAILED };
  const profile = sanitizeProfile((stored.data as { data: unknown }).data);
  const planned = profile.tests.plannedDates.includes(dateKey) ? profile.tests.plannedDates : [...profile.tests.plannedDates, dateKey];
  const next = sanitizeProfile({ ...profile, tests: { ...profile.tests, plannedDates: planned, registeredDates: [...new Set([...profile.tests.registeredDates, dateKey])] } });
  const { error } = await client.from("student_profiles").update({ data: next, updated_at: opts.now.toISOString() }).eq("student_id", studentId);
  if (error) return { ok: false, message: FAILED };
  const list = await client.from("lists").select("id").eq("student_id", studentId).eq("is_default", true).maybeSingle();
  const listId = (list.data as { id: string } | null)?.id ?? null;
  if (listId) await client.from("plan_tasks").update({ done_at: opts.now.toISOString() }).eq("key", `${listId}:test_register:${dateKey}`).is("done_at", null);
  return { ok: true, listId: null, visitId: null };
}

/**
 * Answers one act, once: a resolved or expired act comes back `already` with nothing written. A confirmed act writes
 * first and only then is marked confirmed (guarded on `status = 'pending'`, so two answers at once mark it once).
 */
export async function resolveActRow(
  client: Client,
  row: InterestActRow,
  answer: ActAnswer,
  via: ActResolvedVia,
  extra: ConfirmExtra,
  opts: { now: Date; today: string; timeZone?: string | null },
): Promise<ResolveOutcome> {
  if (row.status !== "pending") return { kind: "already", status: row.status };
  if (isExpired(row, opts.now)) return { kind: "already", status: "expired" };
  const patch = resolutionPatch(row, answer, via, opts.now);
  if (!patch) return { kind: "already", status: row.status };

  let listId: string | null = null;
  let visitId: string | null = null;
  if (answer === "confirmed") {
    const wrote = await writeConfirmedAct(client, row, extra, opts);
    if (!wrote.ok) return wrote.needDate ? { kind: "need_date" } : { kind: "error", message: wrote.message };
    listId = wrote.listId;
    visitId = wrote.visitId;
  }
  const { data, error } = await client
    .from("plan_interest_acts")
    .update({ ...patch, visit_id: visitId })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { kind: "error", message: FAILED };
  if (!data?.length) return { kind: "already", status: "confirmed" };
  return { kind: "resolved", answer, row: { ...row, ...patch, visit_id: visitId }, listId, visitId };
}

/** The pending row a token names (the email's link), or null. */
export async function actByToken(client: Client, token: string): Promise<InterestActRow | null> {
  const { data, error } = await client.from("plan_interest_acts").select(INTEREST_ACT_COLUMNS).eq("confirm_token", token).maybeSingle();
  if (error) return null;
  return (data as InterestActRow | null) ?? null;
}

/** Pages through every pending act (PostgREST caps an unordered read at 1,000 rows). */
async function pendingRows(client: Client): Promise<InterestActRow[]> {
  const out: InterestActRow[] = [];
  const PAGE = 1000;
  let last: string | null = null;
  for (;;) {
    let q = client.from("plan_interest_acts").select(INTEREST_ACT_COLUMNS).eq("status", "pending");
    if (last !== null) q = q.gt("id", last);
    const { data, error } = await q.order("id").limit(PAGE);
    if (error) throw new Error(`interest-confirm: reading plan_interest_acts failed: ${error.message}`);
    const rows = (data ?? []) as unknown as InterestActRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].id;
  }
  return out;
}

/**
 * Marks every pending act past its window `expired` (7 days after its event, 14 after an undated click). Kept in the
 * table, dropped from every view, never on the calendar. Returns the rows it expired (for the telemetry).
 */
export async function expireInterestActs(client: Client, now: Date, rows?: readonly InterestActRow[]): Promise<InterestActRow[]> {
  const pending = rows ?? (await pendingRows(client));
  const due = pending.filter((r) => isExpired(r, now));
  const expired: InterestActRow[] = [];
  for (let i = 0; i < due.length; i += 200) {
    const part = due.slice(i, i + 200);
    const { data, error } = await client
      .from("plan_interest_acts")
      .update({ status: "expired", resolved_at: now.toISOString() })
      .in(
        "id",
        part.map((r) => r.id),
      )
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(`interest-confirm: expiring acts failed: ${error.message}`);
    const ids = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    expired.push(...part.filter((r) => ids.has(r.id)));
  }
  return expired;
}

/* ------------------------------------------------------------------ */
/* The morning job                                                      */
/* ------------------------------------------------------------------ */

export interface ConfirmEmail {
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface InterestConfirmDeps {
  now: Date;
  siteUrl: string;
  /** Render and return the emails; send nothing, write nothing (the expiry included). */
  dry: boolean;
  /** College names by unit id (the dataset the deploy carries). */
  namesFor: (unitIds: string[]) => Promise<Map<string, string>> | Map<string, string>;
  build: (input: { acts: InterestActRow[]; names: Record<string, string>; zones: Record<string, string>; siteUrl: string; unsubscribeUrl: string; now: Date }) => ConfirmEmail | null;
  emailOf: (userId: string) => Promise<string | null>;
  send: (message: { to: string } & ConfirmEmail) => Promise<{ sent: boolean }>;
  track?: (event: "plan_interest_expired" | "interest_confirm_sent", properties: Record<string, string | number>, userId: string) => Promise<void> | void;
}

export interface InterestConfirmSummary {
  dry: boolean;
  expired: number;
  people: number;
  sent: number;
  errors: number;
  skipped: { unsubscribed: number; noEmail: number; nothing: number };
  previews?: { userId: string; subject: string; text: string; html: string }[];
}

/**
 * The job (spec "The confirmation email"): expire first, then every act still pending, unemailed, and clicked before
 * today, grouped by person: one email each, `emailed_at` set only after a real send. A person who turned plan reminders
 * off (`notification_prefs.your_week = false`) is skipped; the acts stay pending for the prompt and the guide.
 */
export async function runInterestConfirm(client: Client, deps: InterestConfirmDeps): Promise<InterestConfirmSummary> {
  const { now, dry } = deps;
  const pending = await pendingRows(client);
  const summary: InterestConfirmSummary = { dry, expired: 0, people: 0, sent: 0, errors: 0, skipped: { unsubscribed: 0, noEmail: 0, nothing: 0 } };

  if (dry) {
    summary.expired = pending.filter((r) => isExpired(r, now)).length;
  } else {
    const expired = await expireInterestActs(client, now, pending);
    summary.expired = expired.length;
    for (const r of expired) await deps.track?.("plan_interest_expired", { action: r.act }, r.user_id);
  }

  const byUser = selectForEmail(pending, now);
  summary.people = byUser.size;
  if (!byUser.size) return summary;

  const userIds = [...byUser.keys()];
  const all = [...byUser.values()].flat();
  const itemIds = [...new Set(all.map((r) => r.item_id).filter((id): id is string => Boolean(id)))];
  const [prefsRes, itemsRes, zones] = await Promise.all([
    client.from("notification_prefs").select("user_id, your_week, unsubscribe_token").in("user_id", userIds),
    itemIds.length ? client.from("list_items").select("id, unit_id").in("id", itemIds) : Promise.resolve({ data: [], error: null }),
    zonesForEvents(
      client,
      all.map((r) => r.event_id),
    ),
  ]);
  if (prefsRes.error) throw new Error(`interest-confirm: reading notification_prefs failed: ${prefsRes.error.message}`);
  if (itemsRes.error) throw new Error(`interest-confirm: reading list_items failed: ${itemsRes.error.message}`);
  const prefs = new Map(((prefsRes.data ?? []) as { user_id: string; your_week: boolean | null; unsubscribe_token: string }[]).map((p) => [p.user_id, p]));
  const unitOf = new Map(((itemsRes.data ?? []) as { id: string; unit_id: string }[]).map((r) => [r.id, r.unit_id]));
  const unitNames = await deps.namesFor([...new Set(unitOf.values())]);
  const names: Record<string, string> = {};
  for (const [itemId, unitId] of unitOf) {
    const name = unitNames.get(unitId);
    if (name) names[itemId] = name;
  }

  const previews: NonNullable<InterestConfirmSummary["previews"]> = [];
  for (const [userId, acts] of byUser) {
    let pref = prefs.get(userId) ?? null;
    if (pref?.your_week === false) {
      summary.skipped.unsubscribed++;
      continue;
    }
    if (!pref && !dry) {
      const created = await client.from("notification_prefs").upsert({ user_id: userId }, { onConflict: "user_id" }).select("user_id, your_week, unsubscribe_token").single();
      if (created.error || !created.data) {
        summary.errors++;
        continue;
      }
      pref = created.data as { user_id: string; your_week: boolean | null; unsubscribe_token: string };
    }
    const unsubscribeUrl = `${deps.siteUrl.replace(/\/$/, "")}/unsubscribe/${pref?.unsubscribe_token ?? "preview"}/week`;
    const built = deps.build({ acts, names, zones, siteUrl: deps.siteUrl, unsubscribeUrl, now });
    if (!built) {
      summary.skipped.nothing++;
      continue;
    }
    if (dry) {
      previews.push({ userId, subject: built.subject, text: built.text, html: built.html });
      continue;
    }
    const to = await deps.emailOf(userId);
    if (!to) {
      summary.skipped.noEmail++;
      continue;
    }
    const result = await deps.send({ to, ...built });
    if (!result.sent) {
      summary.errors++;
      continue;
    }
    summary.sent++;
    const { error } = await client
      .from("plan_interest_acts")
      .update({ emailed_at: new Date().toISOString() })
      .in(
        "id",
        acts.map((a) => a.id),
      );
    if (error) console.error(`interest-confirm: sent to ${userId} but recording it failed: ${error.message}`);
    await deps.track?.("interest_confirm_sent", { acts: acts.length }, userId);
  }
  if (dry) summary.previews = previews;
  return summary;
}
