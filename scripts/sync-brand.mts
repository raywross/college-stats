/**
 * Colors and marks (specs/school-identity/brand.md): each college's colors from Wikipedia's college color data (or its
 * article's infobox) and its own site icon, written to data/brand-colors.json, data/brand-logos.json, and
 * public/brand/{unit_id}.webp, then applied to data/schools.json with `mergeIdentity`.
 *
 *   npm run sync-brand                         # colors, then icons, then merge-identity
 *   npm run sync-brand -- --colors             # colors only (needs data/wikidata.json: npm run sync-wikidata)
 *   npm run sync-brand -- --icons              # icons only (needs data/site-probe.json: npm run probe-sites)
 *   npm run sync-brand -- --ids 139959,221999  # only these colleges; every other row is kept
 *   npm run sync-brand -- --refresh            # ignore the 30-day Wikipedia cache in .cache/wikipedia/
 *   npm run sync-brand -- --no-merge           # write the brand files, leave data/schools.json alone
 *   npm run sync-brand -- --wikidata <file>    # read article links from another file (development)
 *
 * The spec puts the color fetch in sync-wikidata and the icon fetch in the site probe; this separate step reads their
 * files instead, so the steps can be built and run apart (`syncBrandColors` and `syncBrandIcons` can be called from
 * those scripts too). Free sources only; no API key.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrandOverride } from "../lib/identity-files";
import { overrideProblems } from "../lib/brand-colors.ts";
import { syncBrandColors } from "./lib/wikipedia-colors.mts";
import { syncBrandIcons } from "./lib/brand-icons.mts";
import { mergeIdentity } from "./lib/identity-sync.mts";

const ROOT = process.env.SYNC_BRAND_ROOT ?? join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const onlyColors = flag("--colors");
const onlyIcons = flag("--icons");
const doColors = onlyColors || !onlyIcons;
const doIcons = onlyIcons || !onlyColors;
const ids = value("--ids") ? new Set(value("--ids")!.split(",").map((s) => s.trim()).filter(Boolean)) : undefined;

async function main() {
  const overridesPath = join(ROOT, "data", "brand-overrides.json");
  const overrides: Record<string, BrandOverride> = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
  const problems = Object.entries(overrides).flatMap(([id, o]) => (id.startsWith("_") ? [] : overrideProblems(id, o)));
  if (problems.length) throw new Error(`data/brand-overrides.json:\n  ${problems.join("\n  ")}`);

  if (doColors) {
    console.log("Colors: Wikipedia's college color data and each article's infobox");
    const run = await syncBrandColors(ROOT, { ids, refresh: flag("--refresh"), wikidataPath: value("--wikidata") });
    const via: Record<string, number> = {};
    for (const e of run.entries) via[e.via ?? "?"] = (via[e.via ?? "?"] ?? 0) + 1;
    console.log(`  module ${run.module.entries} entries + ${run.module.aliases} aliases (revision ${run.module.revid}, read ${run.module.retrieved}); ${run.requests} requests`);
    console.log(`  colors for ${run.entries.length} colleges: ${Object.entries(via).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    console.log(`  none: ${Object.entries(run.misses).map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
  }

  if (doIcons) {
    console.log("Marks: each college's own site icon");
    const run = await syncBrandIcons(ROOT, { ids });
    const stored = run.outcomes.filter((o) => o.status === "stored");
    const none = run.outcomes.filter((o) => o.status === "none");
    const bytes = stored.reduce((n, o) => n + (o.status === "stored" ? o.bytes : 0), 0);
    const reasons: Record<string, number> = {};
    for (const o of none) {
      const last = o.status === "none" ? (o.reasons.at(-1) ?? "no candidates") : "";
      const key = /: (.*?)(?: \(|$)/.exec(last)?.[1] ?? last;
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
    console.log(`  ${stored.length} icons stored (${(bytes / 1024 / 1024).toFixed(1)} MB this run), ${none.length} colleges without one; ${run.entries.length} marks in all; ${run.requests} requests`);
    console.log(`  last reason per college without one: ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
    for (const o of run.outcomes) if (o.status === "removed") console.log(`  removed ${o.unit_id}: ${o.reason}`);
  }

  if (!flag("--no-merge")) {
    const r = mergeIdentity(ROOT);
    console.log(`identity: ${r.schools} colleges; colors ${r.withColors}, mark ${r.withLogo}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
