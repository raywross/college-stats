import "server-only";
/**
 * The GPA model fitted from the dataset (specs/planner/redesign/gpa.md "The model"), once per server instance: the
 * dataset never changes while an instance runs, and a new dataset ships as a new deploy, so the model follows every
 * new Common Data Set with no generated file to rebuild. Null when the guard refuses the fit (lib/planner/gpa-model.ts).
 */
import { getData } from "@/lib/data";
import { fitGpaModel, trainingRows, type GpaModel } from "./gpa-model";

let fitted: { schools: unknown; model: GpaModel | null } | null = null;

export async function gpaModel(): Promise<GpaModel | null> {
  const { getAllSchools } = await getData();
  const schools = getAllSchools();
  if (fitted?.schools !== schools) fitted = { schools, model: fitGpaModel(trainingRows(schools)) };
  return fitted.model;
}
