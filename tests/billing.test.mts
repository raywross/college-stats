/**
 * Quad Advisor's billing rules (lib/billing.ts; specs/product/commercialization.md "Files"): one price, $20 a student
 * a year; the trial that starts with the student's record and needs no card; what a student's trial and subscriptions
 * mean; every capability a spec names appears in the map; the free column matches what is live except the plan; a
 * lapsed plan is read-only, never emptied; early accounts (specs/product/open-doors.md); what a change in a
 * subscription means for telemetry; the Stripe mapping's rules and the SQL's; the trial email in both forms; and the
 * entitlement glue's unconfigured path. No network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allowedUnder,
  billingEvents,
  checkoutSentence,
  decidingRow,
  entitlementFrom,
  FEATURE_MAP,
  isEarly,
  LIST_PRICES,
  parsePriceLiveAt,
  priceFor,
  priceLabel,
  PRODUCTS,
  statusFrom,
  stripeTrialEnd,
  stripeTrialFor,
  trialDay,
  trialEndFrom,
  trialEndsLine,
  trialPriceLine,
  trialRunning,
  type SubscriptionRow,
  type TrialRow,
} from "../lib/billing.ts";
import { buildTrialEnding, coveredLine } from "../lib/emails/trial-ending.ts";
import { ADVISOR_STATUS_LABEL, advisorStatusFor, allowed, CAPABILITIES } from "../lib/entitlements.ts";
import { EVENTS } from "../lib/analytics.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const TODAY = new Date("2026-11-14T12:00:00Z");

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "s1",
    user_id: "u1",
    product: "student",
    status: "trialing",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    price_id: "price_s",
    price_variant: "list",
    trial_end: "2026-11-28T12:00:00Z",
    current_period_end: "2026-11-28T12:00:00Z",
    cancel_at_period_end: false,
    canceled_at: null,
    covers_student_id: "st1",
    covered_student_ids: ["st1"],
    reminder_sent_at: null,
    created: "2026-11-14T12:00:00Z",
    updated: "2026-11-14T12:00:00Z",
    ...over,
  };
}

function trial(over: Partial<TrialRow> = {}): TrialRow {
  return { student_id: "st1", started_at: "2026-11-14T12:00:00Z", ends_at: "2026-11-28T12:00:00Z", source: "student", reminder_sent_at: null, ...over };
}

/* ------------------------------------------------------------------ */
/* The price and the words                                             */
/* ------------------------------------------------------------------ */

test("one product at the owner's price: $20 a year per student; an unknown variant falls back to it", () => {
  assert.deepEqual(PRODUCTS, ["student"]);
  assert.deepEqual(LIST_PRICES, { student: 20 });
  assert.equal(priceLabel("student"), "$20 a year");
  assert.deepEqual(priceFor("student", "nonsense"), { variant: "list", dollars: 20 });
  assert.equal(trialPriceLine(), "14 days free with your card on file, then $20 a year. Cancel before the trial ends and pay nothing.");
});

test("stripeTrialFor: the trial's own end when two days or more ahead, the remaining day or two when closer, nothing when over", () => {
  assert.deepEqual(stripeTrialFor("2026-11-28T12:00:00Z", TODAY), { trial_end: Math.floor(new Date("2026-11-28T12:00:00Z").getTime() / 1000) });
  assert.deepEqual(stripeTrialFor("2026-11-16T00:00:00Z", TODAY), { trial_period_days: 2 });
  assert.deepEqual(stripeTrialFor("2026-11-14T20:00:00Z", TODAY), { trial_period_days: 1 });
  assert.equal(stripeTrialFor("2026-11-14T11:00:00Z", TODAY), null);
  assert.equal(stripeTrialFor(null, TODAY), null);
});

