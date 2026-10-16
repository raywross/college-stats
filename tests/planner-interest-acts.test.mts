/**
 * Act tracking (lib/planner/interest-acts.ts, lib/planner/interest-acts-server.ts; specs/planner/v3/guides/
 * show-interest.md): the state machine (pending → confirmed | declined | expired, once), expiry (event + 7 days; click
 * + 14 undated), the prompt's question with and without a date or time, `pendingForPrompt` asking once about the
 * newest act under five minutes old, a confirmed event becoming a visit of the right kind and date, a declined act
 * writing nothing, the token resolving once, the morning job's selection (pending, unemailed, before today, one email
 * per person, `emailed_at` only after a real send, unsubscribed skipped), the guide's events and overview order, the
 * account export, and a guard that nothing outside act tracking reads the table (so nothing pending reaches the hooks,
 * the calendar, a brief, or a parent). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import {
  actForEvent,
  actKey,
  actLabel,
  coalesceByKey,
  confirmUrl,
  expiresAt,
  isActToken,
  isExpired,
  pendingForPrompt,
  promptQuestion,
  PROMPT_WINDOW_MS,
  resolutionPatch,
  selectForEmail,
  visitFromAct,
  visitKindForAct,
  visiblePending,
  INTEREST_ACT_COLUMNS,
  type InterestActRow,
} from "../lib/planner/interest-acts.ts";
import { INTEREST_ACTS } from "../lib/planner/interest-acts-types.ts";
import { guideEvents, interestSentence, loggedParts, overviewRows } from "../lib/planner/interest-guide.ts";
import { hooksFromPlan } from "../lib/planner/hooks.ts";
import { planVisitKind } from "../lib/visit-events/kinds.ts";
import { ACCOUNT_EXPORTERS } from "../lib/account-export.ts";
import { emptyProfile } from "../lib/student-profile.ts";
import { numberProblems } from "./helpers/copy-guard.mts";
import { fakeSupabase } from "./helpers/fake-supabase.mts";
import type { VisitEventKind, VisitEventRow } from "../lib/visit-events/types.ts";
import type { MeasuringPoint } from "../lib/visit-events/measure.ts";
import type { PlanItem, PlanSchool, PlanVisit } from "../lib/planner/types.ts";

const ROOT = join(import.meta.dirname, "..");

/* The server writer imports "server-only"; stand it in the way tests/admin-visit-events.test.mts does. */
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
const server = await import("../lib/planner/interest-acts-server.ts");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const LIST = "44444444-4444-4444-8444-444444444444";
const STUDENT = "55555555-5555-4555-8555-555555555555";
const NY = "America/New_York";

