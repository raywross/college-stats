/**
 * Illinois state report card adapter: report card data: college enrollment and persistence, proficiency, chronic absence. Writes data/high-schools/state/il.json through
 * `npm run sync-hs-states -- --state il`.
 *
 * STUB: the state unit (feature/high-school-states-b) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "IL",
  source: "state-il",
  name: "Illinois school report card data",
  publisher: "Illinois State Board of Education",
  url: "https://www.isbe.net/ilreportcarddata",
  built: false,
  async load() {
    throw new Error("IL state adapter not built yet (feature/high-school-states-b)");
  },
};
