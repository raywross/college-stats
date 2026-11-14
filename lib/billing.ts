/**
 * Quad Advisor's commercial rules (specs/product/commercialization.md; specs/product/advisor.md "2. The trial";
 * specs/product/open-doors.md "Early accounts"): the two products and their list prices, the feature map the
 * entitlement hook reads from, what a set of subscription rows means for one student, who is an early account, and
 * the sentences the checkout, the account page, and the Advisor tab say about it. Pure: no I/O, no Stripe, so
 * tests/billing.test.mts runs every rule under plain `node --test` and the server glue (lib/entitlements.ts,
 * lib/stripe.ts) stays thin.
 *
 * What is never here: a weight, a threshold, or a rule of Quad's estimate (that is specs/chances/); a card number or
 * any payment detail (Stripe holds those; the app only ever sees ids and statuses).
 */
import type { Capability } from "./planner/types.ts";

/* ------------------------------------------------------------------ */
/* Products and prices                                                 */
/* ------------------------------------------------------------------ */

/** The two yearly products (commercialization.md "Prices"): one student, or every student in a guardian's households. */
export type Product = "student" | "family";
export const PRODUCTS: readonly Product[] = ["student", "family"];

export function isProduct(v: unknown): v is Product {
  return v === "student" || v === "family";
}

/** The list prices, in whole dollars a year (owner, 2026-10-26). A price test's variants are never below these. */
export const LIST_PRICES: Record<Product, number> = { student: 20, family: 30 };

/**
 * Price variants (commercialization.md "Price tests"): a key a campaign link carries, resolving to a yearly price per
 * product. Only the list price exists until the Growth console issues campaign codes; each later variant is one Stripe
 * Price on the same two Products, named here, so the checkout, the webhooks, and the entitlements don't change.
 */
export const PRICE_VARIANTS: Record<string, Record<Product, number>> = { list: LIST_PRICES };
export const LIST_VARIANT = "list";

/** The yearly price for a product under a variant; an unknown variant is the list price (never a surprise). */
export function priceFor(product: Product, variant: string | null | undefined = LIST_VARIANT): { variant: string; dollars: number } {
  const key = variant && PRICE_VARIANTS[variant] ? variant : LIST_VARIANT;
  return { variant: key, dollars: PRICE_VARIANTS[key][product] };
}

export const PRODUCT_LABEL: Record<Product, string> = { student: "Advisor, one student", family: "Advisor, family" };

/** "$20" (whole dollars; the prices are whole). */
export const dollars = (n: number) => `$${n}`;

/** "$20 a year" / "$30 a year". */
export function priceLabel(product: Product, variant?: string | null): string {
  return `${dollars(priceFor(product, variant).dollars)} a year`;
}

/* ------------------------------------------------------------------ */
/* The trial                                                           */
/* ------------------------------------------------------------------ */

/** Owner's rule (2026-10-26): 14 days free, card up front, annual only. */
export const TRIAL_DAYS = 14;

/** A student may start their own trial at this age (owner, 2026-10-26: "fine to allow students 16 and older to pay with a card"). */
export const SELF_PAY_AGE = 16;
/** Under this age the checkout asks the student to confirm a parent's permission (the Terms say a minor buys with one). */
export const ADULT_AGE = 18;

/**
 * The age a birth year implies on `today`, counted the way lib/accounts.ts counts (someone born in Y turns N in Y+N;
 * with only a year, the birthday is taken as already passed). Null without a year.
 */
export function ageFrom(birthYear: number | null | undefined, today: Date = new Date()): number | null {
  if (birthYear === null || birthYear === undefined || !Number.isFinite(birthYear)) return null;
  return today.getUTCFullYear() - birthYear;
}

/**
 * Who may start a trial from their own account (advisor.md "Who can start one"): a guardian, or a student 16 or
 * older. A student under 16 asks a parent; a student with no birth year on file is asked for one first.
 */
export type StarterRule = { ok: true; confirmPermission: boolean } | { ok: false; reason: "under-age" | "no-birth-year" };

export function starterRule(input: { isGuardian: boolean; birthYear: number | null }, today: Date = new Date()): StarterRule {
  if (input.isGuardian) return { ok: true, confirmPermission: false };
  const age = ageFrom(input.birthYear, today);
  if (age === null) return { ok: false, reason: "no-birth-year" };
  if (age < SELF_PAY_AGE) return { ok: false, reason: "under-age" };
  return { ok: true, confirmPermission: age < ADULT_AGE };
}

/** The day a trial started on `start` ends (14 days on). */
export function trialEndFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * 86_400_000);
}

