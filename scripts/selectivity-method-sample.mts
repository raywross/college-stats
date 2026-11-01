/**
 * Builds the reference document `selectivity-method`: a frozen sample of colleges' raw figures and the scores the
 * current SELECTIVITY_METHOD gives them (scripts/lib/selectivity-method.mts), from the bundled copy's colleges (the
 * real snapshot, after `npm run fetch-snapshot`), and writes it to the data store in one change set (source
 * reference-build; scripts/lib/data-platform/reference-build.mts). Run it after bumping SELECTIVITY_METHOD, never to
 * quiet the guard without bumping it; the next publish carries it, and `npm run check:selectivity` reads it there.
 *
 *   npm run selectivity-method-sample -- --store supabase
 *   … --dry-run   build and compare, write nothing
 */
import { buildMethodSample, formatMethodSample, METHOD_SAMPLE_FILE, METHOD_SAMPLE_NAME, readMethodSample } from "./lib/selectivity-method.mts";
import { SELECTIVITY_METHOD } from "../lib/selectivity.ts";
import { bundledIsFixture, readBundledColleges } from "./lib/data-platform/bundled.mts";
import { writeReferenceDocument } from "./lib/data-platform/reference-build.mts";

const prior = readMethodSample();
if (prior && prior.method === SELECTIVITY_METHOD) {
  console.error(`${METHOD_SAMPLE_FILE} is already for method ${SELECTIVITY_METHOD}. Bump SELECTIVITY_METHOD in lib/selectivity.ts first.`);
  process.exit(1);
}
if (bundledIsFixture()) {
  console.error("The bundled copy is the mini fixture: the sample needs every college. Run `npm run fetch-snapshot` first.");
  process.exit(1);
}
const sample = buildMethodSample(readBundledColleges());
await writeReferenceDocument(METHOD_SAMPLE_NAME, JSON.parse(formatMethodSample(sample)));
console.log(`${METHOD_SAMPLE_FILE}: ${Object.keys(sample.inputs).length} colleges, method ${sample.method}`);
