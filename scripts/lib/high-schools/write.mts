/**
 * Writers for data/high-schools/ (or HIGH_SCHOOLS_DIR). Stable output so git diffs show only real changes:
 * shards hold one school per line, sorted by id, keys in canonical order (normalizeHighSchool); state files one school
 * per line, sorted by ncessch; meta, medians, and detail files are pretty-printed.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HighSchool, HighSchoolDetail, HighSchoolMeta, HighSchoolShard, HighSchoolStateFile, StateMedians } from "../../../lib/high-school-types.ts";
import { HS_STATE_FIELDS } from "../../../lib/hs-fields.ts";
import { normalizeHighSchool } from "../../../lib/high-school-core.ts";

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One shard as text: `{"state":"CA","schools":[` then one normalized row per line. */
export function formatShard(shard: HighSchoolShard): string {
  const rows = [...shard.schools].sort(byId).map((r) => JSON.stringify(normalizeHighSchool(r)));
  return `{"state":${JSON.stringify(shard.state)},"schools":[\n${rows.join(",\n")}\n]}\n`;
}

/** Rows grouped into shards by state, states sorted. */
export function toShards(rows: readonly HighSchool[]): HighSchoolShard[] {
  const by = new Map<string, HighSchool[]>();
  for (const r of rows) {
    const list = by.get(r.state);
    if (list) list.push(r);
    else by.set(r.state, [r]);
  }
  return [...by.keys()].sort().map((state) => ({ state, schools: by.get(state)!.sort(byId).map(normalizeHighSchool) }));
}

/** Write every shard and remove shard files for states with no rows left. Returns the files written. */
export function writeShards(dir: string, rows: readonly HighSchool[]): string[] {
  const schoolsDir = join(dir, "schools");
  mkdirSync(schoolsDir, { recursive: true });
  const shards = toShards(rows);
  const keep = new Set(shards.map((s) => `${s.state}.json`));
  for (const f of readdirSync(schoolsDir)) if (f.endsWith(".json") && !keep.has(f)) rmSync(join(schoolsDir, f));
  for (const s of shards) writeFileSync(join(schoolsDir, `${s.state}.json`), formatShard(s));
  return [...keep].sort();
}

const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export function writeMeta(dir: string, meta: HighSchoolMeta): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), pretty(meta));
}

export function writeMedians(dir: string, medians: StateMedians): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "medians.json"), pretty(medians));
}

/** A state file's school entry with fields in HS_STATE_FIELDS order and `suppressed` last. */
function orderedEntry(e: HighSchoolStateFile["schools"][string]): HighSchoolStateFile["schools"][string] {
  const out: HighSchoolStateFile["schools"][string] = {};
  for (const f of HS_STATE_FIELDS) if (f in e) out[f] = e[f] ?? null;
  if (e.suppressed?.length) out.suppressed = HS_STATE_FIELDS.filter((f) => e.suppressed!.includes(f));
  return out;
}

/** A state file as text: sections pretty-printed, schools one per line sorted by ncessch, then unmatched rows. */
export function formatStateFile(file: HighSchoolStateFile): string {
  const ids = Object.keys(file.schools).sort();
  const schools = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(orderedEntry(file.schools[id]))}`);
  const sections = JSON.stringify(file.sections, null, 2).replace(/\n/g, "\n  ");
  const unmatched = file.unmatched?.length
    ? `,\n  "unmatched": [\n${[...file.unmatched]
        .sort((a, b) => a.stateId.localeCompare(b.stateId))
        .map((u) => `    ${JSON.stringify(u)}`)
        .join(",\n")}\n  ]`
    : "";
  return `{\n  "state": ${JSON.stringify(file.state)},\n  "sections": ${sections},\n  "schools": {\n${schools.join(",\n")}${schools.length ? "\n" : ""}  }${unmatched}\n}\n`;
}

export function writeStateFile(dir: string, file: HighSchoolStateFile): string {
  const stateDir = join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, `${file.state.toLowerCase()}.json`);
  writeFileSync(path, formatStateFile(file));
  return path;
}

export function writeDetail(dir: string, detail: HighSchoolDetail): string {
  const detailDir = join(dir, "detail");
  mkdirSync(detailDir, { recursive: true });
  const path = join(detailDir, `${detail.id}.json`);
  writeFileSync(path, pretty(detail));
  return path;
}

export function hasShards(dir: string): boolean {
  return existsSync(join(dir, "schools")) && readdirSync(join(dir, "schools")).some((f) => f.endsWith(".json"));
}
