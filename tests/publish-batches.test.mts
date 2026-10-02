/**
 * Batched publishing (scripts/lib/publish-batches.mts): history and detail files are upserted into the live table a
 * batch at a time, then colleges no longer in the data are removed. Against a fake client. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allUnitIds, replaceInBatches } from "../scripts/lib/publish-batches.mts";

/** A table in memory with the query-builder calls the helper uses; `failUpsert` fails that upsert call (0-based). */
function fakeTable(initial: string[], failUpsert?: number) {
  const rows = new Map<string, { unit_id: string; data: unknown }>(initial.map((id) => [id, { unit_id: id, data: { old: true } }]));
  const upserts: number[] = [];
  const deletes: string[][] = [];
  const client = {
    from() {
      return {
        upsert(chunk: { unit_id: string; data: unknown }[]) {
          upserts.push(chunk.length);
          if (failUpsert === upserts.length - 1) return Promise.resolve({ error: { message: "statement timeout" } });
          for (const r of chunk) rows.set(r.unit_id, r);
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            order() {
              return {
                range(from: number, to: number) {
                  const ids = [...rows.keys()].sort().slice(from, to + 1).map((unit_id) => ({ unit_id }));
                  return Promise.resolve({ data: ids, error: null });
                },
              };
            },
          };
        },
        delete() {
          return {
            in(_col: string, ids: string[]) {
              deletes.push(ids);
              for (const id of ids) rows.delete(id);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rows, upserts, deletes };
}

const ids = (n: number, prefix = "") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, "0")}`);

test("writes in batches, replaces existing rows, and removes colleges no longer in the data", async () => {
  const t = fakeTable([...ids(5), "gone-1", "gone-2"]);
  const n = await replaceInBatches(t.client, "school_histories", ids(350).map((id) => ({ unit_id: id, data: { id } })), 150, "History");
  assert.equal(n, 350);
  assert.deepEqual(t.upserts, [150, 150, 50], "three batches of at most 150");
  assert.equal(t.rows.size, 350);
  assert.deepEqual(t.rows.get("00000")!.data, { id: "00000" }, "an existing college's row is replaced");
  assert.ok(!t.rows.has("gone-1") && !t.rows.has("gone-2"), "stale colleges removed");
  assert.deepEqual(t.deletes, [["gone-1", "gone-2"]]);
});

test("a failed batch stops the publish and names it", async () => {
  const t = fakeTable([], 1);
  await assert.rejects(
    replaceInBatches(t.client, "school_histories", ids(400).map((id) => ({ unit_id: id, data: {} })), 150, "History"),
    /History: writing 150–300: statement timeout/,
  );
  assert.deepEqual(t.deletes, [], "nothing is removed after a failure");
});

test("listing pages past PostgREST's 1,000-row limit, so stale rows beyond it are found", async () => {
  const t = fakeTable(ids(2500));
  assert.equal((await allUnitIds(t.client, "school_histories")).length, 2500);
});

test("an empty publish is refused rather than deleting every row", async () => {
  const t = fakeTable(ids(10));
  await assert.rejects(replaceInBatches(t.client, "school_details", [], 200, "Details"), /nothing to publish/);
  assert.equal(t.rows.size, 10);
});
