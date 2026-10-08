"use server";
/**
 * The timeline's Server Actions (specs/planner/timeline.md; U5): the calendar feed's tokens, the family's own tasks
 * (edit, delete), a one-time .ics download, the Your week switch, and text consent. Same pattern as
 * lib/planner/store.ts: `ready(capability)` (signed in, the user's own session, `allowed()`), then the write with that
 * session so row-level security decides; `{ ok: true } | { ok: false; message }`; the household pages revalidate.
 *
 * The one exception is the confirmation text after someone turns texts on: it goes out through the secret-key client
 * (lib/planner/reminders-server.ts deliverText) because sms_sends is written only by the server, and it is skipped
 * quietly when texts or the key aren't set up (the weekly job sends it later).
 */
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authConfigured, getAccount, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { getData } from "@/lib/data";
import { supabaseClient } from "@/lib/supabase";
import { myHouseholds } from "@/lib/households";
import { isoDateOrNull } from "@/lib/list-rules";
import { icsCalendar } from "@/lib/ics";
import { trackServer } from "@/lib/analytics-server";
import { SITE_NAME } from "@/lib/brand";
import { consentBy, smsConfigured } from "@/lib/sms";
import { readPlan, todayIso } from "./context";
import { CONSENT_COLUMNS, deliverText, type ConsentRow } from "./reminders-server";
import { collegeNames, feedEvents } from "./timeline";
import type { Assignee } from "./types";

export type TimelineResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): { ok: false; message: string } {
  if (error) console.error(`planner timeline: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ASSIGNEES: readonly Assignee[] = ["student", "guardian", "either"];

/** sha256 hex: what plan_calendar_tokens stores (the token itself is shown once and never kept). */
export async function hashToken(token: string): Promise<string> {
  return createHash("sha256").update(token).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Calendar feed                                                       */
/* ------------------------------------------------------------------ */

/**
 * A new calendar link for a list (any earlier link of this person's for the list stops working). Returns the token
 * once; the page builds `webcal://{host}/api/plan/{token}.ics` from it. Only the hash is stored.
 */
export async function createCalendarToken(listId: string): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.calendar");
  if (!("supabase" in r)) return r;
  await r.supabase.from("plan_calendar_tokens").update({ revoked_at: new Date().toISOString() }).eq("list_id", listId).is("revoked_at", null);
  const token = randomBytes(24).toString("base64url");
  const { error } = await r.supabase.from("plan_calendar_tokens").insert({ list_id: listId, token_hash: await hashToken(token) });
  if (error) return fail(error, "createCalendarToken");
  refresh();
  return { ok: true, token };
}

/** Stops every calendar link this person made for the list. */
export async function revokeCalendarToken(listId: string): Promise<TimelineResult> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.calendar");
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase.from("plan_calendar_tokens").update({ revoked_at: new Date().toISOString() }).eq("list_id", listId).is("revoked_at", null);
  if (error) return fail(error, "revokeCalendarToken");
  refresh();
  return { ok: true };
}

/** The same events as the feed, once, as a file's text (for people who don't want a subscription). */
export async function planIcsOnce(listId: string): Promise<{ ok: true; ics: string; filename: string } | { ok: false; message: string }> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.calendar");
  if (!("supabase" in r)) return r;
  const plan = await readPlan(r.supabase, listId);
  if (!plan) return { ok: false, message: FAILED };
  const { getSchoolsByIds } = await getData();
  const byUnit = Object.fromEntries(getSchoolsByIds(plan.items.map((i) => i.unit_id)).map((s) => [s.unit_id, s.name]));
  const events = feedEvents(
    plan.tasks.filter((t) => t.done_at === null),
    plan.visits,
    collegeNames(plan.items, byUnit),
  );
  return { ok: true, ics: icsCalendar(events, { name: `${SITE_NAME} plan` }), filename: "plan.ics" };
}

/* ------------------------------------------------------------------ */
/* The family's own tasks                                              */
/* ------------------------------------------------------------------ */

/** Changes one of the family's own tasks (title, date, assignee, college); generated tasks aren't editable here. */
export async function editOwnTask(
  taskId: string,
  patch: { title?: string; dueOn?: string | null; assignee?: Assignee; itemId?: string | null },
): Promise<TimelineResult> {
  if (!isUuid(taskId)) return { ok: false, message: FAILED };
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = String(patch.title).trim().slice(0, 200);
    if (!title) return { ok: false, message: "Give the task a name." };
    row.title = title;
  }
  if (patch.dueOn !== undefined) {
    const due = patch.dueOn ? isoDateOrNull(patch.dueOn) : null;
    if (patch.dueOn && !due) return { ok: false, message: "That isn't a date." };
    row.due_on = due;
    row.date_note = due ? "own" : null;
  }
  if (patch.assignee !== undefined) {
    if (!ASSIGNEES.includes(patch.assignee)) return { ok: false, message: FAILED };
    row.assignee = patch.assignee;
  }
  if (patch.itemId !== undefined) {
    if (patch.itemId !== null && !isUuid(patch.itemId)) return { ok: false, message: FAILED };
    row.item_id = patch.itemId;
  }
  if (Object.keys(row).length === 0) return { ok: true };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_tasks").update(row).eq("id", taskId).eq("source", "own").select("id");
  if (error) return fail(error, "editOwnTask");
  if (!data?.length) return { ok: false, message: "Only the family's own tasks can be changed, by someone who can edit the plan." };
  refresh();
  return { ok: true };
}

