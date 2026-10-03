/**
 * Explore's admission-factor filters (specs/data-expansion/admission-factors.md). Pure, so the dataset, the filter
 * panel, and tests share one definition. A college that doesn't report the factor never matches.
 */
import type { School } from "./types";
import { hasGpaData } from "./cds/admissions.ts";

export type FactorFilterParam = "noLegacy" | "noEssay" | "gpaRequired" | "gpa";

export const FACTOR_FILTERS: readonly { param: FactorFilterParam; label: string; test: (s: School) => boolean }[] = [
  { param: "noLegacy", label: "Doesn't consider legacy", test: (s) => s.admissions.factors?.legacy === "not_considered" },
  { param: "noEssay", label: "Essay not required", test: (s) => !!s.admissions.factors?.essay && s.admissions.factors.essay !== "required" },
  { param: "gpaRequired", label: "GPA required", test: (s) => s.admissions.factors?.gpa === "required" },
  // CDS C11/C12 (specs/data-expansion/cds-admissions.md): a filter only, never a sort, column, or range.
  { param: "gpa", label: "Publishes first-years' GPA", test: hasGpaData },
];
