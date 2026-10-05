/**
 * New York state report card adapter: report card database: proficiency, chronic absence, postsecondary enrollment. Writes data/high-schools/state/ny.json through
 * `npm run sync-hs-states -- --state ny`.
 *
 * STUB: the state unit (feature/high-school-states-a) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "NY",
  source: "state-ny",
  name: "New York school report card data",
  publisher: "New York State Education Department",
  url: "https://data.nysed.gov/downloads.php",
  built: false,
  async load() {
    throw new Error("NY state adapter not built yet (feature/high-school-states-a)");
  },
};
