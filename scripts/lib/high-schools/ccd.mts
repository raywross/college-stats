/**
 * NCES Common Core of Data (CCD): the public high school directory, membership (enrollment by grade, race, sex),
 * school characteristics (Title I, charter, magnet, virtual), staff (student-teacher ratio), and lunch (FRL share).
 * Bulk files from NCES (specs/product/high-school-data.md, open question 1).
 *
 * STUB: the federal unit (feature/high-school-federal) replaces `load`. Until then it loads nothing, and the sync
 * leaves public rows as they are.
 */
import type { AdapterContext, AdapterInfo, AdapterResult } from "./types.mts";

export const info: AdapterInfo = {
  key: "ccd",
  role: "directory",
  rowKind: "public",
  owns: [
    "name", "state", "city", "zip", "address", "lat", "lng", "locale", "district", "state_school_id", "grades", "status",
    "school_type", "affiliation", "enrollment", "student_teacher_ratio", "frl_share",
  ],
  sources: ["nces-ccd"],
  vintages: ["ccd-directory", "ccd-enrollment"],
};

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  ctx.warn("ccd: adapter not built yet (stub); public rows unchanged.");
  return { sources: {}, vintages: {}, notes: ["ccd: stub, nothing loaded"] };
}
