"use server";
/**
 * Act tracking's Server Actions (specs/planner/v3/guides/show-interest.md; build-plan.md "Act tracking"): record a
 * click on a guide's act button, mark that the return prompt asked, answer an act, and read the viewer's own pending
 * acts. store-actions.ts' `ready` pattern: signed in, `allowed()`, then the person's own session so RLS decides
 * (`plan_interest_acts`: written only by the actor). The confirmed act's writes are lib/planner/interest-acts-server.ts
 * `resolveActRow`, which the email's token route calls too; this file adds the regeneration that closes the interest
 * move and the telemetry.
 *
 * A pending act is the actor's own: `pendingActs` reads only the viewer's rows, so a parent never sees a student's
 * unconfirmed click and the reverse (spec "Rules": shown to no one else).
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { trackServer } from "@/lib/analytics-server";
import { SOCIAL_NETWORKS } from "@/lib/social";
import type { SocialNetwork } from "@/lib/types";
import { isVisitKind } from "./actions";
import { todayIso } from "./context";
import { INTEREST_ACT_COLUMNS, isInterestAct, visiblePending, type InterestAct, type InterestActRow } from "./interest-acts";
import { resolveActRow, zonesForEvents, type ConfirmExtra } from "./interest-acts-server";
import { regenerate } from "./store";
import type { VisitKind, VisitNotes } from "./types";

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";

type Supa = Awaited<ReturnType<typeof createServerSupabase>>;
type Ready = { userId: string; supabase: Supa };

async function ready(): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, "planner.actions.visits"))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isNetwork = (v: unknown): v is SocialNetwork => typeof v === "string" && (SOCIAL_NETWORKS as readonly string[]).includes(v);
const isHttpUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 2000 && /^https?:\/\//i.test(v);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Whether the signed-in user is the student on the item's list (a follow is the student's own; store-actions.ts' rule). */
async function isStudentOfItem(supabase: Supa, itemId: string, userId: string): Promise<boolean> {
  const item = await supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  const listId = (item.data as { list_id: string } | null)?.list_id;
  if (!listId) return false;
  const list = await supabase.from("lists").select("student_id").eq("id", listId).maybeSingle();
  const studentId = (list.data as { student_id: string | null } | null)?.student_id ?? null;
  if (!studentId) return true;
  const student = await supabase.from("students").select("user_id").eq("id", studentId).maybeSingle();
  return ((student.data as { user_id: string | null } | null)?.user_id ?? null) === userId;
}

export interface RecordActInput {
  itemId: string | null;
  act: InterestAct;
  network?: SocialNetwork | null;
  url: string;
  /** The event a Register button belongs to (or the test date for `test_register`: id `sat_2026_11`, title "SAT"). */
  event?: { id: string; startsAt: string | null; place: string | null; title: string | null } | null;
}

export type RecordActResult = { ok: true; id: string; token: string } | { ok: false; message: string };

