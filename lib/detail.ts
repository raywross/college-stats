/**
 * The per-college detail file, data/detail/schools/{unit_id}.json (specs/data-expansion/majors.md#store-and-the-detail-file):
 * tables too big for data/schools.json (home states, majors, and field-of-study earnings). It holds current
 * snapshot tables only; year-by-year values belong in the history shard (lib/history.ts).
 *
 * Each table carries its own source, release ("vintage"), and year, and maps to a registered field in lib/fields.ts
 * (DETAIL_TABLES), so it's cited like any other value. `npm run sync-data` writes every file whole (it owns all the
 * tables); `npm run check:lineage` and the merge scripts validate every file with validateDetail().
 *
 * Adding a table: add it to DetailTables and DETAIL_TABLES (a field and a row check), register the field in
 * lib/fields.ts, and have the sync fill it. Node scripts, tests, and server code load it; it reads the CIP 2020 table
 * (lib/cip.ts), so client components import its types only.
 */
import type { CdsAidDetail, DatasetMeta, School, SourceKey } from "./types";
import { FIELDS, type FieldPath, type VintageKey } from "./fields.ts";
import { stateByPostal } from "./states.ts";
import { hasCip4, isCipField } from "./cip.ts";
import { majorsSnapshot, programsFromRows, type MajorRows } from "./majors.ts";
import { hasEarnings, isPlausibleCip4, type ProgramEarnings } from "./field-of-study.ts";
import { cdsAidMismatch, checkCdsAidDetail } from "./cds/financial-aid.ts";
import { checkDirectoryRows, summarize, type DirectoryRows } from "./directories.ts";
import { checkCampusPages, type CampusPagesRows } from "./campus-pages.ts";

