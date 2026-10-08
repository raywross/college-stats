/**
 * Task generation and the idempotent merge (lib/planner/tasks.ts; specs/planner/model.md "Tasks are generated with
 * keys"), the views (next task, This week, by month, by college), and the calendar file (lib/ics.ts). Pure.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMerge,
  assigneeLabel,
  dateNoteLabel,
  dayLabel,
  generateTasks,
  groupByCollege,
  groupByMonth,
  mergeTasks,
  nextTask,
  nextTaskByItem,
  taskDateLabel,
  taskKey,
  thisWeek,
} from "../lib/planner/tasks.ts";
import { GENERATORS } from "../lib/planner/generators/index.ts";
import { icsCalendar, icsEscape, icsFold } from "../lib/ics.ts";
import type { GeneratedTask, GeneratorInput, PlanTask } from "../lib/planner/types.ts";

const LIST = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-10-08T12:00:00Z";
const TODAY = "2026-10-08";

const gen = (over: Partial<GeneratedTask> & { key: string }): GeneratedTask => ({
  item_id: ITEM,
  kind: "apply",
  title: "Stanford: apply (REA)",
  detail: null,
  due_on: "2026-11-01",
  window_start: null,
  window_end: null,
  assignee: "student",
  source: "college",
  source_field: "reported.admission_profile.early_action.closing",
  source_edition: "2025-26",
  date_note: null,
  position: 0,
  ...over,
});

const stored = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: `t${Math.random().toString(36).slice(2)}`,
  list_id: LIST,
  item_id: null,
  key: null,
  kind: "own",
  title: "A task",
  detail: null,
  due_on: null,
  window_start: null,
  window_end: null,
  assignee: "student",
  source: "own",
  source_field: null,
  source_edition: null,
  date_note: null,
  done_at: null,
  done_by: null,
  snoozed_until: null,
  dismissed: false,
  orphaned: false,
  position: 0,
  created_by: null,
  created_at: NOW,
  ...over,
});

const APPLY = taskKey(ITEM, "apply", "rea");
const FAFSA = taskKey(LIST, "cycle", "fafsa_opens");

test("taskKey: scope, kind, and suffix, '-' when there's none", () => {
  assert.equal(taskKey(ITEM, "apply", "ed"), `${ITEM}:apply:ed`);
  assert.equal(taskKey(LIST, "decide_rounds"), `${LIST}:decide_rounds:-`);
  assert.equal(taskKey(ITEM, "supplement", 2), `${ITEM}:supplement:2`);
});

test("mergeTasks: new keys insert; running it twice changes nothing the second time", () => {
  const generated = [gen({ key: APPLY }), gen({ key: FAFSA, item_id: null, kind: "cycle", source: "cycle", title: "FAFSA opens", due_on: "2026-10-01", source_field: null, source_edition: null, assignee: "guardian" })];
  const first = mergeTasks([], generated);
  assert.equal(first.upserts.length, 2);
  assert.deepEqual(first.orphans, []);
  const after = applyMerge(LIST, [], first, NOW);
  const second = mergeTasks(after, generated);
  assert.deepEqual(second, { upserts: [], orphans: [] }, "idempotent");
  assert.deepEqual(applyMerge(LIST, after, second, NOW), after);
});

test("mergeTasks: a moved date updates the task and keeps its tick, snooze, dismissal, and position", () => {
  const generated = [gen({ key: APPLY })];
  let tasks = applyMerge(LIST, [], mergeTasks([], generated), NOW);
  tasks = tasks.map((t) => ({ ...t, done_at: "2026-10-05T10:00:00Z", done_by: "u1", snoozed_until: "2026-10-20", position: 7 }));
  const moved = [gen({ key: APPLY, due_on: "2026-11-15", source_edition: "2026-27" })];
  const merge = mergeTasks(tasks, moved);
  assert.equal(merge.upserts.length, 1);
  assert.equal(merge.upserts[0].position, 7, "the stored position is kept");
  assert.equal("done_at" in merge.upserts[0], false, "an upsert never carries the tick");
  const next = applyMerge(LIST, tasks, merge, NOW);
  assert.equal(next.length, 1);
  assert.equal(next[0].due_on, "2026-11-15");
  assert.equal(next[0].source_edition, "2026-27");
  assert.equal(next[0].done_at, "2026-10-05T10:00:00Z");
  assert.equal(next[0].done_by, "u1");
  assert.equal(next[0].snoozed_until, "2026-10-20");
  assert.equal(next[0].id, tasks[0].id, "same row, not a new one");
});

test("mergeTasks: a generated key that disappears is orphaned (never deleted); own tasks are untouched; it comes back if regenerated", () => {
  const own = stored({ title: "Call Grandma about the visit" });
  const ed2 = gen({ key: taskKey(ITEM, "apply", "ed2"), title: "Tufts: apply (ED II)" });
  let tasks = applyMerge(LIST, [own], mergeTasks([own], [gen({ key: APPLY }), ed2]), NOW);
  const drop = mergeTasks(tasks, [gen({ key: APPLY })]);
  const orphan = tasks.find((t) => t.key === ed2.key)!;
  assert.deepEqual(drop, { upserts: [], orphans: [orphan.id] });
  tasks = applyMerge(LIST, tasks, drop, NOW);
  assert.equal(tasks.length, 3, "nothing is deleted");
  assert.equal(tasks.find((t) => t.key === ed2.key)!.orphaned, true);
  assert.deepEqual(mergeTasks(tasks, [gen({ key: APPLY })]), { upserts: [], orphans: [] }, "an orphan is marked once");
  const back = mergeTasks(tasks, [gen({ key: APPLY }), ed2]);
  assert.equal(back.upserts.length, 1);
  assert.equal(applyMerge(LIST, tasks, back, NOW).find((t) => t.key === ed2.key)!.orphaned, false);
  assert.equal(tasks.find((t) => t.id === own.id)!.orphaned, false, "own tasks are never orphaned");
});

const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({
  list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: NOW, sort: null, rounds_plan_accepted_at: null },
  items: [],
  schools: {},
  profile: null,
  cycle: { cycle: "2026-27", startYear: 2026, entries: [] },
  grade: "senior_fall",
  today: TODAY,
  visits: [],
  offers: [],
  ...over,
});

test("generateTasks: generator order, the first key wins, own tasks are never generated, and a guardian's list gets no cycle tasks", () => {
  const a = { name: "a", generate: () => [gen({ key: APPLY, title: "first" }), gen({ key: FAFSA, item_id: null, source: "cycle", kind: "cycle", title: "FAFSA" })] };
  const b = { name: "b", generate: () => [gen({ key: APPLY, title: "second" }), gen({ key: "x", source: "own", kind: "own" })] };
  const student = generateTasks(input(), [a, b]);
  assert.deepEqual(
    student.map((t) => t.title),
    ["first", "FAFSA"],
  );
  const guardianList = input({ list: { ...input().list, student_id: null, user_id: "u1" } });
  assert.deepEqual(
    generateTasks(guardianList, [a, b]).map((t) => t.title),
    ["first"],
  );
});

test("the generator registry lists the six modules in order, and each returns an array (stubs until their units fill them)", () => {
  assert.deepEqual(
    GENERATORS.map((g) => g.name),
    ["cycle", "college", "rounds", "actions", "apply", "offers"],
  );
  for (const g of GENERATORS) assert.ok(Array.isArray(g.generate(input())), `${g.name} returns an array`);
});

test("views: next task per college, This week (overdue first, at most eight), by month, by college", () => {
  const other = "33333333-3333-4333-8333-333333333333";
  const tasks = [
    stored({ id: "a", item_id: ITEM, due_on: "2026-11-01", title: "Apply" }),
    stored({ id: "b", item_id: ITEM, due_on: "2026-10-01", title: "Overdue thing" }),
    stored({ id: "c", item_id: ITEM, due_on: "2026-10-09", title: "Done", done_at: NOW }),
    stored({ id: "d", item_id: other, window_start: "2026-10-01", window_end: "2026-10-12", title: "Window" }),
    stored({ id: "e", item_id: null, due_on: "2026-10-10", title: "FAFSA", snoozed_until: "2026-10-12" }),
    stored({ id: "f", item_id: null, title: "Undated" }),
    stored({ id: "g", item_id: ITEM, due_on: "2026-10-11", title: "Dismissed", dismissed: true }),
  ];
  assert.equal(nextTask(tasks, TODAY, ITEM)!.id, "b", "an overdue task is the next one");
  assert.equal(nextTask(tasks, TODAY)!.id, "b");
  assert.deepEqual(
    Object.fromEntries(Object.entries(nextTaskByItem([{ id: ITEM }, { id: other }, { id: "none" }], tasks, TODAY)).map(([k, v]) => [k, v?.id ?? null])),
    { [ITEM]: "b", [other]: "d", none: null },
  );
  const week = thisWeek(tasks, TODAY);
  assert.deepEqual(
    week.tasks.map((t) => t.id),
    ["b", "d"],
    "overdue first; done, snoozed, dismissed, and later tasks left out",
  );
  assert.equal(week.more, 0);
  const many = Array.from({ length: 11 }, (_, i) => stored({ id: `m${i}`, due_on: "2026-10-09" }));
  assert.deepEqual([thisWeek(many, TODAY).tasks.length, thisWeek(many, TODAY).more], [8, 3]);
  assert.deepEqual(
    groupByMonth(tasks, TODAY).map((g) => [g.key, g.tasks.map((t) => t.id)]),
    [
      ["overdue", ["b"]],
      ["2026-10", ["c", "e", "g", "d"]],
      ["2026-11", ["a"]],
      ["undated", ["f"]],
    ],
  );
  const byCollege = groupByCollege(tasks, [
    { id: other, position: 0 },
    { id: ITEM, position: 1 },
  ]);
  assert.deepEqual(
    byCollege.shared.map((t) => t.id),
    ["e", "f"],
  );
  assert.deepEqual(
    byCollege.byItem.map((g) => g.itemId),
    [other, ITEM],
  );
});

test("labels: dates, windows, whose step, and the date's note", () => {
  assert.equal(dayLabel("2026-11-01", TODAY), "Nov 1");
  assert.equal(dayLabel("2027-01-05", TODAY), "Jan 5, 2027");
  assert.equal(taskDateLabel({ due_on: null, window_start: "2026-10-01", window_end: "2026-11-15" }, TODAY), "Oct 1 – Nov 15");
  assert.equal(taskDateLabel({ due_on: null, window_start: null, window_end: null }, TODAY), null);
  assert.equal(assigneeLabel("student", { isGuardian: false }, "Alex"), "You");
  assert.equal(assigneeLabel("student", { isGuardian: true }, "Alex"), "Alex");
  assert.equal(assigneeLabel("guardian", { isGuardian: false }, "Alex"), "Parent");
  assert.equal(assigneeLabel("either", { isGuardian: true }, null), "Either");
  assert.equal(dateNoteLabel({ date_note: "own", source_edition: null }), "Your date");
  assert.match(dateNoteLabel({ date_note: "last_cycle", source_edition: "2025-26" })!, /2025-26 edition: confirm/);
  assert.equal(dateNoteLabel({ date_note: null, source_edition: "2025-26" }), null);
});

/* ------------------------------------------------------------------ */
/* lib/ics.ts                                                          */
/* ------------------------------------------------------------------ */