/** "Nov 28", or "Nov 28, 2027" when the year isn't today's. */
export function shortDay(iso: string | Date, today: Date = new Date(), timeZone = "America/New_York"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const year = (x: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(x);
  const sameYear = year(d) === year(today);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone }).format(d);
}

/** The checkout's sentence, in Quad's words above Stripe's (advisor.md "2. The trial"). */
export function checkoutSentence(product: Product, trialEnd: Date, variant?: string | null, today: Date = new Date()): string {
  return `Free for ${TRIAL_DAYS} days. Cancel any time before ${shortDay(trialEnd, today)} and you won't be charged. After that, ${priceLabel(product, variant)}.`;
}

/* ------------------------------------------------------------------ */
/* Early accounts                                                      */
/* ------------------------------------------------------------------ */

/** The `app_settings` key: the moment the price went live (an ISO timestamp), or unset while the Advisor is free for everyone. */
export const PRICE_LIVE_SETTING = "advisor.price_live_at";

/**
 * Early accounts keep the Advisor free through the end of the application cycle in which the price goes live, August 31,
 * 2027 (open-doors.md, owner decision 1). A policy date, not a data year; written as a Date so the lineage guard on
 * data years doesn't read it as one.
 */
export const EARLY_FREE_THROUGH = new Date(Date.UTC(2027, 7, 31, 23, 59, 59));

