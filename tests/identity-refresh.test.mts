/**
 * The identity refresh on the data store: the due check (scripts/identity-refresh.mts), the identity producers'
 * writes (scripts/lib/identity-store.mts: sync-wikidata, sync-brand; the probe's are in tests/site-probe.test.mts), and
 * the workflow (.github/workflows/identity-refresh.yml): one change set opened first and closed last, no commit or
 * pull request, the publish dispatch only when the set closed applied. File store only. `npm test`. See
 * specs/school-identity/follow-ups.md, "The monthly refresh", and specs/data-platform/pipelines.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrandColorEntry, WikidataEntry } from "../lib/identity-files";
import { MIN_REFRESH_DAYS, newestRetrieved, refreshDue } from "../scripts/identity-refresh.mts";
import { fileStore, fileStoreChangeSets } from "../scripts/lib/data-platform/store.mts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { readBrandColors, readWikidata, writeBrandColors, writeBrandLogos, writeWikidata, readBrandLogos } from "../scripts/lib/identity-store.mts";
import type { WikidataIssue } from "../scripts/lib/wikidata.mts";
import { importLayers, writeImport } from "../scripts/import-data-from-git.mts";

const ROOT = join(import.meta.dirname, "..");
const UNITS = new Set(["139959", "221999", "166027", "100654", "228778"]);
const IDENTITY = [
  COLLECTIONS.identity.wikidata,
  COLLECTIONS.identity.wikidataIssues,
  COLLECTIONS.identity.probe,
  COLLECTIONS.identity.linkIssues,
  COLLECTIONS.identity.brandColors,
  COLLECTIONS.identity.brandLogos,
  COLLECTIONS.identity.brandOverrides,
];

/** A file store holding the committed identity files for a few colleges, keyed by the import. */
async function importedIdentity(): Promise<{ root: string; store: ReturnType<typeof fileStore> }> {
  const root = mkdtempSync(join(tmpdir(), "identity-store-"));
  const store = fileStore(root);
  await writeImport(store, importLayers(ROOT, { only: new Set(IDENTITY), units: UNITS }), "fixture");
  return { root, store };
}

/* ------------------------------------------------------------------ */
/* due                                                                 */
/* ------------------------------------------------------------------ */

test("refreshDue is the spec's 28-day rule: not due at 27 days, due at 28", () => {
  assert.equal(MIN_REFRESH_DAYS, 28);
  assert.equal(refreshDue([{ retrieved: "2026-09-07" }], "2026-10-04"), false); // 27 days old
  assert.equal(refreshDue([{ retrieved: "2026-09-06" }], "2026-10-04"), true); // 28 days old
});

test("refreshDue is true with no entries (an empty probe has never run)", () => {
  assert.equal(refreshDue([], "2026-10-04"), true);
  assert.equal(newestRetrieved([]), null);
});

test("refreshDue goes by the newest retrieved date among several entries, not the oldest", () => {
  const entries = [{ retrieved: "2026-08-01" }, { retrieved: "2026-09-10" }, { retrieved: "2026-09-01" }];
  assert.equal(newestRetrieved(entries), "2026-09-10");
  assert.equal(refreshDue(entries, "2026-10-04"), false); // newest is 24 days old
  assert.equal(refreshDue(entries, "2026-10-08"), true); // newest is 28 days old
});

