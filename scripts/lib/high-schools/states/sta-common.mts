/**
 * Shared by the California, Texas, and New York state report card adapters (./ca.mts, ./tx.mts, ./ny.mts): the
 * state-id → ncessch crosswalk, the share rule (numerator/denominator or percent, with each state's privacy codes),
 * a builder that files values under ncessch, and small file readers.
 *
 * Crosswalk: from the shards when the federal sync has written them (`ctx.crosswalk`), otherwise from the NCES CCD
 * school directory file (ST_SCHID → NCESSCH), downloaded into the cache. Either way a state's own id is the trailing
 * digits of ST_SCHID: California's 7-digit school code, unique statewide (CCD writes charters under their own
 * code as the district, "CA-0130625-0130625", so the full CDS code doesn't match; "CA-1975309-1995786" → 1995786), Texas's 9-digit campus
 * number ("TX-054901-054901001" → 054901001), New York's 12-digit BEDS code ("NY-211003040000-211003040002" →
 * 211003040002). Only open schools that offer grade 12 are kept (the site's definition of a high school);
 * state rows for other schools (middle schools taking Algebra I, closed schools) are counted, not listed.
 */
import { statSync } from "node:fs";
import type { HsStateField, HsStateValues, HighSchoolStateFile } from "../../../../lib/high-school-types.ts";
import { SMALL_CELL, offersGrade12, round } from "../../../../lib/high-school-core.ts";
import { forEachCsvRow } from "../../ipeds.mts";
import type { StateContext } from "../types.mts";

/** NCES CCD public school directory, 2024–25 final (the file the federal sync reads). `--ccd-url` overrides it. */
export const CCD_DIRECTORY_URL = "https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip";

export interface CrosswalkSchool {
  ncessch: string;
  name: string;
  /** Offers grade 12 (CCD G_12_OFFERED, or a GSLO–GSHI span that includes 12). */
  highSchool: boolean;
  /** Not closed, inactive, or future (CCD SY_STATUS 2, 6, 7). */
  open: boolean;
}

export interface Crosswalk {
  from: "shards" | "ccd";
  /** Keyed by the state's own school id (the trailing digits of ST_SCHID). */
  schools: ReadonlyMap<string, CrosswalkSchool>;
}

/** The state's own id inside a CCD ST_SCHID: its last `width` digits, or null when it has fewer. */
export function localSchoolId(stSchId: string, width: number): string | null {
  const digits = stSchId.replace(/\D/g, "");
  return digits.length >= width ? digits.slice(-width) : null;
}

const CLOSED_STATUS = new Set(["2", "6", "7"]);

/** Crosswalk from the CCD directory CSV (all states; only `state`'s rows are read). */
export function crosswalkFromCcd(csv: string, state: string, width: number): Crosswalk {
  const schools = new Map<string, CrosswalkSchool>();
  forEachCsvRow(csv, (r) => {
    if (r.ST !== state || !r.ST_SCHID || !/^\d{12}$/.test(r.NCESSCH)) return;
    const id = localSchoolId(r.ST_SCHID, width);
    if (!id) return;
    const school: CrosswalkSchool = {
      ncessch: r.NCESSCH,
      name: r.SCH_NAME,
      highSchool: r.G_12_OFFERED === "Yes" || offersGrade12({ low: r.GSLO, high: r.GSHI }),
      open: !CLOSED_STATUS.has(r.SY_STATUS),
    };
    const prev = schools.get(id);
    // Two CCD rows with one state id (a school closed and reopened under a new NCES id): prefer the open one.
    if (!prev || (!prev.open && school.open)) schools.set(id, school);
  });
  return { from: "ccd", schools };
}

/** Crosswalk from the shards (`ctx.crosswalk`, ST_SCHID → ncessch): every row there is an open high school. */
export function crosswalkFromShards(ctx: Pick<StateContext, "crosswalk" | "rows">, width: number): Crosswalk {
  const names = new Map(ctx.rows.map((r) => [r.id, r.name]));
  const schools = new Map<string, CrosswalkSchool>();
  for (const [stSchId, ncessch] of ctx.crosswalk) {
    const id = localSchoolId(stSchId, width);
    if (id) schools.set(id, { ncessch, name: names.get(ncessch) ?? "", highSchool: true, open: true });
  }
  return { from: "shards", schools };
}