export interface DetailTable<T> {
  source: SourceKey;
  /** Null for a per-document source (a college's own CDS, `college-site`): `year` is then the document's own. */
  vintage: VintageKey | null;
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
  /**
   * Bachelor's degrees by program (specs/data-expansion/majors.md): CIP 2020 code ("11.0701") → [first majors, second
   * majors], most first majors first (lib/majors.ts). Programs with neither are left out.
   */
  majors?: DetailTable<MajorRows>;
  /** Earnings and debt by bachelor's program, 4-digit CIP → record (lib/field-of-study.ts). */
  programs?: DetailTable<Record<string, ProgramEarnings>>;
  /** All of CDS section H with a quote per value (specs/data-expansion/cds-financial-aid.md, lib/cds/financial-aid.ts). */
  cds_aid?: DetailTable<CdsAidDetail>;
  /**
   * Campus chapters and groups listed by national directories, each credited to its organization with the list URL,
   * the date read, and its tier (specs/campus-directories.md, lib/directories.ts). Year: the newest date read.
   */
  directories?: DetailTable<DirectoryRows>;
  /**
   * Facts read from the college's own pages by the campus-life pilot (lib/campus-pages.ts): policy items and conduct
   * findings, the LGBTQ+ center, Greek councils and recruitment, the office for religious life, and official religious
   * composition. Each fact carries its page, date checked, and quote. Year: the newest date checked.
   */
  campus_pages?: DetailTable<CampusPagesRows>;
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
  majors: {
    field: "detail.majors",
    checkRows: (rows) => {
      if (!rows || typeof rows !== "object" || Array.isArray(rows)) return "rows must be an object";
      const entries = Object.entries(rows);
      if (!entries.length) return "no rows (leave the table out instead)";
      for (const [k, v] of entries) {
        if (!/^\d{2}\.\d{4}$/.test(k) || !isCipField(k)) return `"${k}" isn't a 6-digit CIP 2020 code`;
        const ok = Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0) && v[0] + v[1] > 0;
        if (!ok) return `${k} has impossible counts ${JSON.stringify(v)}`;
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
        // Shape first, then existence: the sync drops the few Scorecard codes CIP 2020 doesn't have (retired CIP 2000
        // groups), so every stored code must be a real 4-digit group (scripts/lib/field-of-study-sync.mts).
        if (!isPlausibleCip4(cip)) return `"${cip}" doesn't look like a 4-digit CIP code ("12.34")`;
        if (!hasCip4(cip)) return `"${cip}" isn't a 4-digit CIP 2020 group`;
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
  cds_aid: {
    field: "detail.cds_aid",
    checkRows: checkCdsAidDetail,
  },
  directories: {
    field: "detail.directories",
    checkRows: checkDirectoryRows,
  },
  campus_pages: {
    field: "detail.campus_pages",
    checkRows: checkCampusPages,
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
    // A per-document table (vintage null) carries its document's own year, which must be there.
    if (table.vintage === null) {
      if (!table.year) errors.push(`${where}: ${key} needs its document's year`);
      const rowProblem = checkRows(table.rows);
      if (rowProblem) errors.push(`${where}: ${key} ${rowProblem}`);
      continue;
    }
    const year = meta.vintages?.[table.vintage] ?? null;
    if (table.year !== year) errors.push(`${where}: ${key} is ${table.year ?? "no year"}, but meta.json says ${table.vintage} is ${year ?? "unset"} (re-run npm run sync-data)`);
    const rowProblem = checkRows(table.rows);
    if (rowProblem) errors.push(`${where}: ${key} ${rowProblem}`);
  }
  return errors;
}

/**
 * Detail tables that disagree with data/schools.json: home states without a stored residence, more students by state
 * than first-years, or a different top state; majors whose total, top 5, or field counts differ from the snapshot's.
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
  const mj = d.tables.majors;
  if (mj) {
    const ac = school.academics;
    // Titles don't matter here (the snapshot's come from the same CIP table): compare codes, shares, and counts.
    const snap = majorsSnapshot(programsFromRows(mj.rows), (cip) => cip);
    if ((ac?.bachelors_awarded ?? null) !== snap.bachelors_awarded)
      out.push(`detail ${d.unit_id}: ${snap.bachelors_awarded} first-major bachelor's by program, but the snapshot says ${ac?.bachelors_awarded ?? "none"}`);
    const key = (top: readonly { cip: string; share: number }[] | null | undefined) => (top ?? []).map((m) => `${m.cip}:${m.share}`).join(",");
    if (key(ac?.majors_top) !== key(snap.majors_top)) out.push(`detail ${d.unit_id}: top majors don't match the snapshot's`);
    const fams = (f: Record<string, number> | null | undefined) => (f ? JSON.stringify(Object.entries(f).sort((a, b) => a[0].localeCompare(b[0]))) : "none");
    if (fams(ac?.bachelors_by_family) !== fams(snap.bachelors_by_family)) out.push(`detail ${d.unit_id}: bachelor's by field don't match the snapshot's`);
  }
  const programs = d.tables.programs;
  if (programs) {
    const withEarnings = Object.values(programs.rows).filter(hasEarnings).length;
    if ((school.academics?.programs_with_earnings ?? null) !== withEarnings)
      out.push(`detail ${d.unit_id}: academics.programs_with_earnings is ${school.academics?.programs_with_earnings ?? "null"}, but the detail file has ${withEarnings}`);
  }
  const cdsAid = d.tables.cds_aid;
  const aidProblem = cdsAid ? cdsAidMismatch(school, cdsAid.rows) : null;
  if (aidProblem) out.push(`detail ${d.unit_id}: ${aidProblem}`);
  // The snapshot's directory summary is exactly what the credited listings say (lib/directories.ts summarize); a summary
  // with no table at all is caught across files (scripts/lib/directories/merge.mts orphanSummaries).
  const dirs = d.tables.directories;
  if (dirs && JSON.stringify(summarize(dirs.rows) ?? null) !== JSON.stringify(school.directories ?? null))
    out.push(`detail ${d.unit_id}: school.directories doesn't match the directories table (re-run npm run merge-directories)`);
  return out;
}

/**
 * One file per college from several builders' files (each sync step builds its own tables: home states, majors, …).
 * Tables keep DETAIL_TABLES' order so a file's lines don't move between syncs; a table built twice is an error.
 */
export function mergeDetails(...lists: readonly (readonly SchoolDetail[])[]): SchoolDetail[] {
  const byId = new Map<string, DetailTables>();
  for (const list of lists) {
    for (const d of list) {
      const tables = byId.get(d.unit_id) ?? byId.set(d.unit_id, {}).get(d.unit_id)!;
      for (const k of Object.keys(d.tables) as DetailTableKey[]) {
        if (tables[k]) throw new Error(`detail ${d.unit_id}: table ${k} built twice`);
        (tables as Record<string, unknown>)[k] = d.tables[k];
      }
    }
  }
  const order = Object.keys(DETAIL_TABLES) as DetailTableKey[];
  return [...byId.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([unit_id, t]) => ({ unit_id, tables: Object.fromEntries(order.filter((k) => t[k]).map((k) => [k, t[k]])) as DetailTables }));
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
