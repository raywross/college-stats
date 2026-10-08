"use server";
/**
 * The parent view's Server Actions (specs/planner/parents.md). Same pattern as lib/planner/store.ts: `ready()`
 * (signed in, the user's own Supabase session, `allowed()`), then the write with that session so row-level
 * security decides (`send_nudge()`, supabase/migrations/20261008120000_planner.sql §6). Returns
 * `{ ok: true, … } | { ok: false; reason; message }` and revalidates the household pages.
 *
 * Nudges: `sendNudge` calls `send_nudge()`, which already enforces the rate limit and who may nudge whom; this file
 * only maps its error codes to the spec's button copy, then attempts best-effort delivery (email when the student
 * hasn't turned nudge emails off and the site has email configured, text when they have texts on) the same way
 * store-timeline.ts's setSmsConsent sends the confirmation text: through `deliverText` with the secret-key client,
 * inside this user-session action, best effort (a delivery failure never undoes the nudge, which is already
 * recorded and visible in the plan).
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser, studentsICanSee } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { supabaseClient } from "@/lib/supabase";
import { emailConfigured, sendEmail } from "@/lib/email";
import { PLAN_TASK_COLUMNS } from "./context";
import { CONSENT_COLUMNS, deliverText, type ConsentRow } from "./reminders-server";
import type { Assignee, PlanNudge, PlanTask } from "./types";

export type NudgeReason =
  | "not_signed_in"
  | "invalid_channel"
  | "invalid_note"
  | "task_not_found"
  | "not_allowed"
  | "nudge_no_account"
  | "task_closed"
  | "nudge_limit_task"
  | "nudge_limit_week"
  | "failed";

export type NudgeResult = { ok: true; nudge: PlanNudge; channel: "email" | "sms" | "app" } | { ok: false; reason: NudgeReason; message: string };
export type ParentActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";

/** The button copy for each reason (parents.md "Nudges"). */
const NUDGE_REASON_MESSAGE: Record<NudgeReason, string> = {
  not_signed_in: SIGN_IN,
  invalid_channel: FAILED,
  invalid_note: "That note is too long.",
  task_not_found: FAILED,
  not_allowed: "Only a guardian of this student can nudge them.",
  nudge_no_account: "They don't have an account yet, so there's nobody to deliver a nudge to.",
  task_closed: "That step is already done.",
  nudge_limit_task: "Already nudged on this step in the last three days.",
  nudge_limit_week: "Three nudges in a week is the most for one student. Try again later in the week.",
  failed: FAILED,
};

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function reasonOf(error: { message?: string; details?: string | null }): NudgeReason {
  const msg = error.message ?? "";
  if (msg.includes("nudge_limit")) return error.details === "week" ? "nudge_limit_week" : "nudge_limit_task";
  for (const r of ["not_signed_in", "invalid_channel", "invalid_note", "task_not_found", "not_allowed", "nudge_no_account", "task_closed"] as const) {
    if (msg.includes(r)) return r;
  }
  return "failed";
}

/* ------------------------------------------------------------------ */
/* Sending a nudge                                                     */
/* ------------------------------------------------------------------ */

/** Whatever this guardian needs to attempt delivery after the row is written, read with one cheap query each. */
async function nudgeContact(supabase: Ready["supabase"], taskId: string): Promise<{ studentId: string; studentUserId: string | null; studentFirst: string | null; fromFirst: string | null } | null> {
  const task = await supabase.from("plan_tasks").select("list_id").eq("id", taskId).maybeSingle();
  const listId = (task.data as { list_id: string } | null)?.list_id;
  if (!listId) return null;
  const list = await supabase.from("lists").select("student_id").eq("id", listId).maybeSingle();
  const studentId = (list.data as { student_id: string | null } | null)?.student_id ?? null;
  if (!studentId) return null;
  const student = await supabase.from("students").select("user_id, display_name").eq("id", studentId).maybeSingle();
  const row = student.data as { user_id: string | null; display_name: string | null } | null;
  return { studentId, studentUserId: row?.user_id ?? null, studentFirst: row?.display_name?.trim().split(/\s+/)[0] ?? null, fromFirst: null };
}

