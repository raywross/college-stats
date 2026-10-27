/**
 * The morning confirmation email (lib/emails/interest-confirm.ts; specs/planner/v3/guides/show-interest.md "The
 * confirmation email"): the lead sentence and question, the Yes / No token links for every act, "Yesterday" versus a
 * date, the event's own clock time, the Your week footer and one-click unsubscribe, one email per person through the
 * job, nothing for no acts, and the guard that no personal number reaches it (a score planted in a test registration's
 * title is dropped; a college's own event title is escaped). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import { buildInterestConfirm, type ConfirmAct } from "../lib/emails/interest-confirm.ts";
import { confirmUrl, type InterestActRow } from "../lib/planner/interest-acts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.mts";

const ROOT = join(import.meta.dirname, "..");
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});
const { runInterestConfirm } = await import("../lib/planner/interest-acts-server.ts");

const SITE = "https://quad.example";
const UNSUB = `${SITE}/unsubscribe/${"c".repeat(64)}/week`;
const NOW = new Date("2026-10-21T13:30:00Z");
const DUKE = "33333333-3333-4333-8333-333333333333";
const ELON = "66666666-6666-4666-8666-666666666666";
const NAMES = { [DUKE]: "Duke", [ELON]: "Elon" };
const ZONES = { "duke:tour": "America/New_York", "elon:oh": "America/New_York" };

let n = 0;
function act(over: Partial<InterestActRow> = {}): InterestActRow {
  n++;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
    item_id: DUKE,
    user_id: "11111111-1111-4111-8111-111111111111",
    act: "tour",
    network: null,
    url: "https://admissions.duke.edu/register/?id=tour",
    event_id: "duke:tour",
    event_starts_at: "2026-11-03T15:00:00.000Z",
    event_place: "Durham, NC",
    event_title: "Campus Tour",
    clicked_at: "2026-10-20T14:00:00.000Z",
    prompted_at: null,
    emailed_at: null,
    status: "pending",
    resolved_at: null,
    resolved_via: null,
    visit_id: null,
    confirm_token: String(n % 10).repeat(64),
    ...over,
  };
}

const build = (acts: ConfirmAct[]) => buildInterestConfirm({ acts, names: NAMES, zones: ZONES, siteUrl: SITE, unsubscribeUrl: UNSUB, now: NOW });

test("nothing pending, no email", () => {
  assert.equal(build([]), null);
});

test("the lead: yesterday's act, its date and time, the question, and its own Yes / No links", () => {
  const lead = act();
  const email = build([lead])!;
  assert.equal(email.subject, "Did you register for Duke's tour?");
  assert.match(email.text, /^Yesterday you opened Duke's tour sign-up for Nov 3 at 10 AM\.\nDid you register\?/);
  assert.ok(email.text.includes(`Yes: ${confirmUrl(SITE, lead.confirm_token, "yes")}`));
  assert.ok(email.text.includes(`No: ${confirmUrl(SITE, lead.confirm_token, "no")}`));
  assert.ok(email.html.includes(confirmUrl(SITE, lead.confirm_token, "yes").replace(/&/g, "&amp;")));
  // Older than yesterday: the day it was opened.
  assert.match(build([act({ clicked_at: "2026-10-12T14:00:00.000Z" })])!.text, /^On Oct 12 you opened/);
});

test("a line per other pending act, each with its own token links", () => {
  const lead = act();
  const oh = act({ item_id: ELON, act: "open_house", event_id: "elon:oh", event_title: "Fall Open House", event_starts_at: "2026-11-08T15:00:00.000Z" });
  const follow = act({ item_id: ELON, act: "follow", network: "instagram", event_id: null, event_starts_at: null, event_title: null });
  const info = act({ act: "info_request", event_id: null, event_starts_at: null, event_title: null });
  const email = build([lead, oh, follow, info])!;
  assert.match(email.text, /Also waiting for an answer/);
  assert.match(email.text, /- Elon's open house, Nov 8 at 10 AM\. Yes: /);
  assert.match(email.text, /- Following Elon on Instagram\. Yes: /);
  assert.match(email.text, /- Duke's information request\. Yes: /);
  for (const a of [lead, oh, follow, info]) {
    assert.ok(email.text.includes(confirmUrl(SITE, a.confirm_token, "yes")), a.act);
    assert.ok(email.text.includes(confirmUrl(SITE, a.confirm_token, "no")), a.act);
  }
});

test("a duplicate pending row for the same act (clicked twice before the first was answered) earns one line, not two", () => {
  // Same item, act, and event id by default: the shape the duplicate-click bug (QA finding 3) leaves behind.
  const first = act({ clicked_at: "2026-10-20T14:00:00.000Z" });
  const duplicate = act({ clicked_at: "2026-10-20T14:05:00.000Z" });
  const email = build([duplicate, first])!;
  assert.doesNotMatch(email.text, /Also waiting for an answer/, "the duplicate never earns its own \"other act\" line");
  // The newer row (the one still worth asking about) leads; its own token links are the ones sent.
  assert.ok(email.text.includes(confirmUrl(SITE, duplicate.confirm_token, "yes")));
  assert.ok(!email.text.includes(confirmUrl(SITE, first.confirm_token, "yes")));
  // A real second college's act is untouched: still its own line.
  const oh = act({ item_id: ELON, act: "open_house", event_id: "elon:oh", event_title: "Fall Open House", event_starts_at: "2026-11-08T15:00:00.000Z" });
  assert.match(build([duplicate, first, oh])!.text, /Also waiting for an answer/);
});

test("the footer: Your week's unsubscribe, one-click headers, and a link to the plan", () => {
  const email = build([act()])!;
  assert.ok(email.text.endsWith(`Turn off Your week: ${UNSUB}`));
  assert.match(email.html, /Turn off Your week<\/a>/);
  assert.ok(email.html.includes(UNSUB));
  assert.deepEqual(email.headers, { "List-Unsubscribe": `<${UNSUB}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert.ok(email.text.includes(`${SITE}/advisor?utm_source=interest-confirm`));
});

/** Every number in an email that isn't a date, a clock time, or inside a URL. */
function strayNumbers(text: string): string[] {
  const rest = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g, "")
    .replace(/\b\d{1,2}(?::\d{2})? (?:AM|PM)\b/g, "");
  return rest.match(/\d+/g) ?? [];
}

