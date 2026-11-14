import "server-only";
/**
 * Stripe, behind one seam (specs/product/commercialization.md "Billing"): Checkout for a student's subscription (the
 * card collected, the year starting when the trial ends), Checkout in setup mode for a parent's card on file, the
 * server-made subscription charged against that card when a parent adds a student, the Customer Portal for cancel,
 * card, and invoices, the webhook's signature check, and the one function that copies a Stripe subscription into
 * `subscriptions` (`syncSubscription`), shared by the webhook, the return pages, and the nightly reconcile so every
 * path writes the same row. No card data ever touches the app: the browser goes to Stripe's hosted pages and comes back.
 *
 * Env (`.env.example`): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ADVISOR_STUDENT; STRIPE_AUTOMATIC_TAX=1
 * once Stripe Tax is registered. Without the first three, `billingConfigured()` is false and nothing on the site is
 * gated or sold (lib/entitlements.ts).
 */
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProduct, isSubscriptionStatus, LIST_VARIANT, priceFor, stripeTrialFor, type Product, type SubscriptionRow } from "./billing.ts";

export type BillingEnv = Record<string, string | undefined>;

/** The three variables billing needs; the price id is what the checkout sells. */
export function billingConfigured(env: BillingEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ADVISOR_STUDENT);
}

let client: Stripe | null = null;

/** The Stripe client, made once. Throws when the secret key is unset: callers check `billingConfigured()` first. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe isn't configured: set STRIPE_SECRET_KEY (specs/product/commercialization.md).");
  client ??= new Stripe(key, { appInfo: { name: "Quad", url: "https://usequad.app" } });
  return client;
}

/** The Stripe Price for the product (the list price; a price test's variants add their own ids later). */
export function priceIdFor(product: Product = "student", variant: string = LIST_VARIANT, env: BillingEnv = process.env): string {
  void product;
  void variant; // Only the list price has a Stripe Price today (lib/billing.ts PRICE_VARIANTS).
  const id = env.STRIPE_PRICE_ADVISOR_STUDENT;
  if (!id) throw new Error("Stripe isn't configured: no price id for the student product.");
  return id;
}

/** The product a Stripe Price id sells, by the env; null for a price Quad doesn't know. */
export function productForPrice(priceId: string | null | undefined, env: BillingEnv = process.env): Product | null {
  if (!priceId) return null;
  return priceId === env.STRIPE_PRICE_ADVISOR_STUDENT ? "student" : null;
}

const automaticTax = () => process.env.STRIPE_AUTOMATIC_TAX === "1";

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
/* Checkout, setup, and the portal                                     */
/* ------------------------------------------------------------------ */

/** What every subscription carries in its metadata, for the webhook to read back (session events don't carry it). */
export function subscriptionMetadata(input: { userId: string; studentId: string; priceVariant?: string }): Record<string, string> {
  return { user_id: input.userId, product: "student", student_id: input.studentId, covered_student_ids: input.studentId, price_variant: priceFor("student", input.priceVariant).variant };
}

export interface SubscriptionCheckoutInput {
  customerId: string;
  /** The payer. */
  user: { id: string };
  /** The student the subscription pays for. */
  studentId: string;
  /** The student's trial end (lib/billing.ts TrialRow); the charge waits for it when it is far enough ahead. */
  trialEnd: string | null;
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
 * A hosted Checkout session for one student's subscription: `mode: subscription`, the card collected now, the first
 * charge when the student's trial ends (Stripe's `trial_end`, or the remaining day or two as `trial_period_days` when
 * the end is closer than Checkout's two-day minimum), today when the trial is over. A trial that reaches its end with
 * no card never charges (`missing_payment_method: cancel`). Returns the URL to send the browser to.
 */
export async function createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<string> {
  const metadata = subscriptionMetadata({ userId: input.user.id, studentId: input.studentId, priceVariant: input.priceVariant });
  const trial = stripeTrialFor(input.trialEnd);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: priceIdFor("student", metadata.price_variant), quantity: 1 }],
    payment_method_collection: "always",
    subscription_data: {
      ...(trial !== null ? { ...trial, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
      metadata,
    },
    metadata,
    allow_promotion_codes: true,
    custom_text: { submit: { message: input.sentence } },
    ...(automaticTax() ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" } } : {}),
    success_url: `${input.origin}${input.successPath}`,
    cancel_url: `${input.origin}${input.cancelPath}`,
  });
  if (!session.url) throw new Error("billing: Stripe returned a checkout session without a URL.");
  return session.url;
}

