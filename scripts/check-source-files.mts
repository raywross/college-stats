/**
 * Fails when a file named in data/meta.json has no entry in data/source-files.json, so a sync that brings in a new
 * file can't merge without its published date. No network. Part of `npm run verify`. Fix: `npm run source-files`,
 * then commit the file.
 *
 *   npm run check:source-files
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFileRefs, undatedFiles, type SourceFilesRecord } from "../lib/admin/source-files.ts";
import type { DatasetMeta } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const path = join(ROOT, "data", "source-files.json");
if (!existsSync(path)) {
  console.error("data/source-files.json does not exist. Run `npm run source-files` and commit the file.");
  process.exit(1);
}
const meta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;
const record = JSON.parse(readFileSync(path, "utf8")) as SourceFilesRecord;
const missing = undatedFiles(sourceFileRefs(meta), record);
if (missing.length) {
  console.error(`data/source-files.json has no entry for ${missing.map((m) => m.file).join(", ")}.`);
  console.error("Run `npm run source-files` and commit data/source-files.json.");
  process.exit(1);
}
console.log("data/source-files.json: ok");
