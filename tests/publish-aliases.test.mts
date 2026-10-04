/**
 * Publishing short names and nicknames (scripts/lib/publish-aliases.mts; lib/supabase.ts): the table check, the
 * one-transaction replace-and-read-back, and the app's fail-soft read, all against a fake client (like
 * tests/supabase.test.mts and tests/publish-batches.test.mts). `npm test`. The SQL side itself
 * (supabase/migrations/20261004120000_school_aliases.sql) is checked by `npm run publish-data` itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAliasRow, type AliasRow } from "../lib/aliases.ts";
import { fetchAliasRows, fetchAllAliasRows } from "../lib/supabase.ts";
import { aliasesTableProblem, publishAliases } from "../scripts/lib/publish-aliases.mts";

/** A school_aliases table in memory, with the query-builder calls publish-aliases.mts and lib/supabase.ts use. */
function fakeTable(initial: AliasRow[] = []) {
  let rows = [...initial];
  let rpcCalls = 0;
  const client = {
    from(table: string) {
      if (table !== "school_aliases") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            limit() {
              return Promise.resolve(rows.length ? { error: null } : { error: null });
            },
            order() {
              return {
                range(from: number, to: number) {
                  const page = [...rows].sort((a, b) => a.unit_id.localeCompare(b.unit_id)).slice(from, to + 1);
                  return Promise.resolve({ data: page, error: null });
                },
              };
            },
          };
        },
      };
    },
    rpc(fn: string, args: { p_aliases: AliasRow[] }) {
      if (fn !== "publish_aliases") throw new Error(`unexpected rpc ${fn}`);
      rpcCalls++;
      rows = [...args.p_aliases];
      return Promise.resolve({ data: rows.length, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, getRows: () => rows, rpcCalls: () => rpcCalls };
}

/** A client whose `from("school_aliases")` always errors, like a missing table or a dropped connection. */
function erroringTable(error: { message: string; code?: string }) {
  return {
    from() {
      return {
        select() {
          return {
            limit() {
              return Promise.resolve({ error });
            },
            order() {
              return { range: () => Promise.resolve({ data: null, error }) };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

test("aliasesTableProblem is null when the table exists", async () => {
  const { client } = fakeTable();
  assert.equal(await aliasesTableProblem(client), null);
});

test("aliasesTableProblem names the migration when the table is missing (42P01)", async () => {
  const client = erroringTable({ message: 'relation "school_aliases" does not exist', code: "42P01" });
  const problem = await aliasesTableProblem(client);
  assert.match(problem!, /Apply supabase\/migrations\/20261004120000_school_aliases\.sql first/);
});

test("aliasesTableProblem also recognizes PostgREST's missing-table code", async () => {
  const client = erroringTable({ message: "not found", code: "PGRST205" });
  assert.match((await aliasesTableProblem(client))!, /Apply .*school_aliases\.sql/);
});

test("aliasesTableProblem reports any other error without claiming the migration is missing", async () => {
  const client = erroringTable({ message: "connection reset" });
  const problem = await aliasesTableProblem(client);
  assert.match(problem!, /connection reset/);
  assert.doesNotMatch(problem!, /Apply/);
});

test("publishAliases replaces every row in one transaction and reads it back", async () => {
  const t = fakeTable([buildAliasRow("1", "Old", "curated")]);
  const next = [buildAliasRow("139959", "UGA", "curated"), buildAliasRow("221999", "Vandy", "wikidata")];
  const n = await publishAliases(t.client, next);
  assert.equal(n, 2);
  assert.equal(t.rpcCalls(), 1, "one call, not staged in batches — the table is small");
  assert.deepEqual(t.getRows().map((r) => r.unit_id).sort(), ["139959", "221999"], "the old row is gone: it's a full replace");
});

test("publishAliases refuses an empty publish rather than wiping the table", async () => {
  const t = fakeTable([buildAliasRow("1", "Keep", "curated")]);
  await assert.rejects(publishAliases(t.client, []), /nothing to publish|no aliases/);
  assert.equal(t.getRows().length, 1, "nothing was touched");
});

test("fetchAllAliasRows pages past PostgREST's 1,000-row limit and throws on error", async () => {
  const many = Array.from({ length: 1234 }, (_, i) => buildAliasRow(String(i).padStart(6, "0"), `Alias${i}`, "curated"));
  const { client } = fakeTable(many);
  const back = await fetchAllAliasRows(client);
  assert.equal(back.length, 1234);

  await assert.rejects(fetchAllAliasRows(erroringTable({ message: "boom" })), /reading school_aliases failed/);
});

test("fetchAliasRows (the app's read) is fail-soft: a missing table returns no aliases, not a thrown error", async () => {
  const client = erroringTable({ message: 'relation "school_aliases" does not exist', code: "42P01" });
  const rows = await fetchAliasRows(client);
  assert.deepEqual(rows, [], "search still works; it just has no short names");
});

test("fetchAliasRows succeeds normally when the table is present", async () => {
  const { client } = fakeTable([buildAliasRow("139959", "UGA", "curated")]);
  assert.deepEqual(await fetchAliasRows(client), [buildAliasRow("139959", "UGA", "curated")]);
});
