/**
 * Pure rules for saved lists (lib/list-rules.ts; specs/product/saved-lists.md): status/outcome transitions, the
 * balance line, deadline resolution, and CSV export/import round-trips. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOutcome,
  balanceLine,
  deadlineFor,
  parseCsv,
  setStatus,
  toCsv,
  upcomingDeadlines,
  type CsvRow,
  type ListItem,
  CSV_COLUMNS,
  SCOIR_COLUMNS,
  TRACKING_LABELS,
  TRACKING_ORDER,
  isoDateOrNull,
  listOwner,
  ownerColumn,
  trackingChips,
  trackingWrite,
} from "../lib/list-rules.ts";

/* ------------------------------------------------------------------ */
/* Status / outcome transitions                                       */
/* ------------------------------------------------------------------ */

test("applyOutcome: deferred returns to applied with no outcome; everything else is decided", () => {
  assert.deepEqual(applyOutcome("deferred"), { status: "applied", outcome: null });
  assert.deepEqual(applyOutcome("admitted"), { status: "decided", outcome: "admitted" });
  assert.deepEqual(applyOutcome("denied"), { status: "decided", outcome: "denied" });
  assert.deepEqual(applyOutcome("waitlisted"), { status: "decided", outcome: "waitlisted" });
});

test("setStatus: moving off 'decided' clears the outcome; moving to 'decided' keeps it", () => {
  assert.deepEqual(setStatus({ status: "decided", outcome: "admitted" }, "applying"), { status: "applying", outcome: null });
  assert.deepEqual(setStatus({ status: "decided", outcome: "admitted" }, "decided"), { status: "decided", outcome: "admitted" });
  assert.deepEqual(setStatus({ status: "considering", outcome: null }, "applied"), { status: "applied", outcome: null });
});

/* ------------------------------------------------------------------ */
/* Balance line                                                        */
/* ------------------------------------------------------------------ */

const cat = (c: ListItem["category"]) => ({ category: c });

test("balanceLine: tallies non-zero categories and adds counselor guidance", () => {
  assert.equal(balanceLine([]), "No colleges sorted yet");
  assert.equal(balanceLine([cat("unsorted"), cat("unsorted")]), "No colleges sorted yet");
  assert.equal(
    balanceLine([cat("reach"), cat("reach"), cat("reach"), cat("target"), cat("target"), cat("target"), cat("target"), cat("likely")]),
    "3 Reach · 4 Target · 1 Likely: counselors suggest 2–3 Likely",
  );
  assert.equal(balanceLine([cat("target"), cat("likely"), cat("likely"), cat("likely")]), "1 Target · 3 Likely");
  assert.equal(balanceLine([cat("reach"), cat("target")]), "1 Reach · 1 Target: counselors suggest at least 1–2 Likely");
  assert.equal(
    balanceLine([cat("reach"), cat("reach"), cat("reach"), cat("reach"), cat("reach"), cat("target"), cat("likely"), cat("likely")]),
    "5 Reach · 1 Target · 2 Likely: that's a lot of Reach relative to Target and Likely",
  );
});

/* ------------------------------------------------------------------ */
/* Deadlines                                                            */
/* ------------------------------------------------------------------ */

test("deadlineFor: prefers the college's own reported date for the chosen round", () => {
  const logistics = { regular_closing: { month: 1, day: 5 }, priority_date: null };
  const profile = {
    early_decision: { first: { closing: { month: 11, day: 1 } }, other: { closing: { month: 1, day: 1 } } },
    early_action: { closing: { month: 11, day: 15 } },
  };
  assert.deepEqual(deadlineFor("rd", logistics, profile, 2026, { text: null, date: null }), { date: "2027-01-05", text: null, source: "reported" });
  assert.deepEqual(deadlineFor("ed", logistics, profile, 2026, { text: null, date: null }), { date: "2026-11-01", text: null, source: "reported" });
  assert.deepEqual(deadlineFor("ed2", logistics, profile, 2026, { text: null, date: null }), { date: "2027-01-01", text: null, source: "reported" });
  assert.deepEqual(deadlineFor("ea", logistics, profile, 2026, { text: null, date: null }), { date: "2026-11-15", text: null, source: "reported" });
});

