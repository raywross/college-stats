/**
 * readPlan against a fake Supabase client (lib/planner/read-plan.ts; build-plan.md review note 2): with the redesign's
 * columns it reads them as stored; without them (the migration not applied yet) it retries without them and treats
 * every row as the student's, so nothing is overwritten; a missing planner table still says "not set up"; any other
 * error is not retried. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_ITEM_BASE_COLUMNS, PLAN_ITEM_COLUMNS, PlannerSetupError, readPlan } from "../lib/planner/read-plan.ts";

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
  assert.match(PLAN_ITEM_COLUMNS, /category_source, round_source$/);
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