let n = 0;
function act(over: Partial<InterestActRow> = {}): InterestActRow {
  n++;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
    item_id: ITEM,
    user_id: USER,
    act: "tour",
    network: null,
    url: "https://admissions.duke.edu/register/?id=tour",
    event_id: "admissions.duke.edu:tour-1",
    event_starts_at: "2026-11-03T15:00:00.000Z",
    event_place: "Duke, Durham, NC",
    event_title: "Campus Tour",
    clicked_at: "2026-10-20T14:00:00.000Z",
    prompted_at: null,
    emailed_at: null,
    status: "pending",
    resolved_at: null,
    resolved_via: null,
    visit_id: null,
    confirm_token: "ab".repeat(32),
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* The vocabulary                                                      */
/* ------------------------------------------------------------------ */

test("every act has a label; an event is its own title; the columns name every row field", () => {
  assert.deepEqual(
    INTEREST_ACTS.map((a) => actLabel(a, a === "event" ? "Fall Preview Day" : null)),
    ["tour", "information session", "open house", "college fair", "Fall Preview Day", "information request", "mailing list", "follow", "SAT/ACT registration"],
  );
  assert.equal(actLabel("event"), "event");
  const cols = INTEREST_ACT_COLUMNS.split(", ").sort();
  assert.deepEqual(cols, Object.keys(act()).sort());
});

test("an event's kind maps to an act, and a confirmed act's visit kind agrees with planVisitKind", () => {
  const kinds: VisitEventKind[] = ["tour", "info_session", "open_house", "travel", "online", "other"];
  for (const kind of kinds) {
    const a = actForEvent(kind);
    const place = kind === "online" ? "Online" : "Durham, NC";
    assert.equal(visitKindForAct(a, place), planVisitKind(kind), kind);
  }
});

test("the token shape is 64 hex characters (the migration's two UUIDs without dashes)", () => {
  assert.equal(isActToken("ab".repeat(32)), true);
  assert.equal(isActToken("ab".repeat(31)), false);
  assert.equal(isActToken("ZZ".repeat(32)), false);
  assert.equal(confirmUrl("https://quad.example/", "ab".repeat(32), "yes"), `https://quad.example/api/plan/interest/confirm?token=${"ab".repeat(32)}&answer=yes`);
});

/* ------------------------------------------------------------------ */
/* The state machine                                                   */
/* ------------------------------------------------------------------ */

test("pending resolves once: confirmed or declined from pending, nothing from any resolved state", () => {
  const now = new Date("2026-10-20T15:00:00Z");
  assert.deepEqual(resolutionPatch(act(), "confirmed", "prompt", now), { status: "confirmed", resolved_at: now.toISOString(), resolved_via: "prompt" });
  assert.deepEqual(resolutionPatch(act(), "declined", "email", now)?.status, "declined");
  for (const status of ["confirmed", "declined", "expired"] as const) assert.equal(resolutionPatch(act({ status }), "confirmed", "manual", now), null, status);
});

test("expiry: seven days after the event, fourteen after an undated click", () => {
  const dated = act({ event_starts_at: "2026-11-03T15:00:00.000Z" });
  assert.equal(expiresAt(dated), "2026-11-10T15:00:00.000Z");
  const undated = act({ event_starts_at: null, clicked_at: "2026-10-20T14:00:00.000Z" });
  assert.equal(expiresAt(undated), "2026-11-03T14:00:00.000Z");
  assert.equal(isExpired(dated, new Date("2026-11-10T14:59:59Z")), false);
  assert.equal(isExpired(dated, new Date("2026-11-10T15:00:00Z")), true);
  assert.equal(isExpired(undated, new Date("2026-11-03T14:00:00Z")), true);
  // Only a pending act expires.
  assert.equal(isExpired({ ...dated, status: "confirmed" }, new Date("2027-01-01T00:00:00Z")), false);
  assert.deepEqual(visiblePending([dated, undated], new Date("2026-11-05T00:00:00Z")).map((r) => r.id), [dated.id]);
});

test("coalesceByKey: two pending rows for the same item, act, and event collapse to the newer one; different events don't", () => {
  const older = act({ clicked_at: "2026-10-20T14:00:00.000Z" });
  const newer = act({ clicked_at: "2026-10-20T14:05:00.000Z" });
  const otherEvent = act({ event_id: "admissions.duke.edu:tour-2", clicked_at: "2026-10-20T13:00:00.000Z" });
  assert.deepEqual(coalesceByKey([older, newer, otherEvent]).map((r) => r.id).sort(), [newer.id, otherEvent.id].sort());
  // A follow has no event id, so two different networks are two different acts, not a duplicate.
  const ig = act({ act: "follow", network: "instagram", event_id: null, event_starts_at: null });
  const tiktok = act({ act: "follow", network: "tiktok", event_id: null, event_starts_at: null });
  assert.equal(coalesceByKey([ig, tiktok]).length, 2);
  // visiblePending coalesces too (the page's defensive dedupe for a row that slipped through before this fix).
  assert.deepEqual(
    visiblePending([older, newer], new Date("2026-10-20T15:00:00Z")).map((r) => r.id),
    [newer.id],
  );
  assert.equal(actKey(older), actKey(newer));
  assert.notEqual(actKey(older), actKey(otherEvent));
});

/* ------------------------------------------------------------------ */
/* The prompt                                                          */
/* ------------------------------------------------------------------ */

test("the question names the college, the act, and the date and time in the event's own zone", () => {
  assert.equal(promptQuestion(act(), "Duke", NY), "Did you register for Duke's tour on Nov 3 at 10 AM?");
  assert.equal(promptQuestion(act({ event_starts_at: "2026-11-03T23:30:00.000Z" }), "Duke", NY), "Did you register for Duke's tour on Nov 3 at 6:30 PM?");
  // No zone: the day alone, never a guessed clock time.
  assert.equal(promptQuestion(act(), "Duke", null), "Did you register for Duke's tour on Nov 3?");
  // Undated (the college's visit page): did they book one; the date comes next.
  assert.equal(promptQuestion(act({ event_starts_at: null, event_id: null, event_title: null }), "Duke", NY), "Did you book a tour at Duke?");
  assert.equal(promptQuestion(act({ act: "event", event_title: "Duke in Atlanta" }), "Duke", NY), "Did you register for Duke's Duke in Atlanta on Nov 3 at 10 AM?");
  assert.equal(promptQuestion(act({ act: "follow", network: "instagram", event_starts_at: null }), "Elon", NY), "Following Elon on Instagram?");
  assert.equal(promptQuestion(act({ act: "info_request", event_starts_at: null }), "Elon", NY), "Did you request information from Elon?");
  assert.equal(promptQuestion(act({ act: "mailing_list", event_starts_at: null }), "Williams", NY), "Did you join Williams' mailing list?");
  assert.equal(
    promptQuestion(act({ act: "test_register", item_id: null, event_id: "sat_2026_11", event_title: "SAT", event_starts_at: "2026-11-07T12:00:00.000Z" }), null, null),
    "Did you register for the SAT on Nov 7?",
  );
});

test("pendingForPrompt picks the newest unprompted pending act under five minutes old, and asks once", () => {
  const now = new Date("2026-10-20T14:04:00Z");
  const older = act({ clicked_at: "2026-10-20T14:00:30.000Z" });
  const newest = act({ clicked_at: "2026-10-20T14:03:00.000Z" });
  const stale = act({ clicked_at: "2026-10-20T13:58:00.000Z" });
  const answered = act({ clicked_at: "2026-10-20T14:03:30.000Z", status: "confirmed" });
  assert.equal(pendingForPrompt([older, newest, stale, answered], now)?.id, newest.id);
  // Once asked (prompted_at set, whatever the answer), never again; the next one under the window is next.
  const asked = { ...newest, prompted_at: now.toISOString() };
  assert.equal(pendingForPrompt([older, asked, stale], now)?.id, older.id);
  assert.equal(pendingForPrompt([{ ...older, prompted_at: now.toISOString() }, asked, stale], now), null);
  // Exactly five minutes is too old.
  const edge = act({ clicked_at: new Date(now.getTime() - PROMPT_WINDOW_MS).toISOString() });
  assert.equal(pendingForPrompt([edge], now), null);
  assert.equal(pendingForPrompt([stale], now), null);
});

/* ------------------------------------------------------------------ */
/* What a confirmed act writes                                          */
/* ------------------------------------------------------------------ */

test("a confirmed event becomes a visit of the mapped kind on the event's own day and time", () => {
  assert.deepEqual(visitFromAct(act(), {}, NY), {
    kind: "campus_tour",
    onDate: "2026-11-03",
    atTime: "10:00",
    registered: true,
    registrationUrl: "https://admissions.duke.edu/register/?id=tour",
    notesFree: "Campus Tour, Duke, Durham, NC",
  });
  // A late event in Pacific time stays on its own day.
  const pt = visitFromAct(act({ act: "fair", event_starts_at: "2026-11-04T04:00:00.000Z" }), {}, "America/Los_Angeles");
  assert.equal(pt?.kind, "fair");
  assert.equal(pt?.onDate, "2026-11-03");
  assert.equal(pt?.atTime, "20:00");
  // The date the family picked wins; an undated act without one has no visit.
  assert.equal(visitFromAct(act(), { visitDate: "2026-11-05", visitTime: "13:00" }, NY)?.onDate, "2026-11-05");
  assert.equal(visitFromAct(act({ event_starts_at: null }), {}, NY), null);
  assert.equal(visitFromAct(act({ event_starts_at: null }), { visitDate: "2026-12-01" }, NY)?.atTime, null);
});

function planTables(row: InterestActRow) {
  return fakeSupabase({
    plan_interest_acts: [{ ...row }],
    plan_visits: [],
    list_items: [{ id: ITEM, list_id: LIST, unit_id: "198419", visited_on: null, info_requested_on: null, followed_networks: [], follows_social: false }],
    plan_tasks: [
      { id: "t1", list_id: LIST, item_id: ITEM, kind: "request_info", key: `${LIST}:request_info:${ITEM}`, done_at: null },
      { id: "t2", list_id: LIST, item_id: null, kind: "test_register", key: `${LIST}:test_register:sat_2026_11`, done_at: null },
    ],
    students: [{ id: STUDENT, user_id: USER, deleted_at: null }],
    student_profiles: [{ student_id: STUDENT, data: { ...emptyProfile(), tests: { ...emptyProfile().tests, focus: "sat", plannedDates: [] } } }],
    lists: [{ id: LIST, student_id: STUDENT, is_default: true }],
  });
}

const OPTS = { now: new Date("2026-10-20T15:00:00Z"), today: "2026-10-20", timeZone: NY };

test("resolveActRow: a confirmed tour logs a registered visit, links it, and closes the act", async () => {
  const row = act();
  const db = planTables(row);
  const out = await server.resolveActRow(db as never, row, "confirmed", "prompt", {}, OPTS);
  assert.equal(out.kind, "resolved");
  const visit = db.tables.plan_visits[0];
  assert.equal(visit.kind, "campus_tour");
  assert.equal(visit.on_date, "2026-11-03");
  assert.equal(visit.at_time, "10:00");
  assert.equal(visit.registered, true);
  assert.equal(visit.registration_url, row.url);
  assert.deepEqual(visit.notes, { free: "Campus Tour, Duke, Durham, NC" });
  const stored = db.tables.plan_interest_acts[0];
  assert.equal(stored.status, "confirmed");
  assert.equal(stored.resolved_via, "prompt");
  assert.equal(stored.visit_id, visit.id);
  assert.equal(out.kind === "resolved" && out.listId, LIST);
  // A future visit leaves visited_on empty (the built first-past-visit rule).
  assert.equal(db.tables.list_items[0].visited_on, null);
});

test("resolveActRow: without the event's own zone, a confirmed visit's time falls back to a guess from its state (QA finding 4a) rather than going empty", async () => {
  // Dev's actual shape: visit_events.timezone null (the scraper read no zone off the page) but event_place still
  // names a state. Stanford, CA picks a zone three hours off New York's, so the fallback is provably engaging.
  const row = act({ event_place: "Stanford, CA", event_starts_at: "2026-11-03T18:00:00.000Z" });
  const db = planTables(row);
  const out = await server.resolveActRow(db as never, row, "confirmed", "prompt", {}, { now: new Date("2026-10-20T15:00:00Z"), today: "2026-10-20", timeZone: null });
  assert.equal(out.kind, "resolved");
  const visit = db.tables.plan_visits[0];
  assert.equal(visit.at_time, "10:00", "10am Pacific, not left empty for want of a stored zone");
  // The event's own confirmed zone still wins when one is on record.
  const row2 = act({ id: "bbbbbbbb-0000-4000-8000-000000000001", event_place: "Stanford, CA", event_starts_at: "2026-11-03T18:00:00.000Z" });
  const db2 = planTables(row2);
  await server.resolveActRow(db2 as never, row2, "confirmed", "prompt", {}, { now: new Date("2026-10-20T15:00:00Z"), today: "2026-10-20", timeZone: "America/New_York" });
  assert.equal(db2.tables.plan_visits[0].at_time, "13:00");
  // No state to guess from (a place with no comma, or none at all): zoneForState's own default (Eastern) applies,
  // same as everywhere else in the product that falls back to it — still a guess, never a blank for want of trying.
  const row3 = act({ event_place: null, event_starts_at: "2026-11-03T18:00:00.000Z" });
  const db3 = planTables(row3);
  await server.resolveActRow(db3 as never, row3, "confirmed", "prompt", {}, { now: new Date("2026-10-20T15:00:00Z"), today: "2026-10-20", timeZone: null });
  assert.equal(db3.tables.plan_visits[0].at_time, "13:00");
});

test("resolveActRow: a declined act writes nothing but its own status", async () => {
  const row = act();
  const db = planTables(row);
  const out = await server.resolveActRow(db as never, row, "declined", "email", {}, OPTS);
  assert.equal(out.kind, "resolved");
  assert.deepEqual(
    db.writes.map((w) => w.table),
    ["plan_interest_acts"],
  );
  assert.equal(db.tables.plan_interest_acts[0].status, "declined");
  assert.equal(db.tables.plan_visits.length, 0);
});

test("resolveActRow: the token resolves once; a second answer writes nothing", async () => {
  const row = act();
  const db = planTables(row);
  assert.equal((await server.resolveActRow(db as never, row, "confirmed", "email", {}, OPTS)).kind, "resolved");
  const fresh = (await server.actByToken(db as never, row.confirm_token))!;
  assert.equal(fresh.status, "confirmed");
  const writes = db.writes.length;
  const again = await server.resolveActRow(db as never, fresh, "declined", "email", {}, OPTS);
  assert.deepEqual(again, { kind: "already", status: "confirmed" });
  assert.equal(db.writes.length, writes);
  // Planted: a stale copy of the row still says pending, but the guarded update finds nothing to change.
  const stale = await server.resolveActRow(db as never, row, "declined", "email", {}, OPTS);
  assert.equal(stale.kind, "already");
  assert.equal(db.tables.plan_interest_acts[0].status, "confirmed");
});

test("resolveActRow: an expired act is never confirmed, and an undated tour asks for the date", async () => {
  const late = act({ event_starts_at: "2026-10-01T15:00:00.000Z" });
  const db = planTables(late);
  assert.deepEqual(await server.resolveActRow(db as never, late, "confirmed", "email", {}, OPTS), { kind: "already", status: "expired" });
  assert.equal(db.tables.plan_visits.length, 0);

  const undated = act({ event_starts_at: null, event_id: null, event_title: null, event_place: null });
  const db2 = planTables(undated);
  assert.deepEqual(await server.resolveActRow(db2 as never, undated, "confirmed", "email", {}, OPTS), { kind: "need_date" });
  assert.equal(db2.tables.plan_interest_acts[0].status, "pending");
  const picked = await server.resolveActRow(db2 as never, undated, "confirmed", "prompt", { visitDate: "2026-11-12", visitTime: "09:30" }, OPTS);
  assert.equal(picked.kind, "resolved");
  assert.equal(db2.tables.plan_visits[0].on_date, "2026-11-12");
  assert.equal(db2.tables.plan_visits[0].at_time, "09:30");
});

test("resolveActRow: an information request, a follow, and a test registration write through their own records", async () => {
  const info = act({ act: "info_request", event_id: null, event_starts_at: null });
  const db = planTables(info);
  await server.resolveActRow(db as never, info, "confirmed", "manual", {}, OPTS);
  assert.equal(db.tables.list_items[0].info_requested_on, "2026-10-20");
  assert.ok(db.tables.plan_tasks[0].done_at);

  const follow = act({ act: "follow", network: "instagram", event_id: null, event_starts_at: null });
  const db2 = planTables(follow);
  await server.resolveActRow(db2 as never, follow, "confirmed", "prompt", {}, OPTS);
  assert.deepEqual(db2.tables.list_items[0].followed_networks, ["instagram"]);
  assert.equal(db2.tables.list_items[0].follows_social, true);

  const test = act({ act: "test_register", item_id: null, event_id: "sat_2026_11", event_title: "SAT", event_starts_at: "2026-11-07T12:00:00.000Z", url: "https://satsuite.collegeboard.org/sat/registration" });
  const db3 = planTables(test);
  const out = await server.resolveActRow(db3 as never, test, "confirmed", "prompt", {}, OPTS);
  assert.equal(out.kind, "resolved");
  const tests = (db3.tables.student_profiles[0].data as { tests: { plannedDates: string[]; registeredDates: string[] } }).tests;
  assert.deepEqual(tests.plannedDates, ["sat_2026_11"]);
  assert.deepEqual(tests.registeredDates, ["sat_2026_11"]);
  assert.ok(db3.tables.plan_tasks[1].done_at, "the matching test_register task is ticked");
  assert.equal(db3.tables.plan_visits.length, 0, "a test registration is not a college visit");
});

// U5 (guides/test-prep.md "Upcoming dates"): a guardian's click has no item or list of its own to say which child it's
// for, so the fallback below is the one household child with that date's test_register task still open.
test("resolveActRow: a guardian's confirmed registration writes the one household child with that date open", async () => {
  const GUARDIAN = "66666666-6666-4666-8666-666666666666";
  const row = act({
    act: "test_register",
    item_id: null,
    user_id: GUARDIAN,
    event_id: "sat_2026_11",
    event_title: "SAT",
    event_starts_at: "2026-11-07T12:00:00.000Z",
    url: "https://satsuite.collegeboard.org/sat/registration",
  });
  const db = fakeSupabase({
    plan_interest_acts: [{ ...row }],
    plan_visits: [],
    list_items: [],
    plan_tasks: [{ id: "t1", list_id: LIST, item_id: null, kind: "test_register", key: `${LIST}:test_register:sat_2026_11`, done_at: null }],
    students: [{ id: STUDENT, user_id: USER, deleted_at: null }],
    student_profiles: [{ student_id: STUDENT, data: { ...emptyProfile(), tests: { ...emptyProfile().tests, focus: "sat", plannedDates: [] } } }],
    lists: [{ id: LIST, student_id: STUDENT, is_default: true }],
    household_members: [{ id: "m1", user_id: GUARDIAN, student_id: STUDENT, can_edit: true }],
  });
  const out = await server.resolveActRow(db as never, row, "confirmed", "manual", {}, OPTS);
  assert.equal(out.kind, "resolved");
  const tests = (db.tables.student_profiles[0].data as { tests: { plannedDates: string[]; registeredDates: string[] } }).tests;
  assert.deepEqual(tests.plannedDates, ["sat_2026_11"]);
  assert.deepEqual(tests.registeredDates, ["sat_2026_11"]);
  assert.ok(db.tables.plan_tasks[0].done_at);
});

test("resolveActRow: a guardian with two household children and neither's date open writes nothing (ambiguous, no guess)", async () => {
  const GUARDIAN = "77777777-7777-4777-8777-777777777777";
  const STUDENT2 = "88888888-8888-4888-8888-888888888888";
  const row = act({ act: "test_register", item_id: null, user_id: GUARDIAN, event_id: "sat_2026_11", event_title: "SAT", event_starts_at: "2026-11-07T12:00:00.000Z" });
  const db = fakeSupabase({
    plan_interest_acts: [{ ...row }],
    plan_visits: [],
    list_items: [],
    plan_tasks: [],
    students: [],
    student_profiles: [],
    lists: [
      { id: LIST, student_id: STUDENT, is_default: true },
      { id: "list2", student_id: STUDENT2, is_default: true },
    ],
    household_members: [
      { id: "m1", user_id: GUARDIAN, student_id: STUDENT, can_edit: true },
      { id: "m2", user_id: GUARDIAN, student_id: STUDENT2, can_edit: true },
    ],
  });
  const out = await server.resolveActRow(db as never, row, "confirmed", "manual", {}, OPTS);
  assert.equal(out.kind, "resolved");
  assert.equal(db.tables.student_profiles.length, 0, "no student's date was open, so nothing is guessed");
});

/* ------------------------------------------------------------------ */
/* The morning job                                                     */
/* ------------------------------------------------------------------ */

test("selectForEmail: pending, unemailed, clicked before today (UTC), not expired; grouped by person, newest first", () => {
  const now = new Date("2026-10-21T13:30:00Z");
  const a1 = act({ clicked_at: "2026-10-20T14:00:00.000Z" });
  const a2 = act({ clicked_at: "2026-10-19T14:00:00.000Z" });
  const today = act({ clicked_at: "2026-10-21T01:00:00.000Z" });
  const emailed = act({ clicked_at: "2026-10-18T14:00:00.000Z", emailed_at: "2026-10-19T13:30:00.000Z" });
  const done = act({ status: "confirmed" });
  const expired = act({ event_starts_at: "2026-10-01T15:00:00.000Z" });
  const other = act({ user_id: OTHER });
  const out = selectForEmail([a1, a2, today, emailed, done, expired, other], now);
  assert.deepEqual([...out.keys()].sort(), [USER, OTHER].sort());
  assert.deepEqual(
    out.get(USER)!.map((r) => r.id),
    [a1.id, a2.id],
  );
});

function jobDb(rows: InterestActRow[], prefs: { user_id: string; your_week: boolean | null; unsubscribe_token: string }[]) {
  return fakeSupabase({
    plan_interest_acts: rows.map((r) => ({ ...r })),
    notification_prefs: prefs.map((p) => ({ ...p })),
    list_items: [{ id: ITEM, list_id: LIST, unit_id: "198419" }],
    visit_events: [{ id: "admissions.duke.edu:tour-1", timezone: NY }],
  });
}

function jobDeps(sendOk = true) {
  const sent: { to: string; subject: string }[] = [];
  const tracked: { event: string; properties: Record<string, string | number> }[] = [];
  return {
    sent,
    tracked,
    deps: {
      now: new Date("2026-10-21T13:30:00Z"),
      siteUrl: "https://quad.example",
      dry: false,
      namesFor: (ids: string[]) => new Map(ids.map((id) => [id, id === "198419" ? "Duke" : id])),
      build: (input: { acts: InterestActRow[] }) => ({ subject: `about ${input.acts.length}`, text: "t", html: "h" }),
      emailOf: async (userId: string) => (userId === USER ? "student@example.com" : "other@example.com"),
      send: async (m: { to: string; subject: string }) => {
        sent.push({ to: m.to, subject: m.subject });
        return { sent: sendOk };
      },
      track: (event: string, properties: Record<string, string | number>) => {
        tracked.push({ event, properties });
      },
    },
  };
}

test("runInterestConfirm: one email per person, emailed_at set after the send, expired first, unsubscribed skipped", async () => {
  const a1 = act({ clicked_at: "2026-10-20T14:00:00.000Z" });
  const a2 = act({ act: "info_request", event_id: null, event_starts_at: null, clicked_at: "2026-10-19T14:00:00.000Z" });
  const old = act({ act: "follow", network: "x", event_id: null, event_starts_at: null, clicked_at: "2026-10-01T14:00:00.000Z" });
  const off = act({ user_id: OTHER, clicked_at: "2026-10-20T14:00:00.000Z" });
  const db = jobDb([a1, a2, old, off], [
    { user_id: USER, your_week: null, unsubscribe_token: "c".repeat(64) },
    { user_id: OTHER, your_week: false, unsubscribe_token: "d".repeat(64) },
  ]);
  const { deps, sent, tracked } = jobDeps();
  const summary = await server.runInterestConfirm(db as never, deps as never);
  assert.equal(summary.expired, 1);
  assert.equal(summary.sent, 1);
  assert.equal(summary.skipped.unsubscribed, 1);
  assert.deepEqual(sent, [{ to: "student@example.com", subject: "about 2" }]);
  const byId = new Map(db.tables.plan_interest_acts.map((r) => [r.id, r]));
  assert.equal(byId.get(old.id)!.status, "expired");
  assert.ok(byId.get(a1.id)!.emailed_at);
  assert.ok(byId.get(a2.id)!.emailed_at);
  assert.equal(byId.get(off.id)!.emailed_at, null, "an unsubscribed person's acts stay unemailed and pending");
  assert.equal(byId.get(off.id)!.status, "pending");
  assert.deepEqual(
    tracked.map((t) => t.event).sort(),
    ["interest_confirm_sent", "plan_interest_expired"],
  );
  assert.deepEqual(tracked.find((t) => t.event === "plan_interest_expired")!.properties, { action: "follow" });

  // The next morning nothing is sent again: every act was emailed once.
  const again = await server.runInterestConfirm(db as never, { ...deps, now: new Date("2026-10-22T13:30:00Z") } as never);
  assert.equal(again.sent, 0);
});

test("runInterestConfirm: a failed send records nothing; a dry run writes nothing and returns the emails", async () => {
  const a1 = act({ clicked_at: "2026-10-20T14:00:00.000Z" });
  const old = act({ act: "follow", network: "x", event_id: null, event_starts_at: null, clicked_at: "2026-10-01T14:00:00.000Z" });
  const db = jobDb([a1, old], [{ user_id: USER, your_week: true, unsubscribe_token: "c".repeat(64) }]);
  const failing = jobDeps(false);
  const summary = await server.runInterestConfirm(db as never, failing.deps as never);
  assert.equal(summary.sent, 0);
  assert.equal(summary.errors, 1);
  assert.equal(db.tables.plan_interest_acts.find((r) => r.id === a1.id)!.emailed_at, null);

  const db2 = jobDb([a1, old], [{ user_id: USER, your_week: true, unsubscribe_token: "c".repeat(64) }]);
  const dry = jobDeps();
  const preview = await server.runInterestConfirm(db2 as never, { ...dry.deps, dry: true } as never);
  assert.equal(preview.previews?.length, 1);
  assert.equal(preview.expired, 1, "a dry run counts what would expire");
  assert.deepEqual(db2.writes, [], "a dry run writes nothing");
  assert.deepEqual(dry.sent, []);
});

test("runInterestConfirm: a person without a prefs row gets one (and an unsubscribe token) before the first email", async () => {
  const a1 = act({ clicked_at: "2026-10-20T14:00:00.000Z" });
  const db = jobDb([a1], []);
  let unsubscribe = "";
  const { deps } = jobDeps();
  const summary = await server.runInterestConfirm(db as never, {
    ...deps,
    build: (input: { acts: InterestActRow[]; unsubscribeUrl: string }) => {
      unsubscribe = input.unsubscribeUrl;
      return { subject: "s", text: "t", html: "h" };
    },
  } as never);
  assert.equal(summary.sent, 1);
  assert.equal(unsubscribe, `https://quad.example/unsubscribe/${"f".repeat(64)}/week`);
});

/* ------------------------------------------------------------------ */
/* The guide's pure parts                                              */
/* ------------------------------------------------------------------ */

const HOME: MeasuringPoint = { lat: 33.95, lng: -84.55, source: "home", label: "home in Marietta, GA" };
let ev = 0;
function event(over: Partial<VisitEventRow> = {}): VisitEventRow {
  ev++;
  return {
    id: `h:${ev}`,
    unit_id: "198419",
    host: "h",
    slate_id: String(ev),
    title: `Event ${ev}`,
    kind: "tour",
    starts_at: `2026-11-${String(ev).padStart(2, "0")}T15:00:00Z`,
    ends_at: null,
    timezone: NY,
    all_day: false,
    online: false,
    venue: null,
    address: null,
    city: "Durham",
    state: "NC",
    zip: null,
    lat: 36.0,
    lng: -78.94,
    availability: "open",
    book_url: "https://h/register",
    source_url: "https://h",
    description: null,
    date_confirmed: true,
    first_seen: "2026-10-01T00:00:00Z",
    last_seen: "2026-10-20T07:00:00Z",
    changed_at: "2026-10-01T00:00:00Z",
    moved_at: null,
    removed_at: null,
    ...over,
  };
}

test("guideEvents: the family's nearby ones first (two at most), then on campus, four in all, never staff or past", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  ev = 0;
  const campus = [event(), event(), event(), event(), event()];
  const near = [event({ kind: "travel", lat: 33.96, lng: -84.55 }), event({ kind: "travel", lat: 33.97, lng: -84.55 }), event({ kind: "travel", lat: 33.98, lng: -84.55 })];
  const far = event({ kind: "travel", lat: 40, lng: -100 });
  const staff = event({ kind: "staff" });
  const past = event({ starts_at: "2026-10-01T15:00:00Z" });
  const picked = guideEvents([...campus, ...near, far, staff, past], HOME, 30, now);
  assert.equal(picked.length, 4);
  assert.deepEqual(
    picked.map((e) => e.id),
    [near[0].id, near[1].id, campus[0].id, campus[1].id],
  );
  assert.equal(picked[0].near, true);
  // No point: four on campus.
  assert.deepEqual(
    guideEvents([...campus, ...near], null, 30, now).map((e) => e.id),
    campus.slice(0, 4).map((e) => e.id),
  );
});

