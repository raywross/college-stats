/**
 * readPlan against a fake Supabase client (lib/planner/read-plan.ts; build-plan.md review note 2): with the redesign's
 * columns it reads them as stored; without them (the migration not applied yet) it retries without them and treats
 * every row as the student's, so nothing is overwritten; a missing planner table still says "not set up"; any other
 * error is not retried. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingEdColumn,
  isMissingMoveColumn,
  isMissingSkipColumn,
  PLAN_TASK_MOVE_COLUMNS,
  PLAN_TASK_SKIP_COLUMNS,
  skipPatch,
  updateTaskSkip,
  PLAN_ITEM_BASE_COLUMNS,
  PLAN_ITEM_COLUMNS,
  PLAN_TASK_BASE_COLUMNS,
  PLAN_TASK_COLUMNS,
  PlannerSetupError,
  readPlan,
  readTaskRows,
  upsertTaskRows,
} from "../lib/planner/read-plan.ts";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Handler = (q: { table: string; columns: string }) => Result;

/** A chainable stand-in for the Supabase query builder: records each select and answers through `handler`. */
function fakeClient(handler: Handler) {
  const selects: { table: string; columns: string }[] = [];
  const client = {
    from(table: string) {
      const q = { table, columns: "" };
      const builder = {
        select(columns: string) {
          q.columns = columns;
          selects.push({ ...q });
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        maybeSingle: () => {
          const r = handler(q);
          return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
        },
        then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(handler(q)).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, selects };
}

const LIST = { id: "list-1", student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-10-01", sort: null, rounds_plan_accepted_at: null };
const ROW = { id: "item-1", list_id: "list-1", unit_id: "100", category: "reach", round: "ea", status: "considering", position: 1 };
const MISSING_COLUMN = { code: "42703", message: "column list_items.category_source does not exist" };

function tables(items: Handler): Handler {
  return (q) => {
    if (q.table === "lists") return { data: LIST, error: null };
    if (q.table === "list_items") return items(q);
    return { data: [], error: null };
  };
}

test("with the redesign's columns: one read, sources as stored", async () => {
  const { client, selects } = fakeClient(tables(() => ({ data: [{ ...ROW, category_source: "auto", round_source: "student" }], error: null })));
  const plan = await readPlan(client, "list-1");
  assert.equal(plan?.items[0].category_source, "auto");
  assert.equal(plan?.items[0].round_source, "student");
  const itemReads = selects.filter((s) => s.table === "list_items");
  assert.equal(itemReads.length, 1);
  assert.equal(itemReads[0].columns, PLAN_ITEM_COLUMNS);
  assert.match(PLAN_ITEM_COLUMNS, /category_source, round_source, legacy, recruited, legacy_sibling, ed_dismissed_at, ed_checks$/);
});

test("without the five-levels columns only (legacy/recruited): retried without them, backfilled to false/'none', sources kept as stored", async () => {
  const MISSING_HOOKS = { code: "42703", message: "column list_items.legacy does not exist" };
  const { client, selects } = fakeClient(
    tables((q) => (q.columns.includes("legacy") ? { data: null, error: MISSING_HOOKS } : { data: [{ ...ROW, category_source: "student", round_source: "auto" }], error: null })),
  );
  const plan = await readPlan(client, "list-1");
  assert.ok(plan);
  assert.equal(plan.sourcesMissing, undefined, "the redesign's own source columns were there, so nothing is flagged missing");
  assert.equal(plan.items[0].legacy, false);
  assert.equal(plan.items[0].recruited, "none");
  assert.equal(plan.items[0].category_source, "student");
  const itemReads = selects.filter((s) => s.table === "list_items").map((s) => s.columns);
  assert.deepEqual(itemReads, [PLAN_ITEM_COLUMNS, `${PLAN_ITEM_BASE_COLUMNS}, category_source, round_source`]);
});

test("without them: retried without the two columns, sources as the migration's backfill sets them, and flagged so nothing is written", async () => {
  const UNSORTED = { ...ROW, id: "item-2", category: "unsorted", round: null };
  const { client, selects } = fakeClient(
    tables((q) => (q.columns.includes("category_source") ? { data: null, error: MISSING_COLUMN } : { data: [ROW, UNSORTED], error: null })),
  );
  const plan = await readPlan(client, "list-1");
  assert.ok(plan);
  assert.equal(plan.sourcesMissing, true);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].category, "reach");
  assert.equal(plan.items[0].category_source, "student");
  assert.equal(plan.items[0].round_source, "student");
  assert.equal(plan.items[1].category_source, "auto");
  assert.equal(plan.items[1].round_source, "auto");
  const itemReads = selects.filter((s) => s.table === "list_items").map((s) => s.columns);
  assert.deepEqual(itemReads, [PLAN_ITEM_COLUMNS, PLAN_ITEM_BASE_COLUMNS]);
  assert.doesNotMatch(PLAN_ITEM_BASE_COLUMNS, /category_source|round_source/);
});

test("PostgREST's schema-cache wording for the missing column is retried too", async () => {
  const { client } = fakeClient(
    tables((q) =>
      q.columns.includes("round_source")
        ? { data: null, error: { code: "PGRST204", message: "Could not find the 'round_source' column of 'list_items' in the schema cache" } }
        : { data: [ROW], error: null },
    ),
  );
  const plan = await readPlan(client, "list-1");
  assert.equal(plan?.items[0].round_source, "student");
});

test("a missing planner table is still a setup error (not retried as a column)", async () => {
  const { client } = fakeClient((q) => {
    if (q.table === "lists") return { data: LIST, error: null };
    if (q.table === "list_items") return { data: [], error: null };
    if (q.table === "plan_tasks") return { data: null, error: { code: "42P01", message: 'relation "public.plan_tasks" does not exist' } };
    return { data: [], error: null };
  });
  await assert.rejects(readPlan(client, "list-1"), PlannerSetupError);
});

test("any other error on the items is thrown, not retried", async () => {
  const { client, selects } = fakeClient(tables(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })));
  await assert.rejects(readPlan(client, "list-1"), (err: Error) => !(err instanceof PlannerSetupError) && /Reading the plan failed/.test(err.message));
  assert.equal(selects.filter((s) => s.table === "list_items").length, 1);
});

