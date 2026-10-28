/**
 * Applying data/coalition/members.json to the dataset (specs/data-expansion/coalition-app.md "Store"): the block on
 * every member the file joined to a college, removed from any college no longer on the list, and the source and
 * vintage in meta.json built from the file's dates (never typed). `npm run merge-coalition` and `sync-data` both call
 * these, so the two can't disagree. Pure apart from the file reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COALITION_HOME, type CoalitionFile, type SchoolCoalition } from "../../../lib/coalition.ts";
import type { DatasetMeta, School, SourceInfo } from "../../../lib/types.ts";
import { longDate } from "../common-app/merge.mts";

/** Top-level keys later pipelines own (lib/identity.ts LATER_KEYS): a new `coalition` goes right before the first of them. */
const LATER_KEYS = ["directories", "lineage", "trends", "reported"];

export function readCoalition(root: string): CoalitionFile | null {
  const path = join(root, "data", "coalition", "members.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CoalitionFile;
}

/** meta.vintages["coalition-members"]: "Member list read October 28, 2026". */
export function coalitionVintage(file: Pick<CoalitionFile, "retrieved">): string {
  return `Member list read ${longDate(file.retrieved)}`;
}

/** meta.sources.coalition: the homepage is the url (the only page of the Coalition's the site links). */
export function coalitionSource(file: Pick<CoalitionFile, "retrieved" | "scoir">): SourceInfo {
  const scoir = file.scoir.as_of ? `; Scoir's list as of ${longDate(file.scoir.as_of)}` : "";
  return {
    label: "Coalition for College",
    publisher: "Coalition for College",
    edition: `Member list read ${longDate(file.retrieved)}${scoir}`,
    url: COALITION_HOME,
    description:
      "The Common App's smaller rival: a nonprofit whose member colleges share an application with an access mission, delivered through Scoir since 2023. Its member list says which colleges belong; Scoir's list says which of them take applications through it. Shown only for members, as one line on how to apply.",
  };
}

export function addCoalitionMeta(meta: DatasetMeta, file: CoalitionFile): void {
  meta.sources.coalition = coalitionSource(file);
  meta.vintages["coalition-members"] = coalitionVintage(file);
}

/** Sets `school.coalition`, keeping its place when it was already there, else before LATER_KEYS (after `apply`). */
function placeCoalition(school: School, block: SchoolCoalition): School {
  if (school.coalition) return { ...school, coalition: block };
  const entries = Object.entries(school);
  let at = entries.findIndex(([k]) => LATER_KEYS.includes(k));
  if (at < 0) at = entries.length;
  return Object.fromEntries([...entries.slice(0, at), ["coalition", block], ...entries.slice(at)]) as unknown as School;
}

export interface CoalitionSummary {
  members: number;
  viaScoir: number;
  removed: number;
  /** Members the file couldn't join to a college (listed in the file's `unmatched`). */
  unjoined: number;
}

/** The block on every joined member, none on anyone else; a college that left the list loses its block. */
export function applyCoalition(schools: readonly School[], file: CoalitionFile): { schools: School[]; summary: CoalitionSummary } {
  const byUnit = new Map<string, SchoolCoalition>();
  let unjoined = 0;
  for (const m of file.members) {
    if (!m.unit_id) {
      unjoined++;
      continue;
    }
    byUnit.set(m.unit_id, { member: true, via_scoir: m.via_scoir, retrieved: file.retrieved });
  }
  const summary: CoalitionSummary = { members: 0, viaScoir: 0, removed: 0, unjoined };
  const out = schools.map((s) => {
    const block = byUnit.get(s.unit_id);
    if (block) {
      summary.members++;
      if (block.via_scoir) summary.viaScoir++;
      return placeCoalition(s, block);
    }
    if (s.coalition) {
      summary.removed++;
      const { coalition: _gone, ...rest } = s;
      void _gone;
      return rest as School;
    }
    return s;
  });
  return { schools: out, summary };
}

export function summaryLine(s: CoalitionSummary): string {
  return `${s.members} members on the site (${s.viaScoir} through Scoir), ${s.unjoined} names unjoined, ${s.removed} removed`;
}
