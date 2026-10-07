/**
 * Per-college detail files (lib/detail.ts): read data/detail/schools/ and check every file, for check:lineage, the merge
 * scripts and tests. The files ship with the deploy (specs/serving-architecture.md), so nothing publishes them any more;
 * the module keeps its name so its importers don't change.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../../lib/types.ts";
import { detailMismatches, validateDetail, type SchoolDetail } from "../../lib/detail.ts";

/** Every file in data/detail/schools/, sorted by unit ID; null when the folder doesn't exist. */
export function readDetails(root: string): SchoolDetail[] | null {
  const dir = join(root, "data", "detail", "schools");
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as SchoolDetail;
      if (`${d.unit_id}.json` !== f) throw new Error(`data/detail/schools/${f}: file name doesn't match unit_id ${d.unit_id}`);
      return d;
    });
}

/** The same checks as check:lineage: every file valid and consistent with data/schools.json. */
export function detailFileProblems(details: readonly SchoolDetail[], schools: readonly School[], meta: DatasetMeta): string[] {
  const ids = new Set(schools.map((s) => s.unit_id));
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  return details.flatMap((d) => [...validateDetail(d, meta, ids), ...(byId.has(d.unit_id) ? detailMismatches(byId.get(d.unit_id)!, d) : [])]);
}
