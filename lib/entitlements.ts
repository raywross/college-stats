/**
 * Entitlements (specs/planner/model.md "Entitlements"; specs/product/commercialization.md "Feature map"): the one hook
 * the paid tier fills. Every planner Server Action asks `allowed(user, capability)` before it writes; the essays
 * workspace and the reader ask too. The rules are pure, in lib/billing.ts (the map, what a set of subscriptions
 * means, who is an early account); this module is the glue that reads the setting and the table and answers.
 *
 * The order of the answer keeps today's site exactly as it is until the owner flips the switch:
 * 1. A free row of the map (visits, the API key) is always allowed.
 * 2. Billing not configured (no Stripe keys) or the price not live (`advisor.price_live_at` unset): allowed, no read.
 * 3. Otherwise one read, `advisor_access(students[])`, per request and student: the subscriptions covering the
 *    student (a student plan naming them, a family plan held by a guardian in their household) and the accounts behind
 *    them. A trial or a paid year, or an early account through 2027-08-31, is whole; anything else is read-only.
 *
 * Importable under plain node (tests/org-rules.test.mts, tests/essays-workspace.test.mts): the server modules are
 * imported inside the functions that need them, and only once step 2 says a read is needed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADVISOR_STATUS_LABEL,
  allowedUnder,
  entitlementFrom,
  FEATURE_MAP,
  parsePriceLiveAt,
  PRICE_LIVE_SETTING,
  type AdvisorStatus,
  type Entitlement,
  type StatusWord,
  type SubscriptionRow,
  type TrialRow,
} from "./billing.ts";
import type { Capability } from "./planner/types.ts";

export type { Capability, Entitlement };

/** Every capability the map names, in the spec's order. */
export const CAPABILITIES: readonly Capability[] = FEATURE_MAP.map((r) => r.capability);

/** The message a Server Action returns when a capability isn't allowed. */
export const NOT_ALLOWED_MESSAGE = "That part of the advisor isn't available on your account.";

/** Billing is on when Stripe's three variables are set (lib/stripe.ts billingConfigured, kept SDK-free here). */
export function billingConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ADVISOR_STUDENT);
}

/* ------------------------------------------------------------------ */
/* The setting                                                         */
/* ------------------------------------------------------------------ */

/**
 * When the price went live, from the planner's one settings read (lib/planner/settings-server.ts carries the key, so
 * a plan page pays nothing extra), or null while the Advisor is free for everyone or the setting can't be read.
 */
export async function priceLiveAt(): Promise<Date | null> {
  const { appSettings } = await import("./planner/settings-server.ts");
  const settings = await appSettings();
  return settings ? parsePriceLiveAt(settings.get(PRICE_LIVE_SETTING)) : null;
}

/** The same, read with a given client (the cron jobs' secret-key client, outside a request). */
export async function priceLiveAtWith(client: SupabaseClient): Promise<Date | null> {
  const { data, error } = await client.from("app_settings").select("value").eq("key", PRICE_LIVE_SETTING).maybeSingle();
  if (error) return null;
  return parsePriceLiveAt((data as { value: unknown } | null)?.value);
}

/** Whether anything is gated at all: billing configured and the price live. One cheap check before any read. */
export async function priceLive(): Promise<boolean> {
  return billingConfigured() && (await priceLiveAt()) !== null;
}

/* ------------------------------------------------------------------ */
/* The read                                                            */
/* ------------------------------------------------------------------ */

export interface AdvisorAccess {
  studentId: string;
  /** When the accounts behind the student were created (their own, or the guardian managing their record). */
  created: (string | null)[];
  /** The trial the database started with the student's record (advisor_trials); null for a record from before it. */
  trial: TrialRow | null;
  subscriptions: SubscriptionRow[];
}

