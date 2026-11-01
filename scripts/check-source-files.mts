/**
 * Fails when a file named in the bundled copy's `meta.json` has no entry in its `source-files.json`
 * (`base.source_files`, rendered at the snapshot root), so a sync that brings in a new file can't publish without its
 * published date. No network. Part of `npm run verify` (over the mini fixture in CI, over the real snapshot locally
 * after `npm run fetch-snapshot`). Fix: `npm run source-files -- --store …`, which writes `base.source_files`.
 *
 *   npm run check:source-files
 */
import { sourceFileRefs, undatedFiles, type SourceFilesRecord } from "../lib/admin/source-files.ts";
import { SNAPSHOT_OBJECTS } from "../lib/data-platform/snapshot.ts";
import { readBundledJson, readBundledMeta } from "./lib/data-platform/bundled.mts";

const meta = readBundledMeta();
const record = readBundledJson<SourceFilesRecord>(SNAPSHOT_OBJECTS.sourceFiles);
const missing = undatedFiles(sourceFileRefs(meta), record);
if (missing.length) {
  console.error(`source-files.json has no entry for ${missing.map((m) => m.file).join(", ")}.`);
  console.error("Run `npm run source-files -- --store …` to date them in base.source_files, then publish.");
  process.exit(1);
}
console.log("source-files.json: ok");