/**
 * Sends a nudge on one task: one optional line, delivered by email (unless the student turned nudge emails off) and
 * by text (when their texts are on), and always visible in the plan. `send_nudge()` enforces who may nudge whom and
 * the rate limit; this wraps its error into the spec's button copy. Best-effort delivery never fails the nudge
 * itself: it's already recorded once the RPC returns.
 */
export async function sendNudge(taskId: string, note: string, channel: "email" | "sms" | "app" = "app"): Promise<NudgeResult> {
  if (!isUuid(taskId)) return { ok: false, reason: "failed", message: FAILED };
  const r = await ready("planner.parents.nudge");
  if (!("supabase" in r)) return { ok: false, reason: "not_signed_in", message: r.message };
  const trimmed = note.trim().slice(0, 200) || null;
  const { data, error } = await r.supabase.rpc("send_nudge", { p_task: taskId, p_note: trimmed, p_channel: channel });
  if (error) {
    const reason = reasonOf(error as { message?: string; details?: string | null });
    return { ok: false, reason, message: NUDGE_REASON_MESSAGE[reason] };
  }
  const nudge = data as PlanNudge;
  refresh();

  const contact = await nudgeContact(r.supabase, taskId);
  let delivered: "email" | "sms" | null = null;
  if (contact?.studentUserId) {
    try {
      const off = await r.supabase.rpc("student_nudge_emails_off", { p_student: contact.studentId });
      if (!off.error && off.data !== true && emailConfigured()) {
        const admin = await supabaseClient("publish")
          .auth.admin.getUserById(contact.studentUserId)
          .catch(() => ({ data: null, error: null }) as { data: { user: { email?: string | null } } | null; error: unknown });
        const to = admin.data?.user?.email ?? null;
        if (to) {
          const body = trimmed ? `"${trimmed}"` : "Take a look at one step on your plan.";
          await sendEmail({
            to,
            subject: "A nudge on your plan",
            html: `<p>${body}</p><p><a href="/household/${contact.studentId}/plan">Open the plan</a></p>`,
            text: `${body}\n\nOpen the plan: /household/${contact.studentId}/plan`,
          });
          delivered = "email";
        }
      }
    } catch {
      // Best effort: the nudge is recorded regardless.
    }
    try {
      const consent = await supabaseClient("publish")
        .from("sms_consents")
        .select(CONSENT_COLUMNS)
        .eq("student_id", contact.studentId)
        .is("revoked_at", null)
        .is("provider_opt_out_at", null)
        .maybeSingle();
      if (consent.data) {
        const body = `${trimmed ? `"${trimmed}" ` : ""}— a nudge on your plan.`;
        const sent = await deliverText(supabaseClient("publish"), consent.data as ConsentRow, "nudge", body, { taskId, forName: contact.studentFirst });
        if (sent.sent && delivered === null) delivered = "sms";
      }
    } catch {
      // Best effort.
    }
  }
  return { ok: true, nudge, channel: delivered ?? "app" };
}

/* ------------------------------------------------------------------ */
/* Answering a nudge                                                   */
/* ------------------------------------------------------------------ */

