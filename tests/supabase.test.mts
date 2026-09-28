/**
 * Reading the dataset from Supabase (lib/supabase.ts) against a fake client, keeping it current in memory
 * (lib/dataset-loader.ts), and the revalidation endpoint's auth (lib/revalidate.ts). `npm test`.
 * The SQL side (publish_dataset, exact round trip) is checked by `npm run publish-data` itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDatasetFiles, fetchPublishedVersion } from "../lib/supabase.ts";
import { createDatasetLoader } from "../lib/dataset-loader.ts";
import { isAuthorized } from "../lib/revalidate.ts";

type FileRow = { name: string; data: unknown; published_at: string };

/**
 * Enough of the query builder for lib/supabase.ts: from("schools").select().order().range(), and
 * from("dataset_files").select(). `onFilesRead` runs after each dataset_files read, to simulate a publish.
 */
function fakeClient(rows: unknown[], files: FileRow[], onFilesRead?: (reads: number) => void) {
  const ranges: [number, number][] = [];
  let fileReads = 0;
  const client = {
    from(table: string) {
      if (table === "dataset_files") {
        return {
          select: async () => {
            const data = structuredClone(files);
            onFilesRead?.(++fileReads);
            return { data, error: null };
          },
        };
      }
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

const V1 = "2026-09-28T10:00:00+00:00";
const V2 = "2026-09-28T11:00:00+00:00";
const files = (version = V1): FileRow[] => [
  { name: "meta", data: { retrieved: "2026-09-28" }, published_at: version },
  { name: "release_calendar", data: { reviewed: "2026-09-28", releases: [] }, published_at: version },
];

test("reads every page past PostgREST's 1,000-row limit, in position order", async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => ({ data: { unit_id: String(i), name: `College ${i}` } }));
  const { client, ranges } = fakeClient(rows, files());
  const out = await fetchDatasetFiles(client);
  assert.equal(out.schools.length, 2345);
  assert.equal(out.schools[2344].unit_id, "2344");
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(out.meta.retrieved, "2026-09-28");
  assert.equal(out.version, V1);
});

test("an unpublished project fails with instructions instead of serving an empty site", async () => {
  const { client } = fakeClient([], []);
  await assert.rejects(fetchDatasetFiles(client), /publish-data/);
  assert.equal(await fetchPublishedVersion(client), null);
  const { client: noCalendar } = fakeClient([{ data: { unit_id: "1" } }], files().slice(0, 1));
  await assert.rejects(fetchDatasetFiles(noCalendar), /publish-data/);
});

test("a publish landing mid-read is detected and the read repeated, so one load never mixes two publishes", async () => {
  const current = files(V1);
  // Read 1 is the version check before the rows; a publish lands right after it.
  const { client, ranges } = fakeClient([{ data: { unit_id: "1" } }], current, (reads) => {
    if (reads === 1) for (const f of current) f.published_at = V2;
  });
  const out = await fetchDatasetFiles(client);
  assert.equal(out.version, V2);
  assert.equal(ranges.length, 2, "the colleges were read twice");

  const { client: churning } = fakeClient([{ data: { unit_id: "1" } }], current, () => {
    for (const f of current) f.published_at = new Date().toISOString() + Math.random();
  });
  await assert.rejects(fetchDatasetFiles(churning), /kept changing/);
});

/** A store whose version and contents the test controls, counting loads and version checks. */
function fakeStore(version: string | null) {
  const store = { version, loads: 0, checks: 0, down: false };
  const loader = createDatasetLoader({
    load: async () => {
      store.loads++;
      if (store.down) throw new Error("unreachable");
      return { value: `data@${store.version}`, version: store.version };
    },
    currentVersion: async () => {
      store.checks++;
      if (store.down) throw new Error("unreachable");
      return store.version;
    },
    onError: () => {},
  });
  return { store, get: loader };
}

test("an instance holding an old copy reloads before serving once a newer publish exists", async () => {
  const { store, get } = fakeStore(V1);
  assert.equal(await get(), `data@${V1}`);
  assert.equal(await get(), `data@${V1}`);
  assert.equal(store.loads, 1, "unchanged version: served from memory");

  store.version = V2; // published elsewhere; this instance still holds V1
  assert.equal(await get(), `data@${V2}`, "the very next call, e.g. a revalidation render, sees the new publish");
  assert.equal(store.loads, 2);
});

test("concurrent calls after a publish share one reload", async () => {
  const { store, get } = fakeStore(V1);
  await get();
  store.version = V2;
  const results = await Promise.all([get(), get(), get()]);
  assert.deepEqual(results, Array(3).fill(`data@${V2}`));
  assert.equal(store.loads, 2);
});

test("if the store can't be reached, the copy in memory keeps serving; the first load still fails loudly", async () => {
  const { store, get } = fakeStore(V1);
  await get();
  store.down = true;
  assert.equal(await get(), `data@${V1}`);

  const cold = fakeStore(V1);
  cold.store.down = true;
  await assert.rejects(cold.get(), /unreachable/);
});

test("a store without versions (JSON) loads once and is never checked", async () => {
  let loads = 0;
  const get = createDatasetLoader({ load: async () => ({ value: ++loads, version: null }) });
  await get();
  await get();
  assert.equal(loads, 1);
});

test("revalidation requires the exact bearer secret, and is off when no secret is configured", () => {
  assert.equal(isAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorized("Bearer s3cret!", "s3cret"), false);
  assert.equal(isAuthorized("Bearer ", "s3cret"), false);
  assert.equal(isAuthorized("s3cret", "s3cret"), false);
  assert.equal(isAuthorized(null, "s3cret"), false);
  assert.equal(isAuthorized("Bearer ", ""), false);
  assert.equal(isAuthorized("Bearer undefined", undefined), false);
});
