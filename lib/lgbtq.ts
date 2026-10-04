/**
 * LGBTQ+ life, phase 1 (specs/lgbtq-life.md): how IPEDS's "another gender" counts become `school.lgbtq`, how they're
 * shown, and the state-law table. Pure: sync-data and tests share it.
 *
 * What the files say (IPEDS EF2023A/EF2024A and ADM2023/ADM2024 data files, dictionaries, and the 2023–24 Fall
 * Enrollment survey form, read 2026-10-03):
 * - A college first says whether it can report another gender. The imputation flag records the answer: "A" (not
 *   applicable: it doesn't collect it; the cell is blank), "S" (it collects it, but at least one cell would be under 5,
 *   so the form told it to leave them all blank), or a reported value ("R"; "Z" is an implied zero). 0 means it collects
 *   it and counted none. So since fall 2023 no published count is 1–4: NCES has colleges withhold small cells at the
 *   source. EF2022A (the first year) has no flags; there, blank is "not collected".
 * - NCES stopped collecting another gender from the 2025–26 surveys (Executive Order of January 20, 2025), so fall 2024
 *   is the last year. The sync falls back to the newest file that still has the columns (scripts/lib/lgbtq-sync.mts).
 *
 * Display rules (spec): blank → "Not collected by this college"; 0 → "0 reported. The college may not record other
 * genders."; under 10 → "fewer than 10"; never ranked, averaged, filtered, or turned into a "Known for" chip
 * (tests/lgbtq.test.mts holds those files to it).
 */
import type { GenderAdmissions, GenderDetail, GenderReportStatus, LgbtqLife, School, StateLaw } from "./types";

type Row = Record<string, string> | undefined;

/** EF{Y}A level for all undergraduates (the gender detail exists only for the undergraduate and graduate totals). */
export const GENDER_LEVEL = 2;
/** EF{Y}A columns read for the gender detail, pivoted by EFALEVEL like the transfer-in totals (lib/transfers.ts). */
export const GENDER_EF_COLUMNS = ["EFGNDRAN", "XEFGNDRAN", "EFGNDRUN"] as const;
/** ADM{Y} columns read. */
export const GENDER_ADM_COLUMNS = ["APPLCNAN", "ADMSSNAN", "ENRLAN"] as const;
/** The first fall IPEDS asked (EF2022A, ADM2022). */
export const GENDER_FIRST_YEAR = 2022;
/** Counts under this are shown as "fewer than 10", so a small college's figure can't point at individuals. */
export const SMALL_COUNT = 10;

/** The display sentences the spec fixes. */
export const NOT_COLLECTED_TEXT = "Not collected by this college.";
export const ZERO_TEXT = "0 reported. The college may not record other genders.";
export const FEW_TEXT = "Fewer than 10";
export const WITHHELD_TEXT = "Not reported: the college records other genders but leaves these counts blank when any is under 5, for privacy.";