test("no personal number: a score planted in a test registration's title never reaches the email", () => {
  const planted = act({
    item_id: null,
    act: "test_register",
    event_id: "sat_2026_11",
    event_title: "SAT 1530 (your target 1550, 62% likely)",
    event_starts_at: "2026-11-07T12:00:00.000Z",
    url: "https://satsuite.collegeboard.org/sat/registration",
  });
  const email = build([planted, act()])!;
  for (const body of [email.subject, email.text, email.html.replace(/<[^>]+>/g, " ")]) {
    assert.doesNotMatch(body, /1530|1550|62|%|likely|odds|target/i);
  }
  assert.equal(email.subject, "Did you register for the SAT?");
  assert.deepEqual(strayNumbers(email.text), []);
  // The guard is live: the same stored title on a college's own event (passed through, as college text is) shows it,
  // so it is the test registration's rule that drops it.
  assert.match(build([{ ...planted, act: "event", item_id: DUKE }])!.text, /1530/);
});

test("a college's own event title passes through, escaped", () => {
  const email = build([act({ act: "event", event_title: `Preview <script>alert(1)</script> & "Day"` })])!;
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /Preview &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Day&quot;/);
  assert.match(email.text, /Duke's Preview <script>alert\(1\)<\/script> & "Day" sign-up/);
});

test("the job sends one email per person with every one of their acts, built by this template", async () => {
  const mine = [act(), act({ act: "info_request", event_id: null, event_starts_at: null, event_title: null, clicked_at: "2026-10-19T09:00:00.000Z" })];
  const theirs = [act({ user_id: "22222222-2222-4222-8222-222222222222", item_id: ELON, act: "follow", network: "x", event_id: null, event_starts_at: null, event_title: null })];
  const db = fakeSupabase({
    plan_interest_acts: [...mine, ...theirs].map((r) => ({ ...r })),
    notification_prefs: [
      { user_id: mine[0].user_id, your_week: null, unsubscribe_token: "c".repeat(64) },
      { user_id: theirs[0].user_id, your_week: true, unsubscribe_token: "d".repeat(64) },
    ],
    list_items: [
      { id: DUKE, unit_id: "198419" },
      { id: ELON, unit_id: "198516" },
    ],
    visit_events: [{ id: "duke:tour", timezone: "America/New_York" }],
  });
  const sent: { to: string; subject: string; text: string }[] = [];
  const summary = await runInterestConfirm(db as never, {
    now: NOW,
    siteUrl: SITE,
    dry: false,
    namesFor: (ids) => new Map(ids.map((id) => [id, id === "198419" ? "Duke" : "Elon"])),
    build: buildInterestConfirm,
    emailOf: async (id) => (id === mine[0].user_id ? "me@example.com" : "them@example.com"),
    send: async (m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { sent: true };
    },
  });
  assert.equal(summary.sent, 2);
  assert.deepEqual(sent.map((s) => s.to).sort(), ["me@example.com", "them@example.com"]);
  const me = sent.find((s) => s.to === "me@example.com")!;
  assert.match(me.text, /Yesterday you opened Duke's tour sign-up for Nov 3 at 10 AM\./);
  assert.match(me.text, /- Duke's information request\./);
  assert.ok(me.text.includes(`/unsubscribe/${"c".repeat(64)}/week`));
  const them = sent.find((s) => s.to === "them@example.com")!;
  assert.equal(them.subject, "Are you following Elon on X?");
});
