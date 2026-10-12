/**
 * The estimate's server-side files never reach a browser bundle (specs/chances/README.md "Quad's estimate is
 * proprietary"; the brief's rule 9). Browser QA on 2026-10-12 found "hidden_odds" in a client chunk: the planner and
 * the standing card imported estimateInputFromProfile from lib/chances/snapshot.ts, which pulled the snapshot's
 * measurement-only columns along. That function now lives in lib/chances/estimate-input.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reachedFromClient, walk } from "./helpers/client-reach.mts";

const SERVER_ONLY = [
  "lib/chances/model.ts",
  "lib/chances/hooks.ts",
  "lib/chances/calibration.ts",
  "lib/chances/snapshot.ts",
  "lib/chances/snapshot-write.ts",
  "lib/chances/snapshot-deps.ts",
];

test("no client component reaches the model, hooks, calibration, or the snapshot code", () => {
  const files = new Map([...walk("components"), ...walk("app"), ...walk("lib")]);
  for (const f of SERVER_ONLY) assert.ok(files.has(f), f);
  assert.deepEqual(reachedFromClient(files, SERVER_ONLY), []);
});

test("the guard catches a client file importing the profile input from the snapshot file again", () => {
  const files = new Map<string, string>([
    ["lib/chances/snapshot.ts", 'export const COLUMNS = ["hidden_odds"];\nexport { estimateInputFromProfile } from "./estimate-input.ts";'],
    ["lib/chances/estimate-input.ts", "export const estimateInputFromProfile = 1;"],
    ["components/planner/Bad.tsx", '"use client";\nimport { estimateInputFromProfile } from "@/lib/chances/snapshot";'],
    ["components/planner/Fine.tsx", '"use client";\nimport { estimateInputFromProfile } from "@/lib/chances/estimate-input";'],
  ]);
  const found = reachedFromClient(files, ["lib/chances/snapshot.ts"]);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith("components/planner/Bad.tsx"));
});
