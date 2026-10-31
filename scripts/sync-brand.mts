/**
 * Colors and marks (specs/school-identity/brand.md): each college's colors from Wikipedia's college color data (or its
 * article's infobox) and its own site icon, written to `identity.brand_colors`, `identity.brand_logos` (one document
 * per college, in one change set: its own, source `identity-refresh`, unless `--change-set <id>` names the
 * workflow's) and public/brand/{unit_id}.webp. The publisher applies them to the colleges.
 *
 *   npm run sync-brand -- --store supabase     # colors, then icons (--store file:<dir> for a folder)
 *   npm run sync-brand -- --colors             # colors only (needs identity.wikidata: npm run sync-wikidata)
 *   npm run sync-brand -- --icons              # icons only (needs identity.probe: npm run probe-sites)
 *   npm run sync-brand -- --ids 139959,221999  # only these colleges; every other row is kept
 *   npm run sync-brand -- --refresh            # ignore the 30-day Wikipedia cache in .cache/wikipedia/
 *   npm run sync-brand -- --wikidata <file>    # read article links from a wikidata.json-shaped file (development)
 *   npm run sync-brand -- --dry-run            # fetch and count; nothing reaches the store (icons still land in public/brand)
 *
 * The marks' image files are code-side assets under public/brand/: a run writes them in the working tree, and they
 * reach the site only when committed. The identity-refresh workflow therefore runs `--colors` alone; refresh the marks
 * locally with `--icons` and commit public/brand/ in a code PR.
 *
 * The spec puts the color fetch in sync-wikidata and the icon fetch in the site probe; this separate step reads their
 * layers instead, so the steps can be built and run apart. Free sources only; no API key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WikidataEntry } from "../lib/identity-files";
import { overrideProblems } from "../lib/brand-colors.ts";
import { buildBrandColors, defaultDeps } from "./lib/wikipedia-colors.mts";
import { syncIcons } from "./lib/brand-icons.mts";
import { flagValue, storeFromFlag, type ChangeSetHandle } from "./lib/data-platform/store.mts";
import { changeSetFlag, withRunSet } from "./lib/data-platform/change-set.mts";
import { readBrandLogos, readBrandOverrides, readProbe, readWikidata, storeColleges, writeBrandColors, writeBrandLogos } from "./lib/identity-store.mts";

const ROOT = process.env.SYNC_BRAND_ROOT ?? join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => flagValue(args, name);

const onlyColors = flag("--colors");
const onlyIcons = flag("--icons");
const doColors = onlyColors || !onlyIcons;
const doIcons = onlyIcons || !onlyColors;
const dryRun = flag("--dry-run");
const ids = value("--ids") ? new Set(value("--ids")!.split(",").map((s) => s.trim()).filter(Boolean)) : undefined;

async function main() {
  const store = storeFromFlag(value("--store"));
  const overrides = await readBrandOverrides(store);
  const problems = Object.entries(overrides).flatMap(([id, o]) => (id.startsWith("_") ? [] : overrideProblems(id, o)));
  if (problems.length) throw new Error(`identity.brand_overrides:\n  ${problems.join("\n  ")}`);

  // Without a step named, a step whose input layer is empty is skipped with a note; named, it fails.
  const ready = (step: string, rows: number, layer: string, named: boolean, run: string) => {
    if (rows || !named) {
      if (!rows) console.log(`${step}: skipped, ${layer} is empty (${run})`);
      return rows > 0;
    }
    throw new Error(`${step}: ${layer} is empty: ${run} first`);
  };

  const write = async (handle: ChangeSetHandle | null) => {
    if (doColors) {
      const wikidata: Pick<WikidataEntry, "unit_id" | "wikipedia">[] = value("--wikidata") ? JSON.parse(readFileSync(value("--wikidata")!, "utf8")) : await readWikidata(store);
      if (ready("Colors", wikidata.length, "identity.wikidata", onlyColors || !!value("--wikidata"), "npm run sync-wikidata")) {
        console.log("Colors: Wikipedia's college color data and each article's infobox");
        const run = await buildBrandColors(wikidata, join(ROOT, ".cache", "wikipedia"), defaultDeps(), { ids, refresh: flag("--refresh") });
        if (handle) await writeBrandColors(store, handle, run.entries, ids);
        const via: Record<string, number> = {};
        for (const e of run.entries) via[e.via ?? "?"] = (via[e.via ?? "?"] ?? 0) + 1;
        console.log(`  module ${run.module.entries} entries + ${run.module.aliases} aliases (revision ${run.module.revid}, read ${run.module.retrieved}); ${run.requests} requests`);
        console.log(`  colors for ${run.entries.length} colleges this run: ${Object.entries(via).map(([k, n]) => `${k} ${n}`).join(", ")}`);
        console.log(`  none: ${Object.entries(run.misses).map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
      }
    }

    if (doIcons) {
      const probe = await readProbe(store);
      if (ready("Marks", probe.length, "identity.probe", onlyIcons, "npm run probe-sites")) {
        console.log("Marks: each college's own site icon");
        const schools = await storeColleges(store);
        const run = await syncIcons({
          probe,
          previous: await readBrandLogos(store),
          overrides,
          brandDir: join(ROOT, "public", "brand"),
          ids,
          names: new Map(schools.map((s) => [s.unit_id, s.name])),
          deps: { fetch: globalThis.fetch, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (m) => console.log(m) },
        });
        if (handle) await writeBrandLogos(store, handle, run.entries);
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
    }
  };

  if (dryRun) await write(null);
  else await withRunSet(store, { source: "identity-refresh", changeSet: changeSetFlag(args) }, write);
  if (dryRun) console.log("Dry run: nothing written to the store.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
