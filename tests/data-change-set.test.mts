/**
 * One change set per run (specs/data-platform/pipelines.md): the stores' `attach` and `findOpen`, the run helpers in
 * scripts/lib/data-platform/change-set.mts, and the CLI a workflow opens and closes its set with
 * (scripts/data-change-set.mts). File store and a fake client only. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore, fileStoreChangeSets, supabaseStore, type StoreClient } from "../scripts/lib/data-platform/store.mts";
import { CHANGE_SET_SOURCES, openRunSet, replaceCollection, runRefFromEnv, withRunSet } from "../scripts/lib/data-platform/change-set.mts";
import { changeSetCli } from "../scripts/data-change-set.mts";

const ROOT = join(import.meta.dirname, "..");
const temp = () => mkdtempSync(join(tmpdir(), "change-set-"));

function cli(store: ReturnType<typeof fileStore>, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  return changeSetCli(argv, { store, out: (l) => out.push(l), err: (l) => err.push(l) }).then((code) => ({ code, out, err }));
}

test("file store: attach writes into an open set, refuses a closed one; findOpen finds the newest open set by source and run", async () => {
  const root = temp();
  try {
    const store = fileStore(root);
    const a = await store.open("pipeline", "identity-refresh", "100");
    const b = await store.open("pipeline", "identity-refresh", "100");
    await store.open("pipeline", "directories", "100");
    assert.equal(await store.findOpen("identity-refresh", "100"), b.id);
    assert.equal(await store.findOpen("identity-refresh", "999"), null);
    const again = await store.attach(a.id);
    await again.write("identity.probe", [{ key: "100654", body: { unit_id: "100654" } }]);
    await again.close("applied");
    assert.equal(fileStoreChangeSets(root).find((s) => s.id === a.id)?.summary.documents, 1, "the write landed in the attached set");
    await assert.rejects(store.attach(a.id), /is not open/);
    await assert.rejects(store.attach(99), /is not open/);
    await b.close("held", "test");
    assert.equal(await store.findOpen("identity-refresh", "100"), null, "closed sets aren't found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supabase store: attach reads the set's status, findOpen asks for the newest open set", async () => {
  const calls: { table: string; ops: unknown[][] }[] = [];
  let answer: unknown = null;
  const builder = (table: string) => {
    const call = { table, ops: [] as unknown[][] };
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "order", "limit", "maybeSingle"]) b[op] = (...args: unknown[]) => (call.ops.push([op, ...args]), b);
    b.then = (resolve: (r: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: answer, error: null }).then(resolve);
    };
    return b;
  };
  const client = { from: builder, rpc: () => builder("rpc") } as unknown as StoreClient;
  const store = supabaseStore("https://x.supabase.co", "k", { client, waits: [] });

  answer = { status: "open" };
  assert.equal((await store.attach(7)).id, 7);
  assert.deepEqual(calls[0].ops, [["select", "status"], ["eq", "id", 7], ["maybeSingle"]]);
  answer = { status: "applied" };
  await assert.rejects(store.attach(7), /change set 7 is not open/);
  answer = null;
  await assert.rejects(store.attach(8), /is not open/);

  answer = [{ id: 12 }];
  assert.equal(await store.findOpen("college-reported", "555"), 12);
  assert.deepEqual(calls.at(-1)!.ops, [["select", "id"], ["eq", "status", "open"], ["eq", "source", "college-reported"], ["eq", "run_ref", "555"], ["order", "id", { ascending: false }], ["limit", 1]]);
  answer = [];
  assert.equal(await store.findOpen("college-reported", "555"), null);
});

test("openRunSet attaches with --change-set (and never closes it) or opens its own; withRunSet closes its own applied, held on a throw", async () => {
  const root = temp();
  try {
    const store = fileStore(root);
    const own = await openRunSet(store, { source: "identity-refresh", runRef: "1" });
    assert.equal(own.owned, true);
    await own.handle.close("applied");

    const shared = await store.open("pipeline", "identity-refresh", "2");
    await withRunSet(store, { source: "identity-refresh", changeSet: String(shared.id) }, (h) => h.write("identity.probe", [{ key: "1", body: { a: 1 } }]));
    assert.equal(fileStoreChangeSets(root).find((s) => s.id === shared.id)?.status, "open", "an attached set is the workflow's to close");

    await assert.rejects(
      withRunSet(store, { source: "directories", runRef: "3" }, async (h) => {
        await h.write("directories.blocked", [{ key: "blocked", body: { blocked: [] } }]);
        throw new Error("the list moved");
      }),
      /the list moved/
    );
    const failed = fileStoreChangeSets(root).at(-1)!;
    assert.deepEqual([failed.source, failed.status, failed.held_reason], ["directories", "held", "stopped: the list moved"]);

    await withRunSet(store, { source: "campus-pilot", runRef: "4", close: () => ({ status: "held", reason: "review first" }) }, async () => {});
    assert.deepEqual([fileStoreChangeSets(root).at(-1)!.status, fileStoreChangeSets(root).at(-1)!.held_reason], ["held", "review first"]);

    await assert.rejects(openRunSet(store, { source: "identity-refresh", changeSet: "abc" }), /expected a change set id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaceCollection writes the new documents, removes the ones gone, and keeps what `keep` names", async () => {
  const root = temp();
  try {
    const store = fileStore(root);
    const first = await store.open("pipeline", "identity-refresh", "1");
    await first.write("identity.brand_colors", ["1", "2", "3"].map((key) => ({ key, body: { unit_id: key, v: 1 } })));
    await first.close("applied");
    const next = await store.open("pipeline", "identity-refresh", "2");
    const removed = await replaceCollection(store, next, "identity.brand_colors", new Map([["2", { unit_id: "2", v: 2 }]]), { keep: (k) => k === "3" });
    await next.close("applied");
    assert.equal(removed, 1);
    assert.deepEqual([...(await store.read("identity.brand_colors")).keys()], ["2", "3"]);
    assert.deepEqual(fileStoreChangeSets(root).at(-1)!.summary, { documents: 2, added: 0, changed: 1, removed: 1, collections: ["identity.brand_colors"] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runRefFromEnv is the Actions run id, else a local stamp", () => {
  assert.equal(runRefFromEnv({ GITHUB_RUN_ID: "123" }), "123");
  assert.equal(runRefFromEnv({}, () => new Date("2026-10-31T12:00:00.000Z")), "local-2026-10-31T12-00-00");
});

test("the CLI opens (printing the id alone), reuses an open set with --reuse, and closes applied or held", async () => {
  const root = temp();
  try {
    const store = fileStore(root);
    const opened = await cli(store, ["open", "--source", "identity-refresh", "--run-ref", "777", "--summary", '{"note":"x"}']);
    assert.deepEqual([opened.code, opened.out], [0, ["1"]]);
    const reused = await cli(store, ["open", "--source", "identity-refresh", "--run-ref", "777", "--reuse"]);
    assert.deepEqual(reused.out, ["1"], "--reuse returns the run's open set");
    const fresh = await cli(store, ["open", "--source", "identity-refresh", "--run-ref", "777"]);
    assert.deepEqual(fresh.out, ["2"], "without --reuse a second set opens");

    assert.equal((await cli(store, ["close", "--id", "1", "--status", "applied"])).code, 0);
    assert.equal((await cli(store, ["close", "--id", "2", "--status", "held", "--reason", "probe-sites failed"])).code, 0);
    const sets = fileStoreChangeSets(root);
    assert.deepEqual(
      sets.map((s) => [s.id, s.kind, s.source, s.run_ref, s.status, s.held_reason]),
      [
        [1, "pipeline", "identity-refresh", "777", "applied", null],
        [2, "pipeline", "identity-refresh", "777", "held", "probe-sites failed"],
      ]
    );
    assert.equal(sets[0].summary.note, "x");

    // Refusals: exit 1 with the reason, nothing changed.
    const refused = async (argv: string[], why: RegExp) => {
      const r = await cli(store, argv);
      assert.equal(r.code, 1, argv.join(" "));
      assert.match(r.err.join("\n"), why);
    };
    await refused(["open", "--source", "nightly-thing", "--run-ref", "1"], /--source must be one of/);
    await refused(["open", "--source", "directories"], /--run-ref is required/);
    await refused(["open", "--kind", "import", "--source", "directories", "--run-ref", "1"], /pipeline change sets/);
    await refused(["open", "--source", "directories", "--run-ref", "1", "--summary", "[1]"], /JSON object/);
    await refused(["close", "--id", "1", "--status", "applied"], /is not open/);
    await refused(["close", "--id", "2", "--status", "reverted"], /applied or held/);
    await refused(["close", "--id", "3", "--status", "held"], /needs --reason/);
    await refused(["close", "--status", "held"], /--id/);
    await refused(["frobnicate"], /usage/);
    assert.equal(fileStoreChangeSets(root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI as a process: --store file:<dir>, the id alone on stdout (what `id=$(…)` captures)", () => {
  const root = temp();
  try {
    const run = (args: string[]) =>
      execFileSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "data-change-set.mts"), ...args, "--store", `file:${root}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    assert.equal(run(["open", "--source", "campus-pilot", "--run-ref", "42"]), "1\n");
    assert.equal(run(["close", "--id", "1", "--status", "held", "--reason", "review first"]), "");
    assert.deepEqual(fileStoreChangeSets(root).map((s) => [s.status, s.held_reason]), [["held", "review first"]]);
    assert.throws(() => run(["close", "--id", "1", "--status", "applied"]), /is not open/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the sources are the brief's, one per producer", () => {
  assert.deepEqual([...CHANGE_SET_SOURCES].sort(), ["campus-pilot", "coalition", "college-reported", "common-app", "console", "directories", "essay-prompts", "high-schools", "history", "hold-misread", "identity-refresh", "sync-data"]);
});
