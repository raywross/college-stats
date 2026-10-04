/**
 * The matcher's inputs from the repo: the colleges in data/schools.json, IPEDS HD aliases (IALIAS) from the newest
 * HD file the sync cached in .cache/ipeds/ (none when there isn't one), and the hand-checked answers in
 * data/directories/matches.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../../lib/types.ts";
import { forEachCsvRow } from "../ipeds.mts";
import { readReviewed } from "./files.mts";
import { buildIndex, splitAliases, type College, type MatchIndex } from "./matcher.mts";

export function collegesFrom(schools: readonly School[]): College[] {
  return schools.map((s) => ({ unit_id: s.unit_id, name: s.name, city: s.location.city, state: s.location.state, website: s.links?.website ?? null }));
}

/** unit id → IALIAS names, from the newest cached HD{Y}.zip; an empty map (and a note) when none is cached. */
export function readHdAliases(root: string, ids: ReadonlySet<string>, log: (m: string) => void = console.log): Map<string, string[]> {
  const dir = join(root, ".cache", "ipeds");
  const zips = existsSync(dir) ? readdirSync(dir).filter((f) => /^HD\d{4}\.zip$/.test(f)).sort() : [];
  const out = new Map<string, string[]>();
  const zip = zips.at(-1);
  if (!zip) {
    log("  no cached IPEDS HD file (.cache/ipeds/HD*.zip); matching without IALIAS aliases (run npm run sync-data once to cache it)");
    return out;
  }
  const path = join(dir, zip);
  const csv = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).split("\n").find((f) => /\.csv$/i.test(f));
  if (!csv) return out;
  const text = execFileSync("unzip", ["-p", path, csv], { encoding: "latin1", maxBuffer: 1024 * 1024 * 1024 });
  forEachCsvRow(
    text,
    (row) => {
      const a = splitAliases(row.IALIAS ?? "");
      if (a.length) out.set(row.UNITID, a);
    },
    ids
  );
  log(`  aliases: ${out.size} colleges with IPEDS aliases (${zip})`);
  return out;
}

export function loadMatchIndex(root: string, log: (m: string) => void = console.log): MatchIndex {
  const schools: School[] = JSON.parse(readFileSync(join(root, "data", "schools.json"), "utf8"));
  const colleges = collegesFrom(schools);
  return buildIndex(colleges, readHdAliases(root, new Set(colleges.map((c) => c.unit_id)), log), readReviewed(root));
}