test("`due` reads the probe layer from the store (--store file:<dir>), and is due on an empty store", async () => {
  const { root, store } = await importedIdentity();
  const empty = mkdtempSync(join(tmpdir(), "identity-empty-"));
  try {
    const due = (dir: string, today: string) =>
      execFileSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "identity-refresh.mts"), "due", "--store", `file:${dir}`, "--today", today], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    const probe = [...(await store.read<{ retrieved: string }>(COLLECTIONS.identity.probe)).values()];
    const newest = newestRetrieved(probe)!;
    const day = (n: number) => new Date(Date.parse(`${newest}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    assert.equal(due(root, day(MIN_REFRESH_DAYS - 1)), "false\n");
    assert.equal(due(root, day(MIN_REFRESH_DAYS)), "true\n");
    assert.equal(due(empty, day(0)), "true\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* The producers' writes                                               */
/* ------------------------------------------------------------------ */

test("the identity writers key the committed files as the import does: writing them back writes nothing", async () => {
  const { root, store } = await importedIdentity();
  try {
    const issues = [...(await store.read<WikidataIssue[]>(COLLECTIONS.identity.wikidataIssues)).values()].flat();
    const handle = await store.open("pipeline", "identity-refresh", "resave");
    await writeWikidata(store, handle, await readWikidata(store), issues);
    await writeBrandColors(store, handle, await readBrandColors(store));
    await writeBrandLogos(store, handle, await readBrandLogos(store));
    await handle.close("applied");
    assert.ok((await readWikidata(store)).length >= 4, "the fixture has the colleges' Wikidata rows");
    assert.equal(fileStoreChangeSets(root).at(-1)!.summary.documents, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-wikidata's write replaces the layer: a college gone from Wikidata loses its document, issues group per college", async () => {
  const { root, store } = await importedIdentity();
  try {
    const entries = await readWikidata(store);
    const [dropped, ...kept] = entries;
    const changed: WikidataEntry = { ...kept[0], alt_labels: [...kept[0].alt_labels, "A new name"] };
    const issues: WikidataIssue[] = [
      { unit_id: changed.unit_id, network: "x", reason: "one" },
      { unit_id: changed.unit_id, network: "facebook", reason: "two" },
    ];
    const handle = await store.open("pipeline", "identity-refresh", "1");
    await writeWikidata(store, handle, [changed, ...kept.slice(1)], issues);
    await handle.close("applied");
    const after = await store.read<WikidataEntry>(COLLECTIONS.identity.wikidata);
    assert.equal(after.has(dropped.unit_id), false);
    assert.deepEqual(after.get(changed.unit_id)?.alt_labels.at(-1), "A new name");
    assert.deepEqual([...(await store.read<WikidataIssue[]>(COLLECTIONS.identity.wikidataIssues))], [[changed.unit_id, issues]]);
    const set = fileStoreChangeSets(root).at(-1)!;
    assert.deepEqual([set.source, set.summary.changed, set.summary.collections], ["identity-refresh", 1, [COLLECTIONS.identity.wikidata, COLLECTIONS.identity.wikidataIssues]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-brand --ids replaces only those colleges' colors (one with no colors this run loses its row); a full run replaces all", async () => {
  const { root, store } = await importedIdentity();
  try {
    const before = await readBrandColors(store);
    assert.ok(before.length >= 3, "the fixture has brand colors");
    const [a, b, c] = before;
    const recolored: BrandColorEntry = { ...a, colors: [...a.colors].reverse() };
    const h1 = await store.open("pipeline", "identity-refresh", "ids");
    await writeBrandColors(store, h1, [recolored], new Set([a.unit_id, b.unit_id]));
    await h1.close("applied");
    const mid = await store.read<BrandColorEntry>(COLLECTIONS.identity.brandColors);
    assert.deepEqual(mid.get(a.unit_id), recolored);
    assert.equal(mid.has(b.unit_id), false, "named, and no colors this run: removed");
    assert.deepEqual(mid.get(c.unit_id), c, "not named: kept");

    const h2 = await store.open("pipeline", "identity-refresh", "full");
    await writeBrandColors(store, h2, [c]);
    await h2.close("applied");
    assert.deepEqual([...(await store.read(COLLECTIONS.identity.brandColors)).keys()], [c.unit_id]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* The workflow                                                        */
/* ------------------------------------------------------------------ */

type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string };
interface Workflow {
  text: string;
  /** workflow_dispatch's inputs, by name, with their `default` as written. */
  inputs: Record<string, { default?: string }>;
  /** The (one) job's steps. */
  steps: Step[];
}

/** The parts of a workflow file the tests read: the dispatch inputs and the one job's steps (block or inline `run`). */
function workflow(file: string): Workflow {
  const text = readFileSync(join(ROOT, ".github", "workflows", file), "utf8");
  const lines = text.split("\n");
  const inputs: Workflow["inputs"] = {};
  const inputsAt = lines.findIndex((l) => l === "    inputs:");
  for (let i = inputsAt + 1, name = ""; inputsAt >= 0 && i < lines.length && /^ {6}\S|^ {8}/.test(lines[i]); i++) {
    const head = /^ {6}([a-z_]+):$/.exec(lines[i]);
    if (head) inputs[(name = head[1])] = {};
    const def = /^ {8}default: (.*)$/.exec(lines[i]);
    if (def && name) inputs[name].default = def[1].replace(/^"(.*)"$/, "$1");
  }
  const steps: Step[] = [];
  const stepsAt = lines.findIndex((l) => l === "    steps:");
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const step: Step = {};
    for (let i = 0; i < cur.length; i++) {
      const m = /^ {8}(name|id|if|uses|run): ?(.*)$/.exec(cur[i]);
      if (!m) continue;
      const key = m[1] as keyof Step;
      if (key === "run" && m[2] === "|") {
        const body: string[] = [];
        for (i++; i < cur.length && (/^ {10}/.test(cur[i]) || cur[i] === ""); i++) body.push(cur[i].slice(10));
        i--;
        step.run = body.join("\n");
      } else step[key] = m[2];
    }
    steps.push(step);
  };
  for (const line of lines.slice(stepsAt + 1)) {
    if (/^ {6}- /.test(line)) {
      flush();
      cur = [`        ${line.slice(8)}`];
    } else if (cur) cur.push(line);
  }
  flush();
  return { text, inputs, steps };
}

/** What a data workflow's steps must look like (specs/data-platform/pipelines.md; brief "The run's tail"). */
function dataWorkflowProblems(steps: readonly Step[], scripts: readonly string[]): string[] {
  const problems: string[] = [];
  const runs = steps.map((s) => s.run ?? "");
  for (const [i, r] of runs.entries()) {
    if (/\bgit (add|commit|push|checkout -b)\b/.test(r)) problems.push(`step ${i}: git writes`);
    if (/\bgh pr\b/.test(r)) problems.push(`step ${i}: opens or merges a pull request`);
    if (/release-note/.test(r)) problems.push(`step ${i}: writes a release note`);
  }
  const open = runs.findIndex((r) => /data-change-set\.mts open\b/.test(r));
  const close = steps.findIndex((s) => /data-change-set\.mts close\b/.test(s.run ?? ""));
  const dispatch = steps.findIndex((s) => /dispatches/.test(s.run ?? "") && /event_type=publish-snapshot/.test(s.run ?? ""));
  if (open < 0) problems.push("no change-set open step");
  if (close < 0) problems.push("no change-set close step");
  else if (!/always\(\)/.test(steps[close].if ?? "")) problems.push("the close step doesn't run after a failure");
  if (dispatch < 0) problems.push("no publish-snapshot dispatch");
  else {
    if (dispatch < close) problems.push("the dispatch comes before the close");
    if (!/steps\.close\.outputs\.status == 'applied'/.test(steps[dispatch].if ?? "")) problems.push("the dispatch isn't guarded by the set closing applied");
  }
  for (const script of scripts) {
    const at = runs.findIndex((r) => r.includes(script));
    if (at < 0) problems.push(`${script} doesn't run`);
    else {
      if (!/--store supabase/.test(runs[at])) problems.push(`${script} without --store supabase`);
      if (!/--change-set/.test(runs[at])) problems.push(`${script} doesn't write into the run's change set`);
      if (open >= 0 && at < open) problems.push(`${script} runs before the change set opens`);
      if (close >= 0 && at > close) problems.push(`${script} runs after the change set closes`);
    }
  }
  return problems;
}

test("identity-refresh.yml: one change set around the three scripts, no commit or PR, the dispatch only when applied", () => {
  const wf = workflow("identity-refresh.yml");
  const steps = wf.steps;
  assert.deepEqual(dataWorkflowProblems(steps, ["npm run sync-wikidata", "npm run probe-sites", "npm run sync-brand"]), []);
  assert.match(steps.find((s) => s.id === "sync_brand")!.run!, /--colors/, "colors only: the marks are files in the code");
  assert.match(steps.find((s) => s.id === "due")!.run!, /identity-refresh\.mts due --store supabase/);
  assert.deepEqual(Object.keys(wf.inputs).sort(), ["force", "request_id"]);
  assert.doesNotMatch(wf.text, /pull-requests:/);
  // The guard fails when the rule is broken.
  const commit = [...steps, { run: "git add data && git commit -m x" }];
  assert.deepEqual(dataWorkflowProblems(commit, []), [`step ${steps.length}: git writes`]);
  const unguarded = steps.map((s) => (/dispatches/.test(s.run ?? "") ? { ...s, if: "always()" } : s));
  assert.deepEqual(dataWorkflowProblems(unguarded, []), ["the dispatch isn't guarded by the set closing applied"]);
  const noSet = steps.map((s) => (s.id === "probe_sites" ? { ...s, run: "npm run probe-sites -- --store supabase" } : s));
  assert.deepEqual(dataWorkflowProblems(noSet, ["npm run probe-sites"]), ["npm run probe-sites doesn't write into the run's change set"]);
});

test("campus-pilot.yml: one change set around the pilot and its score, held unless `publish`, no commit", () => {
  const wf = workflow("campus-pilot.yml");
  const steps = wf.steps;
  assert.deepEqual(dataWorkflowProblems(steps, ["npm run campus-pilot", "npm run --silent score-campus-pilot"]), []);
  const close = steps.find((s) => s.id === "close")!.run!;
  assert.match(close, /--status held --reason "Campus-life pilot run/, "held for review by default");
  assert.match(close, /PUBLISH" = "true" \]; then\s+node [^\n]+--status applied/);
  assert.equal(wf.inputs.publish.default, "false");
});