const school = (name: string, interest: string | null): PlanSchool => ({ unit_id: name, name, profile: interest ? { factors: { interest } } : null, cites: {} }) as unknown as PlanSchool;

test("overviewRows: ED candidates first, then important, then considered; not considered and unreported folded", () => {
  const items = ["A", "B", "C", "D", "E", "F"].map((id, i) => ({ id, unit_id: id, withdrawn_on: null, position: i }));
  const schools = {
    A: school("A", "considered"),
    B: school("B", "not_considered"),
    C: school("C", "very_important"),
    D: school("D", null),
    E: school("E", "important"),
    F: school("F", "not_considered"),
  };
  const out = overviewRows(items, schools, [{ itemId: "F", rank: 1 }]);
  assert.deepEqual(
    out.shown.map((r) => r.itemId),
    ["F", "C", "E", "A"],
  );
  assert.deepEqual(
    out.notConsidered.map((r) => r.itemId),
    ["B"],
  );
  assert.deepEqual(
    out.unknown.map((r) => r.itemId),
    ["D"],
  );
});

test("the logged line reads only confirmed records, in order", () => {
  const visits = [
    { id: "v1", item_id: ITEM, kind: "campus_tour", on_date: "2026-03-14" },
    { id: "v2", item_id: ITEM, kind: "open_house", on_date: "2026-11-08" },
  ] as PlanVisit[];
  assert.deepEqual(loggedParts({ visited_on: "2026-03-14", info_requested_on: "2026-09-02", followed_networks: ["instagram"] }, visits, "2026-10-20"), [
    "visited Mar 14 (campus tour)",
    "open house planned Nov 8",
    "info requested Sep 2",
    "following on Instagram",
  ]);
  assert.deepEqual(loggedParts({ visited_on: null, info_requested_on: null, followed_networks: [] }, [], "2026-10-20"), []);
});

