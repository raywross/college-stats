/**
 * The per-college detail file, data/detail/schools/{unit_id}.json (specs/data-expansion/majors.md#store-and-the-detail-file):
 * tables too big for data/schools.json (home states now; majors and field-of-study earnings later). It holds current
 * snapshot tables only; year-by-year values belong in the history shard (lib/history.ts).
 *
 * Each table carries its own source, release ("vintage"), and year, and maps to a registered field in lib/fields.ts
 * (DETAIL_TABLES), so it's cited like any other value. `npm run sync-data` writes every file whole (it owns all the
 * tables); `npm run check:lineage` and `npm run publish-data` validate every file with validateDetail().
 *
 * Adding a table: add it to DetailTables and DETAIL_TABLES (a field and a row check), register the field in
 * lib/fields.ts, and have the sync fill it. Pure module: Node scripts, tests, and the app all load it.
 */
import type { DatasetMeta, School, SourceKey } from "./types";
import { FIELDS, type FieldPath, type VintageKey } from "./fields.ts";
import { stateByPostal } from "./states.ts";
import { hasEarnings, isPlausibleCip4, type ProgramEarnings } from "./field-of-study.ts";

export interface DetailTable<T> {
  source: SourceKey;
  vintage: VintageKey;
  /**
   * The release's display year when built (equals meta.vintages[vintage]), e.g. "Fall 2024"; null for a table
   * whose vintage has no single year (e.g. `scorecard-fos`), shown as "most recent release".
   */
  year: string | null;
  rows: T;
}

export interface DetailTables {
  /** First-time undergraduates by home state or territory, USPS code → count, largest first (lib/residence.ts). */
  home_states?: DetailTable<Record<string, number>>;
  /** Earnings and debt by bachelor's program, 4-digit CIP → record (lib/field-of-study.ts). */
  programs?: DetailTable<Record<string, ProgramEarnings>>;
}

export type DetailTableKey = keyof DetailTables;

/** data/detail/schools/{unit_id}.json */
export interface SchoolDetail {
  unit_id: string;
  tables: DetailTables;
}

const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Each table's field (for lineage) and a check of its rows (returns a problem or null). */
export const DETAIL_TABLES: Record<DetailTableKey, { field: FieldPath; checkRows: (rows: unknown) => string | null }> = {
  home_states: {
    field: "detail.home_states",
    checkRows: (rows) => {
      if (!rows || typeof rows !== "object" || Array.isArray(rows)) return "rows must be an object";
      const entries = Object.entries(rows);
      if (!entries.length) return "no rows (leave the table out instead)";
      for (const [k, v] of entries) {
        if (!stateByPostal(k)) return `unknown state "${k}"`;
        if (!isCount(v)) return `${k} has an impossible count ${v}`;
      }
      return null;
    },
  },
  programs: {
    field: "detail.programs",
    checkRows: (rows) => {
      if (!rows || typeof rows !== "object" || Array.isArray(rows)) return "rows must be an object";
      const entries = Object.entries(rows as Record<string, ProgramEarnings>);
      if (!entries.length) return "no rows (leave the table out instead)";
      for (const [cip, p] of entries) {
        // INTEGRATION: once lib/cip.ts exists (majors), also check the code is a real CIP family, not just shaped
        // like one.
        if (!isPlausibleCip4(cip)) return `"${cip}" doesn't look like a 4-digit CIP code ("12.34")`;
        if (!p || typeof p.title !== "string" || !p.title) return `${cip} has no title`;
        if (p.graduates !== null && !(Number.isInteger(p.graduates) && p.graduates >= 0)) return `${cip} has an impossible graduate count ${p.graduates}`;
        const e = p.earnings;
        if (!e || typeof e !== "object") return `${cip} has no earnings`;
        for (const k of ["y1", "y4", "y4_national", "y4_pell", "y4_non_pell"] as const) {
          const v = e[k];
          if (v !== null && !(typeof v === "number" && v > 0)) return `${cip} earnings.${k} is invalid (${v})`;
        }
        if (p.debt_median !== null && !(typeof p.debt_median === "number" && p.debt_median >= 0)) return `${cip} has an invalid debt_median`;
      }
      return null;
    },
  },
};