function count(v: string | undefined): number | null {
  if (v === undefined || v === "" || v === ".") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Whether a cell was reported, withheld, or not collected, from its value and imputation flag. Null when it can't be
 * told (a blank cell with some other flag, e.g. "B", left blank).
 */
export function statusOf(value: string | undefined, flag: string | undefined): GenderReportStatus | null {
  if (count(value) !== null) return "reported";
  if (flag === "S") return "withheld";
  // EF2022A/ADM2022 have no flags: a blank meant the college couldn't report it.
  if (flag === "A" || flag === undefined || flag === "") return "not_collected";
  return null;
}

/** A college's fall undergraduates of another and unknown gender, from its pivoted EF{Y}A row (null when absent). */
export function genderFrom(row: Row): GenderDetail | null {
  if (!row) return null;
  const at = (c: string) => row[`${c}_${GENDER_LEVEL}`];
  const undergrads = count(at("EFTOTLT"));
  if (undergrads === null) return null;
  const status = statusOf(at("EFGNDRAN"), at("XEFGNDRAN"));
  if (status === null) return null;
  return { status, another: status === "reported" ? count(at("EFGNDRAN")) : null, unknown: count(at("EFGNDRUN")), undergrads };
}

/**
 * First-time applicants, admits, and enrollees of another gender, from a college's ADM{Y} row. The applicants cell's
 * flag decides the status (the three cells share the question); null when the college isn't in the file.
 */
export function genderAdmissionsFrom(row: Row): GenderAdmissions | null {
  if (!row || !("APPLCNAN" in row)) return null;
  const status = statusOf(row.APPLCNAN, row.XAPPLCNAN);
  if (status === null) return null;
  const v = (c: string) => (status === "reported" ? count(row[c]) : null);
  return { status, applicants: v("APPLCNAN"), admitted: v("ADMSSNAN"), enrolled: v("ENRLAN") };
}

/* ---- Display ---- */

export type CountDisplay =
  | { kind: "count"; count: number; share: number | null }
  | { kind: "few" }
  | { kind: "zero" }
  | { kind: "withheld" }
  | { kind: "not_collected" };

/** How one count shows under the spec's rules; a share only above the threshold. */
export function countDisplay(status: GenderReportStatus, n: number | null, total: number | null = null): CountDisplay | null {
  if (status === "withheld") return { kind: "withheld" };
  if (status === "not_collected") return { kind: "not_collected" };
  if (n === null) return null;
  if (n === 0) return { kind: "zero" };
  if (n < SMALL_COUNT) return { kind: "few" };
  return { kind: "count", count: n, share: total ? n / total : null };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const share = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

/** The sentence for a display, e.g. "576 undergraduates (1.7%)". `noun` is plural ("undergraduates"). */
export function countText(d: CountDisplay, noun: string): string {
  switch (d.kind) {
    case "count":
      return `${fmt(d.count)} ${noun}${d.share !== null ? ` (${share(d.share)})` : ""}`;
    case "few":
      return `${FEW_TEXT} ${noun}`;
    case "zero":
      return ZERO_TEXT;
    case "withheld":
      return WITHHELD_TEXT;
    case "not_collected":
      return NOT_COLLECTED_TEXT;
  }
}

/** A plain count with the threshold (gender unknown, applicants): "21", "fewer than 10", "0"; null when blank. */
export function smallCount(n: number | null): string | null {
  if (n === null) return null;
  if (n === 0) return "0";
  return n < SMALL_COUNT ? "fewer than 10" : fmt(n);
}

/** True when the profile's LGBTQ+ life block has anything to show. */
export function hasLgbtq(school: Pick<School, "lgbtq">): boolean {
  return !!(school.lgbtq?.gender || school.lgbtq?.state_law);
}

/* ---- State laws (data/state-laws.json; tier A, public colleges only) ---- */

export interface StateLawEntry extends StateLaw {
  /** Which colleges it covers; only public colleges so far. */
  applies_to: "public";
}

export interface StateLawTable {
  /** ISO date the table was last reviewed. */
  reviewed: string;
  laws: StateLawEntry[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with the hand-kept table; the sync refuses to write when there are any. */
export function validateStateLaws(table: StateLawTable): string[] {
  const errors: string[] = [];
  if (!ISO_DATE.test(table.reviewed ?? "")) errors.push(`state-laws.json: "reviewed" must be YYYY-MM-DD`);
  const states = new Set<string>();
  for (const law of table.laws ?? []) {
    const at = `state-laws.json ${law.state ?? "?"}`;
    if (!/^[A-Z]{2}$/.test(law.state ?? "")) errors.push(`${at}: state must be a two-letter code`);
    if (states.has(law.state)) errors.push(`${at}: one law per state (combine them or extend the shape)`);
    states.add(law.state);
    if (law.applies_to !== "public") errors.push(`${at}: applies_to must be "public"`);
    for (const k of ["name", "statute", "act", "summary"] as const) if (!law[k]?.trim()) errors.push(`${at}: ${k} is required`);
    if (!ISO_DATE.test(law.effective ?? "")) errors.push(`${at}: effective must be YYYY-MM-DD`);
    if (!ISO_DATE.test(law.checked ?? "")) errors.push(`${at}: checked must be YYYY-MM-DD (the day the statute was read)`);
    if (!/^https:\/\//.test(law.url ?? "")) errors.push(`${at}: url must link to the statute (https)`);
    if ((law.summary ?? "").length > 240) errors.push(`${at}: summary must be one short sentence (≤ 240 characters)`);
    // "Texas SB 17 (2023)" / "Texas public colleges may not …": both name the same state, so a summary can't land on another state's law.
    const stateWord = (s: string | undefined) => (s ?? "").trim().split(/\s+/)[0];
    if (law.name?.trim() && law.summary?.trim() && stateWord(law.name) !== stateWord(law.summary)) errors.push(`${at}: name and summary must both start with the state's name`);
    if (ISO_DATE.test(law.checked ?? "") && ISO_DATE.test(table.reviewed ?? "") && law.checked > table.reviewed)
      errors.push(`${at}: checked (${law.checked}) is after the table's "reviewed" date (${table.reviewed})`);
  }
  const order = (table.laws ?? []).map((l) => l.state);
  if (order.join() !== [...order].sort().join()) errors.push(`state-laws.json: keep laws sorted by state code`);
  return errors;
}

/** The law that applies to a college: public colleges in a listed state only. */
export function stateLawFor(school: Pick<School, "type" | "location">, table: StateLawTable): StateLaw | null {
  if (school.type !== "public") return null;
  const law = table.laws.find((l) => l.state === school.location.state);
  if (!law) return null;
  return { state: law.state, name: law.name, statute: law.statute, act: law.act, effective: law.effective, summary: law.summary, url: law.url, checked: law.checked };
}

/** "2024-01-01" → "January 1, 2024" (UTC, so the day never shifts). */
export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The year shown in a state law's citation: "In effect since January 1, 2024". */
export const effectiveLabel = (iso: string) => `In effect since ${longDate(iso)}`;

/** `school.lgbtq`, or null when there's nothing at all. */
export function lgbtqFrom(gender: GenderDetail | null, admissions: GenderAdmissions | null, stateLaw: StateLaw | null): LgbtqLife | null {
  return gender || admissions || stateLaw ? { gender, admissions, state_law: stateLaw } : null;
}
