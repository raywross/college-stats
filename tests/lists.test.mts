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
  { name: "Stanford University", category: "reach", round: "rea", status: "applied", outcome: null, deadline: "2026-01-05", enrolling: false, notes: "Loved the tour" },
  { name: "A College, Inc.", category: "likely", round: "rd", status: "decided", outcome: "admitted", deadline: null, enrolling: true, notes: 'Said "yes"' },
];

test("toCsv / parseCsv round-trip the Scoir-compatible columns", () => {
  const csv = toCsv(ROWS);
  assert.ok(csv.startsWith("College,Category,Round,Status,Outcome,Deadline,Enrolling,Notes"));
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { name: "Stanford University", category: "reach", round: "rea", status: "applied", outcome: null, deadline: "2026-01-05", enrolling: false, notes: "Loved the tour" });
  assert.deepEqual(parsed[1], { name: "A College, Inc.", category: "likely", round: "rd", status: "decided", outcome: "admitted", deadline: null, enrolling: true, notes: 'Said "yes"' });
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
