/**
 * The campus-life pilot's published file, data/campus-pages.json: per college, the facts that passed every check
 * (tier A facts for the `campus_pages` detail table; tier B/C listings for the `directories` table). One college per
 * line so a re-run's diff shows only what changed. Pure apart from the read.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CampusFaith, CampusGreek, CampusLgbtq } from "../../../lib/campus-pages.ts";
import type { CollegeResult, PilotListing } from "./run.mts";

/** The 25 pilot colleges (ids verified against data/schools.json 2026-10-04; owner decision 2: no full run). */
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