/** `advisor_access()` for these students with `client` (the viewer's session, or the secret key); a student the caller can't read is left out. */
export async function readAdvisorAccess(client: SupabaseClient, studentIds: readonly string[]): Promise<Map<string, AdvisorAccess>> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map();
  const { data, error } = await client.rpc("advisor_access", { p_students: ids });
  if (error) throw new Error(`entitlements: reading advisor access failed: ${error.message}`);
  const out = new Map<string, AdvisorAccess>();
  for (const r of (data ?? []) as { student_id: string; created: (string | null)[]; trial: TrialRow | null; subscriptions: SubscriptionRow[] }[]) {
    out.set(r.student_id, { studentId: r.student_id, created: r.created ?? [], trial: r.trial ?? null, subscriptions: r.subscriptions ?? [] });
  }
  return out;
}

/** The entitlement a read gives one student; a student the read left out is treated as read-only. */
export function entitlementOf(access: AdvisorAccess | undefined, priceLiveAtDate: Date | null, today = new Date()): Entitlement {
  return entitlementFrom({
    priceLiveAt: priceLiveAtDate,
    stripeConfigured: billingConfigured(),
    accountsCreated: access?.created ?? [],
    rows: access?.subscriptions ?? [],
    trial: access?.trial ?? null,
    today,
  });
}

/** Per-request memo of the reads, so a page asking about the same student twice reads once. */
async function accessFor(studentIds: readonly string[]): Promise<Map<string, AdvisorAccess>> {
  const { requestMemo } = await import("./request-memo.ts");
  const { createServerSupabase } = await import("./supabase-server.ts");
  const key = `advisor_access:${[...studentIds].sort().join(",")}`;
  return requestMemo(key, async () => readAdvisorAccess(await createServerSupabase(), studentIds));
}