test("deadlineFor: falls back to the student's own override, then null", () => {
  assert.deepEqual(deadlineFor("rolling", null, null, 2026, { text: null, date: "2026-12-01" }), { date: "2026-12-01", text: null, source: "student" });
  assert.deepEqual(deadlineFor("rd", null, null, 2026, { text: "Check their site", date: null }), { date: null, text: "Check their site", source: "student" });
  assert.deepEqual(deadlineFor("rd", null, null, 2026, { text: null, date: null }), { date: null, text: null, source: null });
});

test("upcomingDeadlines: within the window, soonest first, undated items dropped", () => {
  const items = [
    { id: "a", deadline: { date: "2026-11-01", text: null, source: "reported" as const } },
    { id: "b", deadline: { date: "2026-10-20", text: null, source: "reported" as const } },
    { id: "c", deadline: { date: null, text: "varies", source: "student" as const } },
    { id: "d", deadline: { date: "2027-06-01", text: null, source: "reported" as const } },
  ];
  const result = upcomingDeadlines(items, new Date("2026-10-05T00:00:00"), 30);
  assert.deepEqual(result.map((i) => i.id), ["b", "a"]);
});

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

const ROWS: CsvRow[] = [
  {
    name: "Stanford University",
    category: "reach",
    round: "rea",
    status: "applied",
    outcome: null,
    deadline: "2026-01-05",
    enrolling: false,
    notes: "Loved the tour",
    updates: true,
    visited_on: "2026-09-20",
    follows_social: true,
    dream: true,
    priority: 1,
  },
  {
    name: "A College, Inc.",
    category: "likely",
    round: "rd",
    status: "decided",
    outcome: "admitted",
    deadline: null,
    enrolling: true,
    notes: 'Said "yes"',
    updates: false,
    visited_on: null,
    follows_social: false,
    dream: false,
    priority: null,
  },
];

test("toCsv / parseCsv round-trip the Scoir-compatible columns, the tracking columns, and the planner's dream/priority columns after them", () => {
  const csv = toCsv(ROWS);
  assert.ok(csv.startsWith("College,Category,Round,Status,Outcome,Deadline,Enrolling,Notes,updates,visited_on,follows_social,dream,priority\n"));
  assert.deepEqual(CSV_COLUMNS.slice(0, 8), [...SCOIR_COLUMNS], "the Scoir columns stay first and in order");
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], ROWS[0]);
  assert.deepEqual(parsed[1], ROWS[1]);
});

test("parseCsv: a Scoir export without the tracking columns gets the defaults (updates on, not visited, not following)", () => {
  const parsed = parseCsv("College,Category,Round,Status,Outcome,Deadline,Enrolling,Notes\nDuke University,Target,,Considering,,,,");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].updates, true);
  assert.equal(parsed[0].visited_on, null);
  assert.equal(parsed[0].follows_social, false);
});

test("parseCsv: tracking columns in any order, with spaces or capitals in the header; a bad date is dropped", () => {
  const parsed = parseCsv("Follows Social,College,Visited On,Updates\nyes,Rice University,2026-02-30,no\n,Tulane University,2025-11-02,");
  assert.deepEqual(
    parsed.map((r) => [r.name, r.updates, r.visited_on, r.follows_social]),
    [
      ["Rice University", false, null, true],
      ["Tulane University", true, "2025-11-02", false],
    ],
  );
});

test("isoDateOrNull: real calendar dates only", () => {
  assert.equal(isoDateOrNull("2026-09-20"), "2026-09-20");
  for (const bad of ["2026-02-30", "2026-9-20", "yesterday", "", null, 20260920]) assert.equal(isoDateOrNull(bad), null, String(bad));
});

/* ------------------------------------------------------------------ */
/* Owners                                                               */
/* ------------------------------------------------------------------ */

test("listOwner / ownerColumn: a student's list filters by student_id, a user's own by user_id", () => {
  assert.deepEqual(listOwner({ student_id: "s1", user_id: null }), { kind: "student", id: "s1" });
  assert.deepEqual(listOwner({ student_id: null, user_id: "u1" }), { kind: "user", id: "u1" });
  assert.throws(() => listOwner({ student_id: null, user_id: null }), /without an owner/);
  assert.deepEqual(ownerColumn({ kind: "student", id: "s1" }), { column: "student_id", id: "s1" });
  assert.deepEqual(ownerColumn({ kind: "user", id: "u1" }), { column: "user_id", id: "u1" });
});

