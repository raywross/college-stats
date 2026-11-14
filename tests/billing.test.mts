/**
 * Quad Advisor's billing rules (lib/billing.ts; specs/product/commercialization.md "Files": every capability a spec
 * names appears in the map; the free column matches what is live except the plan; a family plan covers a student
 * added later and a student plan doesn't extend to a sibling, both as the SQL function's rule; a lapsed plan is
 * read-only, never emptied), who may start a trial (specs/product/advisor.md "2. The trial"), early accounts
 * (specs/product/open-doors.md), what a change in a subscription means for telemetry, the Stripe mapping
 * (lib/stripe.ts rowFromStripe), the reminder email, and the entitlement glue's unconfigured path. No network,
 * no database. `npm test`.
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
  starterRule,
  statusFrom,
  trialDay,
  trialEndFrom,
  trialEndsLine,
  trialPriceLine,
  type SubscriptionRow,
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

/* ------------------------------------------------------------------ */
/* Prices and words                                                    */
/* ------------------------------------------------------------------ */

test("the two list prices are the owner's: $20 a year for a student, $30 for a family; an unknown variant falls back to them", () => {
  assert.deepEqual(LIST_PRICES, { student: 20, family: 30 });
  assert.equal(priceLabel("student"), "$20 a year");
  assert.equal(priceLabel("family"), "$30 a year");
  assert.deepEqual(priceFor("student", "nonsense"), { variant: "list", dollars: 20 });
  assert.equal(trialPriceLine(), "$20 a year after, or $30 for the whole family. Cancel before the trial ends and pay nothing.");
});

test("the checkout sentence and the trial lines say the date and the price in Quad's words", () => {
  const end = trialEndFrom(TODAY);
  assert.equal(checkoutSentence("student", end, null, TODAY), "Free for 14 days. Cancel any time before Nov 28 and you won't be charged. After that, $20 a year.");
  assert.equal(trialEndsLine("2026-11-28T12:00:00Z", TODAY), "Trial ends Nov 28");
  assert.equal(trialEndsLine("2027-01-02T12:00:00Z", TODAY), "Trial ends Jan 2, 2027");
});

/* ------------------------------------------------------------------ */
/* Who may start                                                       */
/* ------------------------------------------------------------------ */

test("a guardian may start; a student at 16 or 17 confirms a parent's permission; at 18 nothing to confirm; under 16 asks a parent", () => {
  assert.deepEqual(starterRule({ isGuardian: true, birthYear: null }, TODAY), { ok: true, confirmPermission: false });
  assert.deepEqual(starterRule({ isGuardian: false, birthYear: 2010 }, TODAY), { ok: true, confirmPermission: true });
  assert.deepEqual(starterRule({ isGuardian: false, birthYear: 2008 }, TODAY), { ok: true, confirmPermission: false });
  assert.deepEqual(starterRule({ isGuardian: false, birthYear: 2011 }, TODAY), { ok: false, reason: "under-age" });
  assert.deepEqual(starterRule({ isGuardian: false, birthYear: null }, TODAY), { ok: false, reason: "no-birth-year" });
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

test("statusFrom: a paid year beats a trial, a trial beats lapsed, incomplete counts as none", () => {
  assert.equal(statusFrom([]), "none");
  assert.equal(statusFrom([row({ status: "incomplete" })]), "none");
  assert.equal(statusFrom([row({ status: "canceled" })]), "lapsed");
  assert.equal(statusFrom([row({ status: "canceled" }), row({ status: "trialing" })]), "trial");
  assert.equal(statusFrom([row({ status: "trialing" }), row({ status: "active" })]), "active");
  assert.equal(statusFrom([row({ status: "past_due" })]), "active", "Stripe's retry window keeps the advisor whole");
  assert.equal(decidingRow([row({ status: "canceled", updated: "2026-11-15T00:00:00Z" }), row({ id: "live", status: "trialing", updated: "2026-11-01T00:00:00Z" })])!.id, "live");
});

test("entitlementFrom: whole while the price isn't live or Stripe is unset; whole on a trial or a year; early accounts whole through 2027-08-31; else read-only", () => {
  const live = new Date("2026-12-01T00:00:00Z");
  const base = { stripeConfigured: true, accountsCreated: ["2027-01-01T00:00:00Z"], rows: [] as SubscriptionRow[], today: new Date("2027-01-15T00:00:00Z") };
  assert.equal(entitlementFrom({ ...base, priceLiveAt: null }).because, "not-live");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, stripeConfigured: false }).because, "not-live");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live }).whole, false);
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, rows: [row()] }).because, "subscription");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, rows: [row({ status: "active" })] }).whole, true);
  const early = entitlementFrom({ ...base, priceLiveAt: live, accountsCreated: ["2026-11-01T00:00:00Z"] });
  assert.equal(early.because, "early");
  assert.equal(entitlementFrom({ ...base, priceLiveAt: live, accountsCreated: ["2026-11-01T00:00:00Z"], today: new Date("2027-09-01T00:00:00Z") }).whole, false, "the early period ends");
  const lapsed = entitlementFrom({ ...base, priceLiveAt: live, rows: [row({ status: "canceled" })] });
  assert.equal(lapsed.status, "lapsed");
  assert.equal(lapsed.whole, false);
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
  // Every planner capability the Capability type names is in the map (the typecheck holds the other direction).
  const types = read("lib/planner/types.ts");
  for (const r of FEATURE_MAP) assert.match(types, new RegExp(`"${r.capability.replace(/\./g, "\\.")}"`), `${r.capability} is in the Capability type`);
});

