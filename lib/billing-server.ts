import "server-only";
/**
 * Billing's server helpers, shared by the checkout action, the webhook, the return page, and the nightly reconcile
 * (specs/product/commercialization.md "Billing"): the secret-key client, which students a family plan covers at its
 * start, what to say about a change (telemetry), the reminder email, and `applySubscription()`, the one path that
 * stores a Stripe subscription and then says and sends what the change means.
 */
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingEvents, trialDay, type BillingEvent, type SubscriptionRow } from "./billing.ts";
import { buildTrialEnding } from "./emails/trial-ending.ts";
import { emailConfigured, sendEmail } from "./email.ts";
import { trackServer } from "./analytics-server.ts";
import { supabaseClient } from "./supabase.ts";
import { syncSubscription, type SyncResult } from "./stripe.ts";

/** The secret-key client: subscriptions are written by the server alone. */
export function billingService(): SupabaseClient {
  return supabaseClient("publish");
}

/**
 * The students a guardian's family plan covers when it starts (commercialization.md "Billing": every student in the
 * guardian's active households, and the records they manage), recorded on the subscription for "one trial per student".
 */
export async function familyStudentsOf(service: SupabaseClient, userId: string): Promise<string[]> {
  const [members, managed] = await Promise.all([
    service.from("household_members").select("household_id").eq("user_id", userId).eq("role", "guardian").eq("status", "active"),
    service.from("students").select("id").eq("managed_by", userId).is("deleted_at", null),
  ]);
  const households = ((members.data ?? []) as { household_id: string }[]).map((m) => m.household_id);
  const kids = households.length
    ? await service.from("household_members").select("student_id").in("household_id", households).eq("role", "student").eq("status", "active").not("student_id", "is", null)
    : { data: [] as { student_id: string | null }[] };
  const ids = new Set<string>();
  for (const k of (kids.data ?? []) as { student_id: string | null }[]) if (k.student_id) ids.add(k.student_id);
  for (const m of (managed.data ?? []) as { id: string }[]) ids.add(m.id);
  return [...ids];
}

/** The server events a stored change means, sent with the buyer as the person. */
export async function trackBilling(events: readonly BillingEvent[], row: SubscriptionRow, at = new Date()): Promise<void> {
  for (const event of events) {
    const base = { product: row.product };
    if (event === "trial_started" || event === "trial_converted" || event === "subscription_renewed") await trackServer(event, { ...base, price_variant: row.price_variant }, row.user_id);
    else if (event === "trial_cancelled") await trackServer(event, { ...base, day: trialDay(row.trial_end, at) }, row.user_id);
    else await trackServer(event, base, row.user_id);
  }
}

/** Store a Stripe subscription and say what changed. The webhook, the return page, and the reconcile all come here. */
export async function applySubscription(service: SupabaseClient, sub: Stripe.Subscription): Promise<SyncResult | null> {
  const result = await syncSubscription(service, sub);
  if (!result) return null;
  const events = billingEvents(result.prev, result.next);
  if (events.length) await trackBilling(events, result.next);
  return result;
}

/* ------------------------------------------------------------------ */
/* The reminder                                                        */
/* ------------------------------------------------------------------ */

/** What the trial covered so far: colleges on the covered students' lists, moves done since it began. */
export async function trialFacts(service: SupabaseClient, row: SubscriptionRow): Promise<{ colleges: number | null; movesDone: number | null; studentNames: string[] }> {
  const students = row.covered_student_ids;
  if (!students.length) return { colleges: null, movesDone: null, studentNames: [] };
  const since = row.trial_end ? new Date(new Date(row.trial_end).getTime() - 14 * 86_400_000).toISOString() : row.created;
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
  // The buyer's own record isn't "Jordan's advisor" to them.
  const studentNames = rows.filter((s) => s.user_id !== row.user_id).map((s) => s.display_name?.trim().split(/\s+/)[0] ?? "").filter(Boolean);
  return { colleges: items.count ?? null, movesDone: tasks.count ?? null, studentNames };
}

/**
 * The one email three days before a trial ends (advisor.md "2. The trial"). Sent once per subscription
 * (`reminder_sent_at`), to the buyer's account email; nothing when email isn't configured.
 */
export async function sendTrialReminder(service: SupabaseClient, row: SubscriptionRow, siteUrl: string): Promise<{ sent: boolean; reason?: string }> {
  if (row.reminder_sent_at) return { sent: false, reason: "already-sent" };
  if (!row.trial_end) return { sent: false, reason: "no-trial-end" };
  if (!emailConfigured()) return { sent: false, reason: "not-configured" };
  const { data: userRes, error } = await service.auth.admin.getUserById(row.user_id);
  const email = error ? null : (userRes.user?.email ?? null);
  if (!email) return { sent: false, reason: "no-email" };
  const { data: profile } = await service.from("profiles").select("display_name").eq("id", row.user_id).maybeSingle();
  const firstName = (profile as { display_name: string | null } | null)?.display_name?.trim().split(/\s+/)[0] ?? null;
  const facts = await trialFacts(service, row);
  const built = buildTrialEnding({ firstName, product: row.product, priceVariant: row.price_variant, trialEnd: row.trial_end, siteUrl, ...facts });
  const result = await sendEmail({ to: email, subject: built.subject, html: built.html, text: built.text });
  if (!result.sent) return { sent: false, reason: result.reason };
  const { error: markError } = await service.from("subscriptions").update({ reminder_sent_at: new Date().toISOString() }).eq("id", row.id);
  if (markError) console.error(`billing: reminder sent for ${row.stripe_subscription_id} but recording it failed: ${markError.message}`);
  await trackServer("trial_reminder_sent", { product: row.product }, row.user_id);
  return { sent: true };
}

/** The site's origin for emails sent from a webhook (no request origin to trust there): the production URL, or Vercel's. */
export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SITE_URL || env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
