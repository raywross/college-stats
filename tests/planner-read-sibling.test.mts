/**
 * Reading list items before 20261012130000_list_item_sibling.sql is applied (lib/planner/read-plan.ts readItems): the
 * sibling column alone missing keeps legacy and recruited, the sibling reading as unmarked; the older fallbacks still
 * work. A stub stands in for Supabase. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingHooksColumn, isMissingSiblingColumn, readItems } from "../lib/planner/read-plan.ts";

/** A stub whose list_items select fails while it names a column the "database" lacks. */
function stub(missing: string[]) {
  const asked: string[] = [];
  const client = {
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          order: async () => {
            asked.push(cols);
            const gone = missing.find((c) => new RegExp(`\\b${c}\\b`).test(cols));
            if (gone) return { data: null, error: { code: "42703", message: `column list_items.${gone} does not exist` } };
            return { data: [{ id: "i1", unit_id: "100", legacy: cols.includes("legacy") ? true : undefined, recruited: "contact" }], error: null };
          },
        }),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, asked };
}

test("the sibling column missing: one retry without it, legacy and recruited kept, sibling false", async () => {
  const { client, asked } = stub(["legacy_sibling"]);
  const r = await readItems(client, "L");
  assert.equal(r.error, null);
  assert.equal(r.sourcesMissing, false);
  assert.equal(r.data![0].legacy, true);
  assert.equal(r.data![0].recruited, "contact");
  assert.equal(r.data![0].legacy_sibling, false);
  assert.equal(asked.length, 2);
  assert.ok(!asked[1].includes("legacy_sibling"));
});

test("with the column there, one read", async () => {
  const { client, asked } = stub([]);
  const r = await readItems(client, "L");
  assert.equal(r.error, null);
  assert.equal(asked.length, 1);
});

test("the error tests tell the sibling column from the five-levels columns", () => {
  const sib = { code: "42703", message: "column list_items.legacy_sibling does not exist" };
  const leg = { code: "42703", message: "column list_items.legacy does not exist" };
  assert.equal(isMissingSiblingColumn(sib), true);
  assert.equal(isMissingHooksColumn(sib), false, "a missing sibling column isn't a missing legacy column");
  assert.equal(isMissingHooksColumn(leg), true);
  assert.equal(isMissingSiblingColumn(leg), false);
});
