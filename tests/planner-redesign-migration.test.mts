/**
 * The planner redesign's migration (supabase/migrations/20261010120000_plan_redesign.sql; specs/planner/redesign/
 * build-plan.md "Database"): both source columns with their checks and defaults, and the backfill that keeps every
 * choice the student already made. Reads the SQL text; `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20261010120000_plan_redesign.sql", import.meta.url), "utf8");
/** The SQL without comments and with whitespace collapsed, so a check reads statements only. */
const body = sql
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .toLowerCase();

for (const col of ["category_source", "round_source"]) {
  test(`${col}: text, not null, default 'auto', checked to auto | student`, () => {
    const re = new RegExp(`alter table public\\.list_items add column ${col} text not null default 'auto' check \\(${col} in \\('auto','student'\\)\\);`);
    assert.match(body, re);
  });
}

test("backfill: a chosen category and a stored round become the student's", () => {
  assert.match(body, /update public\.list_items set category_source = 'student' where category <> 'unsorted';/);
  assert.match(body, /update public\.list_items set round_source = 'student' where round is not null;/);
});

test("the backfill runs after both columns exist", () => {
  const lastAlter = body.lastIndexOf("alter table");
  const firstUpdate = body.indexOf("update public.list_items");
  assert.ok(lastAlter >= 0 && firstUpdate > lastAlter);
});

test("no policy, grant, or drop in this migration (row policies already cover every column)", () => {
  assert.doesNotMatch(body, /\b(create|alter|drop) policy\b/);
  assert.doesNotMatch(body, /\bgrant\b|\bdrop\b/);
});
