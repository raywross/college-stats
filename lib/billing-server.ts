import "server-only";
/**
 * Billing's server helpers, shared by the checkout actions, the webhook, the return routes, the household's Add a
 * student, and the nightly reconcile (specs/product/commercialization.md "Billing"): the secret-key client, the card
 * on file, the server-made subscription a parent's card pays for, what to say about a change (telemetry), the trial
 * email, and `applySubscription()`, the one path that stores a Stripe subscription and then says what the change means.
 */
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingEvents, trialDay, type BillingEvent, type SubscriptionRow, type TrialRow } from "./billing.ts";
import { buildTrialEnding } from "./emails/trial-ending.ts";
import { emailConfigured, sendEmail } from "./email.ts";
import { trackServer } from "./analytics-server.ts";
import { supabaseClient } from "./supabase.ts";
import { cardOfSetupSession, createStudentSubscription, ensureCustomer, setDefaultPaymentMethod, syncSubscription, type SavedCard, type SyncResult } from "./stripe.ts";

/** The secret-key client: subscriptions and cards are written by the server alone. */
export function billingService(): SupabaseClient {
  return supabaseClient("publish");
}

/* ------------------------------------------------------------------ */
/* The card on file                                                    */
/* ------------------------------------------------------------------ */

export interface CardOnFile {
  customerId: string;
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
  updatedAt: string | null;
}

type CustomerRow = { stripe_customer_id: string; default_payment_method: string | null; card_brand: string | null; card_last4: string | null; card_updated_at: string | null };

/** The payer's saved card (the household's, for a parent), or null when none is on file. */
export async function cardOnFile(client: SupabaseClient, userId: string): Promise<CardOnFile | null> {
  const { data } = await client.from("billing_customers").select("stripe_customer_id, default_payment_method, card_brand, card_last4, card_updated_at").eq("user_id", userId).maybeSingle();
  const row = data as CustomerRow | null;
  if (!row?.default_payment_method) return null;
  return { customerId: row.stripe_customer_id, paymentMethodId: row.default_payment_method, brand: row.card_brand, last4: row.card_last4, updatedAt: row.card_updated_at };
}