test("the checkout sentence waits for a trial still two days or more ahead, else says the year starts today", () => {
  const end = trialEndFrom(TODAY);
  assert.equal(checkoutSentence(end, null, TODAY), "Free until Nov 28. Cancel any time before then and you won't be charged. After that, $20 a year.");
  assert.equal(checkoutSentence(new Date("2026-11-15T12:00:00Z"), null, TODAY), "Free until Nov 15. Cancel any time before then and you won't be charged. After that, $20 a year.", "the last day or two stay free too");
  assert.equal(checkoutSentence(new Date("2026-11-14T11:00:00Z"), null, TODAY), "$20 a year, starting today. Cancel any time; the advisor stays whole until the year ends.");
  assert.equal(checkoutSentence(null, null, TODAY), "$20 a year, starting today. Cancel any time; the advisor stays whole until the year ends.");
  assert.equal(trialEndsLine("2026-11-28T12:00:00Z", TODAY), "Trial ends Nov 28");
  assert.equal(trialEndsLine("2027-01-02T12:00:00Z", TODAY), "Trial ends Jan 2, 2027");
});

test("stripeTrialEnd: unix seconds for an end at least 48 hours ahead, null closer or past (Checkout's minimum)", () => {
  assert.equal(stripeTrialEnd("2026-11-28T12:00:00Z", TODAY), Math.floor(new Date("2026-11-28T12:00:00Z").getTime() / 1000));
  assert.equal(stripeTrialEnd("2026-11-16T12:00:00Z", TODAY), null);
  assert.equal(stripeTrialEnd("2026-11-01T12:00:00Z", TODAY), null);
  assert.equal(stripeTrialEnd(null, TODAY), null);
});

/* ------------------------------------------------------------------ */
/* Early accounts                                                      */
/* ------------------------------------------------------------------ */

test("isEarly: everyone while the setting is unset; created before the moment after it; a bad setting reads as unset", () => {
  assert.equal(parsePriceLiveAt(null), null);
  assert.equal(parsePriceLiveAt("not a date"), null);
  const live = parsePriceLiveAt("2026-12-01T00:00:00Z")!;
  assert.equal(isEarly("2026-11-01T00:00:00Z", null), true);
  assert.equal(isEarly(null, null), true);
  assert.equal(isEarly("2026-11-01T00:00:00Z", live), true);
  assert.equal(isEarly("2026-12-01T00:00:01Z", live), false);
  assert.equal(isEarly(null, live), false);
});

/* ------------------------------------------------------------------ */
/* Statuses and entitlements                                           */
/* ------------------------------------------------------------------ */

test("statusFrom: a paid year beats a trial; the database's trial counts as a trial; an ended trial with nothing paying is lapsed; no trial and no rows is none", () => {
  assert.equal(statusFrom([], null, TODAY), "none");
  assert.equal(statusFrom([], trial(), TODAY), "trial");
  assert.equal(statusFrom([], trial({ ends_at: "2026-11-10T00:00:00Z" }), TODAY), "lapsed");
  assert.equal(statusFrom([row({ status: "incomplete" })], null, TODAY), "none");
  assert.equal(statusFrom([row({ status: "canceled" })], null, TODAY), "lapsed");
  assert.equal(statusFrom([row({ status: "canceled" }), row({ status: "trialing" })], null, TODAY), "trial");
  assert.equal(statusFrom([row({ status: "trialing" }), row({ status: "active" })], null, TODAY), "active");
  assert.equal(statusFrom([row({ status: "past_due" })], null, TODAY), "active", "Stripe's retry window keeps the advisor whole");
  assert.equal(trialRunning(trial(), TODAY), true);
  assert.equal(trialRunning(trial({ ends_at: "2026-11-14T11:00:00Z" }), TODAY), false);
  assert.equal(decidingRow([row({ status: "canceled", updated: "2026-11-15T00:00:00Z" }), row({ id: "live", status: "trialing", updated: "2026-11-01T00:00:00Z" })])!.id, "live");
});

