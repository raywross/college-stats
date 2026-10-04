/**
 * The campus-life pilot's published file, data/campus-pages.json: per college, the facts that passed every check
 * (tier A facts for the `campus_pages` detail table; tier B/C listings for the `directories` table). One college per
 * line so a re-run's diff shows only what changed. Pure apart from the read.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CampusFaith, CampusGreek, CampusLgbtq } from "../../../lib/campus-pages.ts";
import type { CampusRecipe, CollegeResult, PilotListing } from "./run.mts";

/** Round 1's 25 pilot colleges (ids verified against data/schools.json 2026-10-04; owner decision 2: no full run). Round 2's list is a file: DEFAULT_COLLEGES_FILE. */
export const PILOT_IDS: readonly string[] = [
  "228778", "152080", "223232", "230038", "149781", "131496", "131520", "168342", "100751", "176017", "234207", "110662", "190150",
  "166027", "167835", "209922", "134130", "170976", "221999", "153384", "104151", "230764", "232557", "197708", "236948",
];

export interface PublishedCollege {
  unit_id: string;
  name: string;
  checked: string;
  greek?: CampusGreek;
  faith?: CampusFaith;
  lgbtq?: CampusLgbtq;
  listings?: PilotListing[];
}

export interface PagesFile {
  updated: string | null;
  colleges: PublishedCollege[];
}

export function readPagesFile(file: string): PagesFile {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PagesFile) : { updated: null, colleges: [] };
}

export function formatPagesFile(f: PagesFile): string {
  const rows = [...f.colleges].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  const body = rows.length ? `[\n${rows.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]` : "[]";
  return `{\n  "updated": ${JSON.stringify(f.updated)},\n  "colleges": ${body}\n}\n`;
}

/** What a run's result publishes, or null when nothing passed. */
export function publishable(r: CollegeResult): PublishedCollege | null {
  const out: PublishedCollege = { unit_id: r.unit_id, name: r.name, checked: r.checked };
  if (r.greek) out.greek = r.greek;
  if (r.faith) out.faith = r.faith;
  if (r.lgbtq && (r.lgbtq.center || r.lgbtq.policies?.length)) out.lgbtq = r.lgbtq;
  // One listing per (domain, kind, tradition, name).
  const seen = new Set<string>();
  const listings = r.listings.filter((l) => {
    const k = `${l.domain}|${l.kind}|${l.tradition ?? ""}|${l.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (listings.length) out.listings = listings;
  return out.greek || out.faith || out.lgbtq || out.listings ? out : null;
}

/* ------------------------------------------------------------------ */
/* College lists and the run's merge (round 2)                         */
/* ------------------------------------------------------------------ */

/** The round-2 college list (default for `npm run campus-pilot`; data/reference/campus-pilot-2-colleges.json). */
export const DEFAULT_COLLEGES_FILE = "data/reference/campus-pilot-2-colleges.json";

export interface CollegeListFile {
  description?: string;
  colleges: { unit_id: string; name?: string; why?: string }[];
}

/** Unit ids from a college list file (`{ colleges: [{ unit_id }] }`), in order, without duplicates. */
export function readCollegeList(file: string): string[] {
  const f = JSON.parse(readFileSync(file, "utf8")) as CollegeListFile;
  if (!Array.isArray(f.colleges)) throw new Error(`${file}: expected { "colleges": [{ "unit_id": … }] }`);
  const ids = f.colleges.map((c) => String(c.unit_id));
  if (ids.some((id) => !/^\d{6}$/.test(id))) throw new Error(`${file}: every unit_id must be six digits`);
  return [...new Set(ids)];
}

export interface SourcesFile {
  updated: string;
  recipes: CampusRecipe[];
}

export function readSourcesFile(file: string, today: string): SourcesFile {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SourcesFile) : { updated: today, recipes: [] };
}

export function formatSourcesFile(f: SourcesFile): string {
  return `${JSON.stringify({ updated: f.updated, recipes: [...f.recipes].sort((a, b) => a.unit_id.localeCompare(b.unit_id)) }, null, 1)}\n`;
}

/**
 * A run's results and recipes merged into the published files. Only the colleges this run read change: every other
 * college's published facts and recipe are carried over as they were (byte for byte once formatted), so a run on new
 * colleges adds to earlier runs and never removes them. For a college in the run: a result with facts replaces its
 * entry; a clean result with nothing to publish removes it; a stopped or failed result keeps the earlier entry. Pure.
 */
export function mergeRun(pages: PagesFile, sources: SourcesFile, run: { results: readonly CollegeResult[]; recipes: readonly CampusRecipe[] }, today: string): { pages: PagesFile; sources: SourcesFile } {
  const byId = new Map(pages.colleges.map((c) => [c.unit_id, c]));
  for (const r of run.results) {
    const p = publishable(r);
    if (p) byId.set(r.unit_id, p);
    else if (!r.stopped && !r.errors.length) byId.delete(r.unit_id);
  }
  const recipes = new Map(sources.recipes.map((r) => [r.unit_id, r]));
  for (const r of run.recipes) if (Object.keys(r.links).length) recipes.set(r.unit_id, r);
  return { pages: { updated: today, colleges: [...byId.values()] }, sources: { updated: today, recipes: [...recipes.values()] } };
}