test("the SQL function's coverage rule is written as the spec says: a student plan names one student; a family plan reaches a guardian's households and managed records", () => {
  const sql = read("supabase/migrations/20261114120000_subscriptions.sql");
  assert.match(sql, /s\.product = 'student' and s\.covers_student_id = p_student/);
  assert.match(sql, /s\.product = 'family'/);
  assert.match(sql, /g\.role = 'guardian' and g\.status = 'active'/);
  assert.match(sql, /st\.managed_by = s\.user_id/);
  assert.match(sql, /can_read_student\(v_student\)/, "a caller reads only students they may see");
  assert.match(sql, /'advisor\.price_live_at'/, "admin_set_setting learns the price-live key");
  assert.match(sql, /subscriptions_read_own[\s\S]*is_admin\(\)/, "a person reads their own rows; an admin every row");
  assert.doesNotMatch(sql, /create policy subscriptions_(insert|update|write)/, "no client writes: the server alone writes rows");
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
/* The reminder                                                        */
/* ------------------------------------------------------------------ */

test("the trial-ending email says the date, the amount, what the trial covered, one way to keep it and one to cancel", () => {
  const built = buildTrialEnding({ firstName: "Sam", product: "family", priceVariant: "list", trialEnd: "2026-11-28T12:00:00Z", colleges: 7, movesDone: 2, studentNames: ["Jordan", "Maya"], siteUrl: "https://usequad.app", today: TODAY });
  assert.equal(built.subject, "Your Quad Advisor trial ends Nov 28");
  assert.match(built.text, /Hi Sam,/);
  assert.match(built.text, /So far, your family's advisor has 7 colleges on the list and 2 moves done\./);
  assert.match(built.text, /charged \$30 a year/);
  assert.match(built.text, /https:\/\/usequad\.app\/account#advisor/);
  assert.match(built.html, /Keep my advisor/);
  assert.match(built.html, /Manage or cancel/);
  assert.doesNotMatch(built.text, /\d{4} \d{4}/, "no card digits, ever");
  assert.equal(coveredLine({ colleges: null, movesDone: null, studentNames: [] }), null);
  assert.equal(coveredLine({ colleges: 1, movesDone: 0, studentNames: ["Jordan"] }), "So far, Jordan's advisor has 1 college on the list.");
});

/* ------------------------------------------------------------------ */
/* The glue, unconfigured                                              */
/* ------------------------------------------------------------------ */

test("without Stripe's keys nothing is gated: allowed() says yes without a user or a read, and every student is in the preview", async () => {
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ADVISOR_STUDENT", "STRIPE_PRICE_ADVISOR_FAMILY"]) delete process.env[k];
  assert.equal(await allowed(null, "planner.tab"), true);
  assert.equal(await allowed({ id: "u" }, "planner.texts"), true);
  assert.deepEqual(await advisorStatusFor(["a", "b"]), { a: "preview", b: "preview" });
  assert.equal(ADVISOR_STATUS_LABEL.preview, "Preview");
});

test("the planner's settings read carries the price-live key, so a plan page pays no extra read for the hook", () => {
  assert.match(read("lib/planner/settings-server.ts"), /PRICE_LIVE_SETTING\] as const/);
  assert.match(read("lib/entitlements.ts"), /appSettings\(\)/);
});

test("the jobs that are the advisor's filter by entitlement, and the webhook verifies the signature and records each event once", () => {
  assert.match(read("app/api/cron/weekly/route.ts"), /entitledStudents\(client, .*"planner\.reminders"\)/);
  assert.match(read("app/api/cron/day-before/route.ts"), /entitledStudents\(client, .*"planner\.texts"\)/);
  const hook = read("app/api/stripe/webhook/route.ts");
  assert.match(hook, /webhookEvent\(raw, request\.headers\.get\("stripe-signature"\)\)/);
  assert.match(hook, /from\("stripe_events"\)\.insert/);
  assert.match(hook, /customer\.subscription\.trial_will_end/);
  assert.match(read("lib/stripe.ts"), /trial_settings: \{ end_behavior: \{ missing_payment_method: "cancel" \} \}/);
  assert.match(read("lib/stripe.ts"), /payment_method_collection: "always"/);
});
