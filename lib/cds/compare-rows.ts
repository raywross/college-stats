/**
 * Compare's "All the numbers" rows for the CDS admissions profile (specs/data-expansion/cds-admissions.md, Display:
 * Compare). Table rows only: no CompareMetric card, radar axis, or key-difference sentence reads these.
 */
import type { FieldPath } from "../fields";
import type { TermKey } from "../glossary";
import type { AdmissionFactor, School } from "../types";
import { C7_FACTORS, IMPORTANCE_LABELS, SHARED_FACTORS, admissionProfile, c7LevelFor, edRate } from "./admissions.ts";
import { num, pct, pctSmart } from "../format.ts";

type Row = readonly [string, TermKey, FieldPath, (s: School) => string | null];

const P = "reported.admission_profile";

/** C7 rows IPEDS doesn't ask about; the six shared ones show in the federal factor rows (`c7FactorCell`). */
const C7_ONLY = C7_FACTORS.filter((f) => !(f.key in SHARED_FACTORS));

export const ADMISSION_PROFILE_ROWS: readonly Row[] = [
  [
    "Average high school GPA",
    "high-school-gpa",
    `${P}.gpa.average` as FieldPath,
    (s) => {
      const g = admissionProfile(s)?.gpa;
      if (!g || g.average === null) return null;
      return `${g.average.toFixed(2)}${g.scale === "weighted" ? " weighted" : ""}`;
    },
  ],
  [
    "First-years in the top tenth of their class",
    "class-rank",
    `${P}.class_rank.top_tenth` as FieldPath,
    (s) => {
      const r = admissionProfile(s)?.class_rank;
      return r && r.top_tenth !== null ? `${pct(r.top_tenth)} (of the ${pct(r.submitted_share)} with a rank)` : null;
    },
  ],
  [
    "Early decision",
    "early-decision",
    `${P}.early_decision.offered` as FieldPath,
    (s) => {
      const ed = admissionProfile(s)?.early_decision;
      if (!ed) return null;
      if (!ed.offered) return "Not offered";
      const rate = edRate(ed);
      return rate !== null ? `${pctSmart(rate)} of ${num(ed.applicants!)} admitted` : "Offered; no counts";
    },
  ],
  [
    "Early action",
    "early-action",
    `${P}.early_action.offered` as FieldPath,
    (s) => {
      const ea = admissionProfile(s)?.early_action;
      if (!ea) return null;
      return !ea.offered ? "Not offered" : ea.restrictive ? "Offered, restrictive" : "Offered";
    },
  ],
  [
    "Wait list",
    "wait-list",
    `${P}.wait_list.policy` as FieldPath,
    (s) => {
      const w = admissionProfile(s)?.wait_list;
      if (!w) return null;
      if (w.admitted !== null && w.accepted !== null) return `${num(w.admitted)} admitted of ${num(w.accepted)} who accepted`;
      if (w.admitted !== null) return `${num(w.admitted)} admitted`;
      if (w.policy === false) return "No wait list";
      return w.policy ? "Uses one; numbers not published" : null;
    },
  ],
  ...C7_ONLY.map(
    (f) =>
      [
        `Admission: ${f.label}`,
        "factor-importance",
        `${P}.factors.${f.key}` as FieldPath,
        (s: School) => {
          const level = admissionProfile(s)?.factors?.[f.key];
          return level ? IMPORTANCE_LABELS[level] : null;
        },
      ] as const
  ),
];

/** The C7 level for one of the federal factor rows, when the college's CDS has it ("Very important"). */
export function c7FactorCell(s: School, k: AdmissionFactor): string | null {
  const level = c7LevelFor(s, k);
  return level ? IMPORTANCE_LABELS[level] : null;
}

/**
 * The field a cell's muted year comes from, when it isn't the row's: a federal factor row showing a C7 level cites
 * the CDS item; Early decision with counts cites the counts (the entering class), not the plan's edition.
 */
export function admissionProfileCellField(label: string, s: School): FieldPath | null {
  const factor = /^Admission: (.+)$/.exec(label)?.[1];
  if (factor) {
    const shared = Object.entries(SHARED_FACTORS).find(([, ipeds]) => FEDERAL_LABEL[ipeds as AdmissionFactor] === factor);
    if (shared && c7LevelFor(s, shared[1] as AdmissionFactor)) return `${P}.factors.${shared[0]}` as FieldPath;
    return null;
  }
  if (label === "Early decision" && edRate(admissionProfile(s)?.early_decision) !== null) return `${P}.early_decision.admitted` as FieldPath;
  return null;
}

/** The federal factor rows' labels in app/compare/page.tsx (FACTOR_ROWS), for the shared six. */
const FEDERAL_LABEL: Partial<Record<AdmissionFactor, string>> = {
  gpa: "High school GPA",
  class_rank: "Class rank",
  recommendations: "Recommendations",
  essay: "Essay",
  legacy: "Legacy status",
  work_experience: "Work experience",
};
