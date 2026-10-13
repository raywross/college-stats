/**
 * Writes data/reference/selectivity-method.json: a frozen sample of colleges' raw figures and the scores the current
 * SELECTIVITY_METHOD gives them (scripts/lib/selectivity-method.mts). Run it after bumping SELECTIVITY_METHOD, never to
 * quiet the guard without bumping it.
 *
 *   npm run selectivity-method-sample
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { METHOD_SAMPLE_FILE, buildMethodSample, formatMethodSample, readMethodSample } from "./lib/selectivity-method.mts";
import { SELECTIVITY_METHOD } from "../lib/selectivity.ts";

const ROOT = join(import.meta.dirname, "..");
const prior = readMethodSample(ROOT);
if (prior && prior.method === SELECTIVITY_METHOD) {
  console.error(`${METHOD_SAMPLE_FILE} is already for method ${SELECTIVITY_METHOD}. Bump SELECTIVITY_METHOD in lib/selectivity.ts first.`);
  process.exit(1);
}
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const sample = buildMethodSample(schools);
writeFileSync(join(ROOT, METHOD_SAMPLE_FILE), formatMethodSample(sample));
console.log(`wrote ${METHOD_SAMPLE_FILE}: ${Object.keys(sample.inputs).length} colleges, method ${sample.method}`);
