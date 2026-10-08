/**
 * Text reminders (lib/sms.ts; specs/planner/timeline.md "Texts"): never without an active consent, never at night in
 * the household's time zone, never twice a day, never a number from the profile; the STOP webhook's parsing and
 * Twilio's signature; dormant without the env. Pure (send runs against a stub fetch). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canText,
  composeConfirmText,
  composeDayBeforeText,
  composeWeekText,
  consentBy,
  handleInbound,
  localDay,
  quietHours,
  send,
  smsConfigured,
  stateOf,
  timeZonesFor,
  twilioSignature,
  validTwilioSignature,
  EASTERN,
  PACIFIC,
  CENTRAL,
} from "../lib/sms.ts";

const ACTIVE = { revoked_at: null, provider_opt_out_at: null };
// 2026-10-11 23:00 UTC = 7 pm Eastern, 4 pm Pacific (Sunday evening).
const SUNDAY_EVENING = new Date("2026-10-11T23:00:00Z");
// 2026-10-12 03:00 UTC = 11 pm Eastern, 8 pm Pacific.
const LATE = new Date("2026-10-12T03:00:00Z");
// 2026-10-12 13:00 UTC = 9 am Eastern, 6 am Pacific.
const MORNING = new Date("2026-10-12T13:00:00Z");

test("never without an active consent", () => {
  assert.deepEqual(canText({ consent: null, now: SUNDAY_EVENING, zones: [EASTERN], sentDays: [] }), { ok: false, reason: "no_consent" });
  assert.deepEqual(canText({ consent: { revoked_at: "2026-10-01T00:00:00Z", provider_opt_out_at: null }, now: SUNDAY_EVENING, zones: [EASTERN], sentDays: [] }), { ok: false, reason: "no_consent" });
  assert.deepEqual(canText({ consent: { revoked_at: null, provider_opt_out_at: "2026-10-01T00:00:00Z" }, now: SUNDAY_EVENING, zones: [EASTERN], sentDays: [] }), { ok: false, reason: "opted_out" });
  assert.deepEqual(canText({ consent: ACTIVE, now: SUNDAY_EVENING, zones: [EASTERN], sentDays: [] }), { ok: true });
});

test("never at night in the household's time zone (9 pm to 8 am)", () => {
  assert.equal(quietHours(LATE, [EASTERN]), true, "11 pm Eastern");
  assert.equal(quietHours(LATE, [PACIFIC]), false, "8 pm Pacific");
  assert.equal(quietHours(MORNING, [EASTERN]), false, "9 am Eastern");
  assert.equal(quietHours(MORNING, [PACIFIC]), true, "6 am Pacific");
  assert.equal(quietHours(new Date("2026-10-12T01:00:00Z"), [EASTERN]), true, "9 pm sharp Eastern");
  assert.deepEqual(canText({ consent: ACTIVE, now: LATE, zones: [EASTERN], sentDays: [] }), { ok: false, reason: "quiet_hours" });
  // Unknown zone: quiet if it's night anywhere from Eastern to Pacific.
  assert.deepEqual(timeZonesFor({}), [EASTERN, PACIFIC]);
  assert.equal(quietHours(MORNING, timeZonesFor({})), true);
  assert.equal(quietHours(SUNDAY_EVENING, timeZonesFor({})), false);
});

test("the time zone: the home address's state, else the phone's area code", () => {
  assert.equal(stateOf("1600 Pennsylvania Ave NW, Washington, DC 20500"), "DC");
  assert.equal(stateOf("Ann Arbor, MI"), "MI");
  assert.equal(stateOf("ZIP 48104"), null);
  assert.deepEqual(timeZonesFor({ homeLabel: "500 S State St, Ann Arbor, MI 48109", phone: "+14155550100" }), [EASTERN], "home wins");
  assert.deepEqual(timeZonesFor({ homePlace: "Austin, TX" }), [CENTRAL]);
  assert.deepEqual(timeZonesFor({ phone: "+14155550100" }), [PACIFIC]);
  assert.deepEqual(timeZonesFor({ phone: "+16175550100" }), [EASTERN, PACIFIC], "Boston isn't in the small table: both coasts");
});

test("never twice a day (the household's day)", () => {
  const day = localDay(SUNDAY_EVENING, [EASTERN]);
  assert.equal(day, "2026-10-11");
  assert.equal(localDay(new Date("2026-10-12T02:00:00Z"), [PACIFIC]), "2026-10-11", "7 pm Pacific is still Sunday there");
  assert.deepEqual(canText({ consent: ACTIVE, now: SUNDAY_EVENING, zones: [EASTERN], sentDays: [day] }), { ok: false, reason: "already_today" });
  assert.deepEqual(canText({ consent: ACTIVE, now: SUNDAY_EVENING, zones: [EASTERN], sentDays: ["2026-10-10"] }), { ok: true });
});

test("never a number from the profile; at most three tasks; skipped when nothing's due", () => {
  const profileNumbers = ["1450", "34", "3.9", "4.2", "$150,000", "28000"];
  const text = composeWeekText(
    [
      { title: "Michigan: apply (ED I)", when: "Nov 1" },
      { title: "FAFSA opens", when: "Oct 1", who: "Parent" },
      { title: "Retake the SAT for 1450 or ACT 34 (GPA 3.9, weighted 4.2)", when: "Dec 5" },
      { title: "Budget: $150,000 income, 28000 saved", when: "Dec 9" },
    ],
    "https://q.example/household/s1/plan",
  )!;
  for (const n of profileNumbers) assert.ok(!text.includes(n), `no ${n} in: ${text}`);
  assert.match(text, /Michigan: apply \(ED I\) \(Nov 1\)/);
  assert.match(text, /FAFSA opens \(Oct 1, Parent\)/);
  assert.match(text, /and 1 more/);
  assert.match(text, /Reply STOP to stop\.$/);
  assert.equal(composeWeekText([], "https://q.example"), null);
  const day = composeDayBeforeText({ title: "Michigan: reply to the offer, deposit $400", when: null }, "https://q.example/p");
  assert.ok(!day.includes("400") && !day.includes("$"));
  assert.match(day, /Tomorrow: Michigan: reply to the offer/);
  assert.match(composeConfirmText("Alex"), /Alex's college plan are on\. At most one a day, never at night\. Reply STOP to stop/);
});

test("the STOP webhook: STOP and its synonyms, Twilio's OptOutType, anything else is nothing", () => {
  assert.deepEqual(handleInbound({ From: "+16155550100", Body: "STOP" }), { action: "stop", from: "+16155550100" });
  assert.deepEqual(handleInbound({ From: "+16155550100", Body: " Unsubscribe. " }).action, "stop");
  assert.deepEqual(handleInbound({ From: "+16155550100", Body: "whatever", OptOutType: "STOP" }).action, "stop");
  assert.deepEqual(handleInbound({ From: "+16155550100", Body: "START" }).action, "start");
  assert.deepEqual(handleInbound({ From: "+16155550100", Body: "help" }).action, "help");
  assert.deepEqual(handleInbound({ From: "+16155550100", Body: "thanks!" }).action, "none");
  assert.equal(handleInbound({ From: "not a phone", Body: "STOP" }).from, null);
});

test("Twilio's signature: HMAC-SHA1 over the URL and sorted params", () => {
  // Twilio's documented example (https://www.twilio.com/docs/usage/webhooks/webhooks-security).
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  const sig = twilioSignature(url, params, "12345");
  assert.equal(sig, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  assert.equal(validTwilioSignature(url, params, sig, "12345"), true);
  assert.equal(validTwilioSignature(url, { ...params, Digits: "9999" }, sig, "12345"), false);
  assert.equal(validTwilioSignature(url, params, null, "12345"), false);
});

test("dormant without the env; with it, one form POST to Twilio", async () => {
  const logs: string[] = [];
  assert.equal(smsConfigured({}), false);
  assert.deepEqual(await send({ to: "+16155550100", body: "hi" }, { env: {}, log: (m) => logs.push(m) }), { sent: false, reason: "not-configured" });
  assert.equal(logs.length, 1);
  const env = { SMS_PROVIDER_SID: "AC123", SMS_PROVIDER_TOKEN: "tok", SMS_FROM_NUMBER: "+18005550100" };
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
  }) as unknown as typeof fetch;
  const r = await send({ to: "+16155550100", body: "Quad · hi" }, { env, fetch: fake });
  assert.deepEqual(r, { sent: true, sid: "SM1" });
  assert.equal(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
  assert.match(String(calls[0].init.body), /To=%2B16155550100&From=%2B18005550100&Body=Quad/);
  assert.deepEqual(await send({ to: "555-0100", body: "x" }, { env, fetch: fake }), { sent: false, reason: "error", error: "not an E.164 number" });
});

test("who consents: an adult for themselves, a guardian under 18 or when the age is unknown", () => {
  assert.equal(consentBy(2006, "2026-10-08"), "self");
  assert.equal(consentBy(2009, "2026-10-08"), "guardian");
  assert.equal(consentBy(null, "2026-10-08"), "guardian");
});
