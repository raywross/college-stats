/**
 * The publisher's gates beyond lineage (scripts/lib/data-platform/gates.mts; scripts/publish-snapshot.mts step 3) and
 * the scripts' reader of the bundled copy (scripts/lib/data-platform/bundled.mts), over the mini fixture: every
 * reference document runs through its own validator (lib/reference-validators.ts, the console editor's dispatch) and a
 * failure fails the publish with nothing uploaded, like lineage. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VALIDATED_REFERENCES, validateReference } from "../lib/reference-validators.ts";
import * as view from "../lib/admin/reference-view.ts";
import { cdsRecordsGate, overridesGate, referenceGate } from "../scripts/lib/data-platform/gates.mts";
import { COLLECTIONS, readLayer } from "../scripts/lib/data-platform/layers.mts";
import { fileStore } from "../scripts/lib/data-platform/store.mts";
import { EXIT, publishSnapshot, type PublishOptions } from "../scripts/publish-snapshot.mts";
import {
  NO_SNAPSHOT,
  bundledIsFixture,
  bundledUnitIdsForChecks,
  readBundledColleges,
  readBundledMeta,
  readBundledReference,
  readBundledReferenceText,
  readReferenceDocument,
} from "../scripts/lib/data-platform/bundled.mts";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import { miniLayers, miniSchools, miniSnapshotDir } from "./helpers/snapshot.mts";

const TODAY = "2026-10-31";
const LAYERS = join(import.meta.dirname, "fixtures", "snapshot-mini", "layers");
const reference = await readLayer<unknown>(miniLayers(), COLLECTIONS.reference.files);

test("the reference editor and the publisher share one dispatch (lib/admin/reference-view.ts re-exports it)", () => {
  assert.equal(view.validateReference, validateReference);
  assert.ok(VALIDATED_REFERENCES.includes("aid-policies"));
});

test("referenceGate: the mini fixture's reference documents pass their validators (membership off: the fixture holds 38 colleges)", () => {
  assert.deepEqual(referenceGate(reference, { today: TODAY }), []);
  for (const name of VALIDATED_REFERENCES) assert.ok(reference.has(name), `the fixture carries ${name}`);
});

test("referenceGate: membership against the composed colleges, a broken document, and a non-object each fail, named", () => {
  const ids = new Set(miniSchools().map((s) => s.unit_id));
  const withIds = referenceGate(reference, { today: TODAY, knownUnitIds: ids });
  assert.ok(withIds.some((p) => p.startsWith("reference aid-policies: ") && p.includes("isn't a college in the dataset")), "a policy for a college not composed");
  const broken = new Map(reference);
  broken.set("application-cycle", { cycles: "not a list" });
  broken.set("sports", "a string");
  const problems = referenceGate(broken, { today: TODAY });
  assert.ok(problems.some((p) => p.startsWith("reference application-cycle: ")), problems.join("\n"));
  assert.ok(problems.includes("reference sports: The document must be a JSON object or array."), problems.join("\n"));
});

test("cdsRecordsGate: skipped without the docs manifest; a record whose document isn't in it fails", async () => {
  const records = [...(await readLayer<CollegeRecord>(miniLayers(), COLLECTIONS.reported.cdsRecords)).values()];
  assert.ok(records.length > 0);
  assert.deepEqual(cdsRecordsGate(records, null), [], "the mini fixture leaves reported.docs out");
  assert.ok(cdsRecordsGate(records, []).some((p) => p.includes("isn't in")));
});

test("overridesGate: an override without its source is refused", () => {
  assert.deepEqual(overridesGate({}), []);
  assert.ok(overridesGate({ "221999": { admissions: { acceptance_rate: 0.1 } } }).length > 0);
});

const options = (dir: string, over: Partial<PublishOptions> = {}): PublishOptions & { lines: string[] } => {
  const lines: string[] = [];
  return {
    store: `file:${dir}`,
    dryRun: false,
    force: true,
    skipChangelog: true,
    skipTables: true,
    skipDeploy: true,
    previous: "none",
    today: TODAY,
    revalidateWaitS: 0,
    skipTrends: true,
    env: {},
    log: (l) => lines.push(l),
    lines,
    deps: { now: () => new Date("2026-10-31T08:00:00.000Z") },
    ...over,
  };
};

test("the publisher fails on a broken reference document, uploading nothing, and publishes once it is fixed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp-gates-"));
  try {
    cpSync(LAYERS, dir, { recursive: true });
    const store = fileStore(dir);
    const good = await store.readOne<unknown>(COLLECTIONS.reference.files, "guaranteed-admission");
    const h = await store.open("pipeline", "console", "edit-1");
    await h.write(COLLECTIONS.reference.files, [{ key: "guaranteed-admission", body: { cycle: 2027, programs: "none" } }]);
    await h.close("applied");
    const failing = options(dir);
    assert.equal(await publishSnapshot(failing), EXIT.failed);
    assert.ok(failing.lines.some((l) => l.includes("reference guaranteed-admission:")), failing.lines.join("\n"));
    assert.ok(!existsSync(join(dir, "_bucket")), "nothing uploaded");

    const fix = await store.open("pipeline", "console", "edit-2");
    await fix.write(COLLECTIONS.reference.files, [{ key: "guaranteed-admission", body: good }]);
    await fix.close("applied");
    const ok = options(dir);
    assert.equal(await publishSnapshot(ok), EXIT.ok, ok.lines.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--previous takes auto or none (git is gone with the files)", async () => {
  const { parseArgs } = await import("../scripts/publish-snapshot.mts");
  assert.equal(parseArgs(["--previous", "none"], {}).previous, "none");
  assert.throws(() => parseArgs(["--previous", "git"], {}), /expected auto or none/);
});

test("bundled.mts reads the bundled copy, and says the --ensure sentence when there is none", async () => {
  const dir = miniSnapshotDir();
  assert.equal(readBundledColleges(dir).length, miniSchools().length);
  assert.ok(readBundledMeta(dir).retrieved);
  assert.ok(Array.isArray(readBundledReference<{ policies: unknown[] }>("aid-policies", dir).policies));
  assert.ok(readBundledReference("essay-guidance/sources", dir));
  assert.match(readBundledReferenceText("zcta-centroids.csv", dir), /^zcta,lat,lng$/m);
  assert.equal(bundledIsFixture(dir), true);
  assert.equal(bundledUnitIdsForChecks(dir), undefined, "no membership over the fixture");
  const empty = mkdtempSync(join(tmpdir(), "dp-bundled-"));
  try {
    assert.throws(() => readBundledColleges(empty), (err: Error) => err.message.startsWith(NO_SNAPSHOT));
    // The store's document wins over the bundled copy's; the bundled one fills in when the store has none.
    assert.deepEqual(await readReferenceDocument({ readOne: async () => ({ from: "store" }) as never }, "aid-policies", dir), { from: "store" });
    assert.ok(await readReferenceDocument({ readOne: async () => null }, "aid-policies", dir));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
