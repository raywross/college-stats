/**
 * Civil Rights Data Collection (CRDC) public-use files: AP courses, AP enrollment, AP exam takers and passers, IB
 * enrollment, dual enrollment, and CRDC's own school enrollment (`rigor.enrollment`, the denominator for the derived
 * shares, so a share never mixes two years). `combokey` is the ncessch. Reserve codes (negative numbers) are missing
 * or suppressed per the CRDC documentation: use `suppress` from lib/high-school-core.ts.
 *
 * STUB: the federal unit (feature/high-school-federal) replaces `load`. Until then it loads nothing, and the sync
 * leaves `rigor` as it is.
 */
import type { AdapterContext, AdapterInfo, AdapterResult } from "./types.mts";

export const info: AdapterInfo = {
  key: "crdc",
  role: "enrichment",
  rowKind: "public",
  owns: ["rigor"],
  sources: ["crdc"],
  vintages: ["crdc"],
};

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  ctx.warn("crdc: adapter not built yet (stub); rigor fields unchanged.");
  return { sources: {}, vintages: {}, notes: ["crdc: stub, nothing loaded"] };
}
