/**
 * Builds data/reference/zcta-centroids.csv, the checked-in table of ZIP Code Tabulation Area centers
 * (specs/product/home-and-distance.md): what Explore's "Distance from home" filter measures from, and the fallback
 * when a home address can't be matched but has a ZIP code.
 *
 *   npm run build-zcta
 *
 * Reads the Census Bureau's Gazetteer ZCTA file (public domain; one row per ZCTA with its internal point) and keeps
 * three columns: the five-digit code and its latitude and longitude to three decimals (about 100 m). ZCTAs are the
 * Census Bureau's approximation of USPS ZIP codes (a few ZIP codes, mostly PO boxes and single buildings, have no
 * ZCTA). The Gazetteer is refreshed yearly; point VINTAGE at the new one and re-run. Needs `unzip` on the PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "reference", "zcta-centroids.csv");
const VINTAGE = "2024";
const URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${VINTAGE}_Gazetteer/${VINTAGE}_Gaz_zcta_national.zip`;

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
  const dir = mkdtempSync(join(tmpdir(), "zcta-"));
  const zipPath = join(dir, "zcta.zip");
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  const text = execFileSync("unzip", ["-p", zipPath], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  rmSync(dir, { recursive: true, force: true });

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  // The file is tab-separated; its last header ("INTPTLONG") carries trailing spaces.
  const header = lines[0].split("\t").map((h) => h.trim());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`column ${name} not found in header: ${header.join(", ")}`);
    return i;
  };
  const [iGeo, iLat, iLng] = [col("GEOID"), col("INTPTLAT"), col("INTPTLONG")];

  const rows: string[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const zcta = cols[iGeo].trim();
    const lat = Number(cols[iLat]);
    const lng = Number(cols[iLng]);
    if (!/^\d{5}$/.test(zcta) || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`unexpected row: ${line}`);
    rows.push(`${zcta},${lat.toFixed(3)},${lng.toFixed(3)}`);
  }
  rows.sort();

  const built = new Date().toISOString().slice(0, 10);
  const out = [
    `# ZCTA centers from the U.S. Census Bureau's ${VINTAGE} Gazetteer file (${URL}), built ${built} by npm run build-zcta.`,
    "# Columns: five-digit ZCTA, latitude, longitude (internal point, three decimals). Public domain.",
    "zcta,lat,lng",
    ...rows,
  ].join("\n");
  mkdirSync(join(ROOT, "data", "reference"), { recursive: true });
  writeFileSync(OUT, `${out}\n`);
  console.log(`Wrote ${rows.length} ZCTA centers to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
