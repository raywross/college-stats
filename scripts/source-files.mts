/**
 * Dates every published file the dataset is built from (specs/product/admin-health-views.md "When a file was
 * published"): a HEAD request per file, its `Last-Modified` date recorded for the Health page's Files view.
 * `npm run sync-data -- --store …` runs `datedSourceFiles` itself and writes the record as `base.source_files`
 * (specs/data-platform/pipelines.md); this CLI dates the files `base.meta` names again and writes `base.source_files`
 * on its own, in one change set (source source-files; scripts/lib/data-platform/reference-build.mts), so a new file's
 * date can be recorded without a full sync. `npm run check:source-files` (over the bundled copy's `source-files.json`)
 * fails while a file is undated.
 *
 *   npm run source-files -- --store supabase           (--dry-run: date and compare, write nothing)
 */
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
  const { storeFromArgv } = await import("./lib/data-platform/producer.mts");
  const { COLLECTIONS, SINGLE_KEYS } = await import("./lib/data-platform/layers.mts");
  const { writeDocumentRun } = await import("./lib/data-platform/reference-build.mts");
  const meta = await storeFromArgv(process.argv.slice(2)).readOne<DatasetMeta>(COLLECTIONS.base.meta, SINGLE_KEYS.meta);
  if (!meta) throw new Error("source-files: the store has no base.meta (run npm run sync-data first)");
  const out = await datedSourceFiles(meta, { log: (l) => console.log(l) });
  console.log(`Dated ${Object.keys(out.files).length} files.`);
  await writeDocumentRun({ collection: COLLECTIONS.base.sourceFiles, key: SINGLE_KEYS.sourceFiles, body: out, source: "source-files" });
}
