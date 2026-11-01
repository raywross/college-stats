/**
 * State bans on legacy preference in admissions (specs/chances/inputs-beyond-academics.md "Legacy"):
 * data/reference/legacy-bans.json, hand-kept and reviewed like data/state-laws.json (lib/lgbtq.ts), each row
 * verified against the state legislature's own page or the enacted statute. A ban with `sectors` including
 * "private" covers both private sectors a college can be (`SchoolType`'s "private-nonprofit" and
 * "private-forprofit"); `sectorOf` maps a college's `type` to the "public" | "private" the file uses. Where a
 * state bans legacy preference at a college's sector, `lib/chances/hooks.ts` (U5) treats alumni relation as not
 * used (`M_legacy = 1`) regardless of the college's own factor rating. Pure, client-safe.
 */
import type { School, SchoolType } from "../types.ts";
import bansFile from "../../.data/snapshot/reference/legacy-bans.json" with { type: "json" };

export type LegacySector = "public" | "private";

export interface LegacyBan {
  /** USPS state code. */
  state: string;
  /** Which sectors the ban covers in that state. */
  sectors: LegacySector[];
  /** ISO date the ban took effect (not the signing date). */
  effective: string;
  /** Bill number or chapter citation, as the legislature names it. */
  law: string;
  /** The state legislature's page for the bill, or the enacted statute. */
  source_url: string;
}

export interface LegacyBansFile {
  /** ISO date the table was last reviewed against the states' own sites. */
  reviewed: string;
  bans: LegacyBan[];
}

const FILE = bansFile as LegacyBansFile;
const BY_STATE = new Map(FILE.bans.map((b) => [b.state, b]));

/** A college's sector as the ban file names it: "private" covers both private-nonprofit and private-forprofit. */
export function sectorOf(type: SchoolType): LegacySector {
  return type === "public" ? "public" : "private";
}

/** The ban that applies to a state and sector, or null when the state hasn't enacted one covering that sector. */
export function banFor(state: string, sector: LegacySector): LegacyBan | null {
  const ban = BY_STATE.get(state.toUpperCase());
  if (!ban || !ban.sectors.includes(sector)) return null;
  return ban;
}

/** Convenience for a college record: looks up the ban for its own state and sector. */
export function banForSchool(school: { type: School["type"]; location: Pick<School["location"], "state"> }): LegacyBan | null {
  return banFor(school.location.state, sectorOf(school.type));
}

/** The reviewed table, for the check script and tests. */
export const LEGACY_BANS: LegacyBansFile = FILE;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const USPS = /^[A-Z]{2}$/;
const SECTORS: readonly LegacySector[] = ["public", "private"];

/** Problems with the hand-kept table; the check script refuses to pass when there are any. */
export function validateLegacyBans(file: LegacyBansFile, knownStates: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!ISO_DATE.test(file.reviewed ?? "")) errors.push(`legacy-bans.json: "reviewed" must be YYYY-MM-DD`);
  const seen = new Set<string>();
  for (const ban of file.bans ?? []) {
    const at = `legacy-bans.json ${ban.state ?? "?"}`;
    if (!USPS.test(ban.state ?? "")) errors.push(`${at}: state must be a two-letter USPS code`);
    else if (!knownStates.has(ban.state)) errors.push(`${at}: not a known USPS state code`);
    if (seen.has(ban.state)) errors.push(`${at}: one row per state (combine sectors instead of repeating it)`);
    seen.add(ban.state);
    if (!Array.isArray(ban.sectors) || ban.sectors.length === 0) errors.push(`${at}: sectors must be a non-empty array`);
    else {
      for (const s of ban.sectors) if (!SECTORS.includes(s)) errors.push(`${at}: sectors may only hold "public" or "private"`);
      if (new Set(ban.sectors).size !== ban.sectors.length) errors.push(`${at}: sectors must not repeat`);
    }
    if (!ISO_DATE.test(ban.effective ?? "")) errors.push(`${at}: effective must be YYYY-MM-DD`);
    if (!ban.law?.trim()) errors.push(`${at}: law is required (the bill number or chapter citation)`);
    if (!/^https:\/\//.test(ban.source_url ?? "")) errors.push(`${at}: source_url must be an https link to the legislature's page or the statute`);
  }
  const order = (file.bans ?? []).map((b) => b.state);
  if (order.join() !== [...order].sort().join()) errors.push(`legacy-bans.json: keep bans sorted by state code`);
  return errors;
}