test("a list the reader can't see is null", async () => {
  const { client } = fakeClient(() => ({ data: null, error: null }));
  assert.equal(await readPlan(client, "list-1"), null);
});

/* ------------------------------------------------------------------ */
/* Next steps (20261014120000_next_steps.sql; build-plan.md note 5)    */
/* ------------------------------------------------------------------ */

const MISSING_ED = { code: "42703", message: "column list_items.ed_dismissed_at does not exist" };
const MISSING_MOVE = { code: "42703", message: "column plan_tasks.season does not exist" };
const TASK = { id: "t1", list_id: "list-1", key: "list-1:playbook:long_list", kind: "playbook", title: "Start a long list", source: "season" };

test("next steps' columns present: items keep ed_dismissed_at/ed_checks, tasks keep season/action, one read each", async () => {
  const action = { kind: "open_tab", tab: "colleges" };
  const { client, selects } = fakeClient((q) => {
    if (q.table === "lists") return { data: LIST, error: null };
    if (q.table === "list_items") return { data: [{ ...ROW, ed_dismissed_at: "2027-04-01T00:00:00Z", ed_checks: { cost: true } }], error: null };
    if (q.table === "plan_tasks") return { data: [{ ...TASK, season: "junior_spring", action }], error: null };
    return { data: [], error: null };
  });
  const plan = await readPlan(client, "list-1");
  assert.equal(plan?.items[0].ed_dismissed_at, "2027-04-01T00:00:00Z");
  assert.deepEqual(plan?.items[0].ed_checks, { cost: true });
  assert.equal(plan?.tasks[0].season, "junior_spring");
  assert.deepEqual(plan?.tasks[0].action, action);
  assert.deepEqual(selects.filter((s) => s.table === "plan_tasks").map((s) => s.columns), [PLAN_TASK_COLUMNS]);
  assert.match(PLAN_TASK_COLUMNS, /, season, action, dismissed_at, dismissed_by$/);
});

test("without the ED columns: items retried without them only, read as null and {}", async () => {
  const { client, selects } = fakeClient(
    tables((q) =>
      q.columns.includes("ed_dismissed_at")
        ? { data: null, error: MISSING_ED }
        : { data: [{ ...ROW, category_source: "auto", round_source: "auto", legacy: true, recruited: "none", legacy_sibling: true }], error: null },
    ),
  );
  const plan = await readPlan(client, "list-1");
  assert.ok(plan);
  assert.equal(plan.sourcesMissing, undefined);
  assert.equal(plan.items[0].ed_dismissed_at, null);
  assert.deepEqual(plan.items[0].ed_checks, {});
  assert.equal(plan.items[0].legacy_sibling, true, "the older columns are still read");
  const reads = selects.filter((s) => s.table === "list_items").map((s) => s.columns);
  assert.equal(reads.length, 2);
  assert.ok(!reads[1].includes("ed_checks") && reads[1].includes("legacy_sibling"));
});

