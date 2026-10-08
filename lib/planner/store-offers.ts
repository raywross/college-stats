"use server";
/**
 * The offers stage's Server Actions (specs/planner/offers.md; U7): record a decision, save or delete an offer, share or
 * revoke a letter, choose a college, pros and cons, the opt-in to share where the student went, and withdrawing from
 * a college. Same pattern as lib/planner/store.ts: `ready(capability)` (signed in, the user's own Supabase session,
 * `allowed()`), then the write with that session so row-level security decides; `{ ok: true } | { ok: false; message }`;
 * every write that can change the plan's tasks calls `regenerate(listId)` after it; the household pages revalidate.
 *
 * A recorded decision ticks the college's "Decision expected" task; a saved offer ticks "Add the aid offer"; the
 * choice ticks the chosen college's "Reply to the offer"; withdrawing ticks that college's withdraw task. A denial
 * dismisses the college's open steps ("Denied closes the college's tasks and says nothing else").
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { applyOutcome, isListOutcome, isoDateOrNull, type ListOutcome } from "@/lib/list-rules";
import { normalizeDraft } from "./offers";
import { regenerate } from "./store";
import { taskKey } from "./tasks";
import type { PlanLetter, TaskKind } from "./types";
import { todayIso } from "./context";

export type OfferResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const NO_EDIT = "Only someone who can edit this list can change it.";

/** The bucket supabase/storage/planner-letters.sql creates (owner-run). */
const LETTERS_BUCKET = "plan-letters";
/** At most this big: under the Server Action's body limit (next.config.ts) and the bucket's own limit. */
const MAX_LETTER_BYTES = 4 * 1024 * 1024;
const LETTER_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): { ok: false; message: string } {
  if (error) console.error(`planner offers: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

function refresh() {
  revalidatePath("/household", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The item's list (null when the reader can't see it). */
async function itemList(supabase: Ready["supabase"], itemId: string): Promise<{ list_id: string } | null> {
  const { data } = await supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  return (data as { list_id: string } | null) ?? null;
}

/** Ticks a generated task by its key if it's open (no-op when it doesn't exist yet: regeneration may add it later). */
async function tickKey(supabase: Ready["supabase"], listId: string, scope: string, kind: TaskKind): Promise<void> {
  const { error } = await supabase.from("plan_tasks").update({ done_at: new Date().toISOString() }).eq("list_id", listId).eq("key", taskKey(scope, kind)).is("done_at", null);
  if (error) console.error(`planner offers: ticking ${kind} failed: ${error.message}`);
}

async function untickKey(supabase: Ready["supabase"], listId: string, scope: string, kind: TaskKind): Promise<void> {
  await supabase.from("plan_tasks").update({ done_at: null }).eq("list_id", listId).eq("key", taskKey(scope, kind));
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

/**
 * Records what a college said (offers.md "Recording decisions"): `applyOutcome` (deferred returns the college to
 * applied), the decision date (default today), then regeneration so an admit opens its reply-by and offer steps and
 * a wait list its own. Ticks the college's "Decision expected" task, except for a deferral (another decision is
 * coming). A denial dismisses the college's open steps.
 */
export async function recordDecision(itemId: string, outcome: ListOutcome, date?: string | null): Promise<OfferResult> {
  if (!isUuid(itemId) || !isListOutcome(outcome)) return { ok: false, message: FAILED };
  const day = date ? isoDateOrNull(date) : todayIso();
  if (!day) return { ok: false, message: "That isn't a date." };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase
    .from("list_items")
    .update({ ...applyOutcome(outcome), decision_date: day })
    .eq("id", itemId)
    .select("list_id");
  if (error) return fail(error, "recordDecision");
  if (!data?.length) return { ok: false, message: NO_EDIT };
  const listId = (data[0] as { list_id: string }).list_id;
  if (outcome !== "deferred") await tickKey(r.supabase, listId, itemId, "decision_expected");
  if (outcome === "denied") {
    await r.supabase.from("plan_tasks").update({ dismissed: true }).eq("list_id", listId).eq("item_id", itemId).is("done_at", null).not("key", "is", null);
  }
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Saves an offer from the form (one per college: an existing offer for the college is updated). Normalized on the
 * server (lib/planner/offers.ts normalizeDraft); confirmed now (the family typed every number). Ticks "Add the aid
 * offer". Returns the offer's id for the share-the-letter question.
 */
export async function saveOffer(itemId: string, raw: unknown): Promise<{ ok: true; offerId: string } | { ok: false; message: string }> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const parsed = normalizeDraft(raw);
  if (!parsed.ok) return parsed;
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const item = await itemList(r.supabase, itemId);
  if (!item) return { ok: false, message: NO_EDIT };
  const row = { ...parsed.draft, source: "form" as const, confirmed_at: new Date().toISOString() };
  const existing = await r.supabase.from("plan_offers").select("id").eq("item_id", itemId).order("created_at").limit(1).maybeSingle();
  let offerId: string | null = (existing.data as { id: string } | null)?.id ?? null;
  if (offerId) {
    const { data, error } = await r.supabase.from("plan_offers").update(row).eq("id", offerId).select("id");
    if (error) return fail(error, "saveOffer");
    if (!data?.length) return { ok: false, message: NO_EDIT };
  } else {
    const { data, error } = await r.supabase.from("plan_offers").insert({ ...row, item_id: itemId }).select("id").single();
    if (error) return error.code === "42501" ? { ok: false, message: NO_EDIT } : fail(error, "saveOffer");
    offerId = (data as { id: string }).id;
  }
  await tickKey(r.supabase, item.list_id, itemId, "add_offer");
  await regenerate(item.list_id);
  refresh();
  return { ok: true, offerId };
}

/** Deletes an offer (its pros and cons go with it) and reopens "Add the aid offer". */
export async function deleteOffer(offerId: string): Promise<OfferResult> {
  if (!isUuid(offerId)) return { ok: false, message: FAILED };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("plan_offers").delete().eq("id", offerId).select("item_id");
  if (error) return fail(error, "deleteOffer");
  if (!data?.length) return { ok: false, message: NO_EDIT };
  const itemId = (data[0] as { item_id: string }).item_id;
  const item = await itemList(r.supabase, itemId);
  if (item) {
    await untickKey(r.supabase, item.list_id, itemId, "add_offer");
    await regenerate(item.list_id);
  }
  refresh();
  return { ok: true };
}

/**
 * The student's pros and cons for an admitted college, shown beside the numbers and never scored. They live on the
 * college's offer row; a college without an offer yet gets a notes-only row (no numbers, not confirmed), which the
 * table doesn't count as an offer.
 */
export async function setProsCons(itemId: string, pros: string, cons: string): Promise<OfferResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const clean = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim().slice(0, 2000) : null);
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const patch = { pros: clean(pros), cons: clean(cons) };
  const existing = await r.supabase.from("plan_offers").select("id").eq("item_id", itemId).order("created_at").limit(1).maybeSingle();
  const id = (existing.data as { id: string } | null)?.id;
  if (id) {
    const { data, error } = await r.supabase.from("plan_offers").update(patch).eq("id", id).select("id");
    if (error) return fail(error, "setProsCons");
    if (!data?.length) return { ok: false, message: NO_EDIT };
  } else {
    if (!patch.pros && !patch.cons) return { ok: true };
    const year = Number(todayIso().slice(0, 4));
    const { error } = await r.supabase.from("plan_offers").insert({ item_id: itemId, award_year: year, ...patch });
    if (error) return error.code === "42501" ? { ok: false, message: NO_EDIT } : fail(error, "setProsCons");
  }
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Letters                                                             */
/* ------------------------------------------------------------------ */

/**
 * Shares a letter (offers.md "Letters", step 2): the file goes to the private bucket under the uploader's own folder
 * (`{user}/{item}/{random}.{ext}`) with the uploader's own session (the bucket's policies allow only their folder),
 * then a plan_letters row records it. A form post: `itemId`, `kind` (admission | aid | other), `file`.
 */
export async function shareLetter(form: FormData): Promise<OfferResult> {
  const itemId = String(form.get("itemId") ?? "");
  const kind = String(form.get("kind") ?? "aid");
  const file = form.get("file");
  if (!isUuid(itemId) || !["admission", "aid", "other"].includes(kind)) return { ok: false, message: FAILED };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the letter (a PDF or a photo)." };
  const ext = LETTER_TYPES[file.type];
  if (!ext) return { ok: false, message: "A PDF or a photo (JPEG, PNG, HEIC, or WebP), please." };
  if (file.size > MAX_LETTER_BYTES) return { ok: false, message: "That file is over 4 MB. A smaller photo or a PDF of just the letter works." };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  if (!(await itemList(r.supabase, itemId))) return { ok: false, message: NO_EDIT };
  const path = `${r.userId}/${itemId}/${randomBytes(12).toString("hex")}.${ext}`;
  const up = await r.supabase.storage.from(LETTERS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) {
    console.error(`planner offers: letter upload failed: ${up.error.message}`);
    return { ok: false, message: /bucket not found/i.test(up.error.message) ? "Sharing letters isn't set up yet." : FAILED };
  }
  const { error } = await r.supabase.from("plan_letters").insert({ item_id: itemId, kind, storage_path: path });
  if (error) {
    await r.supabase.storage.from(LETTERS_BUCKET).remove([path]);
    return error.code === "42501" ? { ok: false, message: NO_EDIT } : fail(error, "shareLetter");
  }
  refresh();
  return { ok: true };
}

/** Takes a shared letter back: the file and its row. Only the person who shared it (the file is in their folder). */
export async function revokeLetter(letterId: string): Promise<OfferResult> {
  if (!isUuid(letterId)) return { ok: false, message: FAILED };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const { data } = await r.supabase.from("plan_letters").select("id, storage_path, uploaded_by").eq("id", letterId).maybeSingle();
  const letter = data as Pick<PlanLetter, "id" | "storage_path" | "uploaded_by"> | null;
  if (!letter) return { ok: false, message: FAILED };
  if (letter.uploaded_by !== r.userId) return { ok: false, message: "Only the person who shared a letter can take it back." };
  const rm = await r.supabase.storage.from(LETTERS_BUCKET).remove([letter.storage_path]);
  if (rm.error) return fail(rm.error, "revokeLetter (file)");
  const { error } = await r.supabase.from("plan_letters").delete().eq("id", letterId);
  if (error) return fail(error, "revokeLetter");
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The choice                                                          */
/* ------------------------------------------------------------------ */

/**
 * "I'm going to {College}" (offers.md "The choice"): sets enrolling (the database clears it on the others) and the
 * commit date, ticks the chosen college's "Reply to the offer", then regenerates: the deposit, withdraw, wait-list,
 * housing-deposit, and summer steps follow from the choice.
 */
export async function choose(itemId: string): Promise<OfferResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const current = await r.supabase.from("list_items").select("list_id, outcome").eq("id", itemId).maybeSingle();
  const row = current.data as { list_id: string; outcome: string | null } | null;
  if (!row) return { ok: false, message: NO_EDIT };
  if (row.outcome !== "admitted") return { ok: false, message: "Only a college that said yes can be the choice." };
  const { data, error } = await r.supabase.from("list_items").update({ enrolling: true, committed_on: todayIso() }).eq("id", itemId).select("id");
  if (error) return fail(error, "choose");
  if (!data?.length) return { ok: false, message: NO_EDIT };
  await tickKey(r.supabase, row.list_id, itemId, "reply_by");
  await regenerate(row.list_id);
  refresh();
  return { ok: true };
}

/** Undoes the choice (the database clears the commit date with it); the steps it created are marked changed. */
export async function unchoose(itemId: string): Promise<OfferResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("list_items").update({ enrolling: false }).eq("id", itemId).select("list_id");
  if (error) return fail(error, "unchoose");
  if (!data?.length) return { ok: false, message: NO_EDIT };
  await regenerate((data[0] as { list_id: string }).list_id);
  refresh();
  return { ok: true };
}

/**
 * Withdraws from a college after the choice ("Marking it sets withdrawn_on"): the date, the college's withdraw task
 * ticked, its "Add the aid offer" dismissed if still open.
 */
export async function withdrawCollege(itemId: string): Promise<OfferResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("list_items").update({ withdrawn_on: todayIso() }).eq("id", itemId).select("list_id");
  if (error) return fail(error, "withdrawCollege");
  if (!data?.length) return { ok: false, message: NO_EDIT };
  const listId = (data[0] as { list_id: string }).list_id;
  await tickKey(r.supabase, listId, itemId, "withdraw");
  await tickKey(r.supabase, listId, itemId, "waitlist_decide");
  await r.supabase.from("plan_tasks").update({ dismissed: true }).eq("list_id", listId).eq("key", taskKey(itemId, "add_offer")).is("done_at", null);
  await regenerate(listId);
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Where they went                                                     */
/* ------------------------------------------------------------------ */

/**
 * The opt-in (one checkbox, revocable) to add where the student went to the pooled self-reported outcomes
 * (offers.md "Where they went"). Only the flag is stored; the pooled table is a later spec. The database lets only
 * the student's own account (or, for a student without one, a guardian who can edit them) change it
 * (20261008141000_planner_offers.sql).
 */
export async function consentOutcomeShare(listId: string, consent: boolean): Promise<OfferResult> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.offers");
  if (!("supabase" in r)) return r;
  const patch = consent ? { outcome_share_consented_at: new Date().toISOString(), outcome_share_consented_by: r.userId } : { outcome_share_consented_at: null, outcome_share_consented_by: null };
  const { data, error } = await r.supabase.from("lists").update(patch).eq("id", listId).select("id");
  if (error) {
    if (/outcome_share_not_allowed/.test(error.message)) return { ok: false, message: "Only the student can change this." };
    return fail(error, "consentOutcomeShare");
  }
  if (!data?.length) return { ok: false, message: "Only the student can change this." };
  refresh();
  return { ok: true };
}
