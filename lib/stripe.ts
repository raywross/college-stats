import "server-only";
/**
 * Stripe, behind one seam (specs/product/commercialization.md "Billing"; specs/product/advisor.md "2. The trial"):
 * Checkout for the 14-day trial with the card up front, the Customer Portal for cancel, card, and invoices, the
 * webhook's signature check, and the one function that copies a Stripe subscription into `subscriptions`
 * (`syncSubscription`), shared by the webhook, the checkout's return page, and the nightly reconcile so every path
 * writes the same row. No card data ever touches the app: the browser goes to Stripe's hosted pages and comes back.
 *
 * Env (`.env.example`): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ADVISOR_STUDENT, STRIPE_PRICE_ADVISOR_FAMILY;
 * STRIPE_AUTOMATIC_TAX=1 once Stripe Tax is registered. Without the first four, `billingConfigured()` is false and
 * nothing on the site is gated or sold (lib/entitlements.ts).
 */
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProduct, isSubscriptionStatus, LIST_VARIANT, priceFor, TRIAL_DAYS, type Product, type SubscriptionRow } from "./billing.ts";

export type BillingEnv = Record<string, string | undefined>;

/** The four variables billing needs; the price ids are what the checkout sells. */
export function billingConfigured(env: BillingEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ADVISOR_STUDENT && env.STRIPE_PRICE_ADVISOR_FAMILY);
}

let client: Stripe | null = null;

/** The Stripe client, made once. Throws when the secret key is unset: callers check `billingConfigured()` first. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe isn't configured: set STRIPE_SECRET_KEY (specs/product/commercialization.md).");
  client ??= new Stripe(key, { appInfo: { name: "Quad", url: "https://usequad.app" } });
  return client;
}

/** The Stripe Price for a product (the list price; a price test's variants add their own ids later). */
export function priceIdFor(product: Product, variant: string = LIST_VARIANT, env: BillingEnv = process.env): string {
  void variant; // Only the list price has a Stripe Price today (lib/billing.ts PRICE_VARIANTS).
  const id = product === "student" ? env.STRIPE_PRICE_ADVISOR_STUDENT : env.STRIPE_PRICE_ADVISOR_FAMILY;
  if (!id) throw new Error(`Stripe isn't configured: no price id for the ${product} product.`);
  return id;
}

/** The product a Stripe Price id sells, by the env; null for a price Quad doesn't know. */
export function productForPrice(priceId: string | null | undefined, env: BillingEnv = process.env): Product | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_ADVISOR_STUDENT) return "student";
  if (priceId === env.STRIPE_PRICE_ADVISOR_FAMILY) return "family";
  return null;
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

/**
 * The Stripe customer for an account: the stored one, else made now (email and `user_id` in metadata) and stored.
 * `service` is the secret-key client (billing_customers is written by the server only).
 */
export async function ensureCustomer(service: SupabaseClient, user: { id: string; email: string | null }): Promise<string> {
  const { data } = await service.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  const stored = (data as { stripe_customer_id: string } | null)?.stripe_customer_id;
  if (stored) return stored;
  const customer = await stripe().customers.create({ ...(user.email ? { email: user.email } : {}), metadata: { user_id: user.id } });
  const { error } = await service.from("billing_customers").insert({ user_id: user.id, stripe_customer_id: customer.id });
  if (error) {
    // Two checkouts racing: the other insert won; use its customer and let this one go unused.
    const again = await service.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    const winner = (again.data as { stripe_customer_id: string } | null)?.stripe_customer_id;
    if (winner) return winner;
    throw new Error(`billing: storing the Stripe customer failed: ${error.message}`);
  }
  return customer.id;
}

/* ------------------------------------------------------------------ */
/* Checkout and the portal                                             */
/* ------------------------------------------------------------------ */

export interface CheckoutInput {
  customerId: string;
  user: { id: string };
  product: Product;
  /** A student plan: the student it covers. A family plan: the guardian's students at the start, for the trial record. */
  studentId: string | null;
  coveredStudentIds: string[];
  /** False when every covered student has had a trial before (one trial per student): the year starts at once. */
  trial: boolean;
  priceVariant?: string;
  /** Quad's sentence above Stripe's button (lib/billing.ts checkoutSentence). */
  sentence: string;
  /** The site's origin, no trailing slash. */
  origin: string;
  /** Where to come back to; `{CHECKOUT_SESSION_ID}` is filled by Stripe. */
  successPath: string;
  cancelPath: string;
}

/**
 * A hosted Checkout session for the trial (advisor.md "2. The trial"): `mode: subscription`, 14 days free, the card
 * collected up front, and a trial that ends without a card ends with a cancel, never a charge. The metadata on the
 * subscription (not only the session) is what the webhook reads, since subscription events carry it and session
 * events don't. Returns the URL to send the browser to.
 */
