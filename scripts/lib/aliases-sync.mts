/**
 * The alias table (specs/school-identity/aliases.md; lib/aliases.ts): the IPEDS directory's IALIAS column when a fresh
 * HD file is at hand (sync-data), else the IPEDS rows the table already had (the publisher's compose), plus
 * Wikidata's other names, the homepage domain, the reference document `aliases-curated`, and Common App members'
 * other names (`common_app.members`; specs/data-expansion/common-app.md). Pure.
 */
import type { School } from "../../lib/types";
import type { WikidataEntry } from "../../lib/identity-files";
import type { MembersFile } from "../../lib/common-app/types";
import {
  aliasTableProblems,
  buildAliasRow,
  dedupeAliases,
  domainLabel,
  shouldDropAlias,
  splitAliasField,
  type AliasRow,
  type CuratedAliasEntry,
} from "../../lib/aliases.ts";

export interface AliasTableInputs {
  schools: School[];
  /** Fresh HD rows by unit id (sync-data); null keeps the IPEDS rows the table already had (`existing`). */
  hdRows: Map<string, Record<string, string>> | null;
  wikidata: Map<string, WikidataEntry>;
  /** Common App members (`common_app.members`), or null. */
  commonApp?: MembersFile | null;
}

/** One alias object per line inside a JSON array, sorted by (unit_id, key) — the same style as colleges.json. */
export function formatAliasRows(rows: readonly AliasRow[]): string {
  return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;
}

/**
 * Common App members' other names (`common_app.members` `alternate_names`, already split on commas; specs/
 * data-expansion/common-app.md "Store"), joined by IPEDS id, weight 2 like Wikidata's.
 */
export function commonAppAliasRows(schools: readonly School[], members: MembersFile | null): AliasRow[] {
  if (!members) return [];
  const nameById = new Map(schools.map((s) => [s.unit_id, s.name]));
  const rows: AliasRow[] = [];
  for (const m of members.members) {
    const name = m.ipeds ? nameById.get(m.ipeds) : undefined;
    if (!name) continue;
    for (const alias of m.alternate_names.flatMap((a) => splitAliasField(a))) {
      if (shouldDropAlias(alias, name)) continue;
      rows.push(buildAliasRow(m.ipeds!, alias, "common-app"));
    }
  }
  return rows;
}

/**
 * The alias table from its inputs, pure (what sync-data builds and the publisher, scripts/lib/data-platform/compose.mts,
 * builds from the layers): `existing` stands in for the IPEDS rows when `hdRows` is null (the rows of the table as it
 * was), `curated` is the reference document `aliases-curated`, `commonApp` the members document.
 * Throws on a broken invariant.
 */
export function aliasRowsFrom(
  inputs: Omit<AliasTableInputs, "commonApp"> & { existing: readonly AliasRow[]; curated: readonly CuratedAliasEntry[]; commonApp: MembersFile | null }
): AliasRow[] {
  const nameById = new Map(inputs.schools.map((s) => [s.unit_id, s.name]));
  const schoolIds = new Set(nameById.keys());
  const rows: AliasRow[] = [];

  // IPEDS HD's IALIAS column. Without a fresh HD file (the publisher's compose), keep the ipeds-sourced rows already on
  // disk, dropping any whose college is no longer in the dataset.
  if (inputs.hdRows) {
    for (const school of inputs.schools) {
      const raw = inputs.hdRows.get(school.unit_id)?.IALIAS;
      for (const alias of splitAliasField(raw)) {
        if (shouldDropAlias(alias, school.name)) continue;
        rows.push(buildAliasRow(school.unit_id, alias, "ipeds"));
      }
    }
  } else {
    for (const row of inputs.existing) {
      if (row.source === "ipeds" && schoolIds.has(row.unit_id)) rows.push(row);
    }
  }

  // Wikidata's other names (skos:altLabel, English), joined by unit id.
  for (const [unitId, entry] of inputs.wikidata) {
    const name = nameById.get(unitId);
    if (!name) continue;
    for (const alias of entry.alt_labels) {
      if (shouldDropAlias(alias, name)) continue;
      rows.push(buildAliasRow(unitId, alias, "wikidata"));
    }
  }

  // The homepage's own domain label ("uga.edu" -> "uga").
  for (const school of inputs.schools) {
    const label = domainLabel(school.links?.website ?? null);
    if (label && !shouldDropAlias(label, school.name)) rows.push(buildAliasRow(school.unit_id, label, "domain"));
  }

  // Curated, hand-picked short names (the reference document aliases-curated), for the owner to review.
  for (const c of inputs.curated) {
    const name = nameById.get(c.unit_id);
    if (!name) {
      console.warn(`  aliases-curated.json: unit_id ${c.unit_id} ("${c.alias}") is not one of the colleges; skipped`);
      continue;
    }
    if (shouldDropAlias(c.alias, name, { curated: true })) continue;
    rows.push(buildAliasRow(c.unit_id, c.alias, "curated", c.weight));
  }

  // Common App members' other names.
  rows.push(...commonAppAliasRows(inputs.schools, inputs.commonApp));

  const final = dedupeAliases(rows);
  const problems = aliasTableProblems(final, schoolIds);
  if (problems.length) throw new Error(`writeAliasTable: refused to write an invalid table:\n  ${problems.slice(0, 10).join("\n  ")}`);
  return final;
}
