/**
 * The method guard (specs/chances/selectivity-history.md, Decision 4): a frozen sample of colleges' raw figures and the
 * scores and tiers SELECTIVITY_METHOD gives them, in data/reference/selectivity-method.json. The figures never change
 * with data runs, so the only thing that can move the sample's scores is the method itself: when they move and the
 * method string doesn't, `npm run check:selectivity` fails. Pure apart from the file read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../lib/types";
import { SELECTIVITY_METHOD, collegeIndex, rawInputs, scales, selectivityTier, topBand, type RawInputs } from "../../lib/selectivity.ts";

export const METHOD_SAMPLE_FILE = "data/reference/selectivity-method.json";

/** Colleges always in the sample: UT Austin (three pools), Harvard (the top band), MIT, a college with no SAT. */
const ALWAYS = ["228778", "166027", "166683"];
/** Every Nth college by unit id, so the sample spans the tiers. */
const EVERY = 20;

export interface MethodSample {
  method: string;
  inputs: Record<string, RawInputs>;
  expected: Record<string, { all: number | null; in_state?: number | null; out_of_state?: number | null; tier: string | null; band: string | null }>;
}

/** The scores and plain tiers (no hysteresis) the current method gives the frozen figures. */
export function scoreSample(inputs: Record<string, RawInputs>): MethodSample["expected"] {
  const ids = Object.keys(inputs).sort();
  const sc = scales(ids.map((id) => inputs[id]));
  const out: MethodSample["expected"] = {};
  for (const id of ids) {
    const idx = collegeIndex(inputs[id], sc);
    const tier = selectivityTier(idx.all, null);
    out[id] = { ...idx, tier, band: topBand(idx.all, tier, null) };
  }
  return out;
}

/** A new sample from the dataset, scored with the current method (`npm run selectivity-method-sample`). */
export function buildMethodSample(schools: readonly School[]): MethodSample {
  const sorted = [...schools].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  const picked = new Set([...ALWAYS.filter((id) => sorted.some((s) => s.unit_id === id)), ...sorted.filter((_, i) => i % EVERY === 0).map((s) => s.unit_id)]);
  const inputs = Object.fromEntries(sorted.filter((s) => picked.has(s.unit_id)).map((s) => [s.unit_id, rawInputs(s)]));
  return { method: SELECTIVITY_METHOD, inputs, expected: scoreSample(inputs) };
}

export function readMethodSample(root: string): MethodSample | null {
  const p = join(root, METHOD_SAMPLE_FILE);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as MethodSample) : null;
}

/** Problems: the sample is missing, its method isn't the current one, or the current method scores it differently. */
export function methodProblems(sample: MethodSample | null): string[] {
  if (!sample) return [`${METHOD_SAMPLE_FILE} is missing: run npm run selectivity-method-sample`];
  const now = scoreSample(sample.inputs);
  const moved = Object.keys(sample.expected).filter((id) => JSON.stringify(now[id]) !== JSON.stringify(sample.expected[id]));
  if (sample.method !== SELECTIVITY_METHOD) {
    return [`${METHOD_SAMPLE_FILE} was scored with method ${sample.method}, but SELECTIVITY_METHOD is ${SELECTIVITY_METHOD}: run npm run selectivity-method-sample`];
  }
  if (moved.length) {
    return [
      `The selectivity method scores ${moved.length} sample colleges differently (${moved.slice(0, 3).join(", ")}) while SELECTIVITY_METHOD is still ${SELECTIVITY_METHOD}: bump SELECTIVITY_METHOD in lib/selectivity.ts, then run npm run selectivity-method-sample and npm run build-selectivity`,
    ];
  }
  return [];
}

export function formatMethodSample(sample: MethodSample): string {
  const ids = Object.keys(sample.inputs).sort();
  const block = (o: Record<string, unknown>) => ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(o[id])}`).join(",\n");
  return `{\n  "method": ${JSON.stringify(sample.method)},\n  "inputs": {\n${block(sample.inputs)}\n  },\n  "expected": {\n${block(sample.expected)}\n  }\n}\n`;
}
