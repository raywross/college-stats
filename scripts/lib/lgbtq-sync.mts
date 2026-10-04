/**
 * sync-data's LGBTQ+ life step (specs/lgbtq-life.md, phase 1). Kept out of scripts/sync-data.mts so that file only calls
 * in; lib/lgbtq.ts reads each row.
 *
 * The another-gender columns come from files the sync already reads: EF{Y}A (pivoted by level, with the transfer-in
 * totals) and ADM{Y}. NCES stopped collecting another gender from 2025–26, so when the newest file lacks the columns
 * this falls back to the newest one that has them (cached like the history files) and gives each value a lineage
 * record with that file's year and URL, since the field's default vintage then describes a newer fall.
 */
import { readFileSync } from "node:fs";
import type { DatasetMeta, LineageRecord, School } from "../../lib/types.ts";
import type { FieldPath } from "../../lib/fields.ts";
import { fetchIpedsTable } from "./ipeds.mts";
import { EFA_WIDE } from "../../lib/transfers.ts";
import {
  GENDER_ADM_COLUMNS,
  GENDER_EF_COLUMNS,
  GENDER_FIRST_YEAR,
  genderAdmissionsFrom,
  genderFrom,
  lgbtqFrom,
  effectiveLabel,
  stateLawFor,
  validateStateLaws,
  type StateLawTable,
} from "../../lib/lgbtq.ts";

/** EF{Y}A pivoted with the transfer-in totals and the gender detail, so the file is read once. */
export const EFA_WIDE_WITH_GENDER = { key: EFA_WIDE.key, values: [...EFA_WIDE.values, ...GENDER_EF_COLUMNS] } as const;

type Rows = ReadonlyMap<string, Record<string, string>>;
export interface GenderFile {
  name: string;
  url: string;
  year: number;
  rows: Rows;
}

const hasColumn = (rows: Rows, column: string) => {
  for (const r of rows.values()) return Object.keys(r).some((k) => k === column || k.startsWith(`${column}_`));
  return false;
};

/**
 * The newest file of a family that still has the another-gender columns: `current` when it does, else older years
 * from the cache or NCES. Throws when none does (the columns were renamed, not dropped).
 */
async function newestWith(
  family: "EF" | "ADM",
  current: GenderFile,
  cacheDir: string,
): Promise<{ file: GenderFile; fallback: boolean }> {
  const column = family === "EF" ? GENDER_EF_COLUMNS[0] : GENDER_ADM_COLUMNS[0];
  if (hasColumn(current.rows, column)) return { file: current, fallback: false };
  for (let y = current.year - 1; y >= GENDER_FIRST_YEAR; y--) {
    const name = family === "EF" ? `EF${y}A` : `ADM${y}`;
    const t = await fetchIpedsTable(name, { cacheDir, maxAgeDays: 30, ...(family === "EF" ? { wide: EFA_WIDE_WITH_GENDER } : {}) });
    if (t && t.columns.has(column)) {
      console.log(`  ${current.name} has no ${column} (NCES stopped collecting another gender); using ${name}`);
      return { file: { name, url: t.url, year: y, rows: t.rows }, fallback: true };
    }
  }
  throw new Error(`No ${family} file from ${GENDER_FIRST_YEAR} to ${current.year} has ${column}`);
}

export interface LgbtqInputs {
  ef: GenderFile;
  adm: GenderFile;
  efFallback: boolean;
  admFallback: boolean;
  laws: StateLawTable;
}

export async function fetchLgbtqInputs(efa: GenderFile, adm: GenderFile, cacheDir: string, lawsPath: string): Promise<LgbtqInputs> {
  const ef = await newestWith("EF", efa, cacheDir);
  const ad = await newestWith("ADM", adm, cacheDir);
  const laws: StateLawTable = JSON.parse(readFileSync(lawsPath, "utf8"));
  const problems = validateStateLaws(laws);
  if (problems.length) throw new Error(`data/state-laws.json failed its checks:\n  ${problems.join("\n  ")}`);
  return { ef: ef.file, adm: ad.file, efFallback: ef.fallback, admFallback: ad.fallback, laws };
}

/** Sets `school.lgbtq` and, where a value's year or document differs from its field's default, its lineage. */
export function addLgbtq(school: School, inputs: LgbtqInputs): void {
  const gender = genderFrom(inputs.ef.rows.get(school.unit_id));
  const admissions = genderAdmissionsFrom(inputs.adm.rows.get(school.unit_id));
  const law = stateLawFor(school, inputs.laws);
  const lgbtq = lgbtqFrom(gender, admissions, law);
  if (!lgbtq) return;
  school.lgbtq = lgbtq;
  const lineage: Partial<Record<FieldPath, LineageRecord>> = {};
  if (gender && inputs.efFallback) lineage["lgbtq.gender"] = { source: "ipeds-ef-a", year: `Fall ${inputs.ef.year}`, url: inputs.ef.url };
  if (admissions && inputs.admFallback) lineage["lgbtq.admissions"] = { source: "ipeds-adm", year: `Fall ${inputs.adm.year}`, url: inputs.adm.url };
  if (law) lineage["lgbtq.state_law"] = { source: "state-law", year: effectiveLabel(law.effective), url: law.url, retrieved: law.checked };
  if (Object.keys(lineage).length) school.lineage = { ...(school.lineage ?? {}), ...lineage };
}

export function addStateLawMeta(meta: DatasetMeta, laws: StateLawTable): void {
  meta.sources["state-law"] = {
    label: "State laws on public colleges",
    publisher: "State legislatures (statutes read and summarized by hand)",
    edition: `Reviewed ${laws.reviewed}`,
    url: laws.laws[0]?.url ?? "https://capitol.texas.gov/",
    description: `Laws that limit what public colleges in a state may offer, such as identity-based offices and programs, each with its statute, effective date, and a one-line summary checked against the statute text. Now: ${laws.laws.map((l) => l.name).join(", ") || "none"}.`,
  };
}

/** Coverage line for the sync's summary. */
export function lgbtqSummary(schools: School[], inputs: LgbtqInputs): string {
  const g = schools.map((s) => s.lgbtq?.gender).filter((x) => x);
  const by = (st: string) => g.filter((x) => x!.status === st).length;
  const counted = g.filter((x) => x!.status === "reported" && (x!.another ?? 0) > 0).length;
  const zero = g.filter((x) => x!.status === "reported" && x!.another === 0).length;
  const adm = schools.filter((s) => s.lgbtq?.admissions?.status === "reported").length;
  const laws = schools.filter((s) => s.lgbtq?.state_law).length;
  return `another gender (${inputs.ef.name}): ${counted} count, ${zero} report 0, ${by("withheld")} withheld, ${by("not_collected")} not collected; ${adm} report applicants (${inputs.adm.name}); ${laws} public colleges with a state law`;
}
