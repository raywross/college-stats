/**
 * Shared pieces for the Florida, Illinois, South Carolina and Connecticut state adapters (./fl.mts, ./il.mts,
 * ./sc.mts, ./ct.mts): the CCD crosswalk from a state's own school ids to `ncessch`, a lean reader for one sheet of a
 * large .xlsx, and a builder that collects one state file's values, suppressed cells and unmatched rows.
 *
 * Crosswalk: `ctx.crosswalk` (from the shards) is empty until the federal sync has written them, so the adapters read
 * the CCD school directory themselves (ST_SCHID → NCESSCH, plus whether the school offers grade 12). Shard entries,
 * when present, win. The lead may fold this into a shared helper at integration.
 */
import { execFileSync } from "node:child_process";
import type { HsStateField, HsStateSection, HsStateValues } from "../../../../lib/high-school-types.ts";
import type { Suppressed } from "../../../../lib/high-school-core.ts";
import { forEachCsvRow } from "../../ipeds.mts";
import type { StateAdapterResult, StateContext } from "../types.mts";

/** NCES CCD school directory, 2024–25 (the newest at build time). Files: https://nces.ed.gov/ccd/files.asp */
export const CCD_DIRECTORY_URL = "https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip";

export interface CcdEntry {
  ncessch: string;
  /** CCD ST_SCHID, e.g. "FL-01-0151". */
  stSchId: string;
  name: string;
  /** Offers grade 12 (the build's definition of a high school). */
  highSchool: boolean;
}

/** One state's rows of the CCD directory CSV (any text with its header row). Pure: tests pass a small extract. */
export function ccdEntriesFromCsv(csv: string, state: string): CcdEntry[] {
  const lines = csv.split(/\r?\n/);
  const keep = new RegExp(`^[^,]*,\\d{2},[^,]*,${state},`);
  const text = [lines[0], ...lines.slice(1).filter((l) => keep.test(l))].join("\n");
  const out: CcdEntry[] = [];
  forEachCsvRow(text, (r) => {
    if (r.ST !== state || !r.NCESSCH || !r.ST_SCHID) return;
    const high = r.G_12_OFFERED === "Yes" || ["12", "13"].includes(r.GSHI);
    out.push({ ncessch: r.NCESSCH, stSchId: r.ST_SCHID, name: r.SCH_NAME, highSchool: high });
  });
  return out;
}

export async function readCcdEntries(ctx: StateContext): Promise<CcdEntry[]> {
  const zip = await ctx.fetchCached(CCD_DIRECTORY_URL);
  return ccdEntriesFromCsv(ctx.readZipEntry(zip, /\.csv$/i), ctx.state);
}

/** State-native id → the CCD school it names. */
export type Crosswalk = Map<string, { ncessch: string; highSchool: boolean; name: string }>;

/**
 * Crosswalk keyed by the id the state's own files use (`nativeKey` turns a CCD ST_SCHID into it). Shard entries
 * (`shardCrosswalk`, ST_SCHID → ncessch; every shard row is a high school) override the directory's.
 */
export function buildCrosswalk(
  entries: readonly CcdEntry[],
  nativeKey: (stSchId: string) => string | null,
  shardCrosswalk: ReadonlyMap<string, string> = new Map(),
): Crosswalk {
  const map: Crosswalk = new Map();
  for (const e of entries) {
    const k = nativeKey(e.stSchId);
    if (!k) continue;
    const prev = map.get(k);
    // A state id shared by two CCD rows (rare: a school split across agencies): prefer the one offering grade 12.
    if (!prev || (!prev.highSchool && e.highSchool)) map.set(k, { ncessch: e.ncessch, highSchool: e.highSchool, name: e.name });
  }
  for (const [st, id] of shardCrosswalk) {
    const k = nativeKey(st);
    if (k) map.set(k, { ncessch: id, highSchool: true, name: map.get(k)?.name ?? "" });
  }
  return map;
}

export async function stateCrosswalk(ctx: StateContext, nativeKey: (stSchId: string) => string | null): Promise<Crosswalk> {
  const entries = await readCcdEntries(ctx);
  ctx.log(`  CCD directory: ${entries.length} ${ctx.state} schools, ${entries.filter((e) => e.highSchool).length} offer grade 12`);
  return buildCrosswalk(entries, nativeKey, ctx.crosswalk);
}

