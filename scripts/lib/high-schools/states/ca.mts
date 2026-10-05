/**
 * California state report card adapter: college-going rate, AP, proficiency, chronic absence (CDE DataQuest downloads). Writes data/high-schools/state/ca.json through
 * `npm run sync-hs-states -- --state ca`.
 *
 * STUB: the state unit (feature/high-school-states-a) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "CA",
  source: "state-ca",
  name: "California school report card data",
  publisher: "California Department of Education",
  url: "https://www.cde.ca.gov/ds/",
  built: false,
  async load() {
    throw new Error("CA state adapter not built yet (feature/high-school-states-a)");
  },
};
