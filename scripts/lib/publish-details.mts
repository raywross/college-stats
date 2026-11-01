/**
 * Per-college detail files (lib/detail.ts): read a folder of `<unit_id>.json` detail files (a snapshot's `detail/`,
 * such as the bundled copy's) and check every file, for check:lineage and tests. The publisher renders them; the
 * module keeps its name so its importers don't change.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../../lib/types.ts";
import { detailMismatches, validateDetail, type SchoolDetail } from "../../lib/detail.ts";

/** Every `<unit_id>.json` in `dir` (a folder of detail files), sorted by unit ID; null when the folder doesn't exist. */
export function readDetails(dir: string): SchoolDetail[] | null {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as SchoolDetail;
      if (`${d.unit_id}.json` !== f) throw new Error(`${join(dir, f)}: file name doesn't match unit_id ${d.unit_id}`);
      return d;
    });
}

/** The same checks as check:lineage: every file valid and consistent with the composed colleges. */
export function detailFileProblems(details: readonly SchoolDetail[], schools: readonly School[], meta: DatasetMeta): string[] {
  const ids = new Set(schools.map((s) => s.unit_id));
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  return details.flatMap((d) => [...validateDetail(d, meta, ids), ...(byId.has(d.unit_id) ? detailMismatches(byId.get(d.unit_id)!, d) : [])]);
}
