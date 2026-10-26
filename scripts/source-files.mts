/**
 * Dates every published file the dataset is built from (specs/product/admin-health-views.md "When a file was
 * published"): a HEAD request per file, its `Last-Modified` date recorded in data/source-files.json for the Health
 * page's Files view. Run after `npm run sync-data`; `npm run check:source-files` fails while a file is undated.
 *
 *   npm run source-files
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lastModifiedDate, sourceFileRefs, type SourceFilesRecord } from "../lib/admin/source-files.ts";
import type { DatasetMeta } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const meta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;
const out: SourceFilesRecord = { checked: new Date().toISOString().slice(0, 10), files: {} };

for (const ref of sourceFileRefs(meta)) {
  if (out.files[ref.file]) continue;
  let status = 0;
  let published: string | null = null;
  try {
    const res = await fetch(ref.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) });
    status = res.status;
    published = res.ok ? lastModifiedDate(res.headers.get("last-modified")) : null;
  } catch (err) {
    console.error(`  ${ref.file}: ${(err as Error).message}`);
  }
  out.files[ref.file] = { source: ref.source, url: ref.url, published, status };
  console.log(`${ref.file.padEnd(48)} ${status || "error"} ${published ?? "no date"}`);
}

writeFileSync(join(ROOT, "data", "source-files.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote data/source-files.json (${Object.keys(out.files).length} files).`);
