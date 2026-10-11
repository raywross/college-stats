/**
 * One-time correction (2026-10-11, owner-approved): graduation-grid rates printed as fractions were stored as points.
 * Before #123's QUOTIENT_RATE_CODES fix, a printed "0.945" (line H, B.429–B.432 / B.529–B.532, or B.2203) went through
 * percentShare as 0.945 percentage points and was stored as 0.00945. The fraction itself is in each item's quote, so the
 * value is corrected exactly from it: v × 100, only when that number is printed in the quote. No fetch, no model call.
 *
 *   npm run fix-fraction-rates [-- --dry-run]
 *
 * Then `npm run check-cds-records` re-judges the corrected values and `npm run merge-reported` publishes what passes.
 * Re-running is a no-op: a corrected value is no longer below 0.02.
 */
import { join } from "node:path";
import { QUOTIENT_RATE_CODES, type ItemResult } from "../lib/cds-sections.ts";
import { readRecords, writeRecord } from "./lib/college-reported/records.mts";

/** Below this a graduation rate can only be a fraction misread as points (no grid rate is under 2%). */
const POINTS_CEILING = 0.02;

/** The numbers printed in a quote, as written ("0.945", "1", "0.844253491"). */
function printed(quote: string): number[] {
  return [...quote.matchAll(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g)].map((m) => Number(m[0]));
}

/**
 * The corrected item, or null when it doesn't need (or can't safely take) the correction: only a quotient-rate code
 * whose stored share is under 2% and whose quote prints exactly that share × 100 as a fraction from 0 to 1.
 */
export function fixFractionRate(code: string, it: ItemResult): ItemResult | null {
  if (!QUOTIENT_RATE_CODES.has(code)) return null;
  if (typeof it.v !== "number" || it.v <= 0 || it.v >= POINTS_CEILING || !it.quote) return null;
  const share = Math.round(it.v * 100 * 1e10) / 1e10;
  if (share > 1) return null;
  if (!printed(it.quote).some((n) => Math.abs(n - share) < 1e-8)) return null;
  return { ...it, v: share };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const dir = join(import.meta.dirname, "..", "data", "cds-records");
  let values = 0;
  let docs = 0;
  for (const rec of readRecords(dir)) {
    let changed = false;
    for (const d of rec.documents) {
      let inDoc = 0;
      for (const [code, it] of Object.entries(d.items)) {
        const fixed = fixFractionRate(code, it);
        if (!fixed) continue;
        d.items[code] = fixed;
        inDoc++;
      }
      if (inDoc) {
        docs++;
        values += inDoc;
        changed = true;
        console.log(`${rec.unit_id} ${d.edition ?? "?"} ${d.sha256.slice(0, 8)}: ${inDoc} rate(s) corrected`);
      }
    }
    if (changed && !dry) writeRecord(dir, rec);
  }
  console.log(`${values} value(s) in ${docs} document(s) corrected${dry ? " (dry run: nothing written)" : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