test("entitlementFrom: whole while the price isn't live or Stripe is unset; a trial waits for its card (owner: a card whenever a student is created); whole on a paid trial, a year, or an early account through 2027-08-31; else read-only", () => {
  const live = new Date("2026-12-01T00:00:00Z");
  const later = new Date("2027-01-15T00:00:00Z");
  const base = { stripeConfigured: true, accountsCreated: ["2027-01-01T00:00:00Z"], rows: [] as SubscriptionRow[], trial: null as TrialRow | null, today: later };
  assert.equal(entitlementFrom({ ...base, priceLiveAt: null }).because, "not-live");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, stripeConfigured: false }).because, "not-live");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live }).whole, false);
  const running = entitlementFrom({ ...base, priceLiveAt: live, trial: trial({ ends_at: "2027-01-20T00:00:00Z" }) });
  assert.equal(running.status, "trial");
  assert.equal(running.whole, false, "the advisor waits for the card");
  assert.equal(running.needsCard, true);
  assert.equal(running.paid, false);
  const paying = entitlementFrom({ ...base, priceLiveAt: live, trial: trial({ ends_at: "2027-01-20T00:00:00Z" }), rows: [row({ trial_end: "2027-01-20T00:00:00Z" })] });
  assert.equal(paying.because, "subscription");
  assert.equal(paying.whole, true);
  assert.equal(paying.paid, true);
  assert.equal(paying.needsCard, false);
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, rows: [row({ status: "active" })] }).whole, true);
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, accountsCreated: ["2026-11-01T00:00:00Z"] }).because, "early");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, accountsCreated: ["2026-11-01T00:00:00Z"], today: new Date("2027-09-01T00:00:00Z") }).whole, false, "the early period ends");
  const lapsed = entitlementFrom({ ...base, priceLiveAt: live, trial: trial({ ends_at: "2027-01-01T00:00:00Z" }) });
  assert.equal(lapsed.status, "lapsed");
  assert.equal(lapsed.whole, false);
  assert.equal(lapsed.needsCard, false, "an ended trial is lapsed, not waiting");
  const earlyTrial = entitlementFrom({ ...base, priceLiveAt: live, accountsCreated: ["2026-11-01T00:00:00Z"], trial: trial({ ends_at: "2027-01-20T00:00:00Z" }) });
  assert.equal(earlyTrial.whole, true, "an early account's trial needs no card");
  assert.equal(earlyTrial.needsCard, false);
});

test("the feature map: every capability the code names is a row; the free rows are the two live beyond the plan; a lapsed plan reads its list, calendar, and offers and writes nothing", () => {
  assert.deepEqual([...CAPABILITIES].sort(), [...new Set(FEATURE_MAP.map((r) => r.capability))].sort());
  assert.deepEqual(FEATURE_MAP.filter((r) => r.free).map((r) => r.capability), ["visits.view", "api.key"]);
  const readOnly = { whole: false };
  assert.equal(allowedUnder(readOnly, "visits.view"), true);
  assert.equal(allowedUnder(readOnly, "planner.tab", "read"), true);
  assert.equal(allowedUnder(readOnly, "planner.tab", "write"), false);
  assert.equal(allowedUnder(readOnly, "planner.calendar", "read"), true);
  assert.equal(allowedUnder(readOnly, "planner.offers", "read"), true);
  assert.equal(allowedUnder(readOnly, "planner.texts", "write"), false);
  assert.equal(allowedUnder(readOnly, "planner.reminders", "write"), false);
  assert.equal(allowedUnder(readOnly, "planner.actions.visits", "read"), false);
  assert.equal(allowedUnder({ whole: true }, "planner.texts"), true);
  const types = read("lib/planner/types.ts");
  for (const r of FEATURE_MAP) assert.match(types, new RegExp(`"${r.capability.replace(/\./g, "\\.")}"`), `${r.capability} is in the Capability type`);
});

