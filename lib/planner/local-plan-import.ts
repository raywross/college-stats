"use server";
/**
 * Importing a signed-out plan once the visitor signs up (specs/planner/redesign/page.md "Signed out" step 3): the
 * colleges go on the student's default list (the existing list actions in lib/lists.ts), the Dream is set, and only
 * the groups/rounds the visitor actually picked themselves become `student` source — an `auto` one is left for the
 * model to keep sorting (lib/planner/plan-view.ts `autoWrites` runs on the next plan open either way). The numbers
 * import separately, through the existing `ImportLocalProfile` flow (components/me/ImportLocalProfile.tsx); this
 * only moves colleges. `components/planner/ImportLocalPlan.tsx` is the one caller.
 */
import { getUser } from "@/lib/auth";
import { addToList, getListWithItems, getOrCreateDefaultList } from "@/lib/lists";
import { localImportPlan, sanitizeLocalPlan } from "./local-plan";
import { setGroup, setPlanDream, setPlanRound } from "./store-plan";

export type LocalPlanImportResult = { ok: true; imported: number } | { ok: false; message: string };

/** Signed in only (the caller renders for the signed-in student's own `/plan` open); refuses otherwise. */
export async function importLocalPlan(studentId: string, local: unknown): Promise<LocalPlanImportResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  const plan = sanitizeLocalPlan(local);
  if (plan.unitIds.length === 0) return { ok: true, imported: 0 };

  const list = await getOrCreateDefaultList(studentId);
  if (!list) return { ok: false, message: "That didn't work. Try again in a moment." };

  const before = await getListWithItems(list.id);
  const existingUnitIds = (before?.items ?? []).map((i) => i.unit_id);
  const toImport = localImportPlan(plan, existingUnitIds);

  for (const unitId of toImport.toAdd) {
    await addToList(list.id, unitId);
  }
  if (toImport.toAdd.length === 0 && toImport.dreamUnitId === null && toImport.groupWrites.length === 0 && toImport.roundWrites.length === 0) {
    return { ok: true, imported: 0 };
  }

  const after = await getListWithItems(list.id);
  const itemIdByUnit = new Map((after?.items ?? []).map((i) => [i.unit_id, i.id]));

  if (toImport.dreamUnitId) {
    const itemId = itemIdByUnit.get(toImport.dreamUnitId);
    if (itemId) await setPlanDream(itemId, true);
  }
  for (const w of toImport.groupWrites) {
    const itemId = itemIdByUnit.get(w.unitId);
    if (itemId) await setGroup(itemId, w.group);
  }
  for (const w of toImport.roundWrites) {
    const itemId = itemIdByUnit.get(w.unitId);
    if (itemId) await setPlanRound(itemId, w.round);
  }

  return { ok: true, imported: toImport.toAdd.length };
}
