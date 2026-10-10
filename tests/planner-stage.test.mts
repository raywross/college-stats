/**
 * The stage machine (lib/planner/stage.ts; specs/planner/model.md "Stages") over fixture lists: each stage's state
 * and count, and which stage the strip opens. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGES, parseStage, redConflicts, stageCaption, stageCounts, stageOf, type StageInput } from "../lib/planner/stage.ts";

type Item = StageInput["items"][number];
type Task = StageInput["tasks"][number];

let n = 0;
const item = (over: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  category: "target",
  status: "considering",
  outcome: null,
  round: null,
  enrolling: false,
  visited_on: null,
  ...over,
});
const task = (over: Partial<Task> = {}): Task => ({
  item_id: null,
  kind: "own",
  due_on: null,
  window_start: null,
  window_end: null,
  done_at: null,
  dismissed: false,
  snoozed_until: null,
  ...over,
});
const TODAY = "2026-10-08";

test("an empty list: the List stage is current, everything after it not yet", () => {
  const { current, stages } = stageOf({ items: [], tasks: [], today: TODAY });
  assert.equal(current, 1);
  assert.deepEqual(stages[1], { state: "open", count: "No colleges yet" });
  assert.equal(stages[2].state, "not_yet");
  assert.equal(stages[3].state, "open", "Actions is always open");
  assert.equal(stages[4].state, "not_yet");
  assert.equal(stages[5].state, "not_yet");
  assert.equal(stages[6].state, "not_yet");
});

test("List: unsorted colleges to sort, then fewer than three, then done", () => {
  assert.deepEqual(stageCounts({ items: [item({ category: "unsorted" }), item({ category: "unsorted" }), item()], tasks: [], today: TODAY })[1], { state: "open", count: "2 to sort" });
  assert.deepEqual(stageCounts({ items: [item(), item()], tasks: [], today: TODAY })[1], { state: "open", count: "Add 1 more" });
  assert.deepEqual(stageCounts({ items: [item(), item(), item()], tasks: [], today: TODAY })[1], { state: "done", count: "3 colleges" });
});

test("Rounds: colleges without a round to decide; a red conflict comes first; done when every live college has a round", () => {
  const sorted = [item({ round: "ea" }), item(), item()];
  const s = stageOf({ items: sorted, tasks: [], today: TODAY });
  assert.deepEqual(s.stages[2], { state: "open", count: "2 to decide" });
  assert.equal(s.current, 2, "the list is done, so Rounds leads");
  assert.deepEqual(stageCounts({ items: [item({ round: "ed" }), item({ round: "ed" }), item({ round: "rd" })], tasks: [], today: TODAY })[2], { state: "open", count: "1 conflict" });
  assert.deepEqual(stageCounts({ items: [item({ round: "ed" }), item({ round: "rea" }), item({ round: "rd" })], tasks: [], today: TODAY })[2], { state: "open", count: "1 conflict" });
  assert.deepEqual(stageCounts({ items: [item({ round: "ed" }), item({ round: "rd" })], tasks: [], today: TODAY, conflicts: 2 })[2], { state: "open", count: "2 conflicts" }, "U3's count wins when given");
  assert.deepEqual(stageCounts({ items: [item({ round: "ed" }), item({ round: "rd" }), item({ status: "decided", outcome: "denied" })], tasks: [], today: TODAY })[2], { state: "done", count: "Rounds set" });
});

test("redConflicts: two EDs, two ED IIs, ED with REA; EA beside anything is fine", () => {
  assert.equal(redConflicts([{ round: "ed" }, { round: "ea" }, { round: "ea" }]), 0);
  assert.equal(redConflicts([{ round: "ed" }, { round: "ed" }, { round: "ed2" }, { round: "ed2" }, { round: "rea" }]), 3);
});

test("Apply: open with any college applying, counting what's in; done when every college in play is in", () => {
  const items = [item({ round: "ea", status: "applied" }), item({ round: "rd", status: "applying" }), item({ round: "rd", status: "applying" }), item({ round: "rd" })];
  const s = stageOf({ items, tasks: [], today: TODAY });
  assert.deepEqual(s.stages[5], { state: "open", count: "1 of 3 in" });
  assert.equal(s.current, 5);
  assert.deepEqual(stageCounts({ items: [item({ round: "ea", status: "applied" }), item({ round: "rd", status: "decided", outcome: "admitted" })], tasks: [], today: TODAY })[5], {
    state: "done",
    count: "2 of 2 in",
  });
});

test("Offers: open with a decision; done once a college is chosen and its commit steps are ticked", () => {
  const chosen = item({ round: "ea", status: "decided", outcome: "admitted", enrolling: true });
  const other = item({ round: "rd", status: "decided", outcome: "admitted" });
  const third = item({ round: "rd", status: "decided", outcome: "denied" });
  assert.deepEqual(stageCounts({ items: [other, third, item({ round: "rd", status: "applied" })], tasks: [], today: TODAY })[6], { state: "open", count: "1 admit" });
  const open = [task({ item_id: chosen.id, kind: "deposit", due_on: "2027-05-01" })];
  assert.deepEqual(stageCounts({ items: [chosen, other, third], tasks: open, today: TODAY })[6], { state: "open", count: "Finish the commit steps" });
  const done = [task({ item_id: chosen.id, kind: "deposit", due_on: "2027-05-01", done_at: "2027-04-20T12:00:00Z" })];
  const s = stageOf({ items: [chosen, other, third], tasks: done, today: TODAY });
  assert.deepEqual(s.stages[6], { state: "done", count: "Chosen" });
  assert.equal(s.current, 6, "everything done: the last stage");
});

test("Timeline: not yet until the first task's date or window arrives; then overdue first, then this week", () => {
  const items = [item({ round: "rd" }), item({ round: "rd" }), item({ round: "rd" })];
  const later = [task({ due_on: "2026-11-01" })];
  assert.equal(stageCounts({ items, tasks: later, today: TODAY })[4].state, "not_yet");
  const window = [task({ window_start: "2026-10-01", window_end: "2026-11-30" })];
  assert.deepEqual(stageCounts({ items, tasks: window, today: TODAY })[4], { state: "open", count: "1 to do" });
  const s = stageOf({ items, tasks: window, today: TODAY });
  assert.equal(s.current, 4, "List and Rounds done, nothing applying: the timeline leads");
  const mixed = [task({ due_on: "2026-10-01" }), task({ due_on: "2026-10-10" }), task({ due_on: "2026-10-12" })];
  assert.deepEqual(stageCounts({ items, tasks: mixed, today: TODAY })[4], { state: "open", count: "1 overdue" });
  const week = [task({ due_on: "2026-10-01", done_at: "2026-10-01T00:00:00Z" }), task({ due_on: "2026-10-10" }), task({ due_on: "2026-10-12", snoozed_until: "2026-10-20" })];
  assert.deepEqual(stageCounts({ items, tasks: week, today: TODAY })[4], { state: "open", count: "1 this week" }, "done and snoozed tasks don't count");
});

test("Actions leads only when nothing else is open", () => {
  const items = [item({ round: "rd", visited_on: "2026-09-01" }), item({ round: "rd" }), item({ round: "rd" })];
  const s = stageOf({ items, tasks: [], today: TODAY });
  assert.equal(s.current, 3);
  assert.deepEqual(s.stages[3], { state: "open", count: "1 visited" });
});

test("the caption reads as the stage and its count; parseStage takes 1–6 only", () => {
  const s = stageOf({ items: [item({ round: "ea", status: "applied" }), item({ round: "rd", status: "applying" }), item({ round: "rd", status: "applying" })], tasks: [], today: TODAY });
  assert.equal(stageCaption(s.current, s.stages), "Applying · 1 of 3 in");
  assert.equal(STAGES.length, 6);
  assert.equal(parseStage("3"), 3);
  assert.equal(parseStage("7"), null);
  assert.equal(parseStage("x"), null);
  assert.equal(parseStage(undefined), null);
});

/* ------------------------------------------------------------------ */
/* The frame's contract with the stage units (source checks)           */
/* ------------------------------------------------------------------ */