test("ics: an all-day event, a timed one, escaping, folding, CRLF", () => {
  const text = icsCalendar(
    [
      { uid: "task-1@quad", date: "2026-11-01", summary: "Michigan: apply (ED I)" },
      { uid: "visit-1@quad", date: "2026-10-20", time: "14:30", minutes: 90, summary: "Tufts, campus tour; info session", location: "Medford, MA" },
      { uid: "win-1@quad", date: "2026-10-01", endDate: "2026-10-31", summary: "Ask two teachers" },
    ],
    { name: "Alex's plan", stamp: NOW },
  );
  assert.ok(text.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "every line ends in CRLF");
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(text, /DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102/);
  assert.match(text, /DTSTART:20261020T143000\r\nDTEND:20261020T160000/);
  assert.match(text, /DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261101/, "a window ends the day after its last day");
  assert.match(text, /SUMMARY:Tufts\\, campus tour\\; info session/);
  assert.match(text, /DTSTAMP:20261008T120000Z/);
  assert.equal((text.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.equal(icsEscape("a\\b\nc"), "a\\\\b\\nc");
  const long = `SUMMARY:${"é".repeat(60)}`;
  const folded = icsFold(long);
  for (const line of folded.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, "each folded line fits in 75 octets");
  assert.equal(folded.split("\r\n").map((l, i) => (i === 0 ? l : l.slice(1))).join(""), long, "unfolding gives the line back");
});
