/**
 * Florida state report card adapter: school accountability and postsecondary outcomes downloads. Writes data/high-schools/state/fl.json through
 * `npm run sync-hs-states -- --state fl`.
 *
 * STUB: the state unit (feature/high-school-states-b) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "FL",
  source: "state-fl",
  name: "Florida school report card data",
  publisher: "Florida Department of Education",
  url: "https://www.fldoe.org/accountability/data-sys/edu-info-accountability-services/",
  built: false,
  async load() {
    throw new Error("FL state adapter not built yet (feature/high-school-states-b)");
  },
};