/**
 * The CCD directory crosswalk, so rows for schools that aren't high schools (middle schools taking Algebra I, closed
 * schools) are recognized and skipped rather than listed as unmatched. Once the shards exist they decide what counts
 * as a high school: a CCD school in the shards is one, a CCD school missing from them isn't.
 */
export async function loadCrosswalk(ctx: StateContext, width: number): Promise<Crosswalk> {
  const url = typeof ctx.flags["ccd-url"] === "string" ? ctx.flags["ccd-url"] : CCD_DIRECTORY_URL;
  const zip = await ctx.fetchCached(url);
  const ccd = crosswalkFromCcd(ctx.readZipEntry(zip, /\.csv$/i), ctx.state, width);
  if (!ctx.crosswalk.size) {
    ctx.log(`  crosswalk: ${ccd.schools.size} ${ctx.state} schools from the CCD directory (shards not written yet)`);
    return ccd;
  }
  return mergeCrosswalks(ccd, crosswalkFromShards(ctx, width));
}

/** Shard entries win; CCD schools the shards don't hold are kept as known non-high schools. */
export function mergeCrosswalks(ccd: Crosswalk, shards: Crosswalk): Crosswalk {
  const inShards = new Set([...shards.schools.values()].map((s) => s.ncessch));
  const schools = new Map<string, CrosswalkSchool>();
  for (const [id, s] of ccd.schools) schools.set(id, inShards.has(s.ncessch) ? s : { ...s, highSchool: false });
  for (const [id, s] of shards.schools) schools.set(id, s);
  return { from: "shards", schools };
}

/* ------------------------------------------------------------------ */
/* Shares                                                              */
/* ------------------------------------------------------------------ */

/** One measure's raw cells: numerator, denominator, and the percent the source printed (0–100). */
export interface ShareCells {
  num?: string | null;
  den?: string | null;
  pct?: string | null;
}

export interface ShareCodes {
  /** The source's privacy codes ("*", "-1", "s"). */
  suppressed: readonly string[];
}

export interface Share {
  value: number | null;
  /** True when null means "suppressed for privacy". */
  suppressed: boolean;
}

const NUMBER = /^\d+(\.\d+)?$/;

/**
 * A 0–1 share from a measure's cells. Order: a suppressed percent → suppressed; numerator and denominator both numbers →
 * their ratio (exact, unlike the rounded percent), with a zero denominator missing, a denominator of 1–4 suppressed
 * (fewer than 5 students), and a numerator above the denominator missing (the source's "abnormal data"); a suppressed
 * numerator or denominator → suppressed; otherwise the printed percent; otherwise missing.
 */
