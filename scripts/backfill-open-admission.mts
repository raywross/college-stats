/**
 * Adds `admissions.open_admission` to the committed data/schools.json, and its release (`ipeds-ic-open`) to
 * data/meta.json, without a full sync (lib/open-admission.ts). `npm run sync-data` sets both from then on; this exists
 * so the field could ship before the next sync. Run `npm run merge-reported` after it, so each college's admissions
 * keys sit where a sync and merge put them. Safe to rerun.
 *
 *   npm run backfill-open-admission
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyOpenAdmission, openAdmissionMeta } from "../lib/open-admission.ts";
import { fetchOpenAdmissionFile } from "./lib/open-admission.mts";
import type { DatasetMeta, School } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "schools.json");
const META = join(ROOT, "data", "meta.json");
const thisYear = new Date().getFullYear();
const names = [thisYear + 1, ...Array.from({ length: 6 }, (_, i) => thisYear - i)].map((y) => `IC${y}`);

const file = await fetchOpenAdmissionFile(names, join(ROOT, ".cache", "ipeds"));
if (!file) throw new Error("No IPEDS IC file answers OPENADMP");
const schools = JSON.parse(readFileSync(OUT, "utf8")) as School[];
const counts = applyOpenAdmission(schools, file.rows);
// The sync's own layout: one school per line.
writeFileSync(OUT, `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);

const meta = JSON.parse(readFileSync(META, "utf8")) as DatasetMeta;
const entry = openAdmissionMeta(file);
meta.sources["ipeds-ic-open"] = entry.source;
meta.vintages["ipeds-ic-open"] = entry.vintage;
writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);

console.log(`${file.name}: ${counts.open} open admission, ${counts.notOpen} not, ${counts.unknown} unknown. Wrote data/schools.json and data/meta.json.`);