test("the guide's own words carry no number and no promise: the C7 sentences pass the shared copy guard", () => {
  for (const factor of ["very_important", "important", "considered", "not_considered", null] as const) {
    const s = interestSentence("Elon", factor);
    for (const line of [s.claim, s.then ?? ""]) assert.deepEqual(numberProblems(line), [], line);
    assert.doesNotMatch(`${s.claim} ${s.then}`, /improve|boost|help your/i);
  }
  const fixed = [
    "An information request or a mailing-list sign-up puts you in Elon's system.",
    "No college says it counts a follow; do it for yourself.",
    "We can't see the college's page, so we ask. Only a yes goes on your plan.",
  ];
  for (const line of fixed) assert.deepEqual(numberProblems(line), [], line);
  // The guard is live: a planted promise fails it.
  assert.notDeepEqual(numberProblems("A visit raises your odds by 20%."), []);
});

/* ------------------------------------------------------------------ */
/* Nothing pending reaches anything else                                */
/* ------------------------------------------------------------------ */

function sources(dir: string, out: Map<string, string> = new Map()): Map<string, string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, out);
    else if (/\.(tsx?|mts)$/.test(name)) out.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  }
  return out;
}

const ACT_READERS = new Set(["lib/planner/interest-acts-server.ts", "lib/planner/store-interest.ts", "lib/account-export.ts", "lib/admin/people.ts", "lib/planner/interest-acts-types.ts"]);

