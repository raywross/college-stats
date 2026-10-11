/**
 * U8's pure parts and migration text (specs/planner/redesign/calendar.md "Feed, print, share"): the per-viewer feed's
 * migration (RLS on, the owner-only policies, the security-definer function with a pinned search_path, revocation,
 * and execute for signed-out callers on the function only), the feed's titles (the child's name first, titles only,
 * no numbers) through the existing ICS builder, and the print page's month grouping (lib/planner/print.ts). The
 * policies themselves run against Postgres in tests/planner-viewer-feed-policies.test.mts. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { icsCalendar } from "../lib/ics.ts";
import { feedChildName, viewerFeedEvents, viewerTitle, type ViewerFeedRow } from "../lib/planner/viewer-feed.ts";
import { printMonths, printSections } from "../lib/planner/print.ts";
import { schoolYearOf, type CalendarEvent } from "../lib/planner/calendar.ts";

const SQL = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261010130000_plan_viewer_feed.sql"), "utf8");
const code = SQL.replace(/--.*$/gm, "");

/* ------------------------------------------------------------------ */
/* The migration's text                                                */
/* ------------------------------------------------------------------ */

test("migration: the token table stores a hash only, with row-level security and owner-only policies", () => {
  assert.match(code, /create table public\.plan_viewer_calendar_tokens \(/);
  assert.match(code, /user_id\s+uuid not null default auth\.uid\(\) references auth\.users \(id\) on delete cascade/);
  assert.match(code, /token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(code, /revoked_at timestamptz/);
  assert.doesNotMatch(code, /\btoken text\b/, "the clear token is never a column");
  assert.match(code, /alter table public\.plan_viewer_calendar_tokens enable row level security;/);
  const policies = [...code.matchAll(/create policy "[^"]+" on public\.plan_viewer_calendar_tokens for (\w+) to (\w+)\s+([^;]+);/g)];
  assert.deepEqual(policies.map((p) => p[1]).sort(), ["insert", "select", "update"], "read, create, revoke; no delete");
  for (const p of policies) {
    assert.equal(p[2], "authenticated", "signed-in only");
    assert.match(p[3], /user_id = auth\.uid\(\)/, "the owner's own rows");
  }
  assert.match(code, /revoke all on public\.plan_viewer_calendar_tokens from public, anon, authenticated;/);
  assert.match(code, /grant update \(revoked_at\) on public\.plan_viewer_calendar_tokens to authenticated;/, "only revoked_at changes");
});

test("migration: the feed function is security definer with an empty search_path, honors revocation, and is the only thing anon may run", () => {
  const fn = code.slice(code.indexOf("create function public.plan_viewer_feed"), code.indexOf("$$;", code.indexOf("create function public.plan_viewer_feed")));
  assert.match(fn, /security definer\s+set search_path = ''/);
  assert.match(fn, /t\.revoked_at is null/, "a revoked token returns nothing");
  assert.match(fn, /g\.status = 'active'/);
  assert.match(fn, /h\.deleted_at is null/);
  assert.match(fn, /s\.deleted_at is null/);
  assert.doesNotMatch(fn, /auth\.uid\(\)/, "read access is the token owner's, never the caller's");
  assert.doesNotMatch(fn, /\bdetail\b|\bnotes\b/, "titles only: never a detail or a note");
  const anon = [...code.matchAll(/grant [^;]*\bto [^;]*\banon\b[^;]*;/g)].map((m) => m[0]);
  assert.deepEqual(anon, ["grant execute on function public.plan_viewer_feed(text) to anon, authenticated, service_role;"]);
  assert.match(code, /revoke execute on function public\.plan_viewer_feed\(text\) from public;/);
  assert.match(code, /if old\.revoked_at is not null then\s+new\.revoked_at := old\.revoked_at;/, "once revoked, always revoked");
});

/* ------------------------------------------------------------------ */
/* The feed's titles                                                   */
/* ------------------------------------------------------------------ */

const row = (over: Partial<ViewerFeedRow>): ViewerFeedRow => ({
  student_id: "s1",
  student_name: "Maya",
  kind: "task",
  id: "t1",
  item_id: "i1",
  unit_id: "199120",
  round: "ed",
  title: "Apply (ED I)",
  due_on: "2026-11-01",
  window_start: null,
  window_end: null,
  visit_kind: null,
  at_time: null,
  ...over,
});

const NAMES: Record<string, string> = { "199120": "Wake Forest", "166683": "MIT" };
const lookup = (u: string) => NAMES[u] ?? null;

test("titles: the child's first name first, then the college and the task; a shared task without a college", () => {
  assert.equal(viewerTitle("Maya", "Wake Forest", "Apply (ED I)"), "Maya: Wake Forest, apply (ED I)");
  assert.equal(viewerTitle("Maya", null, "Register for the SAT on Nov 7"), "Maya: Register for the SAT on Nov 7", "a date's day stays");
  assert.equal(viewerTitle("Maya", "MIT", "Retake to beat 1450 and pay $75"), "Maya: MIT, retake to beat and pay", "no numbers leave the site");
  assert.equal(feedChildName("Maya Lopez"), "Maya");
  assert.equal(feedChildName(null), "Student");
  assert.equal(feedChildName("  "), "Student");
});

test("the feed's events: every child's, sorted, windows and visits shaped like the per-list feed", () => {
  const events = viewerFeedEvents(
    [
      row({}),
      row({ id: "t2", student_id: "s2", student_name: "Leo Park", unit_id: "166683", title: "Decision expected (EA)", due_on: "2026-12-15" }),
      row({ id: "t3", item_id: null, unit_id: null, title: "Write the personal essay", due_on: null, window_start: "2026-06-01", window_end: "2026-08-31" }),
      row({ id: "v1", kind: "visit", title: null, visit_kind: "campus_tour", due_on: "2026-10-20", at_time: "10:00:00" }),
      row({ id: "t4", unit_id: "999999", title: "Pay the application fee", due_on: "2026-10-30" }),
    ],
    lookup,
  );
  assert.deepEqual(
    events.map((e) => [e.date, e.summary]),
    [
      ["2026-06-01", "Maya: Write the personal essay (until Aug 31)"],
      ["2026-10-20", "Maya: Wake Forest campus tour"],
      ["2026-10-30", "Maya: A college, pay the application fee"],
      ["2026-11-01", "Maya: Wake Forest, apply (ED I)"],
      ["2026-12-15", "Leo: MIT, decision expected (EA)"],
    ],
  );
  assert.equal(events.find((e) => e.uid.startsWith("viewer-visit-"))?.time, "10:00:00");
  assert.ok(events.every((e) => !e.description), "titles only");

  const ics = icsCalendar(events, { name: "Quad family plan", stamp: "2026-10-10T12:00:00Z" });
  assert.match(ics, /SUMMARY:Maya: Wake Forest\\, apply \(ED I\)\r\n/, "through the existing ICS builder, escaped");
  assert.match(ics, /SUMMARY:Leo: MIT\\, decision expected \(EA\)\r\n/);
  assert.doesNotMatch(ics, /DESCRIPTION/);
});

/* ------------------------------------------------------------------ */
/* Print grouping                                                      */
/* ------------------------------------------------------------------ */

const ev = (date: string, studentId: string, text: string, shape: CalendarEvent["shape"] = "bar"): CalendarEvent => ({
  date,
  studentId,
  shape,
  round: shape === "bar" || shape === "decision" ? "ed" : undefined,
  text,
  cite: null,
  daysAway: 0,
});

test("print: the school year by month, August first, empty months left out, outside the year dropped", () => {
  const range = schoolYearOf("2026-10-10");
  const months = printMonths(
    [
      ev("2027-01-01", "a", "MIT RD due"),
      ev("2026-11-01", "b", "Wake Forest ED I due"),
      ev("2026-11-01", "a", "Duke ED I due"),
      ev("2026-08-15", "a", "Common App opens", "money"),
      ev("2027-08-01", "a", "Next year's thing"),
      ev("2026-07-31", "a", "Last year's thing"),
    ],
    range,
  );
  assert.deepEqual(
    months.map((m) => [m.label, m.events.map((e) => e.text)]),
    [
      ["August 2026", ["Common App opens"]],
      ["November 2026", ["Duke ED I due", "Wake Forest ED I due"]],
      ["January 2027", ["MIT RD due"]],
    ],
  );
  assert.deepEqual(printMonths([], range), []);
});

test("print: one child, everyone together, or a page per child", () => {
  const range = schoolYearOf("2026-10-10");
  const kids = [{ studentId: "a" }, { studentId: "b" }];
  const events = [ev("2026-11-01", "a", "Duke ED I due"), ev("2026-11-15", "b", "MIT EA due")];

  const one = printSections(kids, events, range, { kind: "one", studentId: "b" });
  assert.equal(one.length, 1);
  assert.equal(one[0].child?.studentId, "b");
  assert.deepEqual(one[0].months.flatMap((m) => m.events.map((e) => e.text)), ["MIT EA due"]);
  assert.deepEqual(printSections(kids, events, range, { kind: "one", studentId: "nobody" }), [], "not a child of this viewer: nothing");

  const together = printSections(kids, events, range, { kind: "together" });
  assert.equal(together.length, 1);
  assert.equal(together[0].child, null);
  assert.equal(together[0].months[0].events.length, 2);

  const each = printSections(kids, events, range, { kind: "each" });
  assert.deepEqual(each.map((s) => [s.child?.studentId, s.months.flatMap((m) => m.events.map((e) => e.studentId))]), [["a", ["a"]], ["b", ["b"]]]);

  const solo = printSections([kids[0]], events, range, { kind: "each" });
  assert.equal(solo.length, 1);
  assert.equal(solo[0].child?.studentId, "a", "one child is just that child");
});
