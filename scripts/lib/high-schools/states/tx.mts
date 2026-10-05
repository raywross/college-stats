/**
 * Texas state report card adapter: TAPR: college-going, AP/IB, STAAR proficiency, attendance. Writes data/high-schools/state/tx.json through
 * `npm run sync-hs-states -- --state tx`.
 *
 * STUB: the state unit (feature/high-school-states-a) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "TX",
  source: "state-tx",
  name: "Texas school report card data",
  publisher: "Texas Education Agency",
  url: "https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/texas-academic-performance-reports",
  built: false,
  async load() {
    throw new Error("TX state adapter not built yet (feature/high-school-states-a)");
  },
};
