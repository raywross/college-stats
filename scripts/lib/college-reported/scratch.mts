/**
 * A scratch folder in the old file layout for one college's CDS documents, seeded from the data store and written
 * back as one change set: how the manual tools that edit a record, the docs manifest and the owner's URL list
 * (scripts/archive-doc.mts, scripts/cds-records-from-workbooks.mts) run their file-based library code
 * (./archive-doc.mts, ./records.mts) against the store, the pattern high schools use (pipelines.md "As built").
 *
 * Seeded: `college-docs.json` (every `reported.docs` document; the manifest is checked by sha256 across colleges),
 * `cds-records/<unit>.json` (the college's record), `reference/cds-urls.json` (the reference document). Written back:
 * the college's record, its manifest documents that changed (only this college's: the tools touch nothing else), and the
 * URL list when it changed.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollegeRecord, ManifestEntry } from "../../../lib/cds-sections.ts";
import type { CdsUrlsFile } from "../../../lib/reported.ts";
import { COLLECTIONS, readLayer } from "../data-platform/layers.mts";
import { orderedJson, type DataStore } from "../data-platform/store.mts";
import { readManifest, readRecord, writeManifest, writeRecord } from "./records.mts";
import { recordBody } from "./state.mts";

export interface CdsScratch {
  /** The folder (holds college-docs.json, cds-records/, reference/cds-urls.json). */
  dir: string;
  /** Writes what changed back through one change set (kind pipeline, `source`) and removes the folder; returns its id, or null on a dry run. */
  commit(source: string, opts?: { dryRun?: boolean; note?: string }): Promise<number | null>;
  /** Removes the folder without writing anything. */
  discard(): void;
}

export async function cdsScratch(store: DataStore, unitId: string): Promise<CdsScratch> {
  const dir = mkdtempSync(join(tmpdir(), "cds-scratch-"));
  const docs = await readLayer<ManifestEntry>(store, COLLECTIONS.reported.docs);
  const header = (await store.readOne<{ updated?: string | null }>(COLLECTIONS.import.headers, "college-docs.json")) ?? {};
  writeManifest(join(dir, "college-docs.json"), { updated: header.updated ?? null, documents: [...docs.values()] });
  const record = await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, unitId);
  mkdirSync(join(dir, "cds-records"), { recursive: true });
  if (record) writeRecord(join(dir, "cds-records"), record);
  const urls = await store.readOne<CdsUrlsFile>(COLLECTIONS.reference.files, "cds-urls");
  mkdirSync(join(dir, "reference"), { recursive: true });
  const urlsFile = join(dir, "reference", "cds-urls.json");
  if (urls) writeFileSync(urlsFile, `${JSON.stringify(urls)}\n`);
  const urlsBefore = urls ? JSON.stringify(urls) : null;

  const discard = () => rmSync(dir, { recursive: true, force: true });
  return {
    dir,
    discard,
    async commit(source, opts = {}) {
      try {
        const after = readRecord(join(dir, "cds-records"), unitId);
        const manifest = readManifest(join(dir, "college-docs.json"));
        const urlsAfter = existsSync(urlsFile) ? (JSON.parse(readFileSync(urlsFile, "utf8")) as CdsUrlsFile) : null;
        if (opts.dryRun) return null;
        const handle = await store.open("pipeline", source, `${source}-${new Date().toISOString()}`, opts.note ? { note: opts.note } : undefined);
        if (after && JSON.stringify(recordBody(after)) !== JSON.stringify(record ? recordBody(record) : null)) await handle.write(COLLECTIONS.reported.cdsRecords, [{ key: unitId, body: recordBody(after) }]);
        // Only the documents whose content changed (the manifest writer reorders keys; the store compares orderedJson too).
        const changedDocs = manifest.documents.filter((d) => d.unit_id === unitId && (!docs.has(d.sha256) || orderedJson(docs.get(d.sha256)) !== orderedJson(d)));
        if (changedDocs.length) await handle.write(COLLECTIONS.reported.docs, changedDocs.map((d) => ({ key: d.sha256, body: d })));
        if (urlsAfter && JSON.stringify(urlsAfter) !== urlsBefore) await handle.write(COLLECTIONS.reference.files, [{ key: "cds-urls", body: urlsAfter }]);
        await handle.close("applied");
        return handle.id;
      } finally {
        discard();
      }
    },
  };
}