/** One student's entitlement, as the signed-in viewer may read it. Whole without a read while the price isn't live. */
export async function entitlementFor(studentId: string): Promise<Entitlement> {
  const live = await priceLiveAt();
  if (!billingConfigured() || live === null) return entitlementOf(undefined, null);
  const access = await accessFor([studentId]);
  return entitlementOf(access.get(studentId), live);
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export interface AllowedOptions {
  /** The student whose advisor the action touches. Without it, the viewer's own students decide (see below). */
  studentId?: string | null;
  /** A read: a lapsed plan keeps reading what the map lets it read. Writes are the default. */
  mode?: "read" | "write";
}

/**
 * Whether `user` may use `capability`. With a student named, that student's entitlement decides. Without one (the
 * planner's `ready()` runs before the action knows its list), the viewer's own record or any child they reach as a
 * guardian being whole is enough, and a viewer with no students at all is allowed (nothing to gate yet). A signed-out
 * caller is never allowed a gated row.
 */
export async function allowed(user: { id: string } | null, capability: Capability, opts: AllowedOptions = {}): Promise<boolean> {
  const mode = opts.mode ?? "write";
  const row = FEATURE_MAP.find((r) => r.capability === capability);
  if (row?.free) return true;
  if (!billingConfigured()) return true;
  const live = await priceLiveAt();
  if (live === null) return true;
  if (!user) return false;
  if (opts.studentId) return allowedUnder(await entitlementFor(opts.studentId), capability, mode);
  const { studentsICanSee } = await import("./auth.ts");
  const mine = (await studentsICanSee()).filter((a) => a.relation !== "counselor");
  if (!mine.length) return true;
  const access = await accessFor(mine.map((a) => a.student.id));
  return mine.some((a) => allowedUnder(entitlementOf(access.get(a.student.id), live), capability, mode));
}

/* ------------------------------------------------------------------ */
/* Status words                                                        */
/* ------------------------------------------------------------------ */

/** The chip's status and words live in lib/billing.ts (pure, client-safe for the caseload); re-exported for the pages. */
export { ADVISOR_STATUS_LABEL, type AdvisorStatus };

/** The status word an entitlement shows: a trial "trial"; whole by a paid year or early "active"; else the plan's state. */
export function statusWordOf(e: Entitlement): Exclude<AdvisorStatus, "preview"> {
  if (e.status === "trial") return "trial";
  if (e.whole) return "active";
  return e.status as StatusWord as Exclude<AdvisorStatus, "preview">;
}

/** Each student's advisor status, by student id, as the signed-in viewer may read it. */
export async function advisorStatusFor(studentIds: string[]): Promise<Record<string, AdvisorStatus>> {
  const ids = [...new Set(studentIds)];
  if (!billingConfigured()) return Object.fromEntries(ids.map((id) => [id, "preview" as const]));
  const live = await priceLiveAt();
  if (live === null) return Object.fromEntries(ids.map((id) => [id, "preview" as const]));
  const access = await accessFor(ids);
  return Object.fromEntries(ids.map((id) => [id, statusWordOf(entitlementOf(access.get(id), live))]));
}

/* ------------------------------------------------------------------ */
/* What a page shows about billing                                     */
/* ------------------------------------------------------------------ */

export interface AdvisorBilling {
  /** "preview" while the price isn't live. */
  status: AdvisorStatus;
  whole: boolean;
  because: Entitlement["because"];
  /** The trial's end: the database's trial, or Stripe's when a subscription carries one. */
  trialEnd: string | null;
  /** Whole days until the trial ends (0 on its last day), or null without a trial; computed here so components stay pure. */
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** A live subscription pays for the student (a card is on file; the year will be charged). */
  paid: boolean;
  /** The trial runs but no card is on file: the advisor waits, read-only, for the card (lib/billing.ts Entitlement). */
  needsCard: boolean;
  /** The viewer holds the subscription (so Manage and Cancel are theirs to press). */
  mine: boolean;
}

/** The Advisor tab's and the account page's facts about one student's billing, as the viewer may read them. */
export async function advisorBillingFor(studentId: string, viewerId: string | null): Promise<AdvisorBilling> {
  const none: AdvisorBilling = { status: "preview", whole: true, because: "not-live", trialEnd: null, trialDaysLeft: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, paid: false, needsCard: false, mine: false };
  if (!billingConfigured()) return none;
  const live = await priceLiveAt();
  if (live === null) return none;
  const access = (await accessFor([studentId])).get(studentId);
  const e = entitlementOf(access, live);
  const trialEnd = e.row?.trial_end ?? e.trial?.ends_at ?? null;
  return {
    status: statusWordOf(e),
    whole: e.whole,
    because: e.because,
    trialEnd,
    trialDaysLeft: trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000)) : null,
    currentPeriodEnd: e.row?.current_period_end ?? null,
    cancelAtPeriodEnd: e.row?.cancel_at_period_end ?? false,
    paid: e.paid,
    needsCard: e.needsCard,
    mine: e.row !== null && viewerId !== null && e.row.user_id === viewerId,
  };
}

/* ------------------------------------------------------------------ */
/* Outside a request: the jobs                                         */
/* ------------------------------------------------------------------ */

/**
 * Of `studentIds`, those whose advisor is whole for `capability` (a write-side row: texts, reminders, alerts), read
 * with the secret-key client the cron jobs hold. Everyone while the price isn't live. A read that fails keeps everyone
 * (a job must never go silent because billing hiccuped; the failure is logged).
 */
export async function entitledStudents(client: SupabaseClient, studentIds: readonly string[], capability: Capability, today = new Date()): Promise<Set<string>> {
  const ids = [...new Set(studentIds)];
  const all = new Set(ids);
  if (!ids.length || !billingConfigured()) return all;
  try {
    const live = await priceLiveAtWith(client);
    if (live === null) return all;
    const access = await readAdvisorAccess(client, ids);
    return new Set(ids.filter((id) => allowedUnder(entitlementOf(access.get(id), live, today), capability, "write")));
  } catch (err) {
    console.error(`entitlements: reading access for a job failed; keeping everyone: ${err instanceof Error ? err.message : String(err)}`);
    return all;
  }
}
