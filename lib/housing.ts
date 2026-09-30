/**
 * Housing and policies (specs/data-expansion/housing-and-policies.md): beds per 100 undergrads and the Explore filter
 * rules. Pure, so the dataset, the profile, and tests share one definition.
 */
import type { School } from "./types";

/** Beds per 100 undergrads, rounded; null without housing capacity. Capacity can include graduate housing. */
export function bedsPer100(s: Pick<School, "campus" | "demographics">): number | null {
  const cap = s.campus?.housing?.capacity;
  const ug = s.demographics.undergrad_enrollment;
  return cap != null && ug > 0 ? Math.round((cap / ug) * 100) : null;
}

export const requiresLiveOn = (s: Pick<School, "campus">) => s.campus?.housing?.first_years_required === true;
export const noApplicationFee = (s: Pick<School, "admissions">) => s.admissions.application_fee === 0;
export const hasTuitionGuarantee = (s: Pick<School, "cost">) => !!s.cost?.tuition_plans?.includes("guarantee");

export type HousingFilterParam = "liveOn" | "noFee" | "guarantee";

/** Explore's housing and policy chips: URL parameter, label, and test. */
export const HOUSING_FILTERS: readonly { param: HousingFilterParam; label: string; test: (s: School) => boolean }[] = [
  { param: "liveOn", label: "First-years live on campus", test: requiresLiveOn },
  { param: "noFee", label: "No application fee", test: noApplicationFee },
  { param: "guarantee", label: "Tuition guarantee", test: hasTuitionGuarantee },
];