/** The student's answer to a nudge: a one-line reply (the trigger stamps replied_at and refuses a second one). */
export async function replyToNudge(nudgeId: string, reply: string): Promise<ParentActionResult> {
  if (!isUuid(nudgeId)) return { ok: false, message: FAILED };
  const text = reply.trim().slice(0, 200);
  if (!text) return { ok: false, message: "Write a line first." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_nudges").update({ reply: text }).eq("id", nudgeId).select("id");
  if (error) {
    console.error(`planner parents: replyToNudge failed: ${error.message}`);
    return { ok: false, message: /already_answered/.test(error.message) ? "That nudge already has a reply." : FAILED };
  }
  if (!data?.length) return { ok: false, message: "Only the student this nudge went to can reply." };
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Reassigning a task                                                  */
/* ------------------------------------------------------------------ */

const ASSIGNEES: readonly Assignee[] = ["student", "guardian", "either"];

/** Guardian ↔ student ↔ either: anyone who can edit the plan may move a step's assignee; the edit is attributed
 * like any other (the list's edit policy, tasks.ts assigneeLabel reads the result). */
export async function reassignTask(taskId: string, assignee: Assignee): Promise<ParentActionResult> {
  if (!isUuid(taskId) || !ASSIGNEES.includes(assignee)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_tasks").update({ assignee }).eq("id", taskId).select("id");
  if (error) {
    console.error(`planner parents: reassignTask failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  if (!data?.length) return { ok: false, message: "Only someone who can edit this plan can reassign a step." };
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

/** The weekly parent-summary email switch (a guardian's own; off by default). */
export async function setParentSummaryEmail(on: boolean): Promise<ParentActionResult> {
  const r = await ready("planner.reminders");
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase
    .from("notification_prefs")
    .upsert({ user_id: r.userId, parent_summary: Boolean(on), updated: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error(`planner parents: setParentSummaryEmail failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  revalidatePath("/account");
  return { ok: true };
}

/** Whether nudges reach this person by email (on by default); in-app nudges always show regardless. */
export async function setNudgeEmails(on: boolean): Promise<ParentActionResult> {
  const r = await ready("planner.parents.nudge");
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase
    .from("notification_prefs")
    .upsert({ user_id: r.userId, nudge_emails: Boolean(on), updated: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error(`planner parents: setNudgeEmails failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  revalidatePath("/account");
  return { ok: true };
}

/** The stored parent-summary choice (null: off, the default). */
export async function myParentSummary(): Promise<boolean> {
  const r = await ready("planner.reminders");
  if (!("supabase" in r)) return false;
  const { data } = await r.supabase.from("notification_prefs").select("parent_summary").eq("user_id", r.userId).maybeSingle();
  return (data as { parent_summary: boolean | null } | null)?.parent_summary === true;
}

/** The stored nudge-emails choice (default on). */
export async function myNudgeEmails(): Promise<boolean> {
  const r = await ready("planner.parents.nudge");
  if (!("supabase" in r)) return true;
  const { data } = await r.supabase.from("notification_prefs").select("nudge_emails").eq("user_id", r.userId).maybeSingle();
  return (data as { nudge_emails: boolean | null } | null)?.nudge_emails !== false;
}

/* ------------------------------------------------------------------ */
/* "Your part"                                                         */
/* ------------------------------------------------------------------ */

export interface YourPartRead {
  studentId: string;
  name: string | null;
  /** Every guardian/either task on the student's default list (lib/planner/summary.ts `yourPart` filters to open ones). */
  tasks: PlanTask[];
}

/**
 * Every visible student's guardian/either tasks, grouped by student (lib/planner/summary.ts's `yourPart` filters to
 * the open ones and sorts them; components/planner/parents/YourPart.tsx renders the result). One query per visible
 * student's default list, like lib/planner/hub.ts's captions.
 */
export async function myYourPart(): Promise<YourPartRead[]> {
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return [];
  const students = await studentsICanSee();
  const out: YourPartRead[] = [];
  for (const s of students) {
    const list = await r.supabase.from("lists").select("id").eq("student_id", s.student.id).eq("is_default", true).maybeSingle();
    const listId = (list.data as { id: string } | null)?.id;
    if (!listId) continue;
    const tasks = await r.supabase.from("plan_tasks").select(PLAN_TASK_COLUMNS).eq("list_id", listId).in("assignee", ["guardian", "either"]);
    out.push({ studentId: s.student.id, name: s.student.display_name, tasks: (tasks.data ?? []) as PlanTask[] });
  }
  return out;
}