/** Deletes one of the family's own tasks (generated ones are dismissed instead, so a regeneration doesn't bring them back). */
export async function deleteOwnTask(taskId: string): Promise<TimelineResult> {
  if (!isUuid(taskId)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_tasks").delete().eq("id", taskId).eq("source", "own").select("id");
  if (error) return fail(error, "deleteOwnTask");
  if (!data?.length) return { ok: false, message: "Only the family's own tasks can be deleted, by someone who can edit the plan." };
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Your week                                                           */
/* ------------------------------------------------------------------ */

/** The Your week switch (null: back to the default by grade). */
export async function setYourWeek(on: boolean | null): Promise<TimelineResult> {
  const r = await ready("planner.reminders");
  if (!("supabase" in r)) return r;
  const value = on === null ? null : Boolean(on);
  const { error } = await r.supabase
    .from("notification_prefs")
    .upsert({ user_id: r.userId, your_week: value, updated: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return fail(error, "setYourWeek");
  revalidatePath("/account");
  return { ok: true };
}

/** The stored Your week choice (null: the default by grade applies). */
export async function myYourWeek(): Promise<boolean | null> {
  const r = await ready("planner.reminders");
  if (!("supabase" in r)) return null;
  const { data, error } = await r.supabase.from("notification_prefs").select("your_week").eq("user_id", r.userId).maybeSingle();
  if (error) return null;
  return ((data as { your_week: boolean | null } | null)?.your_week ?? null) as boolean | null;
}

/* ------------------------------------------------------------------ */
/* Texts                                                               */
/* ------------------------------------------------------------------ */

/** Whose texts: the signed-in person's own (`self`), or a student's (by id). */
export type ConsentTarget = { kind: "self" } | { kind: "student"; studentId: string };

export interface ConsentView {
  /** Whether texts can be sent on this site at all (the Twilio env is set). */
  configured: boolean;
  /** The active consent, if any. */
  active: { phone: string; consentedAt: string; consentedBy: string | null; byMe: boolean } | null;
  /** A STOP reply turned the last consent off. */
  stoppedByReply: boolean;
  /** The phone a new consent would use (the household record's), or null when there's none. */
  phone: string | null;
  /** Whether the viewer may turn texts on (or off) here; when false, `who` says who can. */
  canChange: boolean;
  who: "self" | "guardian";
}

/** Facts about a student's consent rule: whose consent counts, and the phone on the household record. */
async function studentFacts(r: Ready, studentId: string): Promise<{ by: "self" | "guardian"; isSelf: boolean; phone: string | null; name: string | null } | null> {
  const households = await myHouseholds();
  const member = households.flatMap((h) => h.members).find((m) => m.student_id === studentId);
  if (!member) return null;
  const student = await r.supabase.from("students").select("user_id").eq("id", studentId).maybeSingle();
  const studentUser = (student.data as { user_id: string | null } | null)?.user_id ?? null;
  const isSelf = studentUser === r.userId;
  let birthYear: number | null = null;
  if (isSelf) {
    birthYear = (await getAccount())?.profile.birth_year ?? null;
  } else if (studentUser) {
    // A guardian can't read the student's profile; the age check uses the server's key when it's there, and treats
    // an unknown age as under 18 (a guardian's consent) otherwise.
    try {
      const { data } = await supabaseClient("publish").from("profiles").select("birth_year").eq("id", studentUser).maybeSingle();
      birthYear = (data as { birth_year: number | null } | null)?.birth_year ?? null;
    } catch {
      birthYear = null;
    }
  }
  return { by: consentBy(birthYear, todayIso()), isSelf, phone: member.phone, name: member.display_name?.trim().split(/\s+/)[0] ?? null };
}

async function readConsent(r: Ready, target: ConsentTarget): Promise<{ active: ConsentRow & { consented_at: string; consented_by: string } | null; stopped: boolean }> {
  const q = r.supabase.from("sms_consents").select(`${CONSENT_COLUMNS}, consented_at, consented_by`).order("consented_at", { ascending: false }).limit(5);
  const { data } = target.kind === "self" ? await q.eq("user_id", r.userId) : await q.eq("student_id", target.studentId);
  const rows = (data ?? []) as (ConsentRow & { consented_at: string; consented_by: string })[];
  const active = rows.find((c) => c.revoked_at === null && c.provider_opt_out_at === null) ?? null;
  return { active, stopped: !active && rows[0]?.provider_opt_out_at != null };
}

/** What the consent control shows for the signed-in person or a student. */
export async function consentView(target: ConsentTarget): Promise<ConsentView | null> {
  const r = await ready("planner.texts");
  if (!("supabase" in r)) return null;
  const configured = smsConfigured();
  if (target.kind === "self") {
    const households = await myHouseholds();
    const me = households.map((h) => h.me.guardian).find(Boolean) ?? null;
    const { active, stopped } = await readConsent(r, target);
    return {
      configured,
      active: active ? { phone: active.phone, consentedAt: active.consented_at, consentedBy: null, byMe: true } : null,
      stoppedByReply: stopped,
      phone: me?.phone ?? null,
      canChange: true,
      who: "self",
    };
  }
  if (!isUuid(target.studentId)) return null;
  const facts = await studentFacts(r, target.studentId);
  if (!facts) return null;
  const { active, stopped } = await readConsent(r, target);
  let consentedBy: string | null = null;
  if (active) {
    const households = await myHouseholds();
    const by = households.flatMap((h) => h.members).find((m) => m.user_id === active.consented_by);
    consentedBy = active.consented_by === r.userId ? "you" : (by?.display_name?.trim().split(/\s+/)[0] ?? "a guardian");
  }
  const canChange = facts.by === "self" ? facts.isSelf : !facts.isSelf;
  return {
    configured,
    active: active ? { phone: active.phone, consentedAt: active.consented_at, consentedBy, byMe: active.consented_by === r.userId } : null,
    stoppedByReply: stopped,
    phone: facts.phone,
    canChange,
    who: facts.by,
  };
}

/**
 * Turns texts on: the person's own for an adult, or for a student by the student at 18 or older and by a guardian
 * under 18. The phone is the household record's. The first text is the confirmation with the STOP wording.
 */
export async function setSmsConsent(target: ConsentTarget): Promise<TimelineResult> {
  const r = await ready("planner.texts");
  if (!("supabase" in r)) return r;
  let phone: string | null;
  let row: { user_id?: string; student_id?: string; phone: string };
  let forName: string | null = null;
  let byGuardian = false;
  if (target.kind === "self") {
    const households = await myHouseholds();
    phone = households.map((h) => h.me.guardian?.phone ?? null).find(Boolean) ?? null;
    const account = await getAccount();
    forName = null;
    if (!phone) return { ok: false, message: "Add your phone number on the household page first." };
    if (account && consentBy(account.profile.birth_year, todayIso()) !== "self") return { ok: false, message: "A parent or guardian turns texts on for students under 18." };
    row = { user_id: r.userId, phone };
  } else {
    if (!isUuid(target.studentId)) return { ok: false, message: FAILED };
    const facts = await studentFacts(r, target.studentId);
    if (!facts) return { ok: false, message: FAILED };
    if (facts.by === "guardian" && facts.isSelf) return { ok: false, message: "A parent or guardian turns texts on for students under 18." };
    if (facts.by === "self" && !facts.isSelf) return { ok: false, message: "Students 18 and older turn texts on for themselves." };
    phone = facts.phone;
    if (!phone) return { ok: false, message: "Add a phone number for them on the household page first." };
    row = { student_id: target.studentId, phone };
    forName = facts.isSelf ? null : facts.name;
    byGuardian = !facts.isSelf;
  }
  const { data, error } = await r.supabase.from("sms_consents").insert(row).select(CONSENT_COLUMNS).single();
  if (error) {
    if (error.code === "23505") return { ok: true }; // already on
    return fail(error, "setSmsConsent");
  }
  await trackServer("plan_text_consented", { by_guardian: byGuardian }, r.userId);
  try {
    await deliverText(supabaseClient("publish"), data as ConsentRow, "confirm", "", { forName });
  } catch (err) {
    console.info(`sms: confirmation deferred to the weekly job (${err instanceof Error ? err.message : err}).`);
  }
  refresh();
  revalidatePath("/account");
  return { ok: true };
}

/** Turns texts off (any active consent for the target). */
export async function revokeSmsConsent(target: ConsentTarget): Promise<TimelineResult> {
  const r = await ready("planner.texts");
  if (!("supabase" in r)) return r;
  if (target.kind === "student" && !isUuid(target.studentId)) return { ok: false, message: FAILED };
  const q = r.supabase.from("sms_consents").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  const { data, error } = target.kind === "self" ? await q.eq("user_id", r.userId).select("id") : await q.eq("student_id", target.studentId).select("id");
  if (error) return fail(error, "revokeSmsConsent");
  if (data?.length) await trackServer("plan_text_opted_out", { via: "account" }, r.userId);
  refresh();
  revalidatePath("/account");
  return { ok: true };
}
