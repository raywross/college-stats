/**
 * The Coalition sync's work between the two pages and the layer (specs/data-expansion/coalition-app.md "Checks"):
 * parse, check the counts, join the names, and build the `CoalitionFile` that becomes the `coalition.members`
 * document. Pure: scripts/sync-coalition.mts fetches the pages, reads the colleges and the hand map, and writes the
 * document through the data store.
 */
import type { AliasRow } from "../../../lib/aliases.ts";
import { COALITION_MEMBERS_URL, SCOIR_LIST_URL, type CoalitionFile, type CoalitionUnmatched } from "../../../lib/coalition.ts";
import { buildJoinIndex, joinName, mappedIds } from "./join.mts";
import { parseMemberPage, parseScoirPage } from "./parse.mts";

export interface CoalitionInputs {
  schools: readonly { unit_id: string; name: string; links?: { website?: string | null } | null }[];
  aliases: readonly AliasRow[];
  /** data/coalition/name-map.json (`coalition.name_map`): a printed name → one unit id or several. */
  nameMap: Record<string, string | string[]>;
  today: string;
}

export interface CoalitionBuild {
  file: CoalitionFile;
  /** Log lines (the counts, then each unmatched name and each Scoir college not on the member list). */
  lines: string[];
}

/** Builds the members file from the two pages' HTML; throws (nothing to write) when a check fails. */
export function buildCoalitionFile(membersHtml: string, scoirHtml: string, inputs: CoalitionInputs): CoalitionBuild {
  const members = parseMemberPage(membersHtml);
  const scoir = parseScoirPage(scoirHtml);
  const names = new Set(members.map((m) => m.name));
  if (members.length < 100 || members.length > 300) throw new Error(`member page: ${members.length} names (expected 100–300); the page's markup may have changed`);
  if (names.size !== members.length) throw new Error(`member page: ${members.length - names.size} duplicate names`);
  if (scoir.names.length < 50) throw new Error(`Scoir page: ${scoir.names.length} names (expected 50 or more); the page's markup may have changed`);

  const index = buildJoinIndex(
    inputs.schools.map((s) => ({ unit_id: s.unit_id, name: s.name, website: s.links?.website ?? null })),
    [...inputs.aliases],
    inputs.nameMap,
  );

  const unmatched: CoalitionUnmatched[] = [];
  // A hand-map entry with several ids (one printed name for two campuses) becomes one row per college.
  const scoirJoined = scoir.names.flatMap((name) => {
    const many = mappedIds(index, name);
    if (many.length > 1) return many.map((unit_id) => ({ name, unit_id, join: "name-map" as const }));
    const r = joinName(index, name, null);
    if (!r.unit_id) unmatched.push({ name, list: "scoir", tried: r.tried });
    return [{ name, unit_id: r.unit_id, join: r.join }];
  });
  const scoirIds = new Set(scoirJoined.map((s) => s.unit_id).filter((id): id is string => !!id));
  const joined = members.flatMap((m) => {
    const many = mappedIds(index, m.name);
    const rows = many.length > 1 ? many.map((unit_id) => ({ unit_id, join: "name-map" as const })) : [joinName(index, m.name, m.admissions_url)];
    return rows.map((r) => {
      if (!r.unit_id) unmatched.push({ name: m.name, list: "coalition", tried: (r as { tried: CoalitionUnmatched["tried"] }).tried });
      return { name: m.name, admissions_url: m.admissions_url, unit_id: r.unit_id, join: r.join, via_scoir: !!r.unit_id && scoirIds.has(r.unit_id) };
    });
  });
  const seenIds = new Set<string>();
  for (const m of joined) {
    if (m.unit_id && seenIds.has(m.unit_id)) throw new Error(`two member names joined to the same college (${m.unit_id}: ${m.name}); fix the Coalition name map (coalition.name_map)`);
    if (m.unit_id) seenIds.add(m.unit_id);
  }
  const memberIds = new Set(joined.map((m) => m.unit_id).filter((id): id is string => !!id));
  const notMembers = scoirJoined.filter((s) => s.unit_id && !memberIds.has(s.unit_id)).map((s) => ({ name: s.name, unit_id: s.unit_id! }));

  const file: CoalitionFile = {
    retrieved: inputs.today,
    member_url: COALITION_MEMBERS_URL,
    scoir_url: SCOIR_LIST_URL,
    members: joined.sort((a, b) => a.name.localeCompare(b.name)),
    scoir: { as_of: scoir.as_of, names: scoirJoined, not_members: notMembers },
    unmatched,
  };

  const unCo = unmatched.filter((u) => u.list === "coalition").length;
  const unSc = unmatched.filter((u) => u.list === "scoir").length;
  const lines = [
    `coalition: ${members.length} members, ${memberIds.size} joined (${unCo} unmatched); Scoir ${scoir.names.length} names as of ${scoir.as_of ?? "no date"}, ${scoirIds.size} joined (${unSc} unmatched); ${joined.filter((m) => m.via_scoir).length} members through Scoir; ${notMembers.length} Scoir colleges not on the member list`,
    ...unmatched.map((u) => `  unmatched (${u.list}): ${u.name}  [tried ${u.tried.join(", ")}]`),
    ...notMembers.map((n) => `  on Scoir's list, not a member: ${n.name} (${n.unit_id})`),
  ];
  if (unCo > members.length / 10 || unSc > scoir.names.length / 10) {
    throw Object.assign(new Error("more than 10% of a list is unmatched; add the names to the Coalition name map (coalition.name_map) and rerun"), { lines });
  }
  return { file, lines };
}

/** The `coalition.members` document: the file as `JSON.stringify(file, null, 2)` writes it, parsed (the import's key order). */
export const coalitionDocument = (file: CoalitionFile): CoalitionFile => JSON.parse(JSON.stringify(file, null, 2)) as CoalitionFile;
