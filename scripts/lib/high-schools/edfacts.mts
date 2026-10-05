/**
 * EDFacts adjusted cohort graduation rate (ACGR), school level. Ranges ("GE80", "90-94") stay ranges: use
 * parseRateRange from lib/high-school-core.ts; "PS" is suppressed.
 *
 * STUB: the federal unit (feature/high-school-federal) replaces `load`. Until then it loads nothing, and the sync
 * leaves `grad_rate` as it is.
 */
import type { AdapterContext, AdapterInfo, AdapterResult } from "./types.mts";

export const info: AdapterInfo = {
  key: "edfacts",
  role: "enrichment",
  rowKind: "public",
  owns: ["grad_rate"],
  sources: ["edfacts"],
  vintages: ["edfacts-acgr"],
};

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  ctx.warn("edfacts: adapter not built yet (stub); graduation rates unchanged.");
  return { sources: {}, vintages: {}, notes: ["edfacts: stub, nothing loaded"] };
}
