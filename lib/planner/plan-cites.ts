/**
 * One citation of the plan, resolved the way lib/planner/context.ts `planSchoolFor` resolves it: `citeField`, except
 * the GPA fields, whose ⓘ carries the fitted model's own formula (lib/planner/gpa-model.ts `gpaCites`). `GET /api/cite`
 * answers a plan reference (lib/lineage.ts `CiteRef`) with this, so the ⓘ that opens one shows exactly what the plan
 * used to ship. Pure: the caller passes the dataset's `citeField` and the fitted models.
 */
import { HIDDEN_FIELDS, isFieldPath, type FieldPath } from "../fields.ts";
import type { School } from "../types.ts";
import { citeRefOf, type AnyCited, type Cited, type CiteLike } from "../lineage.ts";
import { collegeGpa, gpaCites, type GpaCurve, type GpaModel } from "./gpa-model.ts";

/** Whether a plan carries full citations (the print page) or references the ⓘ fetches on open (everything else). */
export type CiteMode = "full" | "ref";

/** The GPA fields, cited with the fitted model's formula rather than the registry's alone. */
export const GPA_CITE_PATHS: ReadonlySet<string> = new Set([
  "reported.admission_profile.gpa.average",
  "derived.gpa_band_mean",
  "derived.gpa_middle_half",
  "derived.gpa_estimate",
]);

export function planCiteFor(
  school: School,
  path: FieldPath,
  citeField: (path: FieldPath, school?: School) => Cited,
  models: { gpaModel: GpaModel | null; gpaCurve: GpaCurve | null },
): AnyCited {
  if (GPA_CITE_PATHS.has(path)) {
    const gpa = collegeGpa(school, models.gpaModel, models.gpaCurve);
    const cited = gpaCites(school, gpa, models.gpaModel, citeField as (path: FieldPath, school: never) => Cited, models.gpaCurve)[path];
    if (cited) return cited;
  }
  return citeField(path, school);
}

const HIDDEN: ReadonlySet<string> = new Set(HIDDEN_FIELDS);

/**
 * A page's citation (`citeField(path, school)`, nothing changed after it) as a reference the ⓘ fetches on open, where
 * `GET /api/cite` answers that same citation (round 4: the list page, the offers facts, the college page's estimate
 * facts; specs/data-lineage.md "Citations on the plan"). Kept whole where it wouldn't: a GPA field (the API answers
 * with the fitted model's formula, `planCiteFor`), a path the registry hides or doesn't list (the API's 404).
 */
export function citeRefWhereSame(cited: AnyCited, unit: string): CiteLike {
  if (GPA_CITE_PATHS.has(cited.path) || !isFieldPath(cited.path) || HIDDEN.has(cited.path)) return cited;
  return citeRefOf(cited, unit);
}
