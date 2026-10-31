/**
 * The nightly export of the console's hand-read prompts (the hand-read brief, "Git catches up nightly"): the rows of
 * `public.essay_prompt_overrides` for the open cycle become `data/essay-prompts/confirmed/<unit_id>.json`, each written
 * with `recordJson` (lib/essay-prompts/confirmed.ts), so the merge, the lineage check, and the public college pages
 * catch up with what the advisor already shows live. The directory mirrors the table: a file with no open-cycle row
 * (deleted in the console, or a closed cycle's) is removed. A row that fails `validateConfirmed`, or whose record names
 * another college or cycle than its row, is skipped and listed, and that college's file is left as it was. Pure but
 * for `readConfirmedFiles`/`applyExport` (node:fs); scripts/export-essay-confirmed.mts reads the table and calls these.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordJson, validateConfirmed, type ConfirmedRecord } from "../../../lib/essay-prompts/confirmed.ts";
import { openCycle } from "./cycle.mts";

/** One row as the table holds it (the columns the export reads). */
export interface OverrideRow {
  unit_id: string;
  cycle: string;
  record: ConfirmedRecord;
}

export interface ExportPlan {
  /** unit id → the file's new text (only files whose text changes). */
  writes: Map<string, string>;
  /** unit ids whose file goes (no open-cycle row). */
  removes: string[];
  /** Files already equal to their row. */
  unchanged: number;
  /** Rows skipped, with why ("134130: read_on … is in the future"). */
  skipped: string[];
  /** The open cycle the export used. */
  cycle: string;
}

/**
 * The open cycle's rows that pass, as hand-read records (by unit id), and the ones skipped with why. A skipped row
 * with a well-formed unit id is in `held`: its college keeps what it had (the export leaves its file; the publisher,
 * scripts/lib/data-platform/compose.mts, keeps the layer's record). Shared by the nightly export and the publisher.
 */
export function confirmedFromRows(rows: readonly OverrideRow[], today: string): { cycle: string; records: ConfirmedRecord[]; skipped: string[]; held: Set<string> } {
  const cycle = openCycle(today);
  const records: ConfirmedRecord[] = [];
  const skipped: string[] = [];
  const held = new Set<string>();
  for (const row of [...rows].sort((a, b) => a.unit_id.localeCompare(b.unit_id))) {
    if (row.cycle !== cycle) continue;
    const r = row.record;
    const problems = r && typeof r === "object" ? validateConfirmed(r, today) : ["the record isn't an object"];
    if (r && typeof r === "object" && (r.unit_id !== row.unit_id || r.cycle !== row.cycle)) problems.unshift(`the record is for ${r.unit_id} ${r.cycle}, not its row's ${row.unit_id} ${row.cycle}`);
    if (!/^\d{1,12}$/.test(row.unit_id)) problems.unshift(`unit id ${JSON.stringify(row.unit_id)} isn't 1 to 12 digits`);
    if (problems.length) {
      skipped.push(`${row.unit_id}: ${problems.join("; ")}`);
      if (/^\d{1,12}$/.test(row.unit_id)) held.add(row.unit_id);
      continue;
    }
    records.push(r);
  }
  return { cycle, records, skipped, held };
}

/** What to write and remove so the directory (its files' text by unit id) mirrors the open cycle's rows. */
export function planExport(rows: readonly OverrideRow[], files: ReadonlyMap<string, string>, today: string): ExportPlan {
  const picked = confirmedFromRows(rows, today);
  const plan: ExportPlan = { writes: new Map(), removes: [], unchanged: 0, skipped: picked.skipped, cycle: picked.cycle };
  const keep = new Set<string>(picked.held);
  for (const r of picked.records) {
    keep.add(r.unit_id);
    const text = recordJson(r);
    if (files.get(r.unit_id) === text) plan.unchanged++;
    else plan.writes.set(r.unit_id, text);
  }
  plan.removes = [...files.keys()].filter((id) => !keep.has(id)).sort();
  return plan;
}

/** The directory's record files' text, by unit id. */
export function readConfirmedFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => /^\d{1,12}\.json$/.test(f)).sort()) out.set(f.slice(0, -5), readFileSync(join(dir, f), "utf8"));
  return out;
}

/** Writes and removes the plan's files (each write atomic: a temp file renamed into place). */
export function applyExport(dir: string, plan: ExportPlan): void {
  mkdirSync(dir, { recursive: true });
  for (const [id, text] of plan.writes) {
    const file = join(dir, `${id}.json`);
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  }
  for (const id of plan.removes) rmSync(join(dir, `${id}.json`), { force: true });
}

/** One line for the log and the PR body. */
export function exportLine(plan: ExportPlan): string {
  return `${plan.cycle}: ${plan.writes.size} written, ${plan.removes.length} removed, ${plan.unchanged} unchanged, ${plan.skipped.length} skipped`;
}
