import "server-only";
/**
 * What the Health page's two views read (specs/product/admin-health-views.md): every college's estimate inputs,
 * worked out once per server instance from the dataset (it never changes while an instance runs), and the published
 * files with their health. `data/source-files.json` is a few KB and imported, so nothing extra is traced for /admin.
 * Callers check requireAdmin() first.
 */
import sourceFilesJson from "../../data/source-files.json" with { type: "json" };
import { getData } from "@/lib/data";
import { gpaCurve, gpaModel } from "@/lib/planner/gpa-model-server";
import { collegeGpa } from "@/lib/planner/gpa-model";
import { selectivityTier } from "@/lib/metrics";
import type { Cited } from "@/lib/lineage";
import { CORE_INPUT_KEYS, ESTIMATE_INPUTS, INPUT_LABELS, collegeInputs, countInputs, editionPublished, sortInputsWorstFirst, type CollegeInputs, type InputCounts, type PublishedFor } from "./estimate-inputs";
import { sourceFileRows, type SourceFileRow, type SourceFilesRecord } from "./source-files";
import { csvCell } from "./health";

const sourceFiles = sourceFilesJson as SourceFilesRecord;

/** One table row: the college's inputs and what the table shows beside them. */
export interface InputRowView {
  inputs: CollegeInputs;
  name: string;
  state: string;
  admitRate: number | null;
  tier: { label: string; level: number };
}

export interface InputsOverview {
  /** Worst first. */
  all: InputRowView[];
  counts: InputCounts;
  /** The estimate inputs each source key feeds at any college, in input order (the Files view's column). */
  feeds: Record<string, string[]>;
  /** ISO date measured. */
  today: string;
}

/** The published files and their health, measured today. */
export async function loadSourceFiles(today: string = new Date().toISOString().slice(0, 10)): Promise<{ rows: SourceFileRow[]; checked: string }> {
  const data = await getData();
  return { rows: sourceFileRows(data.getMeta(), sourceFiles, data.getReleaseCalendar(), today), checked: sourceFiles.checked };
}

/** A citation's published date: its source file's date, else a college document's edition. */
function publishedFrom(rows: readonly SourceFileRow[]): PublishedFor {
  const bySource = new Map(rows.map((r) => [r.source as string, r.published]));
  return (c: Cited) => bySource.get(c.key) ?? editionPublished(c);
}

let cached: Promise<InputsOverview> | null = null;

async function build(): Promise<InputsOverview> {
  const today = new Date().toISOString().slice(0, 10);
  const [data, model, curve, files] = await Promise.all([getData(), gpaModel(), gpaCurve(), loadSourceFiles(today)]);
  const published = publishedFrom(files.rows);
  const rows: InputRowView[] = data.getAllSchools().map((school) => {
    const admitRate = school.admissions.acceptance_rate ?? null;
    return {
      inputs: collegeInputs(school, data.citeField, { gpa: collegeGpa(school, model, curve) }, published),
      name: school.name,
      state: school.location.state,
      admitRate,
      tier: selectivityTier(admitRate),
    };
  });
  const feeds: Record<string, Set<string>> = {};
  for (const r of rows) for (const i of r.inputs.inputs) for (const f of i.fields) for (const k of f.sourceKeys) (feeds[k] ??= new Set()).add(i.key);
  const order = ESTIMATE_INPUTS.map((i) => i.key as string);
  const feedLabels = Object.fromEntries(
    Object.entries(feeds).map(([k, set]) => [k, order.filter((key) => set.has(key)).map((key) => INPUT_LABELS[key as keyof typeof INPUT_LABELS])]),
  );
  return { all: sortInputsWorstFirst(rows), counts: countInputs(rows.map((r) => r.inputs)), feeds: feedLabels, today };
}

/** Every college's estimate inputs, worst first, with counts. Computed once per server instance; a failed build is not kept. */
export function inputsOverview(): Promise<InputsOverview> {
  cached ??= build().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

/** One college's inputs (the college admin page), from the same overview. */
export async function collegeInputsFor(unitId: string): Promise<CollegeInputs | null> {
  return (await inputsOverview()).all.find((r) => r.inputs.unitId === unitId)?.inputs ?? null;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export const INPUTS_CSV_COLUMNS: readonly string[] = [
  "unit_id",
  "name",
  "overall",
  ...CORE_INPUT_KEYS.flatMap((k) => [`${k}_status`, `${k}_year`, `${k}_reason`]),
];

/** One line per college in the order given; per core input its status, the year it describes, and why. */
export function inputsCsv(rows: readonly InputRowView[]): string {
  const lines = [INPUTS_CSV_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) {
    const cells: (string | null)[] = [r.inputs.unitId, r.name, r.inputs.overall];
    for (const key of CORE_INPUT_KEYS) {
      const i = r.inputs.inputs.find((x) => x.key === key);
      cells.push(i?.status ?? "", i?.year ?? "", i?.reason ?? "");
    }
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