/* ------------------------------------------------------------------ */
/* One sheet of an .xlsx                                               */
/* ------------------------------------------------------------------ */

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function unzipText(zip: string, entry: string): string {
  try {
    return execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Sheet rows as text cells, from the sheet's XML and the shared strings. Pure (tests feed it XML). */
export function rowsFromSheetXml(sheetXml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const rm of sheetXml.matchAll(rowRe)) {
    const cells: string[] = [];
    for (const cm of (rm[1] ?? "").matchAll(cellRe)) {
      const [, col, attrs, body = ""] = cm;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let v: string;
      if (type === "s") v = shared[Number(/<v>([^<]*)<\/v>/.exec(body)?.[1])] ?? "";
      else if (type === "inlineStr") v = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else v = decodeXml(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "");
      cells[colIndex(col)] = v.trim();
    }
    rows.push(Array.from(cells, (c) => c ?? ""));
  }
  return rows;
}

/** The shared strings of an .xlsx. */
export function sharedStringsFromXml(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}

/** Every row of one named sheet (cells as trimmed text), reading only that sheet's XML. */
export function readXlsxSheet(zip: string, sheetName: string | RegExp): string[][] {
  const wb = unzipText(zip, "xl/workbook.xml");
  const rels = new Map(
    [...unzipText(zip, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [
      m[1],
      m[2].replace(/^\/?xl\//, ""),
    ]),
  );
  const sheets = [...wb.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: decodeXml(m[1]), rid: m[2] }));
  const sheet = sheets.find((s) => (typeof sheetName === "string" ? s.name === sheetName : sheetName.test(s.name)));
  if (!sheet) throw new Error(`${zip}: no sheet ${sheetName} (sheets: ${sheets.map((s) => s.name).join(", ")})`);
  const target = rels.get(sheet.rid);
  if (!target) throw new Error(`${zip}: sheet ${sheet.name} has no part`);
  return rowsFromSheetXml(unzipText(zip, `xl/${target}`), sharedStringsFromXml(unzipText(zip, "xl/sharedStrings.xml")));
}

/** Rows after the header row (the first row whose cells include every `required` name), as records by header. */
export function recordsFrom(rows: readonly string[][], required: readonly string[]): Record<string, string>[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const at = rows.findIndex((r) => required.every((h) => r.some((c) => norm(c) === h)));
  if (at < 0) throw new Error(`no header row with ${required.join(", ")}`);
  const header = rows[at].map(norm);
  return rows.slice(at + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/* ------------------------------------------------------------------ */
/* Building one state file                                             */
/* ------------------------------------------------------------------ */

export interface StateFileStats {
  /** Source rows offered per field (school rows the adapter read for that field). */
  rows: number;
  matched: number;
  /** Mapped to a CCD school that doesn't offer grade 12: skipped. */
  notHigh: number;
  unmatched: number;
}

/** Collects one state's values by ncessch, the suppressed cells, and the rows the crosswalk couldn't place. */
export class StateFileBuilder {
  readonly schools: Record<string, HsStateValues> = {};
  readonly unmatched = new Map<string, { stateId: string; name: string; reason?: string }>();
  readonly stats = new Map<HsStateField, StateFileStats>();

  private readonly crosswalk: Crosswalk;

  constructor(crosswalk: Crosswalk) {
    this.crosswalk = crosswalk;
  }

  /**
   * Records `cell` for the school with state id `stateId`. `listIfUnmatched`: a row that maps to no CCD school and
   * carries a value goes to `unmatched` (set it for rows that look like high schools; elementary rows that don't map
   * are only counted).
   * Returns the ncessch it was stored under, or null.
   */
  set(field: HsStateField, stateId: string, name: string, cell: Suppressed, listIfUnmatched: boolean): string | null {
    const s = this.stats.get(field) ?? { rows: 0, matched: 0, notHigh: 0, unmatched: 0 };
    this.stats.set(field, s);
    s.rows++;
    const hit = this.crosswalk.get(stateId);
    if (!hit) {
      s.unmatched++;
      // Only rows that carry a value are worth reviewing (a row of "*" and "N/A" loses nothing).
      if (listIfUnmatched && cell.value !== null && !this.unmatched.has(stateId)) this.unmatched.set(stateId, { stateId, name: name.replace(/\s+/g, " ").trim(), reason: "no CCD school with this state id" });
      return null;
    }
    if (!hit.highSchool) {
      s.notHigh++;
      return null;
    }
    s.matched++;
    if (cell.value === null && !cell.suppressed) return hit.ncessch;
    const entry = (this.schools[hit.ncessch] ??= {});
    if (cell.suppressed) {
      entry[field] = null;
      if (!entry.suppressed?.includes(field)) entry.suppressed = [...(entry.suppressed ?? []), field];
    } else {
      entry[field] = cell.value;
      if (entry.suppressed) {
        entry.suppressed = entry.suppressed.filter((f) => f !== field);
        if (!entry.suppressed.length) delete entry.suppressed;
      }
    }
    return hit.ncessch;
  }

  /** The adapter result, with schools in id order and keys in field order. */
  result(sections: HsStateSection[]): StateAdapterResult {
    const order = sections.flatMap((s) => s.fields);
    const schools: Record<string, HsStateValues> = {};
    for (const id of Object.keys(this.schools).sort()) {
      const e = this.schools[id];
      const out: HsStateValues = {};
      for (const f of order) if (f in e) out[f] = e[f] ?? null;
      if (e.suppressed?.length) out.suppressed = order.filter((f) => e.suppressed!.includes(f));
      if (Object.keys(out).length) schools[id] = out;
    }
    const unmatched = [...this.unmatched.values()].sort((a, b) => a.stateId.localeCompare(b.stateId));
    return { sections, schools, ...(unmatched.length ? { unmatched } : {}) };
  }

  /** One line per field for the run log: rows read, matched, skipped, suppressed. */
  report(): string[] {
    const lines: string[] = [];
    for (const [field, s] of this.stats) {
      const suppressed = Object.values(this.schools).filter((e) => e.suppressed?.includes(field)).length;
      const values = Object.values(this.schools).filter((e) => typeof e[field] === "number").length;
      lines.push(`  ${field}: ${s.rows} school rows, ${s.matched} high schools matched (${values} values, ${suppressed} suppressed), ${s.notHigh} not high schools, ${s.unmatched} unmatched`);
    }
    return lines;
  }
}

/** CSV text → rows of cells (RFC 4180 quoting; CRLF or LF). For exports whose header isn't the first line. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

/** A share already on 0–1 ("0.29") → rounded share; codes as for `suppress`. */
export function shareCell(raw: string | undefined, suppressedCodes: readonly string[], missingCodes: readonly string[] = []): Suppressed {
  const t = (raw ?? "").trim();
  if (suppressedCodes.includes(t)) return { value: null, suppressed: true };
  if (!t || missingCodes.includes(t)) return { value: null, suppressed: false };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1) return { value: null, suppressed: false };
  return { value: Math.round(n * 1e4) / 1e4, suppressed: false };
}
