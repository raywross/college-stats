/**
 * NCES Private School Survey (PSS): private schools offering grade 12. Directory, enrollment by grade and race,
 * student-teacher ratio, religious affiliation / orientation. No rigor or graduation rate (null, not suppressed).
 * Ids are the PSS `ppin` (isPrivateHighSchoolId in lib/high-school-core.ts; verify the format against the file).
 *
 * STUB: the private-schools unit (feature/high-school-private) replaces `load`. Until then it loads nothing, and the
 * sync leaves private rows as they are.
 */
import type { AdapterContext, AdapterInfo, AdapterResult } from "./types.mts";

export const info: AdapterInfo = {
  key: "pss",
  role: "directory",
  rowKind: "private",
  owns: [
    "name", "state", "city", "zip", "address", "lat", "lng", "locale", "district", "state_school_id", "grades", "status",
    "school_type", "affiliation", "enrollment", "student_teacher_ratio", "frl_share", "grad_rate", "rigor",
  ],
  sources: ["nces-pss"],
  vintages: ["pss"],
};

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  ctx.warn("pss: adapter not built yet (stub); private rows unchanged.");
  return { sources: {}, vintages: {}, notes: ["pss: stub, nothing loaded"] };
}