/** Files that name the acts table outside act tracking itself. */
function strayReaders(files: Map<string, string>): string[] {
  return [...files].filter(([path, text]) => /plan_interest_acts/.test(text) && !ACT_READERS.has(path)).map(([path]) => path);
}

test("only act tracking reads the acts table: the hooks, the calendar, the briefs, and a parent's view never see a pending act", () => {
  const files = new Map([...sources("lib"), ...sources("app"), ...sources("components")]);
  assert.deepEqual(strayReaders(files), []);
  // Planted: a calendar that reads the table is caught.
  assert.deepEqual(strayReaders(new Map([["lib/planner/calendar.ts", "client.from('plan_interest_acts')"]])), ["lib/planner/calendar.ts"]);
  // The interest hook reads the list and the visits only: a pending act is in neither.
  const hooks = hooksFromPlan([{ id: ITEM, unit_id: "198419", legacy: false, recruited: null, visited_on: null, info_requested_on: null, followed_networks: [] } as unknown as PlanItem], []);
  assert.equal(hooks["198419"], undefined);
  for (const f of ["lib/planner/hooks.ts", "lib/planner/calendar.ts"]) assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /interest-acts/, f);
});

test("the account export includes the person's own acts", () => {
  const exporter = ACCOUNT_EXPORTERS.find((e) => e.key === "plan_interest_acts");
  assert.ok(exporter, "ACCOUNT_EXPORTERS registers plan_interest_acts");
  const src = readFileSync(join(ROOT, "lib/account-export.ts"), "utf8");
  const block = src.slice(src.indexOf('key: "plan_interest_acts"'), src.indexOf('key: "access_log"'));
  assert.match(block, /\.eq\("user_id", userId\)/);
  assert.doesNotMatch(block, /confirm_token/, "the token isn't exported");
});

test("the cron is scheduled at 13:30 UTC and the confirm link writes only on POST", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(
    vercel.crons.find((c) => c.path === "/api/cron/interest-confirm"),
    { path: "/api/cron/interest-confirm", schedule: "30 13 * * *" },
  );
  const route = readFileSync(join(ROOT, "app/api/plan/interest/confirm/route.ts"), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(get, /resolveActRow/, "a mail scanner opening the link never confirms anything");
  assert.match(route.slice(route.indexOf("export async function POST")), /resolveActRow\(client, row, answer === "yes" \? "confirmed" : "declined", "email"/);
});