/** The setting's value as a date, or null when unset or unreadable. */
export function parsePriceLiveAt(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * An early account was created before the price went live (open-doors.md: `created_at < price_live_at`, no column, no
 * backfill). With the setting unset everyone is early, which is what keeps today's site free until the owner flips it.
 */
export function isEarly(created: string | Date | null | undefined, priceLiveAt: Date | null): boolean {
  if (priceLiveAt === null) return true;
  if (!created) return false;
  const c = typeof created === "string" ? new Date(created) : created;
  return !Number.isNaN(c.getTime()) && c.getTime() < priceLiveAt.getTime();
}

/** Whether early accounts' free period is still running on `today`. */
export function earlyFreeRunning(today: Date = new Date()): boolean {
  return today.getTime() <= EARLY_FREE_THROUGH.getTime();
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

/** Stripe's subscription statuses, as stored in `subscriptions.status` (the webhook copies Stripe's word). */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"];

export function isSubscriptionStatus(v: unknown): v is SubscriptionStatus {
  return typeof v === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(v);
}

/** One row of public.subscriptions (supabase/migrations/20261114120000_subscriptions.sql), as the app reads it. */
export interface SubscriptionRow {
  id: string;
  user_id: string;
  product: Product;
  status: SubscriptionStatus;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  price_id: string | null;
  price_variant: string;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  /** A student plan: the one student it covers. Null on a family plan (every student in the buyer's households). */
  covers_student_id: string | null;
  /** Every student this subscription's trial has covered, for "one trial per student". */
  covered_student_ids: string[];
  reminder_sent_at: string | null;
  created: string;
  updated: string;
}

/** Statuses under which the advisor is whole: the trial, a paid year, and the retry window after a failed charge. */
export const WHOLE_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due"];

/**
 * A student's advisor status from the subscriptions that cover them: the best live one wins (a paid year over a
 * trial), then a lapsed one, then none. `incomplete` (a checkout that never finished) counts as none.
 */
export type StatusWord = "trial" | "active" | "none" | "lapsed";

export function statusFrom(rows: readonly Pick<SubscriptionRow, "status">[]): StatusWord {
  const statuses = new Set(rows.map((r) => r.status));
  if (statuses.has("active") || statuses.has("past_due")) return "active";
  if (statuses.has("trialing")) return "trial";
  if (statuses.has("canceled") || statuses.has("unpaid") || statuses.has("incomplete_expired") || statuses.has("paused")) return "lapsed";
  return "none";
}

/** The row that decides a student's status (the live one, else the most recently updated), or null. */
export function decidingRow<R extends Pick<SubscriptionRow, "status" | "updated">>(rows: readonly R[]): R | null {
  const live = rows.filter((r) => (WHOLE_STATUSES as readonly string[]).includes(r.status));
  const pool = live.length ? live : rows;
  return [...pool].sort((a, b) => b.updated.localeCompare(a.updated))[0] ?? null;
}

/**
 * A student's advisor status, the one fact about money a counselor sees (specs/product/counselor-portal.md "The
 * caseload", "The channel"): a quiet chip on the caseload row, never a price. "preview" for everyone until billing
 * ships (the price not live); then Advisor, Trial, Not yet, or Lapsed. An early account reads "Advisor": the guides
 * open for them. Here, not in lib/entitlements.ts, because client components import the caseload module.
 */
export type AdvisorStatus = "preview" | "trial" | "active" | "none" | "lapsed";

/** The chip's words. */
export const ADVISOR_STATUS_LABEL: Record<AdvisorStatus, string> = {
  preview: "Preview",
  trial: "Trial",
  active: "Advisor",
  none: "Not yet",
  lapsed: "Lapsed",
};

/* ------------------------------------------------------------------ */
/* Entitlements                                                        */
/* ------------------------------------------------------------------ */

/** The one answer the hook needs about a student: whole, or read-only, and why. */
export interface Entitlement {
  status: StatusWord;
  /** Every capability in the map, writes included. False: the free rows and the read-only plan. */
  whole: boolean;
  /** Why it's whole: the price isn't live, the account is early, or a subscription covers the student. */
  because: "not-live" | "early" | "subscription" | null;
  /** The subscription behind `status`, when one covers the student. */
  row: SubscriptionRow | null;
}

export interface EntitlementInput {
  /** The `advisor.price_live_at` setting, parsed. Null: the price isn't live and everyone has everything. */
  priceLiveAt: Date | null;
  /** Billing can't run without Stripe's keys; without them nothing is gated, whatever the setting says. */
  stripeConfigured: boolean;
  /** When the accounts behind the student were created (the student's own, or their manager's): any early one counts. */
  accountsCreated: readonly (string | null)[];
  rows: readonly SubscriptionRow[];
  today?: Date;
}

export function entitlementFrom(input: EntitlementInput): Entitlement {
  const today = input.today ?? new Date();
  const status = statusFrom(input.rows);
  const row = decidingRow(input.rows);
  if (!input.stripeConfigured || input.priceLiveAt === null) return { status, whole: true, because: "not-live", row };
  if (status === "trial" || status === "active") return { status, whole: true, because: "subscription", row };
  if (earlyFreeRunning(today) && input.accountsCreated.some((c) => isEarly(c, input.priceLiveAt))) return { status, whole: true, because: "early", row };
  return { status, whole: false, because: null, row };
}

/**
 * The feature map's one list (commercialization.md "Feature map"), as the entitlement code reads it: the rows with a
 * capability name, whether the free account has them, and whether a lapsed plan may still read them. The free rows
 * are what is live today beyond the plan; everything the Advisor tab does is the plan.
 */
export interface FeatureRow {
  capability: Capability;
  label: string;
  free: boolean;
  /** A lapsed plan keeps reading this (the list, the calendar, the offers stay visible); writes stop either way. */
  readWhenLapsed: boolean;
}

export const FEATURE_MAP: readonly FeatureRow[] = [
  { capability: "visits.view", label: "A college's event calendar on its page and your visits page", free: true, readWhenLapsed: true },
  { capability: "api.key", label: "Data API: a personal key, 5,000 requests a day", free: true, readWhenLapsed: true },
  { capability: "planner.tab", label: "The advisor: your list with levels and its shape, the season's three things to do and every guide", free: false, readWhenLapsed: true },
  { capability: "planner.rounds", label: "Early rounds: the ED opportunity pills and the ED sheet", free: false, readWhenLapsed: true },
  { capability: "planner.actions.visits", label: "The visit log and the Show interest guide's tracking", free: false, readWhenLapsed: false },
  { capability: "planner.calendar", label: "The Calendar tab, its feed, and print", free: false, readWhenLapsed: true },
  { capability: "planner.reminders", label: "Reminder emails (Your week)", free: false, readWhenLapsed: false },
  { capability: "planner.texts", label: "A text the evening before a hard deadline", free: false, readWhenLapsed: false },
  { capability: "planner.parents.nudge", label: "A parent's nudge", free: false, readWhenLapsed: false },
  { capability: "planner.offers", label: "Offers side by side and the choice", free: false, readWhenLapsed: true },
  { capability: "advisor.essays", label: "The Essays tab: drafts, the reader's notes, suggested changes", free: false, readWhenLapsed: true },
  { capability: "advisor.reviews", label: "A reader's notes on an essay draft", free: false, readWhenLapsed: false },
  { capability: "visits.alerts", label: "Visit alert emails within your radius of home", free: false, readWhenLapsed: false },
  { capability: "cost.family", label: "Your family's price per college on the list and the four-year total", free: false, readWhenLapsed: true },
  { capability: "plan.dossier", label: "The family PDF dossier", free: false, readWhenLapsed: false },
];

const FEATURE_BY_CAPABILITY = new Map(FEATURE_MAP.map((r) => [r.capability, r]));

export function featureRow(capability: Capability): FeatureRow {
  const row = FEATURE_BY_CAPABILITY.get(capability);
  if (!row) throw new Error(`entitlements: ${capability} isn't in the feature map`);
  return row;
}

/**
 * Whether `capability` is allowed under `entitlement`. A free row always; a whole advisor everything; a lapsed or
 * never-started plan reads what the map lets it read and writes nothing (commercialization.md "When a plan lapses").
 */
export function allowedUnder(entitlement: Pick<Entitlement, "whole">, capability: Capability, mode: "read" | "write" = "write"): boolean {
  const row = featureRow(capability);
  if (row.free || entitlement.whole) return true;
  return mode === "read" && row.readWhenLapsed;
}

/* ------------------------------------------------------------------ */
/* Webhooks: what changed                                              */
/* ------------------------------------------------------------------ */

/** The server telemetry events a change in a subscription's row means (specs/product/telemetry.md). */
export type BillingEvent = "trial_started" | "trial_converted" | "trial_cancelled" | "subscription_cancelled" | "subscription_renewed";

type Transition = Pick<SubscriptionRow, "status" | "current_period_end" | "cancel_at_period_end">;

/**
 * The events to send when a subscription's stored row goes from `prev` (null: first seen) to `next`. Pure, so the
 * webhook and the nightly reconcile say the same things and tests can list them. A cancel-at-period-end during the
 * trial is the cancellation (the family keeps the 14 days); a later resume isn't an event.
 */
export function billingEvents(prev: Transition | null, next: Transition): BillingEvent[] {
  const out: BillingEvent[] = [];
  if (!prev) {
    if (next.status === "trialing") out.push("trial_started");
    return out;
  }
  const wasLive = prev.status === "active" || prev.status === "past_due";
  const ended = next.status === "canceled" || next.status === "unpaid" || next.status === "incomplete_expired";
  if (prev.status === "trialing" && next.status === "active") out.push("trial_converted");
  if (prev.status === "trialing" && ended) out.push("trial_cancelled");
  if (prev.status === "trialing" && next.status === "trialing" && !prev.cancel_at_period_end && next.cancel_at_period_end) out.push("trial_cancelled");
  if (wasLive && ended) out.push("subscription_cancelled");
  if (wasLive && next.status === "active" && !prev.cancel_at_period_end && next.cancel_at_period_end) out.push("subscription_cancelled");
  if (prev.status === "active" && next.status === "active" && prev.current_period_end && next.current_period_end && next.current_period_end > prev.current_period_end) out.push("subscription_renewed");
  return out;
}

/** The day of the trial a cancellation landed on (1 to 14), for `trial_cancelled {day}`; null without a trial end. */
export function trialDay(trialEnd: string | null, at: Date = new Date()): number | null {
  if (!trialEnd) return null;
  const end = new Date(trialEnd).getTime();
  const start = end - TRIAL_DAYS * 86_400_000;
  const day = Math.floor((at.getTime() - start) / 86_400_000) + 1;
  return Math.min(TRIAL_DAYS, Math.max(1, day));
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/** The Advisor tab's quiet line while a trial runs: "Trial ends Nov 28". */
export function trialEndsLine(trialEnd: string, today: Date = new Date()): string {
  return `Trial ends ${shortDay(trialEnd, today)}`;
}

/** The read-only banner's first sentence, by how the plan got there. */
export function lapsedLine(status: StatusWord, firstName: string | null): string {
  const whose = firstName ? `${firstName}'s advisor` : "Your advisor";
  if (status === "lapsed") return `${whose} is read-only: the list, its levels, the calendar, and the offers stay; the guides and changes wait for a subscription.`;
  return `${whose} is read-only until a trial starts: the list, its levels, the calendar, and the offers stay; the guides and changes come with it.`;
}

/** The splash page's and the pricing page's price line once the trial is live. */
export function trialPriceLine(variant?: string | null): string {
  return `${priceLabel("student", variant)} after, or ${dollars(priceFor("family", variant).dollars)} for the whole family. Cancel before the trial ends and pay nothing.`;
}

/** The splash page's button once the trial is live. */
export const TRIAL_CTA = `Start your ${TRIAL_DAYS}-day free trial`;

/** The refund rule, stated on the pricing page (commercialization.md "Billing"). */
export const REFUND_RULE = `The trial is the refund policy: ${TRIAL_DAYS} days free with your card on file, and nothing is charged if you cancel before it ends. After a charge, a refund within ${TRIAL_DAYS} days on request if the list has fewer than three colleges and no guide was completed.`;
