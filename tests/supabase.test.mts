/**
 * Reading the dataset from Supabase (lib/supabase.ts) against a fake client. `npm test`.
 * The SQL side (publish_dataset, exact round trip) is checked by `npm run publish-data` itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDatasetFiles } from "../lib/supabase.ts";

/** Enough of the query builder for fetchDatasetFiles: from().select().order().range(), and from().select(). */
function fakeClient(rows: unknown[], files: { name: string; data: unknown }[]) {
  const ranges: [number, number][] = [];
  const client = {
    from(table: string) {
      if (table === "dataset_files") return { select: async () => ({ data: files, error: null }) };
      return {
        select: () => ({
          order: () => ({
            range: async (from: number, to: number) => {
              ranges.push([from, to]);
              return { data: rows.slice(from, to + 1), error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: client as unknown as SupabaseClient, ranges };
}

const FILES = [
  { name: "meta", data: { retrieved: "2026-09-28" } },
  { name: "release_calendar", data: { reviewed: "2026-09-28", releases: [] } },
];

test("reads every page past PostgREST's 1,000-row limit, in position order", async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => ({ data: { unit_id: String(i), name: `College ${i}` } }));
  const { client, ranges } = fakeClient(rows, FILES);
  const out = await fetchDatasetFiles(client);
  assert.equal(out.schools.length, 2345);
  assert.equal(out.schools[2344].unit_id, "2344");
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(out.meta.retrieved, "2026-09-28");
});

test("an unpublished project fails with instructions instead of serving an empty site", async () => {
  const { client } = fakeClient([], []);
  await assert.rejects(fetchDatasetFiles(client), /publish-data/);
  const { client: noCalendar } = fakeClient([{ data: { unit_id: "1" } }], FILES.slice(0, 1));
  await assert.rejects(fetchDatasetFiles(noCalendar), /publish-data/);
});
