/**
 * The next-steps migration (supabase/migrations/20261014120000_next_steps.sql; build-plan.md "Database"): every
 * column it adds, the kind check equal to TaskKind, the source check with 'season', plan_opens with its own-rows RLS,
 * and plan_bundle() selecting the new item and task columns. Reads the SQL; `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEASONS } from "../lib/planner/seasons.ts";

const ROOT = join(import.meta.dirname, "..");
const SQL = readFileSync(join(ROOT, "supabase", "migrations", "20261014120000_next_steps.sql"), "utf8");
/** The SQL without comments, so a column named only in the header doesn't pass. */
const CODE = SQL.replace(/--.*$/gm, "");

function codeKinds(): string[] {
  const src = readFileSync(join(ROOT, "lib", "planner", "types.ts"), "utf8").replace(/\/\/.*$/gm, "");
  const m = src.match(/export type TaskKind =([\s\S]*?);/);
  assert.ok(m);
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]).sort();
}

test("plan_tasks gains season (every Season) and action (a jsonb object)", () => {
  const season = /alter table public\.plan_tasks add column season text check \(season in \(([^)]*)\)\)/.exec(CODE);
  assert.ok(season, "plan_tasks.season");
  assert.deepEqual([...season[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), [...SEASONS]);
  assert.match(CODE, /alter table public\.plan_tasks add column action jsonb check \(action is null or jsonb_typeof\(action\) = 'object'\)/);
});

/** The newest migration that sets plan_tasks_kind_check (essays part 4's 20261030120000_essays_move.sql widened it), comments stripped. */
function latestKindCheck(): string {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sets = files.map((f) => readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "")).filter((sql) => /add constraint plan_tasks_kind_check/.test(sql));
  assert.ok(sets.length > 0);
  return sets[sets.length - 1];
}

test("the kind check lists exactly TaskKind (the newest migration that sets it), and the source check gains 'season'", () => {
  // This migration's own list is every kind of its day; a later one (the essays move) widens it, and the newest wins.
  assert.match(CODE, /add constraint plan_tasks_kind_check check \(kind in \(/);
  const m = /add constraint plan_tasks_kind_check check \(kind in \(([\s\S]*?)\)\)/.exec(latestKindCheck());
  assert.ok(m);
  assert.deepEqual([...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort(), codeKinds());
  for (const k of ["playbook", "ed_decide", "ed2_decide", "visit_ed", "show_interest", "shape_gap", "shape_cost", "confirm_complete", "compare_offers", "decide_by", "outcome_share", "story"]) {
    assert.ok(codeKinds().includes(k), k);
  }
  assert.match(CODE, /drop constraint if exists plan_tasks_source_check/);
  assert.match(CODE, /add constraint plan_tasks_source_check check \(source in \('college', 'cycle', 'stage', 'own', 'season'\)\)/);
});

test("list_items gains ed_dismissed_at and ed_checks; notification_prefs gains season_brief (updatable)", () => {
  assert.match(CODE, /alter table public\.list_items add column ed_dismissed_at timestamptz;/);
  assert.match(CODE, /alter table public\.list_items add column ed_checks jsonb not null default '\{\}' check \(jsonb_typeof\(ed_checks\) = 'object'\);/);
  assert.match(CODE, /alter table public\.notification_prefs add column season_brief boolean;/);
  assert.match(CODE, /grant update \(season_brief\) on public\.notification_prefs to authenticated;/);
});

test("plan_opens: keyed by viewer and student, own rows only, service_role all", () => {
  assert.match(CODE, /create table public\.plan_opens \(/);
  assert.match(CODE, /primary key \(user_id, student_id\)/);
  assert.match(CODE, /alter table public\.plan_opens enable row level security;/);
  for (const verb of ["select", "insert", "update", "delete"]) {
    assert.match(CODE, new RegExp(`on public\\.plan_opens for ${verb} to authenticated[\\s\\S]*?user_id = auth\\.uid\\(\\)`), verb);
  }
  assert.match(CODE, /grant select, insert, update, delete on public\.plan_opens to authenticated;/);
  assert.match(CODE, /grant all on public\.plan_opens to service_role;/);
});

test("plan_bundle is recreated in place with the new item and task columns", () => {
  assert.match(CODE, /create or replace function public\.plan_bundle\(p_student uuid default null, p_list uuid default null\) returns jsonb/);
  assert.match(CODE, /legacy_sibling,\s+ed_dismissed_at, ed_checks\s+from public\.list_items/);
  assert.match(CODE, /created_by, created_at, season, action\s+from public\.plan_tasks/);
  assert.match(CODE, /security invoker/);
});
