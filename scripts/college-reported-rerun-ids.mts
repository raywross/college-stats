/**
 * Lists the colleges to run again after the 2026-10-10 read fixes (release-notes/college-reported-reads.md), from the
 * committed data files and, optionally, a run's artifact (its college-sources.json, which can be newer than the
 * committed one):
 *
 *   node scripts/college-reported-rerun-ids.mts [--artifact <dir>] [--out <file>]
 *
 * Reasons, each a list of unit ids:
 * - `cds-no-edition`: a model-read CDS (PDF, older workbook, HTML) whose edition wasn't detected and that was never
 *   read. A plain run reads it now (the edition from the cover's years or the file name, else assumed).
 * - `class-profile-unread`: a class profile fetched (it has a sha256) and never extracted.
 * - `class-profile-pdf-misread`: a class-profile PDF "read" by decoding it as HTML. A plain run reads it again.
 * - `uri-malformed`: discovery failed with "URI malformed". These carry a back-off date (`next_attempt`), so a plain run
 *   skips them: run them with `--rediscover`.
 *
 * Writes { generated, sources, reasons, counts, rerun, rediscover } where `rerun` takes a plain run (`--college` per id)
 * and `rediscover` needs `--rediscover`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Recipe, SourcesFile } from "../lib/reported.ts";
import type { CollegeDocsFile, CollegeRecord } from "../lib/cds-sections.ts";
import { profileMisread } from "../lib/cds-reads.ts";

const ROOT = join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const read = <T,>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

const MODEL_READ = new Set(["pdf-flat", "xlsx-classic", "html"]);

export interface RerunList {
  generated: string;
  sources: string[];
  reasons: Record<string, string[]>;
  counts: Record<string, number>;
  rerun: string[];
  rediscover: string[];
}

export function rerunIds(o: { manifest: CollegeDocsFile; records: CollegeRecord[]; recipes: Recipe[][] }): Omit<RerunList, "generated" | "sources"> {
  const reasons: Record<string, Set<string>> = {
    "cds-no-edition": new Set(),
    "class-profile-unread": new Set(),
    "class-profile-pdf-misread": new Set(),
    "uri-malformed": new Set(),
  };
  const readShas = new Set(o.records.flatMap((r) => r.documents.filter((d) => Object.keys(d.reads ?? {}).length).map((d) => d.sha256)));
  for (const e of o.manifest.documents) {
    if (e.kind === "cds" && MODEL_READ.has(e.type) && !e.edition && e.edition_from !== "none" && !readShas.has(e.sha256)) reasons["cds-no-edition"].add(e.unit_id);
  }
  // The newest copy of each recipe wins (the artifact's over the committed one).
  const byId = new Map<string, Recipe>();
  for (const list of o.recipes) for (const r of list) byId.set(r.unit_id, r);
  for (const r of byId.values()) {
    for (const s of r.sources) {
      if (s.kind === "class-profile" && s.sha256 && s.extraction === undefined) reasons["class-profile-unread"].add(r.unit_id);
      if (s.kind === "class-profile" && s.sha256 && profileMisread(s)) reasons["class-profile-pdf-misread"].add(r.unit_id);
    }
    if (r.discovery?.tried.some((t) => /URI malformed/i.test(t.detail ?? ""))) reasons["uri-malformed"].add(r.unit_id);
  }
  const sorted = Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, [...v].sort()]));
  const rediscover = sorted["uri-malformed"];
  const rerun = [...new Set(Object.entries(sorted).filter(([k]) => k !== "uri-malformed").flatMap(([, v]) => v))].filter((id) => !rediscover.includes(id)).sort();
  return { reasons: sorted, counts: Object.fromEntries(Object.entries(sorted).map(([k, v]) => [k, v.length])), rerun, rediscover };
}

function main() {
  const artifact = arg("artifact");
  const out = arg("out");
  const manifest = read<CollegeDocsFile>(join(ROOT, "data", "college-docs.json"));
  const dir = join(ROOT, "data", "cds-records");
  const records = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => read<CollegeRecord>(join(dir, f)));
  const sources = [join(ROOT, "data", "college-sources.json")];
  if (artifact) sources.push(join(artifact, "college-sources.json"));
  const recipes = sources.filter((f) => existsSync(f)).map((f) => read<SourcesFile>(f).recipes);
  const list: RerunList = { generated: new Date().toISOString(), sources: sources.map((f) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f)), ...rerunIds({ manifest, records, recipes }) };
  const json = `${JSON.stringify(list, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  for (const [k, n] of Object.entries(list.counts)) console.error(`${k}: ${n}`);
  console.error(`rerun (plain): ${list.rerun.length}; rediscover: ${list.rediscover.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
