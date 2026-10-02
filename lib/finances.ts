/**
 * Finances (specs/data-expansion/finances.md): how an IPEDS `DRVF{Y}` row becomes `school.finances`. Pure: sync-data
 * and tests share it. IPEDS reports finances on three different accounting forms by sector — F1 (GASB, public), F2
 * (FASB, private nonprofit), F3 (for-profit) — that aren't comparable, so every school reports exactly one, and
 * every benchmark (lib/metrics.ts instructionGasb/Fasb/Forprofit, endowmentGasb/Fasb) stays within that same form.
 */
import type { FinanceForm, School, SchoolFinances } from "./types";

type Row = Record<string, string> | undefined;

function num(row: Row, col: string): number | null {
  const raw = row?.[col];
  if (raw === undefined || raw === "" || raw === ".") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** Column prefix for each form, and whether that form reports an endowment (for-profits don't). */
const FORM_COLUMNS: Record<FinanceForm, { prefix: string; hasEndowment: boolean }> = {
  gasb: { prefix: "F1", hasEndowment: true },
  fasb: { prefix: "F2", hasEndowment: true },
  forprofit: { prefix: "F3", hasEndowment: false },
};
const REPORTED_COLUMNS = ["TUFEPC", "INSTFT", "ACSPFT", "STSVFT", "ENDMFT"];

/**
 * `DRVF{Y}`: whichever of F1/F2/F3 has values for this college. Verified against the snapshot's 1,892 colleges
 * (fiscal 2023–24): every one reports exactly one form, matching its sector 98.4% of the time (31 colleges' reported
 * form differs from `school.type`, likely a sector change NCES hasn't caught up with yet; the reported form is what
 * decides benchmarking, since that's the sector its own figures were filed under). Throws if a row ever reports more
 * than one form (would mean NCES changed the file's shape). Null when the college isn't in the file yet.
 */
/** Instruction spending per student: a college that teaches can't spend 0, so 0 (3 colleges in DRVF2024) is unreported. */
export function instructionSpending(v: number | null | undefined): number | null {
  return v === null || v === undefined || !(v > 0) ? null : v;
}

export function financesFrom(row: Row, fiscalYear: number | null): SchoolFinances | null {
  if (!row) return null;
  const reports = (prefix: string) => REPORTED_COLUMNS.some((c) => num(row, `${prefix}${c}`) !== null);
  const forms = (Object.keys(FORM_COLUMNS) as FinanceForm[]).filter((f) => reports(FORM_COLUMNS[f].prefix));
  if (forms.length > 1) throw new Error(`DRVF row reports more than one finance form: ${forms.join(", ")}`);
  if (forms.length === 0) return null;
  const form = forms[0];
  const { prefix, hasEndowment } = FORM_COLUMNS[form];
  const tuitionShare = num(row, `${prefix}TUFEPC`);
  return {
    fiscal_year: fiscalYear,
    form,
    endowment_per_student: hasEndowment ? num(row, `${prefix}ENDMFT`) : null,
    instruction_per_student: instructionSpending(num(row, `${prefix}INSTFT`)),
    student_services_per_student: num(row, `${prefix}STSVFT`),
    academic_support_per_student: num(row, `${prefix}ACSPFT`),
    // Stored as a column (20 → 0.20), the site's convention for shares.
    tuition_share_of_revenue: tuitionShare === null ? null : tuitionShare / 100,
  };
}

/** Instruction spending per student, only for a college that reports on `form` (the sector-scoped benchmarks). */
export function instructionOnForm(s: School, form: FinanceForm): number | null {
  return s.finances?.form === form ? s.finances.instruction_per_student : null;
}

/** Endowment per student, only for a college that reports on `form`; for-profits report no endowment. */
export function endowmentOnForm(s: School, form: FinanceForm): number | null {
  return s.finances?.form === form ? s.finances.endowment_per_student : null;
}

/** The metric (lib/metrics.ts) that ranks a college against its own accounting form only. */
export const INSTRUCTION_METRIC = { gasb: "instructionGasb", fasb: "instructionFasb", forprofit: "instructionForprofit" } as const satisfies Record<FinanceForm, string>;
export const ENDOWMENT_METRIC = { gasb: "endowmentGasb", fasb: "endowmentFasb" } as const satisfies Partial<Record<FinanceForm, string>>;

/** The endowment metric for a college's own form, or null (no finances, or a for-profit). */
export function endowmentMetricFor(s: School): (typeof ENDOWMENT_METRIC)[keyof typeof ENDOWMENT_METRIC] | null {
  const form = s.finances?.form;
  return form === "gasb" || form === "fasb" ? ENDOWMENT_METRIC[form] : null;
}

export const FORM_LABELS: Record<FinanceForm, string> = {
  gasb: "public colleges",
  fasb: "private nonprofit colleges",
  forprofit: "for-profit colleges",
};

/** "public (GASB)", for the glossary and the foundation caveat. */
export const FORM_SHORT: Record<FinanceForm, string> = {
  gasb: "public, GASB accounting",
  fasb: "private nonprofit, FASB accounting",
  forprofit: "for-profit",
};
