/**
 * Dates every published file the dataset is built from (specs/product/admin-health-views.md "When a file was
 * published"): a HEAD request per file, its `Last-Modified` date recorded for the Health page's Files view.
 * `npm run sync-data -- --store …` runs `datedSourceFiles` itself and writes the record as `base.source_files`
 * (specs/data-platform/pipelines.md); this CLI rewrites data/source-files.json from data/meta.json, for the files
 * still in the repository. `npm run check:source-files` fails while a file is undated.
 *
 *   npm run source-files
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lastModifiedDate, sourceFileRefs, type SourceFilesRecord } from "../lib/admin/source-files.ts";
import type { DatasetMeta } from "../lib/types.ts";

/** One HEAD request per file named in `meta`; a file that fails is recorded with status 0 and no date. */
export async function datedSourceFiles(meta: DatasetMeta, opts: { fetch?: typeof fetch; today?: string; log?: (line: string) => void } = {}): Promise<SourceFilesRecord> {
  const get = opts.fetch ?? globalThis.fetch;
  const log = opts.log ?? (() => {});
  const out: SourceFilesRecord = { checked: opts.today ?? new Date().toISOString().slice(0, 10), files: {} };
  for (const ref of sourceFileRefs(meta)) {
    if (out.files[ref.file]) continue;
    let status = 0;
    let published: string | null = null;
    try {
      const res = await get(ref.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) });
      status = res.status;
      published = res.ok ? lastModifiedDate(res.headers.get("last-modified")) : null;
    } catch (err) {
      log(`  ${ref.file}: ${(err as Error).message}`);
    }
    out.files[ref.file] = { source: ref.source, url: ref.url, published, status };
    log(`${ref.file.padEnd(48)} ${status || "error"} ${published ?? "no date"}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ROOT = join(import.meta.dirname, "..");
  const meta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;
  const out = await datedSourceFiles(meta, { log: (l) => console.log(l) });
  writeFileSync(join(ROOT, "data", "source-files.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote data/source-files.json (${Object.keys(out.files).length} files).`);
}