test("without the move columns: tasks retried without season/action, read as null", async () => {
  const { client, selects } = fakeClient((q) => {
    if (q.table === "lists") return { data: LIST, error: null };
    if (q.table === "list_items") return { data: [], error: null };
    if (q.table === "plan_tasks") return q.columns.includes("season") ? { data: null, error: MISSING_MOVE } : { data: [TASK], error: null };
    return { data: [], error: null };
  });
  const plan = await readPlan(client, "list-1");
  assert.equal(plan?.tasks[0].season, null);
  assert.equal(plan?.tasks[0].action, null);
  assert.deepEqual(selects.filter((s) => s.table === "plan_tasks").map((s) => s.columns), [PLAN_TASK_COLUMNS, PLAN_TASK_BASE_COLUMNS]);
  const direct = await readTaskRows(client, "list-1");
  assert.equal(direct.data?.[0].season, null);
});

test("guard: another task error is not retried as a missing column", async () => {
  const { client, selects } = fakeClient((q) => (q.table === "plan_tasks" ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: [], error: null }));
  const r = await readTaskRows(client, "list-1");
  assert.ok(r.error);
  assert.equal(selects.length, 1);
  assert.equal(isMissingMoveColumn({ code: "42703", message: "column plan_tasks.season does not exist" }), true);
  assert.equal(isMissingMoveColumn({ code: "42703", message: "column list_items.category_source does not exist" }), false);
  assert.equal(isMissingEdColumn({ code: "PGRST204", message: "Could not find the 'ed_checks' column of 'list_items' in the schema cache" }), true);
});