/**
 * A hosted Checkout session in setup mode: the household's card, saved once to the parent's customer and charged for
 * each student they add (commercialization.md "Billing", the household card). Nothing is charged here.
 */
export async function createCardSetupCheckout(input: { customerId: string; userId: string; origin: string; successPath: string; cancelPath: string }): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    customer: input.customerId,
    currency: "usd",
    setup_intent_data: { metadata: { user_id: input.userId } },
    custom_text: { submit: { message: "Saved for your household. Each student you add is $20 a year after their 14-day trial, charged to this card." } },
    success_url: `${input.origin}${input.successPath}`,
    cancel_url: `${input.origin}${input.cancelPath}`,
  });
  if (!session.url) throw new Error("billing: Stripe returned a setup session without a URL.");
  return session.url;
}

export interface SavedCard {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
}

/** The card a finished setup session saved, or null when the session isn't a finished setup. */
export async function cardOfSetupSession(sessionId: string): Promise<{ customerId: string; userId: string | null; card: SavedCard } | null> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
  if (session.mode !== "setup" || session.status !== "complete") return null;
  const intent = session.setup_intent;
  if (!intent || typeof intent === "string") return null;
  const pm = intent.payment_method;
  if (!pm || typeof pm === "string") return null;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) return null;
  return { customerId, userId: intent.metadata?.user_id ?? null, card: { paymentMethodId: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null } };
}

/** Make a saved card the customer's default for invoices (so every subscription on the customer charges it). */
export async function setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
  await stripe().customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
}

/**
 * A subscription made by the server, no Checkout: a parent with a card on file adds a student (commercialization.md
 * "Billing"). Trialing until the student's trial ends, then charged to the card; charged today when the trial is over.
 */
export async function createStudentSubscription(input: { customerId: string; paymentMethodId: string; userId: string; studentId: string; trialEnd: string | null; priceVariant?: string }): Promise<Stripe.Subscription> {
  const metadata = subscriptionMetadata({ userId: input.userId, studentId: input.studentId, priceVariant: input.priceVariant });
  // The direct API takes any future end (Checkout's two-day minimum doesn't apply); a trial already over charges today.
  const endMs = input.trialEnd ? new Date(input.trialEnd).getTime() : NaN;
  const trialEnd = Number.isFinite(endMs) && endMs > Date.now() + 5 * 60_000 ? Math.floor(endMs / 1000) : null;
  return stripe().subscriptions.create({
    customer: input.customerId,
    items: [{ price: priceIdFor("student", metadata.price_variant), quantity: 1 }],
    default_payment_method: input.paymentMethodId,
    ...(trialEnd !== null ? { trial_end: trialEnd, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
    payment_settings: { save_default_payment_method: "on_subscription" },
    ...(automaticTax() ? { automatic_tax: { enabled: true } } : {}),
    metadata,
  });
}

/** The Customer Portal (cancel, card, invoices), returning to `returnUrl`. */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

/** Cancel at the period's end (during the trial: at its end, so the family keeps what it started), or undo that. */
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
 * The row a Stripe subscription means. `user_id` and the student come from the metadata the checkout set; a
 * subscription made outside the app (the dashboard) falls back to the customer's account and the price id. Null when
 * neither names an account, which the caller logs: a row without a user can't entitle anyone.
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
  const studentId = meta.student_id || null;
  const covered = (meta.covered_student_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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
    covers_student_id: studentId,
    covered_student_ids: covered.length ? covered : studentId ? [studentId] : [],
  };
}

export interface SyncResult {
  prev: SubscriptionRow | null;
  next: SubscriptionRow;
}

/**
 * Writes the row for `sub` (insert or update by `stripe_subscription_id`) with the secret-key client and returns the
 * row as it was before, for the events the change means (lib/billing.ts billingEvents). Null when the subscription
 * names no account Quad knows.
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

/** The subscription a finished Checkout session made, fetched from Stripe; null when the session has none. */
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
