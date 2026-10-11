/**
 * Every task kind the planner generates (lib/planner/types.ts TaskKind) is one the database accepts: the latest
 * migration that sets `plan_tasks_kind_check` lists exactly the same kinds. A kind added in code without a migration
 * makes every write of that task fail (cost_check, test_register, test_day did until 20261011150000). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function codeKinds(): string[] {
  // Comments go first: one of them holds a semicolon that would end the union early.
  const src = readFileSync(join(ROOT, "lib", "planner", "types.ts"), "utf8").replace(/\/\/.*$/gm, "");
  const m = src.match(/export type TaskKind =([\s\S]*?);/);
  assert.ok(m, "TaskKind union not found in lib/planner/types.ts");
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]).sort();
}

function databaseKinds(): { file: string; kinds: string[] } {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let found: { file: string; kinds: string[] } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    // The original inline check in the plan_tasks table, or a later named constraint that replaces it.
    const m =
      sql.match(/add constraint plan_tasks_kind_check check \(kind in \(([\s\S]*?)\)\)/) ??
      (/create table (if not exists )?public\.plan_tasks\b/.test(sql) ? sql.match(/create table (?:if not exists )?public\.plan_tasks\b[\s\S]*?kind\s+text not null check \(kind in \(([\s\S]*?)\)\)/) : null);
    if (m) found = { file: f, kinds: [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort() };
  }
  assert.ok(found, "no migration defines the plan_tasks kind check");
  return found;
}

test("the database accepts every task kind the planner generates", () => {
  const { file, kinds } = databaseKinds();
  assert.deepEqual(kinds, codeKinds(), `plan_tasks_kind_check in ${file} must list exactly TaskKind's kinds; add a migration`);
});
