/**
 * Data platform phase 2, unit E3 (specs/data-platform/pipelines.md): the essay reader, Common App, Coalition, history,
 * the high-school syncs and sync-data write their layers through the data store, keyed as the import keys them, in
 * one change set per run; their workflows commit nothing, open no PR, and ask for a snapshot only after a clean run.
 * Everything runs on the file store in temp folders and the mini fixture; no network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { School } from "../lib/types.ts";
import type { SchoolDetail } from "../lib/detail.ts";
import type { CoalitionFile } from "../lib/coalition.ts";
import type { CpiTable, HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { validateLineage } from "../lib/lineage.ts";
import { fileStore, fileStoreChangeSets, type DataStore } from "../scripts/lib/data-platform/store.mts";
import { COLLECTIONS, SINGLE_KEYS, readLayer } from "../scripts/lib/data-platform/layers.mts";
import { changeSetFromArgv, EXIT, openProducerRun, runRef, writeChanged } from "../scripts/lib/data-platform/producer.mts";
import { importLayers, stripLaterLayers, writeImport } from "../scripts/import-data-from-files.mts";
import { ESSAY_COLLECTIONS, essaysBreaker, heldDocument, loadEssayState, recordDocument, writeEssayRun, type EssayRecord, type HeldRecord, type PageRecipe } from "../scripts/lib/essay-prompts/store.mts";
import { coalitionDocument } from "../scripts/lib/coalition/sync.mts";
import { editionFileText } from "../scripts/lib/common-app/edition-file.mts";
import { fetchSlugs, membersFileText } from "../scripts/lib/common-app/members.mts";
import type { GridEdition, MembersFile } from "../lib/common-app/types.ts";
import { formatHistoryShard } from "../scripts/history/build.mts";
import { deriveTrends } from "../scripts/lib/overrides.mts";
import { highSchoolScratch, onHighSchoolFolder, readHighSchoolFolder, writeHighSchoolChanges } from "../scripts/lib/high-schools/data-store.mts";
import { baseDocuments, overlayStore } from "../scripts/lib/sync-data-base.mts";
import { composeSnapshot, loadPublishLayers } from "../scripts/lib/data-platform/compose.mts";
import { miniLayers, miniMeta, miniSchools } from "./helpers/snapshot.mts";

const ROOT = join(import.meta.dirname, "..");
const scratch = (name: string) => mkdtempSync(join(tmpdir(), `dp-sources-${name}-`));
const NODE = [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
/** The environment a script runs in here: no data project, so `--store` must be given. */
const OFFLINE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATA_)?SUPABASE_/.test(k) && k !== "GITHUB_RUN_ID")) as NodeJS.ProcessEnv;

/** One collection of the import, for the colleges given (or every document). */
function imported(collection: string, units?: string[]): Map<string, unknown> {
  return importLayers(join(ROOT, "data"), { only: new Set([collection]), ...(units ? { units: new Set(units) } : {}) }).get(collection as never) ?? new Map();
}

/* ------------------------------------------------------------------ */
/* The producer's run                                                   */
/* ------------------------------------------------------------------ */