test("the SQL says what the specs say: a trial for every new student record, the student plan alone, a counselor's parent invitation, and no client writes", () => {
  const first = read("supabase/migrations/20261114120000_subscriptions.sql");
  const second = read("supabase/migrations/20261114130000_billing_per_student.sql");
  assert.match(second, /create trigger students_start_trial[\s\S]*after insert on public\.students/, "every new student starts a trial");
  assert.match(second, /now\(\) \+ interval '14 days'/);
  assert.match(second, /select s\.\* from public\.subscriptions s where s\.covers_student_id = p_student/, "the student plan is the only coverage rule");
  assert.doesNotMatch(second.slice(second.indexOf("create or replace function public.subscriptions_covering")), /product = 'family'/);
  assert.match(second, /create function public\.org_invite_guardian/);
  assert.match(second, /raise exception 'not_on_caseload'/, "a counselor invites parents only for students on their caseload");
  assert.match(second, /'''s household'/, "a new household is named after the student");
  assert.match(second, /'trial', v_trial/, "advisor_access returns the trial");
  assert.match(first, /can_read_student\(v_student\)/, "a caller reads only students they may see");
  assert.match(first, /subscriptions_read_own[\s\S]*is_admin\(\)/, "a person reads their own rows; an admin every row");
  for (const sql of [first, second]) assert.doesNotMatch(sql, /create policy (subscriptions|advisor_trials|billing_customers)_(insert|update|write)/, "no client writes");
});

/* ------------------------------------------------------------------ */
/* What a change means                                                 */
/* ------------------------------------------------------------------ */

test("billingEvents: first seen trialing is trial_started; trial to active converts; cancel during the trial cancels it once; a later period end renews", () => {
  const t = row();
  assert.deepEqual(billingEvents(null, t), ["trial_started"]);
  assert.deepEqual(billingEvents(null, row({ status: "active" })), []);
  assert.deepEqual(billingEvents(t, row({ status: "active", current_period_end: "2027-11-28T12:00:00Z" })), ["trial_converted"]);
  assert.deepEqual(billingEvents(t, row({ cancel_at_period_end: true })), ["trial_cancelled"]);
  assert.deepEqual(billingEvents(row({ cancel_at_period_end: true }), row({ status: "canceled" })), ["trial_cancelled"]);
  assert.deepEqual(billingEvents(t, row({ status: "canceled" })), ["trial_cancelled"]);
  const year = row({ status: "active", current_period_end: "2027-11-28T12:00:00Z" });
  assert.deepEqual(billingEvents(year, row({ status: "active", current_period_end: "2027-11-28T12:00:00Z", cancel_at_period_end: true })), ["subscription_cancelled"]);
  assert.deepEqual(billingEvents(year, row({ status: "canceled" })), ["subscription_cancelled"]);
  assert.deepEqual(billingEvents(year, row({ status: "active", current_period_end: "2028-11-28T12:00:00Z" })), ["subscription_renewed"]);
  assert.deepEqual(billingEvents(year, year), [], "a rewrite with nothing changed says nothing");
  assert.equal(trialDay("2026-11-28T12:00:00Z", new Date("2026-11-16T13:00:00Z")), 3);
  assert.equal(trialDay(null), null);
});

test("the billing events are registered as server events with the product and never an amount", () => {
  for (const name of ["trial_started", "trial_reminder_sent", "trial_converted", "trial_cancelled", "subscription_cancelled", "subscription_renewed"] as const) {
    const spec = EVENTS[name];
    assert.equal(spec.side, "server");
    assert.ok((spec.properties as readonly string[]).includes("product"), `${name} carries the product`);
    assert.ok(!(spec.properties as readonly string[]).some((p) => /amount|price_cents|dollars/.test(p)), `${name} carries no amount`);
  }
});

/* ------------------------------------------------------------------ */
/* The email                                                           */
/* ------------------------------------------------------------------ */

test("the trial-ending email: with a card, nothing to do and one way to cancel; without one, add a card or the advisor turns read-only with nothing charged", () => {
  const base = { firstName: "Sam", priceVariant: "list", trialEnd: "2026-11-28T12:00:00Z", colleges: 7, movesDone: 2, studentNames: ["Jordan"], siteUrl: "https://usequad.app", today: TODAY };
  const withCard = buildTrialEnding({ ...base, hasCard: true });
  assert.equal(withCard.subject, "Your Quad Advisor trial ends Nov 28");
  assert.match(withCard.text, /Hi Sam,/);
  assert.match(withCard.text, /So far, Jordan's advisor has 7 colleges on the list and 2 moves done\./);
  assert.match(withCard.text, /nothing to do: on Nov 28 your card is charged \$20 a year/);
  assert.match(withCard.html, /Keep my advisor/);
  const noCard = buildTrialEnding({ ...base, hasCard: false, studentNames: [] });
  assert.match(noCard.text, /add a card before Nov 28/);
  assert.match(noCard.text, /If you do nothing, nothing is charged: on Nov 28 your advisor turns read-only/);
  assert.match(noCard.html, /Add a card/);
  assert.match(noCard.text, /https:\/\/usequad\.app\/advisor\/start/);
  for (const b of [withCard, noCard]) assert.doesNotMatch(b.text, /\d{4} \d{4}/, "no card digits, ever");
  assert.equal(coveredLine({ colleges: null, movesDone: null, studentNames: [] }), null);
  assert.equal(coveredLine({ colleges: 1, movesDone: 0, studentNames: ["Jordan"] }), "So far, Jordan's advisor has 1 college on the list.");
});

/* ------------------------------------------------------------------ */
/* The glue, unconfigured; the guards                                  */
/* ------------------------------------------------------------------ */

test("without Stripe's keys nothing is gated: allowed() says yes without a user or a read, and every student is in the preview", async () => {
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ADVISOR_STUDENT"]) delete process.env[k];
  assert.equal(await allowed(null, "planner.tab"), true);
  assert.equal(await allowed({ id: "u" }, "planner.texts"), true);
  assert.deepEqual(await advisorStatusFor(["a", "b"]), { a: "preview", b: "preview" });
  assert.equal(ADVISOR_STATUS_LABEL.preview, "Preview");
});

test("the planner's settings read carries the price-live key, so a plan page pays no extra read for the hook", () => {
  assert.match(read("lib/planner/settings-server.ts"), /PRICE_LIVE_SETTING\] as const/);
  assert.match(read("lib/entitlements.ts"), /appSettings\(\)/);
});

test("the jobs that are the advisor's filter by entitlement; the webhook verifies the signature, records each event once, and saves a setup session's card; a parent needs a card before adding a student", () => {
  assert.match(read("app/api/cron/weekly/route.ts"), /entitledStudents\(client, .*"planner\.reminders"\)/);
  assert.match(read("app/api/cron/day-before/route.ts"), /entitledStudents\(client, .*"planner\.texts"\)/);
  const hook = read("app/api/stripe/webhook/route.ts");
  assert.match(hook, /webhookEvent\(raw, request\.headers\.get\("stripe-signature"\)\)/);
  assert.match(hook, /from\("stripe_events"\)\.insert/);
  assert.match(hook, /session\.mode === "setup"/);
  assert.match(hook, /customer\.subscription\.trial_will_end/);
  const stripe = read("lib/stripe.ts");
  assert.match(stripe, /mode: "setup"/, "the household card is saved through a setup session");
  assert.match(stripe, /payment_method_collection: "always"/);
  assert.match(stripe, /missing_payment_method: "cancel"/);
  assert.match(stripe, /stripeTrialFor\(input\.trialEnd\)/, "the trial is the database's; Stripe gets its end date (or the last day or two), never a fresh 14 days");
  assert.doesNotMatch(stripe, /trial_period_days: TRIAL_DAYS/);
  const household = read("app/household/actions.ts");
  assert.match(household, /cardOnFile\(/);
  assert.match(household, /redirect\(`\$\{ADD_CARD_PATH\}\?next=/, "a parent with no card is sent to add one before the student is made");
  assert.match(household, /payForStudent\(account\.user/, "the student is paid for once made");
  assert.match(read("app/api/cron/subscriptions/route.ts"), /sendCardlessTrialReminder/, "cardless trials get their reminder from the reconcile");
});
