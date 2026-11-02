/**
 * How the signed-in viewer stands to a student (specs/product/counselor-portal.md "Model"; specs/product/accounts.md
 * "Privacy model"): the student themselves (`self`), a parent in their household (`guardian`), or a counselor the
 * student or a parent granted access (`counselor`). Pure, so pages and components share one reading.
 *
 * Two questions, kept apart on purpose:
 * - **Is this someone other than the student?** (`isViewer`): the banner, read-only or editing by `canEdit`, logging
 *   the read, redacting the story, "Added by" attribution, no first-run intake. A guardian and a counselor alike.
 * - **Is this a parent?** (`isParent`): nudges, Your part, the money lane's "your part", estimate sharing, the child
 *   switcher, the parent summary email, texts, anything about the household. Never a counselor.
 *
 * tests/viewer-relation.test.mts sweeps app/, components/, and lib/ for `relation === "guardian"` and its kin; each
 * comparison that really means "a parent" is listed there with its reason.
 */
import type { StudentAccess } from "./accounts.ts";

export type ViewerRelation = StudentAccess["relation"];

/** The role words telemetry and the essays use for a viewer: the student, a parent, or a counselor. */
export type ViewerRole = "student" | "guardian" | "counselor";

/** Someone other than the student, looking at the student's information with their own session. */
export function isViewer(relation: ViewerRelation): boolean {
  return relation !== "self";
}

/** A parent or other guardian in the student's household (never a counselor). */
export function isParent(relation: ViewerRelation): boolean {
  return relation === "guardian";
}

/** The role word for a relation: `self` is the student. */
export function viewerRole(relation: ViewerRelation): ViewerRole {
  return relation === "self" ? "student" : relation;
}

/**
 * The role word for a plan's viewer (PlanContext.viewer, whose relation may also be the older `household`, which reads
 * as a parent): what telemetry's `viewer` and `by` carry.
 */
export function planViewerRole(viewer: { relation: ViewerRelation | "household" }): ViewerRole {
  return viewer.relation === "household" ? "guardian" : viewerRole(viewer.relation);
}
