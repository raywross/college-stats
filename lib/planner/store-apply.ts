"use server";
/**
 * Stage 5's Server Actions (specs/planner/applications.md): marking a college applied or complete, the platform,
 * the portal link, the recommendation/supplement counts, withdrawing, and the transcript-sharing switch. Copies
 * `lib/planner/store.ts`'s `ready(capability)` pattern (signed in, the user's own session, `allowed()`), then writes
 * with that session so row-level security decides. Every write that can change which tasks should exist calls
 * `regenerate(listId)` afterward; `markApplied` also ticks the matching `apply`/`ed2_conditional` task (Wave 1's
 * note: U5 left that tick to the unit that sets `applied_on`), and records the application snapshot after the response
 * (specs/chances/calibration.md; lib/chances/snapshot-write.ts: best-effort, never fails the action).
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { isoDateOrNull } from "@/lib/list-rules";
import { todayIso } from "./context";
import { regenerate } from "./store";
import { snapshotOnApplied } from "@/lib/chances/snapshot-write";
import { snapshotDeps } from "@/lib/chances/snapshot-deps";
import type { PlanItem } from "./types";

export type PlanActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";

type Supa = Awaited<ReturnType<typeof createServerSupabase>>;
type Ready = { userId: string; supabase: Supa };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): PlanActionResult {
  if (error) console.error(`planner apply: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const PLATFORMS = ["common_app", "coalition", "own", "uc", "apply_texas", "other"] as const;
const isPlatform = (v: unknown): v is PlanItem["application_platform"] => v === null || (PLATFORMS as readonly string[]).includes(v as string);

async function listOfItem(supabase: Supa, itemId: string): Promise<string | null> {
  const { data } = await supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  return (data as { list_id: string } | null)?.list_id ?? null;
}

/** Ticks any open generated task of `kind` for this item (a direct write finishing what the task tracks). */
async function completeGeneratedTask(supabase: Supa, itemId: string, kind: string): Promise<void> {
  await supabase.from("plan_tasks").update({ done_at: new Date().toISOString() }).eq("item_id", itemId).eq("kind", kind).is("done_at", null);
}

/** A `http(s)://` URL only, trimmed; `null` clears it; anything else is rejected (the site never stores a login). */
function sanitizePortalUrl(url: string | null): string | null | "invalid" {
  if (url === null) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
    return u.toString();
  } catch {
    return "invalid";
  }
}

/** Marks a college applied: `applied_on` (today, or a given date) and status `applied` — one fact, the same tick as the timeline's Apply task. */
export async function markApplied(itemId: string, appliedOn?: string | null): Promise<PlanActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const date = appliedOn ? isoDateOrNull(appliedOn) : todayIso();
  if (appliedOn && !date) return { ok: false, message: "That isn't a date." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ applied_on: date, status: "applied" }).eq("id", itemId);
  if (error) return fail(error, "markApplied");
  await completeGeneratedTask(r.supabase, itemId, "apply");
  await completeGeneratedTask(r.supabase, itemId, "ed2_conditional");
  await regenerate(listId);
  refresh();
  // The inputs as of today, with the estimate the student saw (never fails or slows the action).
  const supabase = r.supabase;
  after(() => snapshotOnApplied(itemId, snapshotDeps(supabase)));
  return { ok: true };
}

/** Un-marks applied (back to `applying`, clearing `applied_on`); the database's trigger keeps the two in step either way. */
export async function unmarkApplied(itemId: string): Promise<PlanActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ applied_on: null, status: "applying", complete_on: null }).eq("id", itemId);
  if (error) return fail(error, "unmarkApplied");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** Marks (or clears) "the portal shows everything received": stops the weekly portal check. */
export async function markComplete(itemId: string, completeOn: string | null = todayIso()): Promise<PlanActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const date = completeOn === null ? null : isoDateOrNull(completeOn);
  if (completeOn !== null && !date) return { ok: false, message: "That isn't a date." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ complete_on: date }).eq("id", itemId);
  if (error) return fail(error, "markComplete");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** The application platform (a chip, groups the Apply stage "By platform"); the site has no reliable per-college source, so it's the student's own pick. */
export async function setPlatform(itemId: string, platform: PlanItem["application_platform"]): Promise<PlanActionResult> {
  if (!isUuid(itemId) || !isPlatform(platform)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ application_platform: platform }).eq("id", itemId);
  if (error) return fail(error, "setPlatform");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** The portal link the student pastes once (never a login); setting one ticks `portal_setup`. */
export async function setPortalUrl(itemId: string, url: string | null): Promise<PlanActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const clean = sanitizePortalUrl(url);
  if (clean === "invalid") return { ok: false, message: "That doesn't look like a web address." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase.from("list_items").update({ portal_url: clean }).eq("id", itemId);
  if (error) return fail(error, "setPortalUrl");
  if (clean) await completeGeneratedTask(r.supabase, itemId, "portal_setup");
  refresh();
  return { ok: true };
}

/** The student's own recommendation/supplement counts (not in any public dataset). */
export async function setCounts(itemId: string, counts: { recommendations?: number | null; supplements?: number | null }): Promise<PlanActionResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const row: Record<string, number | null> = {};
  for (const [key, column] of [
    ["recommendations", "recommendations_count"],
    ["supplements", "supplements_count"],
  ] as const) {
    const v = counts[key];
    if (v === undefined) continue;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 20)) return { ok: false, message: "That's not a number of those, 0–20." };
    row[column] = v;
  }
  if (Object.keys(row).length === 0) return { ok: true };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update(row).eq("id", itemId);
  if (error) return fail(error, "setCounts");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** Whether this college's transcript request is shared (the default) or its own (applications.md "Open questions" #2). */
export async function setTranscriptShared(itemId: string, shared: boolean): Promise<PlanActionResult> {
  if (!isUuid(itemId) || typeof shared !== "boolean") return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ transcript_shared: shared }).eq("id", itemId);
  if (error) return fail(error, "setTranscriptShared");
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/** Withdraws (or restores) an application: the card greys out; its tasks stop being generated (applications.md "Status per college"). */
export async function markWithdrawn(itemId: string, withdrawn: boolean, on: string | null = todayIso()): Promise<PlanActionResult> {
  if (!isUuid(itemId) || typeof withdrawn !== "boolean") return { ok: false, message: FAILED };
  const date = withdrawn ? (on ? isoDateOrNull(on) : todayIso()) : null;
  if (withdrawn && on && !date) return { ok: false, message: "That isn't a date." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const listId = await listOfItem(r.supabase, itemId);
  if (!listId) return { ok: false, message: FAILED };
  const { error } = await r.supabase.from("list_items").update({ withdrawn_on: date }).eq("id", itemId);
  if (error) return fail(error, "markWithdrawn");
  await regenerate(listId);
  refresh();
  return { ok: true };
}
