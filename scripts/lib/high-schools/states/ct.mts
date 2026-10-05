/**
 * Connecticut state report card adapter: EdSight: National Student Clearinghouse college entrance and persistence. Writes data/high-schools/state/ct.json through
 * `npm run sync-hs-states -- --state ct`.
 *
 * STUB: the state unit (feature/high-school-states-b) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "CT",
  source: "state-ct",
  name: "Connecticut school report card data",
  publisher: "Connecticut State Department of Education",
  url: "https://edsight.ct.gov/",
  built: false,
  async load() {
    throw new Error("CT state adapter not built yet (feature/high-school-states-b)");
  },
};
