/**
 * The mini fixture (scripts/build-mini-fixture.mts; specs/data-platform/git-ci-tests.md "The mini fixture"): the
 * builder run over the fixture's own snapshot folder and layers store reproduces `tests/fixtures/snapshot-mini/` file
 * for file and byte for byte (self-consistency, offline: no real data, no database), so a change to the builder or a
 * hand edit to the fixture can't drift one from the other; a rebuild from the real snapshot and store is
 * `npm run build-mini-fixture -- --store supabase` after `npm run fetch-snapshot`. Also: building is deterministic,
 * the fixture is real (every chosen college appears, with the right shape), under budget in colleges, and the helpers
 * (tests/helpers/snapshot.mts) read it correctly. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build as buildFrom, DEFAULT_UNITS, sampleCsv, type BuildOptions } from "../scripts/build-mini-fixture.mts";
import { readLayer, COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { miniLayers, miniMeta, miniSchool, miniSchools, miniSnapshotDir } from "./helpers/snapshot.mts";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "snapshot-mini");

/** The builder over the fixture's own two folders (`--snapshot …/snapshot --store file:…/layers`). */
const build = (opts: BuildOptions = {}) => buildFrom({ snapshot: join(FIXTURE_DIR, "snapshot"), store: `file:${join(FIXTURE_DIR, "layers")}`, ...opts });

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
}

test("the builder over the fixture's own snapshot folder and layers store reproduces the fixture", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dp-mini-fixture-"));
  try {
    await build({ out: tmp });
    for (const sub of ["layers", "snapshot"]) {
      const want = filesUnder(join(FIXTURE_DIR, sub));
      const got = filesUnder(join(tmp, sub));
      assert.deepEqual(got, want, `${sub}: file list differs`);
      for (const f of want) {
        const a = readFileSync(join(FIXTURE_DIR, sub, f));
        const b = readFileSync(join(tmp, sub, f));
        assert.ok(a.equals(b), `${sub}/${f} differs from the builder's output over the fixture's own folders: fix the builder (scripts/build-mini-fixture.mts), never the fixture`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("building twice gives identical bytes (determinism)", async () => {
  const a = mkdtempSync(join(tmpdir(), "dp-mini-fixture-a-"));
  const b = mkdtempSync(join(tmpdir(), "dp-mini-fixture-b-"));
  try {
    await build({ out: a });
    await build({ out: b });
    for (const sub of ["layers", "snapshot"]) {
      const filesA = filesUnder(join(a, sub));
      assert.deepEqual(filesUnder(join(b, sub)), filesA);
      for (const f of filesA) assert.ok(readFileSync(join(a, sub, f)).equals(readFileSync(join(b, sub, f))), `${sub}/${f}`);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("under budget: fewer than 40 colleges, named coverage present", () => {
  assert.ok(DEFAULT_UNITS.length < 40);
  const schools = miniSchools();
  assert.equal(schools.length, DEFAULT_UNITS.length);
  for (const id of DEFAULT_UNITS) assert.ok(schools.some((s) => s.unit_id === id), `missing ${id}`);
});

test("miniSchool/miniSchools read the snapshot's composed colleges", () => {
  const vanderbilt = miniSchool("221999");
  assert.equal(vanderbilt?.name, "Vanderbilt University");
  assert.equal(miniSchool("000000"), undefined);
});

test("miniMeta reads the snapshot's meta.json", () => {
  const meta = miniMeta();
  assert.ok(meta.retrieved);
});

test("miniLayers opens the mini fixture's layers as a DataStore", async () => {
  const store = miniLayers();
  const base = await readLayer<{ unit_id: string }>(store, COLLECTIONS.base.colleges);
  assert.equal(base.size, DEFAULT_UNITS.length);
  for (const id of DEFAULT_UNITS) assert.ok(base.has(id), `base.colleges missing ${id}`);
});

test("the four CDS academics colleges keep their real CDS record; the rest don't", async () => {
  const store = miniLayers();
  const cds = await readLayer(store, COLLECTIONS.reported.cdsRecords);
  for (const id of ["221999", "190415", "231624", "145637"]) assert.ok(cds.has(id), `cds record missing for ${id}`);
  for (const id of DEFAULT_UNITS) if (!["221999", "190415", "231624", "145637"].includes(id)) assert.ok(!cds.has(id), `unexpected cds record for ${id}`);
});

test("exactly two high-school state shards, the two smallest real ones", async () => {
  const store = miniLayers();
  const states = await readLayer(store, COLLECTIONS.highSchools.state);
  assert.deepEqual([...states.keys()].sort(), ["ct", "sc"]);
});

test("the snapshot folder has a manifest with id 0 and this many colleges", () => {
  const manifest = JSON.parse(readFileSync(join(miniSnapshotDir(), "manifest.json"), "utf8")) as { id: number; colleges: number };
  assert.equal(manifest.id, 0);
  assert.equal(manifest.colleges, DEFAULT_UNITS.length);
});

test("the ZIP sample is idempotent: a national table is sampled, an already-sampled one is kept", () => {
  const rows = (n: number) => ["# note", "zcta,lat,lon", ...Array.from({ length: n }, (_, i) => `${String(i).padStart(5, "0")},1,2`)].join("\n") + "\n";
  const once = sampleCsv(rows(3000));
  assert.equal(once.split("\n").filter((l) => /^\d/.test(l)).length, 10);
  assert.equal(sampleCsv(once), once);
});

test("--add includes an extra college", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dp-mini-fixture-add-"));
  try {
    const { units } = await build({ units: new Set([...DEFAULT_UNITS, "198419"]), out: tmp });
    assert.ok(units.has("198419"));
    const schools = JSON.parse(readFileSync(join(tmp, "snapshot", "colleges.json"), "utf8")) as { unit_id: string }[];
    assert.ok(schools.some((s) => s.unit_id === "198419"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// A path check, not a content one: relative() guards against the drift test ever comparing a fixture to itself.
test("the fixture dir used here is tests/fixtures/snapshot-mini", () => {
  assert.equal(relative(import.meta.dirname, FIXTURE_DIR), join("fixtures", "snapshot-mini"));
});
