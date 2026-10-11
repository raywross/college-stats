/**
 * Reading and writing the pipeline's committed files (shapes in lib/reported.ts). Lists are written one entry per
 * line, sorted by college, like data/schools.json, so a run's PR diff shows exactly which colleges changed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReportedFile, ReviewQueueFile, RunSummary, SourcesFile } from "../../../lib/reported.ts";
import { federalYears } from "../../../lib/newest-groups.ts";
import type { VintageKey } from "../../../lib/fields.ts";
import type { DatasetMeta } from "../../../lib/types";

export interface DataPaths {
  sources: string;
  reported: string;
  queue: string;
  reports: string;
}

export function dataPaths(root: string): DataPaths {
  return {
    sources: join(root, "data", "college-sources.json"),
    reported: join(root, "data", "college-reported.json"),
    queue: join(root, "data", "review-queue.json"),
    reports: join(root, "data", "reports"),
  };
}

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

/** data/reports/college-reported-run-<run>.json (colons in an ISO run id become dashes in the file name). */
export function writeRunSummary(dir: string, summary: RunSummary): string {
  const file = join(dir, `college-reported-run-${summary.run.replace(/[:]/g, "-")}.json`);
  write(file, `${JSON.stringify(summary, null, 2)}\n`);
  return file;
}

/**
 * The entering fall of the federal graduation class (`meta.vintages["ipeds-gr"]`, "Entered fall 2018" → 2018), which
 * the CDS checks need to know which B4–B21 grid holds that class (lib/cds-checks.ts `CheckContext.gradYear`). Null
 * when data/meta.json is missing or names no year: the grids are then not compared with federal data.
 */
export function federalGradYear(root: string): number | null {
  const meta = readJson<{ vintages?: Partial<Record<VintageKey, string>> }>(join(root, "data", "meta.json"), {});
  return federalYears({ vintages: meta.vintages ?? {} } as Pick<DatasetMeta, "vintages">).graduation;
}
