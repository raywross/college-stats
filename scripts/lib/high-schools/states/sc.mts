/**
 * South Carolina state report card adapter: report cards and the EOC's National Student Clearinghouse reports. Writes data/high-schools/state/sc.json through
 * `npm run sync-hs-states -- --state sc`.
 *
 * STUB: the state unit (feature/high-school-states-b) replaces this file (set `built: true`). Map state ids to ncessch with
 * `ctx.crosswalk` (from the shards) or the CCD directory file in `ctx.cacheDir`; shares 0–1; suppressed cells listed
 * per school; rows that don't map go to `unmatched`.
 */
import type { StateAdapter } from "../types.mts";

export const adapter: StateAdapter = {
  state: "SC",
  source: "state-sc",
  name: "South Carolina school report card data",
  publisher: "South Carolina Department of Education",
  url: "https://screportcards.com/",
  built: false,
  async load() {
    throw new Error("SC state adapter not built yet (feature/high-school-states-b)");
  },
};