export function shareOf(cells: ShareCells, codes: ShareCodes): Share {
  const t = (s: string | null | undefined) => (s ?? "").trim().replace(/,/g, "");
  const num = t(cells.num);
  const den = t(cells.den);
  const pct = t(cells.pct);
  const missing: Share = { value: null, suppressed: false };
  if (codes.suppressed.includes(pct)) return { value: null, suppressed: true };
  if (NUMBER.test(den)) {
    const d = Number(den);
    if (d === 0) return missing;
    if (d < SMALL_CELL) return { value: null, suppressed: true };
    if (NUMBER.test(num)) {
      const n = Number(num);
      return n > d ? missing : { value: round(n / d, 4), suppressed: false };
    }
  }
  if (codes.suppressed.includes(num) || codes.suppressed.includes(den)) return { value: null, suppressed: true };
  if (NUMBER.test(pct) && Number(pct) <= 100) return { value: round(Number(pct) / 100, 4), suppressed: false };
  return missing;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export interface BuilderStats {
  /** Values filed under a high school. */
  filed: number;
  /** State rows whose school CCD lists as not offering grade 12. */
  notHighSchool: number;
  /** State rows whose school CCD lists as closed or inactive. */
  closed: number;
  /** State rows with no CCD match (listed in `unmatched` when they carry a high-school measure). */
  noMatch: number;
}

/** Collects one state's values by ncessch, the suppressed cells, and the rows the crosswalk couldn't map. */
export class StateFileBuilder {
  readonly schools: Record<string, HsStateValues> = {};
  readonly stats: Record<HsStateField, BuilderStats> = {} as Record<HsStateField, BuilderStats>;
  private readonly unmatched = new Map<string, { stateId: string; name: string; reason?: string }>();
  private readonly crosswalk: Crosswalk;
  constructor(crosswalk: Crosswalk) {
    this.crosswalk = crosswalk;
  }

  /**
   * File one value under the crosswalk `key` (`stateId`: the id to show in `unmatched`, default the key). `hsOnly`: the measure exists only for high schools (college-going, grade 11 tests, AP), so a row the
   * crosswalk can't map is listed under `unmatched`; for all-grade measures (Texas campus chronic absence) unmapped rows
   * are most likely elementary schools and are only counted. Missing values (null, not suppressed) aren't filed.
   */
  set(key: string, name: string, field: HsStateField, share: Share, opts: { hsOnly: boolean; stateId?: string }): void {
    const s = (this.stats[field] ??= { filed: 0, notHighSchool: 0, closed: 0, noMatch: 0 });
    if (share.value === null && !share.suppressed) return;
    const school = this.crosswalk.schools.get(key);
    if (!school) {
      s.noMatch++;
      const stateId = opts.stateId ?? key;
      if (opts.hsOnly && !this.unmatched.has(stateId)) this.unmatched.set(stateId, { stateId, name: name.trim(), reason: "no CCD school with this state id" });
      return;
    }
    if (!school.open) return void s.closed++;
    if (!school.highSchool) return void s.notHighSchool++;
    const entry = (this.schools[school.ncessch] ??= {});
    if (entry[field] !== undefined) return; // two state ids for one NCES school: the first row wins
    s.filed++;
    entry[field] = share.value;
    if (share.suppressed) entry.suppressed = [...(entry.suppressed ?? []), field];
  }

  /** Suppressed cells as a share of the field's filed values. */
  suppressedShare(field: HsStateField): number {
    const filed = this.stats[field]?.filed ?? 0;
    const n = Object.values(this.schools).filter((e) => e.suppressed?.includes(field)).length;
    return filed ? n / filed : 0;
  }

  result(): Pick<HighSchoolStateFile, "schools" | "unmatched"> {
    return { schools: this.schools, unmatched: [...this.unmatched.values()].sort((a, b) => a.stateId.localeCompare(b.stateId)) };
  }

  /** One line per field for the run's log: filed, suppressed share, unmatched and skipped rows. */
  report(): string[] {
    return (Object.keys(this.stats) as HsStateField[]).map((f) => {
      const s = this.stats[f];
      return `  ${f}: ${s.filed} high schools (${Math.round(this.suppressedShare(f) * 100)}% suppressed); ${s.noMatch} rows without a CCD match, ${s.notHighSchool} not high schools, ${s.closed} closed`;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** Rows of an unquoted delimited text file (California's tab- and caret-delimited downloads). Headers trimmed. */
export function forEachDelimitedRow(text: string, delimiter: string, onRow: (row: Record<string, string>) => void): string[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = (lines[0] ?? "").split(delimiter).map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(delimiter);
    onRow(Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? "").trim()])));
  }
  return header;
}

/** A cached file's download date (YYYY-MM-DD), for a section's `retrieved`. */
export function retrievedDate(path: string): string {
  return statSync(path).mtime.toISOString().slice(0, 10);
}

/** "2022-23" or "2023" (the spring year) → "2022–23". */
export function schoolYear(text: string): string {
  const m = /^(\d{4})\s*-\s*(\d{2}|\d{4})$/.exec(text.trim());
  if (m) return `${m[1]}–${m[2].slice(-2)}`;
  const y = /^(\d{4})$/.exec(text.trim());
  if (y) return `${Number(y[1]) - 1}–${y[1].slice(-2)}`;
  throw new Error(`not a school year: ${JSON.stringify(text)}`);
}

/** "2022-23" → "2023" (the year a class graduates). */
export function springYear(text: string): string {
  const y = schoolYear(text);
  return `${y.slice(0, 2)}${y.slice(-2)}`;
}

/** A string flag, or the default. */
export function flag(ctx: Pick<StateContext, "flags">, name: string, fallback: string): string {
  const v = ctx.flags[name];
  return typeof v === "string" ? v : fallback;
}
