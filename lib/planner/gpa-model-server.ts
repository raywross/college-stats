import "server-only";
/**
 * The GPA models fitted from the dataset (specs/planner/redesign/gpa.md "The model" and "The GPA curve"), once per
 * server instance: the dataset never changes while an instance runs, and a new dataset ships as a new deploy, so the
 * models follow every new Common Data Set with no generated file to rebuild. Each is null when its guard refuses the
 * fit (lib/planner/gpa-model.ts): the average model, and the p25/p75 pair behind an estimated middle 50%.
 */
import { getData } from "@/lib/data";
import { curveRows, fitGpaCurve, fitGpaModel, trainingRows, type GpaCurve, type GpaModel } from "./gpa-model";

let fitted: { schools: unknown; model: GpaModel | null; curve: GpaCurve | null } | null = null;

async function fit() {
  const { getAllSchools } = await getData();
  const schools = getAllSchools();
  if (fitted?.schools !== schools) fitted = { schools, model: fitGpaModel(trainingRows(schools)), curve: fitGpaCurve(curveRows(schools)) };
  return fitted;
}

/** The average GPA model. */
export async function gpaModel(): Promise<GpaModel | null> {
  return (await fit()).model;
}

/** The p25 and p75 models, or null when either fails its guard. */
export async function gpaCurve(): Promise<GpaCurve | null> {
  return (await fit()).curve;
}