test("producer: a run opens one pipeline change set with its source; --change-set attaches to an open set and refuses a closed one", async () => {
  const dir = scratch("producer");
  try {
    const store = fileStore(dir);
    const run = await openProducerRun(store, "coalition", { runRef: "123" });
    assert.equal(run.attached, false);
    await run.handle.write("coalition.members", [{ key: "members", body: { a: 1 } }]);
    const joined = await openProducerRun(store, "ignored", { changeSet: run.handle.id });
    assert.equal(joined.attached, true);
    await joined.handle.write("coalition.name_map", [{ key: "name-map", body: {} }]);
    await joined.finish("held", "an attached run never closes the set");
    assert.equal(fileStoreChangeSets(dir)[0].status, "open", "the opener closes it");
    await run.finish("applied", undefined, { members: 1 });
    const [set] = fileStoreChangeSets(dir);
    assert.deepEqual([set.kind, set.source, set.run_ref, set.status, set.summary.members, set.summary.documents], ["pipeline", "coalition", "123", "applied", 1, 2]);
    await assert.rejects(openProducerRun(store, "coalition", { changeSet: run.handle.id }), /change set 1 is not open/);
    assert.equal(changeSetFromArgv(["--change-set", "7"]), 7);
    assert.throws(() => changeSetFromArgv(["--change-set", "x"]), /expected a change set id/);
    assert.equal(runRef({ GITHUB_RUN_ID: "99" }), "99");
    assert.match(runRef({}, new Date("2026-10-31T12:00:00.123Z")), /^local-2026-10-31T12:00:00Z$/);
    assert.deepEqual(EXIT, { applied: 0, failed: 1, held: 2, stopped: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("producer: writeChanged sends only what changed and, mirroring, removes what is gone", async () => {
  const dir = scratch("changed");
  try {
    const store = fileStore(dir);
    const first = await store.open("pipeline", "history", "1");
    await first.write("history.schools", [{ key: "1", body: { a: 1 } }, { key: "2", body: { b: 2 } }]);
    await first.close("applied");
    const before = await store.read("history.schools");
    const run = await store.open("pipeline", "history", "2");
    const sent = await writeChanged(run, "history.schools", before, new Map([["1", { a: 1 }], ["3", { c: 3 }]]), { mirror: true });
    await run.close("applied");
    assert.deepEqual(sent, { sent: 1, removed: 1 });
    assert.deepEqual([...(await store.read("history.schools")).keys()], ["1", "3"]);
    assert.deepEqual(fileStoreChangeSets(dir)[1].versions.map((v) => `${v.key}:${v.deleted}`), ["3:false", "2:true"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Essays                                                               */
/* ------------------------------------------------------------------ */

const firstRecord = (): EssayRecord => {
  const records = imported(ESSAY_COLLECTIONS.records, ["221999"]);
  return records.get("221999") as EssayRecord;
};

test("essays: a record's document is the committed file's parsed text, so a run and the import write the same body", () => {
  const rec = firstRecord();
  const doc = recordDocument(rec);
  assert.equal(JSON.stringify(doc), JSON.stringify(rec), "same keys, same order");
  const held = imported(ESSAY_COLLECTIONS.held, ["145637"]).get("145637") as HeldRecord;
  assert.equal(JSON.stringify(heldDocument(held)), JSON.stringify(held));
});

test("essays: a run writes records, held reads, changed pages and its summary in one set; a college that passes leaves the held list", async () => {
  const dir = scratch("essays");
  try {
    const store = fileStore(dir);
    const rec = firstRecord();
    const heldBefore: HeldRecord = { unit_id: rec.unit_id, name: rec.name, held: "2026-10-01", problems: ["the page names no cycle"], record: rec };
    const page: PageRecipe = { url: "https://example.edu/essays", via: "known-link", checked: "2026-10-01" };
    const seed = await store.open("import", "git", "seed");
    await seed.write(ESSAY_COLLECTIONS.held, [{ key: rec.unit_id, body: heldDocument(heldBefore) }]);
    await seed.write(ESSAY_COLLECTIONS.pages, [{ key: rec.unit_id, body: page }, { key: "100000", body: page }]);
    await seed.close("applied");

    const before = await loadEssayState(store);
    assert.equal(before.held.size, 1);
    const other: HeldRecord = { unit_id: "100000", name: "Placeholder College", held: "2026-10-31", problems: ["a prompt is the Common App's"], record: { ...rec, unit_id: "100000", name: "Placeholder College" } };
    const run = await openProducerRun(store, "essay-prompts", { runRef: "42" });
    await writeEssayRun(run.handle, before, {
      records: [rec],
      held: [other],
      cleared: [rec.unit_id],
      pages: new Map([[rec.unit_id, page], ["100000", { ...page, checked: "2026-10-31" }]]),
      summary: { run: "2026-10-31T12:00:00Z" },
    });
    await run.finish("applied");
    const after = await loadEssayState(store);
    assert.deepEqual([...after.records.keys()], [rec.unit_id]);
    assert.deepEqual([...after.held.keys()], ["100000"], "the passing college left the held list; the new hold is in");
    const set = fileStoreChangeSets(dir)[1];
    assert.deepEqual(
      set.versions.map((v) => `${v.collection}/${v.key}${v.deleted ? " (removed)" : ""}`),
      [`essays.records/${rec.unit_id}`, "essays.held/100000", `essays.held/${rec.unit_id} (removed)`, "essays.pages/100000", "essays.runs/2026-10-31T12:00:00Z"],
      "the unchanged page isn't sent",
    );
    assert.deepEqual(set.summary.collections, ["essays.held", "essays.pages", "essays.records", "essays.runs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("essays: the breaker holds the set only when more than half of the colleges read were held", () => {
  assert.equal(essaysBreaker({ passed: 0, held: 0 }), null, "nothing read");
  assert.equal(essaysBreaker({ passed: 1, held: 1 }), null, "half is not more than half");
  assert.equal(essaysBreaker({ passed: 10, held: 3 }), null);
  assert.match(essaysBreaker({ passed: 1, held: 2 }) ?? "", /^2 of the 3 colleges read this run were held \(more than half\)/);
  const script = readFileSync(join(ROOT, "scripts", "sync-essay-prompts.mts"), "utf8");
  assert.match(script, /run\.finish\(breaker \? "held" : "applied"/);
  assert.match(script, /process\.exit\(breaker \? EXIT\.held : summary\.stopped \? EXIT\.stopped : EXIT\.applied\)/);
  assert.doesNotMatch(script, /writeFileSync|writeEssayRecord|writeHeld\(|writePages|last-run\.json/, "no file under data/ is written");
});

/* ------------------------------------------------------------------ */
/* Coalition and Common App                                             */
/* ------------------------------------------------------------------ */

/** The two pages, rebuilt from the committed members file (the parser's markup). */
function coalitionPages(file: CoalitionFile): { members: string; scoir: string } {
  const names = [...new Set(file.members.map((m) => m.name))];
  const url = new Map(file.members.map((m) => [m.name, m.admissions_url]));
  const esc = (s: string) => s.replace(/&/g, "&amp;");
  const members = `<html><body>${names.map((n) => `<div class="summary-title"><a href="${esc(url.get(n) ?? "")}" class="summary-title-link">${esc(n)}</a></div>`).join("\n")}</body></html>`;
  const scoirNames = [...new Set(file.scoir.names.map((n) => n.name))];
  const [y, m, d] = file.scoir.as_of!.split("-").map(Number);
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  const scoir = `<html><body><p>As of ${month} ${d}, ${y}</p><p>${scoirNames.map(esc).join("<br>")}</p></body></html>`;
  return { members, scoir };
}

test("coalition: the CLI on the file store writes coalition.members as the import has it, in a coalition change set, and nothing under data/", async () => {
  const dir = scratch("coalition");
  try {
    const committed = imported(COLLECTIONS.coalition.members).get(SINGLE_KEYS.members) as CoalitionFile;
    const pages = coalitionPages(committed);
    writeFileSync(join(dir, "members.html"), pages.members);
    writeFileSync(join(dir, "scoir.html"), pages.scoir);
    const store = fileStore(join(dir, "store"));
    await writeImport(store, new Map([[COLLECTIONS.coalition.nameMap, imported(COLLECTIONS.coalition.nameMap)]]) as never, "seed");
    const before = readFileSync(join(ROOT, "data", "coalition", "members.json"), "utf8");
    const r = spawnSync(NODE[0], [...NODE.slice(1), join(ROOT, "scripts", "sync-coalition.mts"), "--store", `file:${join(dir, "store")}`, "--from-files", join(dir, "members.html"), join(dir, "scoir.html")], { encoding: "utf8", env: OFFLINE_ENV });
    assert.equal(r.status, 0, r.stderr);
    const doc = (await store.readOne<CoalitionFile>(COLLECTIONS.coalition.members, SINGLE_KEYS.members))!;
    assert.equal(JSON.stringify({ ...doc, retrieved: committed.retrieved }), JSON.stringify(committed), "the same document, key for key, apart from the day");
    assert.equal(JSON.stringify(coalitionDocument(committed)), JSON.stringify(committed));
    const sets = fileStoreChangeSets(join(dir, "store"));
    assert.deepEqual([sets[1].source, sets[1].status, sets[1].summary.collections], ["coalition", "applied", ["coalition.members"]]);
    assert.equal(readFileSync(join(ROOT, "data", "coalition", "members.json"), "utf8"), before, "data/ untouched");
    const bare = spawnSync(NODE[0], [...NODE.slice(1), join(ROOT, "scripts", "sync-coalition.mts"), "--from-files", join(dir, "members.html"), join(dir, "scoir.html")], { encoding: "utf8", env: OFFLINE_ENV });
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /--store is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("common app: the edition and members documents are the files' parsed text, as the import keys them; the sync reads its prior state from the store", () => {
  const grid = imported(COLLECTIONS.commonApp.grid);
  assert.ok(grid.size >= 1);
  for (const [key, edition] of grid) {
    const e = edition as GridEdition;
    assert.equal(key, `${e.cycle}_${e.updated}`);
    assert.equal(JSON.stringify(JSON.parse(editionFileText(e))), JSON.stringify(e));
  }
  const members = imported(COLLECTIONS.commonApp.members).get(SINGLE_KEYS.members) as MembersFile;
  assert.equal(JSON.stringify(JSON.parse(membersFileText(members))), JSON.stringify(members));
  const script = readFileSync(join(ROOT, "scripts", "sync-common-app.mts"), "utf8");
  for (const c of ["COLLECTIONS.commonApp.grid", "COLLECTIONS.commonApp.members", "COLLECTIONS.commonApp.nameMap"]) assert.ok(script.includes(c), c);
  assert.match(script, /createArchive\(.*\)\.put\(sha, gridBytes, "pdf"\)/, "the PDF goes to the archive");
  assert.doesNotMatch(script, /writeFileSync|writeMembersFile|newestEdition\(|data", "common-app/, "no file under data/");
  // The change set is opened lazily inside the members loop and closed only at a clean finish; a thrown error or a
  // cancelled workflow (SIGINT/SIGTERM) must still close it `held`, not leave it `open` forever.
  assert.match(script, /process\.on\(signal/, "a SIGINT/SIGTERM handler");
  assert.match(script, /main\(\)\s*\n\s*\.then\(/, "a catch-all around the run");
  assert.match(script, /holdOpenRun/, "both paths close the run the same way");
});

test("sync-common-app's safety net: a throw after the change set opens (mid-loop) leaves it held with the reason, not open", async () => {
  const dir = scratch("common-app-safety-net");
  try {
    const store = fileStore(dir);
    // Mirrors the script's lazy-open: the first periodic save opens the run and writes successfully…
    let run: Awaited<ReturnType<typeof openProducerRun>> | null = null;
    const runSet = async () => (run ??= await openProducerRun(store, "common-app", {}));
    await (await runSet()).handle.write(COLLECTIONS.commonApp.members, [{ key: SINGLE_KEYS.members, body: { retrieved: "2026-01-01", sitemap_url: "https://www.commonapp.org/sitemap-0.xml", members: [] } }]);
    assert.equal(fileStoreChangeSets(dir).at(-1)?.status, "open", "opened by the first save, same as the real script");
    // …then a later request throws (a fake fetch standing in for the network), caught by the same catch-all
    // sync-common-app.mts has around its run: hold the set with why, then rethrow.
    const fakeHttp = { get: async (url: string) => { throw new Error(`${url}: ECONNRESET`); } };
    await assert.rejects(
      (async () => {
        try {
          await fetchSlugs(fakeHttp);
        } catch (err) {
          await run!.finish("held", `stopped: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500));
          throw err;
        }
      })(),
      /ECONNRESET/
    );
    const set = fileStoreChangeSets(dir).at(-1)!;
    assert.equal(set.status, "held", "never left open");
    assert.match(set.held_reason ?? "", /^stopped: .*ECONNRESET/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

test("history: school.trends derive from the history layer exactly as the committed colleges carry them (the publisher can stop carrying them)", async () => {
  const store = miniLayers();
  const histories = await readLayer<SchoolHistory>(store, COLLECTIONS.history.schools);
  const cpi = (await store.readOne<CpiTable>(COLLECTIONS.history.shared, "cpi"))!;
  const hmeta = (await store.readOne<HistoryMeta>(COLLECTIONS.history.shared, "meta"))!;
  const composed = miniSchools();
  const derived = structuredClone(composed);
  const n = deriveTrends(derived, histories, cpi, hmeta);
  assert.ok(n > 0);
  for (let i = 0; i < composed.length; i++) assert.equal(JSON.stringify(derived[i].trends), JSON.stringify(composed[i].trends), composed[i].unit_id);
  assert.deepEqual(validateLineage(derived, miniMeta()), []);
  const gone = structuredClone(composed[0]);
  deriveTrends([gone], new Map(), cpi, hmeta);
  assert.equal(gone.trends, undefined, "no history, no trends block");
  // A shard's document is its file text parsed (the import's body).
  for (const [id, h] of histories) assert.equal(JSON.stringify(JSON.parse(formatHistoryShard(h))), JSON.stringify(h), id);
  const script = readFileSync(join(ROOT, "scripts", "sync-history.mts"), "utf8");
  assert.doesNotMatch(script, /writeFileSync|buildTrends\(|schools\.json"\)\)/, "no data/ writes, no build-trends step");
  assert.match(script, /openProducerRun\(store, "history"/);
});

/* ------------------------------------------------------------------ */
/* High schools                                                         */
/* ------------------------------------------------------------------ */

/** A small data/high-schools/: the two smallest state shards and their ledgers, one state file, the shared files. */
function smallHighSchools(dir: string): void {
  const src = join(ROOT, "data", "high-schools");
  for (const f of readdirSync(src)) if (f.endsWith(".json")) cpSync(join(src, f), join(dir, f));
  for (const sub of ["schools", "ledger"]) {
    mkdirSync(join(dir, sub), { recursive: true });
    for (const f of ["DC.json", "DE.json"]) if (existsSync(join(src, sub, f))) cpSync(join(src, sub, f), join(dir, sub, f));
  }
  const states = readdirSync(join(src, "state")).sort();
  mkdirSync(join(dir, "state"), { recursive: true });
  cpSync(join(src, "state", states[0]), join(dir, "state", states[0]));
  if (existsSync(join(src, "detail"))) cpSync(join(src, "detail"), join(dir, "detail"), { recursive: true });
}

test("high schools: the folder reads back keyed as the import keys data/high-schools/", () => {
  const dir = scratch("hs-keys");
  try {
    smallHighSchools(join(dir, "data", "high-schools"));
    const got = readHighSchoolFolder(join(dir, "data", "high-schools"));
    const want = importLayers(join(dir, "data"), { only: new Set(Object.values(COLLECTIONS.highSchools)) });
    for (const c of Object.values(COLLECTIONS.highSchools)) {
      const g = got.get(c)!;
      const w = (want.get(c as never) ?? new Map()) as Map<string, unknown>;
      assert.deepEqual([...g.keys()], [...w.keys()], c);
      for (const [k, v] of w) assert.equal(JSON.stringify(g.get(k)), JSON.stringify(v), `${c}/${k}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("high schools: a sync on the scratch folder writes back only what it changed, added or removed", async () => {
  const dir = scratch("hs-run");
  try {
    smallHighSchools(join(dir, "data", "high-schools"));
    const store: DataStore = fileStore(join(dir, "store"));
    await writeImport(store, importLayers(join(dir, "data"), { only: new Set(Object.values(COLLECTIONS.highSchools)) }), "seed");
    const ran = await onHighSchoolFolder(store, async (hs) => {
      const meta = JSON.parse(readFileSync(join(hs, "meta.json"), "utf8"));
      writeFileSync(join(hs, "meta.json"), `${JSON.stringify({ ...meta, built: "2099-01-01" }, null, 2)}\n`);
      // Rewritten with other whitespace but the same values: not a change.
      const dc = JSON.parse(readFileSync(join(hs, "schools", "DC.json"), "utf8"));
      writeFileSync(join(hs, "schools", "DC.json"), JSON.stringify(dc, null, 4));
      rmSync(join(hs, "schools", "DE.json"));
      mkdirSync(join(hs, "detail"), { recursive: true });
      writeFileSync(join(hs, "detail", "999999999999.json"), JSON.stringify({ id: "999999999999" }));
      return "done";
    });
    assert.equal(ran.result, "done");
    const run = await openProducerRun(store, "high-schools", { runRef: "7" });
    const changed = await writeHighSchoolChanges(run.handle, ran.before, ran.after);
    await run.finish("applied");
    assert.deepEqual(changed, { sent: 2, removed: 1 });
    const set = fileStoreChangeSets(join(dir, "store"))[1];
    assert.deepEqual(set.versions.map((v) => `${v.collection}/${v.key}${v.deleted ? " (removed)" : ""}`).sort(), ["high_schools.detail/999999999999", "high_schools.schools/DE (removed)", "high_schools.shared/meta"]);
    assert.equal(((await store.readOne<{ built: string }>(COLLECTIONS.highSchools.shared, "meta"))!).built, "2099-01-01");
    const s = await highSchoolScratch(store);
    assert.ok(existsSync(join(s.dir, "schools", "DC.json")), "the scratch root stands in for the repository root");
    s.remove();
    assert.equal(existsSync(s.root), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("high schools: the three syncs run on the scratch copy and write nothing under data/", () => {
  for (const f of ["sync-high-schools.mts", "sync-hs-states.mts", "sync-hs-profiles.mts"]) {
    const script = readFileSync(join(ROOT, "scripts", f), "utf8");
    assert.match(script, /onHighSchoolFolder|highSchoolScratch/, f);
    assert.match(script, /openProducerRun\(store, "high-schools"/, f);
    assert.doesNotMatch(script, /highSchoolsDir\(|join\(ROOT, "data", "high-schools"\)/, `${f} doesn't write data/high-schools/`);
  }
});

/* ------------------------------------------------------------------ */
/* sync-data: the base                                                  */
/* ------------------------------------------------------------------ */

async function miniBase() {
  const store = miniLayers();
  return {
    store,
    schools: [...(await readLayer<School>(store, COLLECTIONS.base.colleges)).values()],
    details: [...(await readLayer<SchoolDetail>(store, COLLECTIONS.base.detail)).values()],
    meta: (await store.readOne(COLLECTIONS.base.meta, SINGLE_KEYS.meta)) as never,
    aliases: ((await store.readOne(COLLECTIONS.base.aliases, SINGLE_KEYS.aliases)) ?? []) as never[],
    calendar: (await store.readOne(COLLECTIONS.base.releaseCalendar, SINGLE_KEYS.calendar)) as never,
    sourceFiles: (await store.readOne(COLLECTIONS.base.sourceFiles, SINGLE_KEYS.sourceFiles)) as never,
  };
}

test("sync-data: the base it writes is the import's base, document for document (the two definitions agree)", async () => {
  const b = await miniBase();
  const docs = baseDocuments(b);
  for (const [collection, mine] of docs) {
    const theirs = await b.store.read(collection);
    assert.deepEqual([...mine.keys()].sort(), [...theirs.keys()].sort(), collection);
    for (const [k, v] of mine) assert.equal(JSON.stringify(v), JSON.stringify(theirs.get(k)), `${collection}/${k}`);
  }
  // Forward from the composed colleges: stripping the later layers gives the stored base back byte for byte.
  const stored = await readLayer<School>(b.store, COLLECTIONS.base.colleges);
  for (const s of miniSchools()) assert.equal(JSON.stringify(stripLaterLayers(s)), JSON.stringify(stored.get(s.unit_id)), s.unit_id);
});

test("sync-data: a later layer's value or detail table never reaches the base (the guard, broken on purpose)", async () => {
  const b = await miniBase();
  const composed = miniSchools().find((s) => s.unit_id === "221999")!;
  assert.throws(() => baseDocuments({ ...b, schools: [composed] }), /later-layer values in the base \(only the publisher composes\):\n {2}221999: has apply/);
  const withAid = { ...b.details[0], tables: { ...b.details[0].tables, cds_aid: { rows: [] } } } as unknown as SchoolDetail;
  const docs = baseDocuments({ ...b, details: [withAid] });
  assert.equal(JSON.stringify(docs.get(COLLECTIONS.base.detail)!.get(withAid.unit_id)), JSON.stringify(b.details[0]), "the CDS aid table is the compose's");
  const rows = baseDocuments({ ...b, aliases: [{ unit_id: "221999", alias: "Vandy", source: "common-app" } as never] }).get(COLLECTIONS.base.aliases)!.get(SINGLE_KEYS.aliases);
  assert.deepEqual(rows, [], "Common App's alias rows are added at compose");
});

test("sync-data --out: the publisher's compose over the new base laid on the store gives the same colleges as the store alone", async () => {
  const b = await miniBase();
  const docs = baseDocuments(b);
  const today = "2026-10-31";
  const over = composeSnapshot(await loadPublishLayers(overlayStore(b.store, docs)), { previous: miniSchools(), today, trends: false });
  const plain = composeSnapshot(await loadPublishLayers(b.store), { previous: miniSchools(), today, trends: false });
  assert.deepEqual(over.problems, []);
  assert.equal(JSON.stringify(over.schools), JSON.stringify(plain.schools));
  assert.equal(JSON.stringify(over.meta), JSON.stringify(plain.meta));
  const script = readFileSync(join(ROOT, "scripts", "sync-data.mts"), "utf8");
  for (const gone of ["applyCommonApp(", "applyCoalition(", "applyEssays(", "mergeReported(", "applyDirectoryLayers(", "buildSelectivity(", "runSiteProbe("]) assert.ok(!script.includes(gone), `sync-data no longer calls ${gone}`);
  assert.match(script, /openProducerRun\(store, "sync-data"/);
});

/* ------------------------------------------------------------------ */
/* The workflows                                                        */
/* ------------------------------------------------------------------ */

const workflow = (name: string) => readFileSync(join(ROOT, ".github", "workflows", name), "utf8");
// essay-prompts.yml isn't part of this round's fix (Finding 1 doesn't name it) and keeps its own, older dispatch
// guard (just the sync step's exit code); the files this round touches gate the dispatch on the secrets check too,
// so a run that skipped cleanly (secrets unset) never asks the publisher for anything.
const DISPATCH_PLAIN = /- name: Ask for a snapshot\n\s+if: steps\.sync\.outputs\.exit_code == '0'\n\s+env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n\s+run: gh api repos\/\$\{\{ github\.repository \}\}\/dispatches -f event_type=publish-snapshot\n/;
const DISPATCH =
  /- name: Ask for a snapshot\n\s+if: steps\.secrets\.outputs\.ready == 'true' && steps\.sync\.outputs\.exit_code == '0'\n\s+env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n\s+run: gh api repos\/\$\{\{ github\.repository \}\}\/dispatches -f event_type=publish-snapshot\n/;

/**
 * The "Check the …secrets" step's own script (just its body, not the rest of the job): every data workflow skips
 * cleanly with an `::notice::` and `ready=false` when a required secret is unset, never `::error::`/`exit 1`
 * (that would fail the job instead of skipping it). See publish-snapshot.yml and college-reported.yml, the pattern
 * this follows.
 */
function secretsCheckStep(yml: string): string {
  const m = /- name: Check[^\n]*\n\s+id: secrets\n\s+run: \|\n([\s\S]*?)\n {6}- /.exec(yml);
  assert.ok(m, "no 'Check …secrets' step with id: secrets");
  return m![1];
}

/** Every required secret this step checks gets its own `::notice::` naming it and sets `ready=false`; no `exit 1`. */
function assertSkipsCleanly(yml: string, name: string, requiredSecrets: readonly string[]): void {
  const step = secretsCheckStep(yml);
  assert.doesNotMatch(step, /::error::/, `${name}: the secrets check must not use ::error:: (that fails the job)`);
  assert.doesNotMatch(step, /exit 1\b/, `${name}: the secrets check must not exit 1 (that fails the job)`);
  assert.match(step, /echo "ready=true" >> "\$GITHUB_OUTPUT"/, `${name}: sets ready=true when everything is set`);
  for (const secret of requiredSecrets) {
    assert.match(step, new RegExp(`::notice::[^\\n]*${secret}[^\\n]*\\n\\s+echo "ready=false" >> "\\$GITHUB_OUTPUT"`), `${name}: a missing ${secret} gets a notice and ready=false`);
  }
}

test("workflows: no commit, no PR, no release note; the data project's secrets; the snapshot asked for only after a clean run", () => {
  for (const name of ["essay-prompts.yml", "common-app.yml", "coalition.yml", "sync-history.yml", "sync-data.yml", "hs-profile-pilot.yml"]) {
    const yml = workflow(name);
    assert.doesNotMatch(yml, /git (add|commit|push|checkout -b)|gh pr |release-notes\/|merge-(essay-prompts|common-app|coalition)|build-trends|check:lineage/, `${name}: no data PR tail`);
    assert.match(yml, /DATA_SUPABASE_URL: \$\{\{ secrets\.DATA_SUPABASE_URL \|\| secrets\.PROD_SUPABASE_URL \}\}/, name);
    assert.match(yml, /DATA_SUPABASE_SECRET_KEY: \$\{\{ secrets\.DATA_SUPABASE_SECRET_KEY \|\| secrets\.PROD_SUPABASE_SECRET_KEY \}\}/, name);
    assert.match(yml, /--store supabase/, name);
    assert.match(yml, /^ {6}request_id:\n/m, `${name}: the console can find its run`);
    assert.ok(!/\t/.test(yml), `${name}: no tabs`);
    if (name !== "hs-profile-pilot.yml") {
      assert.match(yml, name === "essay-prompts.yml" ? DISPATCH_PLAIN : DISPATCH, `${name}: the dispatch, guarded`);
      assert.match(yml, /^permissions:\n {2}contents: write\n/m, `${name}: the token may send the dispatch`);
    }
    const requiredSecrets =
      name === "sync-data.yml"
        ? ["DATA_SUPABASE_URL or DATA_SUPABASE_SECRET_KEY", "COLLEGE_SCORECARD_API_KEY"]
        : name === "sync-history.yml"
          ? ["DATA_SUPABASE_URL or DATA_SUPABASE_SECRET_KEY", "COLLEGE_SCORECARD_API_KEY"]
          : name === "hs-profile-pilot.yml"
            ? ["ANTHROPIC_API_KEY", "DATA_SUPABASE_URL or DATA_SUPABASE_SECRET_KEY"]
            : name === "essay-prompts.yml"
              ? null // essay-prompts.yml follows its own established pattern (exit 2/3), checked separately above
              : ["DATA_SUPABASE_URL or DATA_SUPABASE_SECRET_KEY"];
    if (requiredSecrets) assertSkipsCleanly(yml, name, requiredSecrets);
  }
  // Exit 2 (held) and 3 (stopped) end the essays step cleanly but leave exit_code non-zero, so no snapshot is asked for.
  assert.match(workflow("essay-prompts.yml"), /if \[ "\$code" = "2" \]; then .*exit 0; fi\n\s+if \[ "\$code" = "3" \]; then .*exit 0; fi/);
  assert.match(workflow("sync-history.yml"), /^ {2}schedule:\n {4}- cron: "0 9 3 \* \*"/m, "monthly");
  const sync = workflow("sync-data.yml");
  assert.match(sync, /^ {6}releases-only:\n {8}description: .*\n {8}type: boolean/m);
  assert.match(sync, /RELEASES_ONLY: \$\{\{ \(github\.event_name == 'schedule' \|\| inputs\.releases-only\) && 'true' \|\| 'false' \}\}/, "the weekly run checks the calendar only");
  assert.match(sync, /npm run sync-data -- --store supabase --releases-only/);
  for (const [name, mode] of [["common-app.yml", "workflow_dispatch"], ["coalition.yml", "workflow_dispatch"]]) assert.match(workflow(name), new RegExp(`^on:\\n {2}${mode}:`, "m"));
});

test("workflows: the profile pilot shares one change set across its three steps and closes it held, so a pilot waits for a look", () => {
  const yml = workflow("hs-profile-pilot.yml");
  assert.match(yml, /node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\/data-change-set\.mts open --kind pipeline --source high-schools --run-ref "\$GITHUB_RUN_ID"/);
  assert.equal(yml.match(/npm run sync-hs-profiles -- --store supabase --change-set "\$SET"/g)?.length, 4, "every invocation joins the set");
  assert.match(yml, /if: always\(\) && steps\.set\.outputs\.id != ''/);
  assert.match(yml, /scripts\/data-change-set\.mts close --id "\$SET" --status held --reason "\$reason"/);
  assert.doesNotMatch(yml, /event_type=publish-snapshot/, "a held pilot asks for no snapshot");
  assert.doesNotMatch(yml, /Refuse to run on main/, "it commits nothing, so any branch may run it");
});

test("retired: the nightly hand-read export and its workflow; build-trends is no step of these workflows", () => {
  assert.equal(existsSync(join(ROOT, ".github", "workflows", "essay-confirmed.yml")), false);
  assert.equal(existsSync(join(ROOT, "scripts", "export-essay-confirmed.mts")), false);
  for (const f of readdirSync(join(ROOT, ".github", "workflows"))) assert.doesNotMatch(readFileSync(join(ROOT, ".github", "workflows", f), "utf8"), /npm run export-essay-confirmed/, f);
  for (const f of ["essay-prompts.yml", "common-app.yml", "coalition.yml", "sync-history.yml", "sync-data.yml", "hs-profile-pilot.yml"]) assert.doesNotMatch(workflow(f), /build-trends/, f);
  assert.ok(existsSync(join(ROOT, "scripts", "build-trends.mts")), "the script stays for a local look");
});
