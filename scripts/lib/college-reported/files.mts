/**
 * Reading and writing the pipeline's files in the old layout (shapes in lib/reported.ts), at paths a caller names:
 * the tests' scratch folders and the import's (scripts/import-data-from-files.mts) fixtures. Lists are written one
 * entry per line, sorted by college. The pipeline itself reads and writes the store (./state.mts).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReportedFile, ReviewQueueFile, RunSummary, SourcesFile } from "../../../lib/reported.ts";
import { federalYears } from "../../../lib/newest-groups.ts";
import type { VintageKey } from "../../../lib/fields.ts";
import type { DatasetMeta } from "../../../lib/types";

function readJson<T>(file: string, empty: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : empty;
}

export const readSources = (file: string) => readJson<SourcesFile>(file, { updated: "", recipes: [] });
export const readReported = (file: string) => readJson<ReportedFile>(file, { updated: null, entries: [] });
export const readQueue = (file: string) => readJson<ReviewQueueFile>(file, { updated: "", items: [] });

/** `{ "updated": …, "<key>": [\n  {one item per line},\n  …\n] }` */
export function linesJson(updated: string | null, key: string, items: unknown[]): string {
  const body = items.map((it) => `    ${JSON.stringify(it)}`).join(",\n");
  return `{\n  "updated": ${JSON.stringify(updated)},\n  "${key}": [${items.length ? `\n${body}\n  ` : ""}]\n}\n`;
}

const byUnit = <T extends { unit_id: string }>(a: T, b: T) => (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0);

/** Writes to a temporary file, then renames it over the target, so a run cancelled mid-write never leaves half a file. */
function write(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function writeSources(file: string, f: SourcesFile) {
  write(file, linesJson(f.updated, "recipes", [...f.recipes].sort(byUnit)));
}
export function writeReported(file: string, f: ReportedFile) {
  write(file, linesJson(f.updated, "entries", [...f.entries].sort(byUnit)));
}
export function writeQueue(file: string, f: ReviewQueueFile) {
  write(file, linesJson(f.updated, "items", [...f.items].sort(byUnit)));
}

/** `<dir>/college-reported-run-<run>.json` (colons in an ISO run id become dashes in the file name). */
export function writeRunSummary(dir: string, summary: RunSummary): string {
  const file = join(dir, `college-reported-run-${summary.run.replace(/[:]/g, "-")}.json`);
  write(file, `${JSON.stringify(summary, null, 2)}\n`);
  return file;
}

/**
 * The entering fall of the federal graduation class (`meta.vintages["ipeds-gr"]`, "Entered fall 2018" → 2018), which
 * the CDS checks need to know which B4–B21 grid holds that class (lib/cds-checks.ts `CheckContext.gradYear`), from a
 * dataset meta (`base.meta`, or the bundled copy's). Null when there is no meta or it names no year: the grids are
 * then not compared with federal data.
 */
export function federalGradYear(meta: { vintages?: Partial<Record<VintageKey, string | null>> } | null): number | null {
  return federalYears({ vintages: meta?.vintages ?? {} } as Pick<DatasetMeta, "vintages">).graduation;
}
