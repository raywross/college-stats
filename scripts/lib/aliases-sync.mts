/**
 * Writes data/aliases.json (specs/school-identity/aliases.md; lib/aliases.ts): the IPEDS directory's IALIAS column
 * when a fresh HD file is at hand (sync-data), else the IPEDS rows already in the file (merge-identity), plus
 * Wikidata's other names, the homepage domain, and data/aliases-curated.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../lib/types";
import type { WikidataEntry } from "../../lib/identity-files";
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
  /** Fresh HD rows by unit id (sync-data); null keeps the IPEDS rows already in data/aliases.json (merge-identity). */
  hdRows: Map<string, Record<string, string>> | null;
  wikidata: Map<string, WikidataEntry>;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

/** One alias object per line inside a JSON array, sorted by (unit_id, key) — the same style as data/schools.json. */
export function formatAliasRows(rows: readonly AliasRow[]): string {
  return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;
}

/**
 * Rebuilds data/aliases.json from every source and writes it. Throws, writing nothing, if the result would fail
 * its own invariant (a duplicate (unit_id, key), or a row for a college not in `inputs.schools`).
 */
export function writeAliasTable(root: string, inputs: AliasTableInputs): void {
  const dataDir = join(root, "data");
  const aliasesPath = join(dataDir, "aliases.json");
  const curatedPath = join(dataDir, "aliases-curated.json");

  const nameById = new Map(inputs.schools.map((s) => [s.unit_id, s.name]));
  const schoolIds = new Set(nameById.keys());
  const rows: AliasRow[] = [];

  // IPEDS HD's IALIAS column. Without a fresh HD file (merge-identity), keep the ipeds-sourced rows already on
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
    for (const row of readJson<AliasRow[]>(aliasesPath, [])) {
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

  // Curated, hand-picked short names (data/aliases-curated.json), for the owner to review.
  for (const c of readJson<CuratedAliasEntry[]>(curatedPath, [])) {
    const name = nameById.get(c.unit_id);
    if (!name) {
      console.warn(`  aliases-curated.json: unit_id ${c.unit_id} ("${c.alias}") is not in data/schools.json; skipped`);
      continue;
    }
    if (shouldDropAlias(c.alias, name)) continue;
    rows.push(buildAliasRow(c.unit_id, c.alias, "curated", c.weight));
  }

  const final = dedupeAliases(rows);
  const problems = aliasTableProblems(final, schoolIds);
  if (problems.length) throw new Error(`writeAliasTable: refused to write an invalid table:\n  ${problems.slice(0, 10).join("\n  ")}`);
  writeFileSync(aliasesPath, formatAliasRows(final));
}