/* ------------------------------------------------------------------ */
/* Tracking row                                                         */
/* ------------------------------------------------------------------ */

const tracked = (over: Partial<Pick<ListItem, "updates" | "status" | "outcome" | "visited_on" | "follows_social">> = {}) => ({
  updates: true,
  status: "considering" as const,
  outcome: null,
  visited_on: null,
  follows_social: false,
  ...over,
});

test("trackingChips: five chips in the spec's order; a new item has only Updates on", () => {
  const chips = trackingChips(tracked());
  assert.deepEqual(chips.map((c) => c.key), TRACKING_ORDER);
  assert.deepEqual(chips.map((c) => TRACKING_LABELS[c.key]), ["Updates", "Applying", "Visited", "Following on social", "Accepted"]);
  assert.deepEqual(chips.filter((c) => c.on).map((c) => c.key), ["updates"]);
  assert.ok(chips.every((c) => !c.locked));
});

test("trackingChips: Applying reads the status and locks on once applied or decided; Accepted reads the outcome", () => {
  const on = (item: ReturnType<typeof tracked>) => Object.fromEntries(trackingChips(item).map((c) => [c.key, [c.on, c.locked]]));
  assert.deepEqual(on(tracked({ status: "applying" })).applying, [true, false]);
  assert.deepEqual(on(tracked({ status: "applied" })).applying, [true, true]);
  assert.deepEqual(on(tracked({ status: "decided", outcome: "admitted" })).applying, [true, true]);
  assert.deepEqual(on(tracked({ status: "decided", outcome: "admitted" })).accepted, [true, false]);
  assert.deepEqual(on(tracked({ status: "decided", outcome: "denied" })).accepted, [false, false]);
  assert.deepEqual(on(tracked({ visited_on: "2026-09-20", follows_social: true, updates: false })).visited, [true, false]);
  assert.deepEqual(on(tracked({ follows_social: true })).social, [true, false]);
  assert.deepEqual(on(tracked({ updates: false })).updates, [false, false]);
});

test("trackingWrite: each toggle maps to the existing actions (Applying ↔ status, Accepted ↔ outcome)", () => {
  const today = "2026-10-06";
  assert.deepEqual(trackingWrite("updates", false, today), { action: "setUpdates", value: false });
  assert.deepEqual(trackingWrite("applying", true, today), { action: "setItemStatus", status: "applying" });
  assert.deepEqual(trackingWrite("applying", false, today), { action: "setItemStatus", status: "considering" });
  assert.deepEqual(trackingWrite("visited", true, today), { action: "setVisited", date: today });
  assert.deepEqual(trackingWrite("visited", false, today), { action: "setVisited", date: null });
  assert.deepEqual(trackingWrite("social", true, today), { action: "setFollowsSocial", value: true });
  assert.deepEqual(trackingWrite("accepted", true, today), { action: "setOutcome", outcome: "admitted", date: today });
  // Accepted off: back to applied with no outcome (owner assumption), via setStatus's clearing rule.
  assert.deepEqual(trackingWrite("accepted", false, today), { action: "setItemStatus", status: "applied" });
  assert.deepEqual(setStatus({ status: "decided", outcome: "admitted" }, "applied"), { status: "applied", outcome: null });
  // Accepted on goes through applyOutcome: decided + admitted, which the chips then read back as on.
  const next = applyOutcome("admitted");
  assert.equal(trackingChips(tracked(next)).find((c) => c.key === "accepted")!.on, true);
});

test("parseCsv: tolerates a header-less paste and unrecognized category/status text", () => {
  const pasted = "Harvard University,Reach\nMIT,made up category,Early decision";
  const parsed = parseCsv(pasted);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "Harvard University");
  assert.equal(parsed[0].category, "reach");
  assert.equal(parsed[1].category, "unsorted", "an unrecognized category falls back rather than failing the row");
  assert.equal(parsed[1].round, "ed");
});

test("parseCsv: blank lines and a name-only column are handled; rows without a name are dropped", () => {
  const parsed = parseCsv("College\nDuke University\n\n,Reach\n");
  assert.deepEqual(parsed.map((r) => r.name), ["Duke University"]);
});