const isTableKey = (k: string): k is DetailTableKey => Object.prototype.hasOwnProperty.call(DETAIL_TABLES, k);

/** Problems with one detail file: unknown tables, citations that don't match the registry or meta, bad rows. */
export function validateDetail(d: SchoolDetail, meta: DatasetMeta, knownIds?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const where = `detail ${d?.unit_id}`;
  if (!d || typeof d.unit_id !== "string" || !/^\d+$/.test(d.unit_id)) return [`detail: missing or malformed unit_id`];
  if (knownIds && !knownIds.has(d.unit_id)) errors.push(`${where}: not a college in data/schools.json`);
  const tables = Object.entries(d.tables ?? {});
  if (!tables.length) errors.push(`${where}: no tables (don't write an empty file)`);
  for (const [key, t] of tables) {
    if (!isTableKey(key)) {
      errors.push(`${where}: unknown table "${key}" (add it to DETAIL_TABLES in lib/detail.ts)`);
      continue;
    }
    const { field, checkRows } = DETAIL_TABLES[key];
    const def = FIELDS[field];
    const table = t as DetailTable<unknown>;
    if (table.source !== def.source) errors.push(`${where}: ${key} cites ${table.source}, but ${field} is from ${def.source}`);
    if (table.vintage !== def.vintage) errors.push(`${where}: ${key} has vintage ${table.vintage}, but ${field} uses ${def.vintage}`);
    if (!(table.source in (meta.sources ?? {}))) errors.push(`${where}: ${key} cites unknown source ${table.source}`);
    // null is a legitimate year (a vintage with no single year, e.g. scorecard-fos — "most recent release");
    // it must still match meta.json, not just be present.
    const year = meta.vintages?.[table.vintage] ?? null;
    if (table.year !== year) errors.push(`${where}: ${key} is ${table.year ?? "no year"}, but meta.json says ${table.vintage} is ${year ?? "unset"} (re-run npm run sync-data)`);
    const rowProblem = checkRows(table.rows);
    if (rowProblem) errors.push(`${where}: ${key} ${rowProblem}`);
  }
  return errors;
}

/**
 * Detail tables that disagree with data/schools.json: home states without a stored residence, more students by state
 * than first-years, or a different top state.
 */
export function detailMismatches(school: School, d: SchoolDetail): string[] {
  const out: string[] = [];
  const hs = d.tables.home_states;
  if (hs) {
    const r = school.demographics.residence;
    const sum = Object.values(hs.rows).reduce((a, b) => a + b, 0);
    if (!r) out.push(`detail ${d.unit_id}: home states without demographics.residence`);
    else {
      if (sum > r.first_years) out.push(`detail ${d.unit_id}: ${sum} first-years by state, more than the ${r.first_years} counted`);
      const [top, n] = Object.entries(hs.rows)[0];
      if (r.top_state?.state !== top || Math.abs(r.top_state.share - n / r.first_years) > 1e-4)
        out.push(`detail ${d.unit_id}: top home state ${top} doesn't match the snapshot's ${r.top_state?.state ?? "none"}`);
    }
  }
  const programs = d.tables.programs;
  if (programs) {
    const withEarnings = Object.values(programs.rows).filter(hasEarnings).length;
    if ((school.academics?.programs_with_earnings ?? null) !== withEarnings)
      out.push(`detail ${d.unit_id}: academics.programs_with_earnings is ${school.academics?.programs_with_earnings ?? "null"}, but the detail file has ${withEarnings}`);
  }
  return out;
}

/** One table per line, so a yearly refresh reads as a small diff (like history shards). */
export function formatDetail(d: SchoolDetail): string {
  const lines = Object.entries(d.tables).map(([k, t]) => `    ${JSON.stringify(k)}: ${JSON.stringify(t)}`);
  return `{\n  "unit_id": ${JSON.stringify(d.unit_id)},\n  "tables": {\n${lines.join(",\n")}\n  }\n}\n`;
}

/** The top `n` home states, largest first: { state, count, share of first-years }. */
export function topHomeStates(d: SchoolDetail | null, firstYears: number, n = 5): { state: string; count: number; share: number }[] {
  const rows = d?.tables.home_states?.rows;
  if (!rows || firstYears <= 0) return [];
  return Object.entries(rows)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([state, count]) => ({ state, count, share: count / firstYears }));
}