/** Record a saved card and make it the customer's default for every invoice. */
export async function saveCard(service: SupabaseClient, userId: string, customerId: string, card: SavedCard): Promise<void> {
  await setDefaultPaymentMethod(customerId, card.paymentMethodId);
  const { error } = await service
    .from("billing_customers")
    .upsert({ user_id: userId, stripe_customer_id: customerId, default_payment_method: card.paymentMethodId, card_brand: card.brand, card_last4: card.last4, card_updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`billing: recording the card failed: ${error.message}`);
}

/** The card a finished setup session saved, recorded for its account; false when the session isn't one. */
export async function saveCardFromSession(service: SupabaseClient, sessionId: string, expectUserId?: string): Promise<boolean> {
  const found = await cardOfSetupSession(sessionId);
  if (!found) return false;
  let userId = found.userId;
  if (!userId) {
    const { data } = await service.from("billing_customers").select("user_id").eq("stripe_customer_id", found.customerId).maybeSingle();
    userId = (data as { user_id: string } | null)?.user_id ?? null;
  }
  if (!userId || (expectUserId && userId !== expectUserId)) return false;
  await saveCard(service, userId, found.customerId, found.card);
  return true;
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

/** The server events a stored change means, sent with the payer as the person. */
export async function trackBilling(events: readonly BillingEvent[], row: SubscriptionRow, at = new Date()): Promise<void> {
  for (const event of events) {
    const base = { product: row.product };
    if (event === "trial_started" || event === "trial_converted" || event === "subscription_renewed") await trackServer(event, { ...base, price_variant: row.price_variant }, row.user_id);
    else if (event === "trial_cancelled") await trackServer(event, { ...base, day: trialDay(row.trial_end, at) }, row.user_id);
    else await trackServer(event, base, row.user_id);
  }
}

/** Store a Stripe subscription and say what changed. The webhook, the return routes, and the reconcile all come here. */
export async function applySubscription(service: SupabaseClient, sub: Stripe.Subscription): Promise<SyncResult | null> {
  const result = await syncSubscription(service, sub);
  if (!result) return null;
  const events = billingEvents(result.prev, result.next);
  if (events.length) await trackBilling(events, result.next);
  return result;
}

/** The student's trial row, read with the secret key, or null. */
export async function trialOf(service: SupabaseClient, studentId: string): Promise<TrialRow | null> {
  const { data } = await service.from("advisor_trials").select("*").eq("student_id", studentId).maybeSingle();
  return (data as TrialRow | null) ?? null;
}

/**
 * A parent with a card on file pays for a student (commercialization.md "Billing": "if a parent creates a student in
 * the household, it should charge them"): a subscription on the parent's customer, trialing until the student's trial
 * ends, then charged to the saved card. Returns the stored row, or null without a card (the caller sends the parent to
 * add one first).
 */
export async function subscribeWithCard(service: SupabaseClient, payer: { id: string; email: string | null }, studentId: string): Promise<SubscriptionRow | null> {
  const card = await cardOnFile(service, payer.id);
  if (!card) return null;
  const customerId = await ensureCustomer(service, payer);
  const trial = await trialOf(service, studentId);
  const sub = await createStudentSubscription({ customerId, paymentMethodId: card.paymentMethodId, userId: payer.id, studentId, trialEnd: trial?.ends_at ?? null });
  const result = await applySubscription(service, sub);
  return result?.next ?? null;
}

/** Whether a live subscription already pays for the student (so a second one is never made). */
export async function studentPaidFor(service: SupabaseClient, studentId: string): Promise<boolean> {
  const { data } = await service.from("subscriptions").select("status").eq("covers_student_id", studentId).in("status", ["trialing", "active", "past_due"]).limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

/* ------------------------------------------------------------------ */
/* The trial email                                                     */
/* ------------------------------------------------------------------ */

/** What the trial covered so far: colleges on the student's lists, moves done since it began. */
export async function trialFacts(service: SupabaseClient, studentIds: readonly string[], since: string, payerId: string): Promise<{ colleges: number | null; movesDone: number | null; studentNames: string[] }> {
  const students = [...new Set(studentIds)];
  if (!students.length) return { colleges: null, movesDone: null, studentNames: [] };
  const [names, lists] = await Promise.all([
    service.from("students").select("id, display_name, user_id").in("id", students).is("deleted_at", null),
    service.from("lists").select("id").in("student_id", students),
  ]);
  const listIds = ((lists.data ?? []) as { id: string }[]).map((l) => l.id);
  const [items, tasks] = listIds.length
    ? await Promise.all([
        service.from("list_items").select("id", { count: "exact", head: true }).in("list_id", listIds),
        service.from("plan_tasks").select("id", { count: "exact", head: true }).in("list_id", listIds).gte("done_at", since),
      ])
    : [{ count: 0 }, { count: 0 }];
  const rows = (names.data ?? []) as { id: string; display_name: string | null; user_id: string | null }[];
  // The payer's own record isn't "Jordan's advisor" to them.
  const studentNames = rows.filter((s) => s.user_id !== payerId).map((s) => s.display_name?.trim().split(/\s+/)[0] ?? "").filter(Boolean);
  return { colleges: items.count ?? null, movesDone: tasks.count ?? null, studentNames };
}

export interface TrialEmailTarget {
  /** Who gets it: the payer of a subscription, or the student (their own account) of a cardless trial. */
  userId: string;
  studentIds: string[];
  trialEnd: string;
  /** A live subscription will charge at the end: the email says nothing to do. Without one it asks for a card. */
  hasCard: boolean;
  priceVariant: string | null;
}

/** The one email three days before a trial ends (advisor.md "2. The trial"), to the account's email; nothing when email isn't configured. */
export async function sendTrialEnding(service: SupabaseClient, target: TrialEmailTarget, siteUrl: string): Promise<{ sent: boolean; reason?: string }> {
  if (!emailConfigured()) return { sent: false, reason: "not-configured" };
  const { data: userRes, error } = await service.auth.admin.getUserById(target.userId);
  const email = error ? null : (userRes.user?.email ?? null);
  if (!email) return { sent: false, reason: "no-email" };
  const { data: profile } = await service.from("profiles").select("display_name").eq("id", target.userId).maybeSingle();
  const firstName = (profile as { display_name: string | null } | null)?.display_name?.trim().split(/\s+/)[0] ?? null;
  const since = new Date(new Date(target.trialEnd).getTime() - 14 * 86_400_000).toISOString();
  const facts = await trialFacts(service, target.studentIds, since, target.userId);
  const built = buildTrialEnding({ firstName, hasCard: target.hasCard, priceVariant: target.priceVariant, trialEnd: target.trialEnd, siteUrl, ...facts });
  const result = await sendEmail({ to: email, subject: built.subject, html: built.html, text: built.text });
  if (!result.sent) return { sent: false, reason: result.reason };
  await trackServer("trial_reminder_sent", { product: "student" }, target.userId);
  return { sent: true };
}

/** The reminder for a subscription's trial (Stripe's `trial_will_end`, or the reconcile), once per subscription. */
export async function sendTrialReminder(service: SupabaseClient, row: SubscriptionRow, siteUrl: string): Promise<{ sent: boolean; reason?: string }> {
  if (row.reminder_sent_at) return { sent: false, reason: "already-sent" };
  if (!row.trial_end) return { sent: false, reason: "no-trial-end" };
  const students = row.covers_student_id ? [row.covers_student_id] : row.covered_student_ids;
  const result = await sendTrialEnding(service, { userId: row.user_id, studentIds: students, trialEnd: row.trial_end, hasCard: true, priceVariant: row.price_variant }, siteUrl);
  if (!result.sent) return result;
  const { error } = await service.from("subscriptions").update({ reminder_sent_at: new Date().toISOString() }).eq("id", row.id);
  if (error) console.error(`billing: reminder sent for ${row.stripe_subscription_id} but recording it failed: ${error.message}`);
  return result;
}

/**
 * The reminder for a cardless trial (the nightly reconcile): to the student's own account when they have one, else to
 * the guardian managing the record; once per trial.
 */
export async function sendCardlessTrialReminder(service: SupabaseClient, trial: TrialRow, siteUrl: string): Promise<{ sent: boolean; reason?: string }> {
  if (trial.reminder_sent_at) return { sent: false, reason: "already-sent" };
  const { data } = await service.from("students").select("user_id, managed_by").eq("id", trial.student_id).is("deleted_at", null).maybeSingle();
  const s = data as { user_id: string | null; managed_by: string | null } | null;
  const userId = s?.user_id ?? s?.managed_by ?? null;
  if (!userId) return { sent: false, reason: "no-account" };
  const result = await sendTrialEnding(service, { userId, studentIds: [trial.student_id], trialEnd: trial.ends_at, hasCard: false, priceVariant: null }, siteUrl);
  if (!result.sent) return result;
  const { error } = await service.from("advisor_trials").update({ reminder_sent_at: new Date().toISOString() }).eq("student_id", trial.student_id);
  if (error) console.error(`billing: trial reminder sent for ${trial.student_id} but recording it failed: ${error.message}`);
  return result;
}

/** The site's origin for emails sent from a webhook (no request origin to trust there): the production URL, or Vercel's. */
export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SITE_URL || env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