/** Records a click as a pending act (spec "1. The click"). The college's page opens either way; this never blocks it. */
export async function recordAct(input: RecordActInput): Promise<RecordActResult> {
  if (!input || !isInterestAct(input.act) || !isHttpUrl(input.url)) return { ok: false, message: FAILED };
  if (input.itemId !== null && !isUuid(input.itemId)) return { ok: false, message: FAILED };
  if (input.act !== "test_register" && input.itemId === null) return { ok: false, message: FAILED };
  if (input.act === "follow" && !isNetwork(input.network)) return { ok: false, message: FAILED };
  const startsAt = input.event?.startsAt && !Number.isNaN(Date.parse(input.event.startsAt)) ? new Date(input.event.startsAt).toISOString() : null;

  const r = await ready();
  if (!("supabase" in r)) return r;
  if (input.itemId) {
    const { data: canEdit } = await r.supabase.rpc("can_edit_item", { p_item: input.itemId });
    if (canEdit !== true) return { ok: false, message: "Only someone who can edit this plan can do that." };
    if (input.act === "follow" && !(await isStudentOfItem(r.supabase, input.itemId, r.userId))) return { ok: false, message: "Only the student can mark a follow." };
  }
  const { data, error } = await r.supabase
    .from("plan_interest_acts")
    .insert({
      item_id: input.itemId,
      user_id: r.userId,
      act: input.act,
      network: input.act === "follow" ? input.network : null,
      url: input.url,
      event_id: text(input.event?.id, 200),
      event_starts_at: startsAt,
      event_place: text(input.event?.place, 200),
      event_title: input.act === "test_register" ? (input.event?.title === "ACT" ? "ACT" : input.event?.title === "SAT" ? "SAT" : null) : text(input.event?.title, 200),
    })
    .select("id, confirm_token")
    .single();
  if (error || !data) {
    if (error) console.error(`interest acts: recordAct failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  const row = data as { id: string; confirm_token: string };
  return { ok: true, id: row.id, token: row.confirm_token };
}

/** Marks that the return prompt asked about this act (it never asks twice, whatever the answer). */
export async function markPrompted(id: string): Promise<{ ok: boolean }> {
  if (!isUuid(id)) return { ok: false };
  const r = await ready();
  if (!("supabase" in r)) return { ok: false };
  const { data, error } = await r.supabase
    .from("plan_interest_acts")
    .update({ prompted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", r.userId)
    .is("prompted_at", null)
    .select("id");
  return { ok: !error && (data?.length ?? 0) > 0 };
}

export type ResolveActResult = { ok: true; visitId: string | null } | { ok: false; message: string; needDate?: true };

function cleanExtra(extra: { visitDate?: string; visitTime?: string | null; kind?: VisitKind; who?: string[]; notes?: VisitNotes } | undefined): ConfirmExtra {
  if (!extra) return {};
  const out: ConfirmExtra = {};
  if (typeof extra.visitDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extra.visitDate)) out.visitDate = extra.visitDate;
  if (typeof extra.visitTime === "string" && /^\d{2}:\d{2}$/.test(extra.visitTime)) out.visitTime = extra.visitTime;
  if (extra.visitTime === null) out.visitTime = null;
  if (isVisitKind(extra.kind)) out.kind = extra.kind;
  if (Array.isArray(extra.who)) out.who = extra.who.map(String);
  if (extra.notes && typeof extra.notes === "object") out.notes = extra.notes;
  return out;
}

/**
 * Answers one of the viewer's own acts: confirmed writes through the built tables (interest-acts-server.ts) and
 * regenerates the list so the interest move closes; declined writes nothing else. `extra` carries the date the family
 * picked ("I picked a different date", or an undated tour) and the rest of the visit form.
 */
export async function resolveAct(
  id: string,
  answer: "confirmed" | "declined",
  via: "prompt" | "manual",
  extra?: { visitDate?: string; visitTime?: string | null; kind?: VisitKind; who?: string[]; notes?: VisitNotes },
): Promise<ResolveActResult> {
  if (!isUuid(id) || (answer !== "confirmed" && answer !== "declined") || (via !== "prompt" && via !== "manual")) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_interest_acts").select(INTEREST_ACT_COLUMNS).eq("id", id).eq("user_id", r.userId).maybeSingle();
  if (error || !data) return { ok: false, message: FAILED };
  const row = data as unknown as InterestActRow;
  const zones = await zonesForEvents(r.supabase, [row.event_id]);
  const now = new Date();
  const outcome = await resolveActRow(r.supabase, row, answer, via, cleanExtra(extra), { now, today: todayIso(now), timeZone: row.event_id ? (zones[row.event_id] ?? null) : null });
  if (outcome.kind === "need_date") return { ok: false, message: "Pick the date.", needDate: true };
  if (outcome.kind === "error") return { ok: false, message: outcome.message };
  if (outcome.kind === "already") return { ok: false, message: "That one is already answered." };
  if (outcome.answer === "confirmed") {
    await trackServer("plan_interest_confirmed", { action: row.act, via }, r.userId);
    if (outcome.listId) await regenerate(outcome.listId);
  }
  revalidatePath("/plan", "layout");
  revalidatePath("/household", "layout");
  return { ok: true, visitId: outcome.visitId };
}

/** The viewer's own pending acts for one college (or the item-less ones, for null), newest first, none expired. */
export async function pendingActs(itemId: string | null): Promise<InterestActRow[]> {
  if (itemId !== null && !isUuid(itemId)) return [];
  const r = await ready();
  if (!("supabase" in r)) return [];
  let q = r.supabase.from("plan_interest_acts").select(INTEREST_ACT_COLUMNS).eq("user_id", r.userId).eq("status", "pending");
  q = itemId === null ? q.is("item_id", null) : q.eq("item_id", itemId);
  const { data, error } = await q.order("clicked_at", { ascending: false }).limit(50);
  if (error) return [];
  return visiblePending((data ?? []) as unknown as InterestActRow[], new Date());
}
