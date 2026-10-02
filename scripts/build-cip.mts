/**
 * Builds data/reference/cip2020.json, the checked-in table of CIP 2020 titles (specs/data-expansion/majors.md).
 *
 *   npm run build-cip
 *
 * Reads NCES's CIP 2020 file (every 2-, 4-, and 6-digit code with its title) and the CIP 2010 → 2020 crosswalk. Codes
 * NCES marks "Moved from" or "Deleted" are left out of `titles` (they don't exist in CIP 2020); the crosswalk's moves
 * become `moved_from_2010`, which sync-history uses to read pre-2020 completions files (C2019_A and older) in CIP 2020
 * terms. CIP is revised about once a decade (the next is CIP 2030); when NCES publishes it, point the URLs at the new
 * files, rename the output, and re-run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./lib/ipeds.mts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "reference", "cip2020.json");
const CIP_URL = "https://nces.ed.gov/ipeds/cipcode/Files/CIPCode2020.csv";
const CROSSWALK_URL = "https://nces.ed.gov/ipeds/cipcode/Files/Crosswalk2010to2020.csv";

async function csv(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return parseCsv(await res.text());
}

/** NCES writes codes as Excel formulas (`="01.0101"`) so leading zeros survive; parseCsv leaves `=01.0101`. */
const code = (v: string) => v.replace(/^=/, "").replace(/"/g, "").trim();

const SMALL = new Set(["and", "or", "of", "the", "in", "for", "to", "a", "an", "on"]);
/** NCES capitalizes 2-digit family titles ("BUSINESS, MANAGEMENT, …"); title-case them like the rest. */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/(\s+|\/|-)/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}
/** "Agriculture, General." → "Agriculture, General" */
const clean = (t: string) => titleCase(t.trim().replace(/\.$/, ""));

async function main() {
  const [cip, crosswalk] = await Promise.all([csv(CIP_URL), csv(CROSSWALK_URL)]);
  const titles: Record<string, string> = {};
  for (const r of cip) {
    const c = code(r.CIPCODE);
    if (!/^\d{2}(\.\d{2}(\d{2})?)?$/.test(c)) throw new Error(`unexpected CIP code "${r.CIPCODE}"`);
    // In this file "Moved from" marks the old code (gone in CIP 2020) and "Moved to" its new home.
    if (r.ACTION === "Moved from" || r.ACTION === "Deleted") continue;
    titles[c] = clean(r.CIPTITLE);
  }
  const moved: Record<string, string> = {};
  for (const r of crosswalk) {
    if (r.ACTION !== "Moved to") continue;
    const from = code(r.CIPCODE2010);
    const to = code(r.CIPCODE2020);
    if (!titles[to]) throw new Error(`crosswalk moves ${from} to ${to}, which isn't a CIP 2020 code`);
    moved[from] = to;
  }
  const sorted = (o: Record<string, string>) => Object.keys(o).sort();
  const lines = (o: Record<string, string>) => sorted(o).map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(",\n");
  const header = {
    source: "Classification of Instructional Programs (CIP) 2020, National Center for Education Statistics",
    url: CIP_URL,
    crosswalk_url: CROSSWALK_URL,
    retrieved: new Date().toISOString().slice(0, 10),
  };
  const body = [
    ...Object.entries(header).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`),
    `  "titles": {\n${lines(titles)}\n  }`,
    `  "moved_from_2010": {\n${lines(moved)}\n  }`,
  ].join(",\n");
  mkdirSync(join(ROOT, "data", "reference"), { recursive: true });
  writeFileSync(OUT, `{\n${body}\n}\n`);
  const byLen = (n: number) => Object.keys(titles).filter((k) => k.replace(".", "").length === n).length;
  console.log(`Wrote ${Object.keys(titles).length} CIP 2020 titles (${byLen(2)} families, ${byLen(4)} 4-digit, ${byLen(6)} 6-digit) and ${Object.keys(moved).length} CIP 2010 moves to data/reference/cip2020.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