/** A stand-in for `.from("plan_tasks").upsert(rows)`: records each call's rows and answers through `answer`. */
function fakeUpsert(answer: (rows: Record<string, unknown>[]) => { code?: string; message?: string } | null) {
  const calls: Record<string, unknown>[][] = [];
  const client = {
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => {
        calls.push(rows);
        return Promise.resolve({ data: null, error: answer(rows) });
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test("upsertTaskRows: retried without season/action on a missing-column error naming them; other errors are not retried", async () => {
  const rows = [{ list_id: "list-1", key: "k", kind: "playbook", season: "junior_fall", action: { kind: "tick" } }];
  const missing = fakeUpsert((r) => ("season" in r[0] ? { code: "PGRST204", message: "Could not find the 'action' column of 'plan_tasks' in the schema cache" } : null));
  assert.equal(await upsertTaskRows(missing.client, rows), null);
  assert.equal(missing.calls.length, 2);
  assert.ok(!("season" in missing.calls[1][0]) && !("action" in missing.calls[1][0]));
  assert.equal(missing.calls[1][0].kind, "playbook");
  assert.equal("season" in rows[0], true, "the caller's rows are left alone");

  const ok = fakeUpsert(() => null);
  assert.equal(await upsertTaskRows(ok.client, rows), null);
  assert.equal(ok.calls.length, 1);

  const other = fakeUpsert(() => ({ code: "23514", message: 'new row violates check constraint "plan_tasks_kind_check"' }));
  assert.match((await upsertTaskRows(other.client, rows))?.message ?? "", /kind_check/);
  assert.equal(other.calls.length, 1);
});

/* ------------------------------------------------------------------ */
/* Plan v3: the skip record (dismissed_at, dismissed_by)                */
/* ------------------------------------------------------------------ */

const MISSING_SKIP = { code: "42703", message: "column plan_tasks.dismissed_at does not exist" };

test("plan v3's skip columns: read when present; PLAN_TASK_COLUMNS lists them", async () => {
  assert.deepEqual([...PLAN_TASK_SKIP_COLUMNS], ["dismissed_at", "dismissed_by"]);
  assert.ok(PLAN_TASK_COLUMNS.endsWith(PLAN_TASK_SKIP_COLUMNS.join(", ")));
  const { client, selects } = fakeClient((q) =>
    q.table === "plan_tasks" ? { data: [{ ...TASK, season: "junior_fall", action: null, dismissed: true, dismissed_at: "2026-10-12T15:00:00Z", dismissed_by: "u1" }], error: null } : { data: [], error: null },
  );
  const r = await readTaskRows(client, "list-1");
  assert.equal(r.data?.[0].dismissed_at, "2026-10-12T15:00:00Z");
  assert.equal(r.data?.[0].dismissed_by, "u1");
  assert.equal(selects.length, 1);
});

test("without the skip columns: tasks retried without them only (season/action still read), read as null", async () => {
  const { client, selects } = fakeClient((q) => {
    if (q.table !== "plan_tasks") return { data: [], error: null };
    return q.columns.includes("dismissed_at") ? { data: null, error: MISSING_SKIP } : { data: [{ ...TASK, season: "junior_fall", action: null, dismissed: true }], error: null };
  });
  const r = await readTaskRows(client, "list-1");
  assert.equal(r.error, null);
  assert.equal(r.data?.[0].dismissed_at, null);
  assert.equal(r.data?.[0].dismissed_by, null);
  assert.equal(r.data?.[0].season, "junior_fall", "the move columns are still read");
  assert.deepEqual(selects.map((s) => s.columns), [PLAN_TASK_COLUMNS, `${PLAN_TASK_BASE_COLUMNS}, ${PLAN_TASK_MOVE_COLUMNS}`]);
});

test("without the skip and the move columns: three reads, down to the base columns", async () => {
  const { client, selects } = fakeClient((q) => {
    if (q.table !== "plan_tasks") return { data: [], error: null };
    if (q.columns.includes("dismissed_at")) return { data: null, error: MISSING_SKIP };
    if (q.columns.includes("season")) return { data: null, error: MISSING_MOVE };
    return { data: [TASK], error: null };
  });
  const r = await readTaskRows(client, "list-1");
  assert.equal(r.data?.[0].season, null);
  assert.equal(r.data?.[0].dismissed_at, null);
  assert.deepEqual(selects.map((s) => s.columns), [PLAN_TASK_COLUMNS, `${PLAN_TASK_BASE_COLUMNS}, ${PLAN_TASK_MOVE_COLUMNS}`, PLAN_TASK_BASE_COLUMNS]);
});

test("isMissingSkipColumn names only the skip columns", () => {
  assert.equal(isMissingSkipColumn(MISSING_SKIP), true);
  assert.equal(isMissingSkipColumn({ code: "PGRST204", message: "Could not find the 'dismissed_by' column of 'plan_tasks' in the schema cache" }), true);
  assert.equal(isMissingSkipColumn(MISSING_MOVE), false);
  assert.equal(isMissingSkipColumn({ code: "23514", message: "dismissed_at check" }), false, "not a missing-column error");
  assert.equal(isMissingMoveColumn(MISSING_SKIP), false, "a skip-column error isn't read as the move columns");
});

/** A stand-in for `.from("plan_tasks").update(patch).eq("id", …).select("id")`. */
function fakeUpdate(answer: (patch: Record<string, unknown>) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const patches: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        patches.push(patch);
        const chain = { eq: () => chain, select: () => Promise.resolve(answer(patch)) };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, patches };
}

test("skipPatch: a skip stamps when and who; bringing back clears all three", () => {
  assert.deepEqual(skipPatch(true, "u1", "2026-10-12T15:00:00Z"), { dismissed: true, dismissed_at: "2026-10-12T15:00:00Z", dismissed_by: "u1" });
  assert.deepEqual(skipPatch(false, "u1", "2026-10-12T15:00:00Z"), { dismissed: false, dismissed_at: null, dismissed_by: null });
});

test("updateTaskSkip: writes the stamped patch; retried with { dismissed } alone when the skip columns are missing; other errors not retried", async () => {
  const ok = fakeUpdate(() => ({ data: [{ id: "t1" }], error: null }));
  const r = await updateTaskSkip(ok.client, "t1", true, "u1", "2026-10-12T15:00:00Z");
  assert.deepEqual(r, { data: [{ id: "t1" }], error: null });
  assert.deepEqual(ok.patches, [{ dismissed: true, dismissed_at: "2026-10-12T15:00:00Z", dismissed_by: "u1" }]);

  const back = fakeUpdate(() => ({ data: [{ id: "t1" }], error: null }));
  await updateTaskSkip(back.client, "t1", false, "u1");
  assert.deepEqual(back.patches, [{ dismissed: false, dismissed_at: null, dismissed_by: null }]);

  const missing = fakeUpdate((p) => ("dismissed_at" in p ? { data: null, error: MISSING_SKIP } : { data: [{ id: "t1" }], error: null }));
  const m = await updateTaskSkip(missing.client, "t1", true, "u1");
  assert.equal(m.error, null);
  assert.deepEqual(missing.patches.at(-1), { dismissed: true }, "the flag alone, before the migration");
  assert.equal(missing.patches.length, 2);

  const other = fakeUpdate(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
  const o = await updateTaskSkip(other.client, "t1", true, "u1");
  assert.match(o.error?.message ?? "", /permission/);
  assert.equal(other.patches.length, 1);
});

test("store.ts: dismiss writes through updateTaskSkip with the user id; undismiss is exported and clears it", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/planner/store.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function dismiss"), src.indexOf("export async function addOwnTask"));
  assert.match(fn, /updateTaskSkip\(r\.supabase, taskId, Boolean\(dismissed\), r\.userId\)/);
  assert.match(fn, /export async function undismiss\(taskId: string\)[\s\S]*dismiss\(taskId, false\)/);
});