export async function createTrialCheckout(input: CheckoutInput): Promise<string> {
  const variant = priceFor(input.product, input.priceVariant).variant;
  const metadata = {
    user_id: input.user.id,
    product: input.product,
    student_id: input.studentId ?? "",
    covered_student_ids: input.coveredStudentIds.join(","),
    price_variant: variant,
  };
  const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === "1";
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: priceIdFor(input.product, variant), quantity: 1 }],
    payment_method_collection: "always",
    subscription_data: {
      ...(input.trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
      metadata,
    },
    metadata,
    allow_promotion_codes: true,
    custom_text: { submit: { message: input.sentence } },
    ...(automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" } } : {}),
    success_url: `${input.origin}${input.successPath}`,
    cancel_url: `${input.origin}${input.cancelPath}`,
  });
  if (!session.url) throw new Error("billing: Stripe returned a checkout session without a URL.");
  return session.url;
}

/** The Customer Portal (cancel, card, invoices), returning to `returnUrl`. */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

/** Cancel at the period's end (during the trial: at day 14, so the family keeps what it started), or undo that. */
export async function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<Stripe.Subscription> {
  return stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/** The verified event, or null when the signature doesn't match (the caller answers 400). */
export async function webhookEvent(rawBody: string, signature: string | null): Promise<Stripe.Event | null> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;
  try {
    return await stripe().webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Copying a subscription into the table                               */
/* ------------------------------------------------------------------ */

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

/**
 * The row a Stripe subscription means. `user_id` and the product come from the metadata the checkout set; a
 * subscription made outside the checkout (the dashboard) falls back to the customer's account and the price id. Null
 * when neither names an account, which the caller logs: a row without a user can't entitle anyone.
 */
export function rowFromStripe(sub: Stripe.Subscription, userIdFromCustomer: string | null, env: BillingEnv = process.env): Omit<SubscriptionRow, "id" | "created" | "updated" | "reminder_sent_at"> | null {
  const meta = sub.metadata ?? {};
  const userId = meta.user_id || userIdFromCustomer;
  if (!userId) return null;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const product = isProduct(meta.product) ? meta.product : productForPrice(priceId, env);
  if (!product) return null;
  const status = isSubscriptionStatus(sub.status) ? sub.status : null;
  if (!status) return null;
  const covered = (meta.covered_student_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const studentId = meta.student_id || null;
  return {
    user_id: userId,
    product,
    status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    price_variant: meta.price_variant || LIST_VARIANT,
    trial_end: iso(sub.trial_end),
    current_period_end: iso(item?.current_period_end),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    canceled_at: iso(sub.canceled_at),
    covers_student_id: product === "student" ? studentId : null,
    covered_student_ids: covered.length ? covered : studentId ? [studentId] : [],
  };
}

export interface SyncResult {
  prev: SubscriptionRow | null;
  next: SubscriptionRow;
}

/**
 * Writes the row for `sub` (insert or update by `stripe_subscription_id`) with the secret-key client and returns the
 * row as it was before, for the events the change means (lib/billing.ts billingEvents). The covered-students list
 * only grows: a family plan's students at the start stay recorded after they leave the household, so "one trial per
 * student" holds. Null when the subscription names no account Quad knows.
 */
export async function syncSubscription(service: SupabaseClient, sub: Stripe.Subscription): Promise<SyncResult | null> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data: existing } = await service.from("subscriptions").select("*").eq("stripe_subscription_id", sub.id).maybeSingle();
  const prev = (existing as SubscriptionRow | null) ?? null;
  let userId = prev?.user_id ?? null;
  if (!userId) {
    const { data } = await service.from("billing_customers").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = (data as { user_id: string } | null)?.user_id ?? null;
  }
  const mapped = rowFromStripe(sub, userId);
  if (!mapped) {
    console.error(`billing: subscription ${sub.id} (customer ${customerId}) names no Quad account or product; not stored.`);
    return null;
  }
  const covered = [...new Set([...(prev?.covered_student_ids ?? []), ...mapped.covered_student_ids])];
  const row = { ...mapped, covered_student_ids: covered, updated: new Date().toISOString() };
  const { data: written, error } = await service.from("subscriptions").upsert(row, { onConflict: "stripe_subscription_id" }).select("*").single();
  if (error) throw new Error(`billing: writing subscription ${sub.id} failed: ${error.message}`);
  return { prev, next: written as SubscriptionRow };
}

/** The subscription a finished Checkout session made, fetched from Stripe; null when the session has none yet. */
export async function subscriptionOfSession(sessionId: string): Promise<Stripe.Subscription | null> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  const sub = session.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? stripe().subscriptions.retrieve(sub) : sub;
}

/** One subscription, fresh from Stripe (the nightly reconcile). */
export async function fetchSubscription(id: string): Promise<Stripe.Subscription> {
  return stripe().subscriptions.retrieve(id);
}