const ROOT = join(import.meta.dirname, "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ROW_FILES = ["list", "rounds", "actions", "apply", "offers"];

test("OffersStage exists and default-exports a component taking { ctx }", () => {
  const code = src(`components/planner/stages/OffersStage.tsx`);
  assert.match(code, /export default (async )?function OffersStage\(\{ ctx \}: \{ ctx: PlanContext \}\)/, `OffersStage's signature`);
});

test("every row control exists as a client component with the shared props; RowControls renders them in stage order", () => {
  for (const file of ROW_FILES) {
    const code = src(`components/planner/row/${file}.tsx`);
    assert.match(code, /^"use client";/);
    assert.match(code, /export default function \w+\(\{[^}]*\}: RowControlProps\)/);
  }
  const rows = src("components/planner/RowControls.tsx");
  const order = [...rows.matchAll(/<(\w+)RowControls \{\.\.\.props\} \/>/g)].map((m) => m[1].toLowerCase());
  assert.deepEqual(order, ROW_FILES);
});

test("the Plan tab sits between List and Numbers on a student's page, and the hub's List tab turns the planner on", () => {
  const header = src("components/account/PersonHeader.tsx");
  assert.ok(header.indexOf('value: "list"') < header.indexOf('value: "plan"') && header.indexOf('value: "plan"') < header.indexOf('value: "numbers"'));
  assert.match(header, /href: `\/household\/\$\{id\}\/plan`/);
  assert.match(src("app/household/[person]/page.tsx"), /<ListPage [^>]*\bplanner\b/);
  assert.match(src("app/household/[person]/plan/page.tsx"), /searchParams: Promise<\{ stage\?: string \| string\[\] \}>/);
});
