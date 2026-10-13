import "server-only";
/**
 * What /admin/colleges/[unit] reads (specs/product/admin.md "A college"): the college from the dataset, its
 * selectivity breakdown, the GPA the standing model reads, its hidden derived fields (lib/admin/hidden.ts, pure), and
 * its data health card (lib/admin/health.ts). Every read is a deployed file or the fitted models; nothing here touches
 * family data. Callers check requireAdmin() first (the page does).
 */
import { getData } from "@/lib/data";
import { healthOverview, type CollegeHealth } from "@/lib/admin/health";
import { gpaCurve, gpaModel } from "@/lib/planner/gpa-model-server";
import type { School } from "@/lib/types";
import { gpaPanel, hiddenFieldRows, selectivityContext, selectivityPanel, type GpaPanel, type HiddenFieldRow, type SelectivityPanel } from "./hidden";

export interface AdminCollege {
  school: School;
  selectivity: SelectivityPanel;
  gpa: GpaPanel;
  hidden: HiddenFieldRow[];
  /** Null when the health file couldn't be read, or the college isn't in it. */
  health: CollegeHealth | null;
  /** When the health inputs were measured (the compact file's date), for the card's caption. */
  healthGenerated: string | null;
}

/** The college's hidden values and health, or null for a unit id the dataset doesn't have. */
export async function adminCollege(unitId: string): Promise<AdminCollege | null> {
  const data = await getData();
  const school = data.getSchoolById(unitId);
  if (!school) return null;
  const [model, curve, overview] = await Promise.all([
    gpaModel(),
    gpaCurve(),
    healthOverview().catch((err) => {
      console.error("[admin college] the health overview could not be read; the health card is left out.", err);
      return null;
    }),
  ]);
  const selectivity = selectivityPanel(school, selectivityContext(data.getAllSchools()));
  return {
    school,
    selectivity,
    gpa: gpaPanel(school, model, curve),
    hidden: hiddenFieldRows(school, { selectivity }),
    health: overview?.colleges.find((c) => c.unitId === unitId) ?? null,
    healthGenerated: overview?.generated ?? null,
  };
}
