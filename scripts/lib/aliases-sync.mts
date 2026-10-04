/**
 * Writes data/aliases.json (specs/school-identity/aliases.md; lib/aliases.ts): the IPEDS directory's IALIAS column
 * when a fresh HD file is at hand (sync-data), else the IPEDS rows already in the file (merge-identity), plus
 * Wikidata's other names, the homepage domain, and data/aliases-curated.json.
 */
import type { School } from "../../lib/types";
import type { WikidataEntry } from "../../lib/identity-files";

export interface AliasTableInputs {
  schools: School[];
  /** Fresh HD rows by unit id (sync-data); null keeps the IPEDS rows already in data/aliases.json (merge-identity). */
  hdRows: Map<string, Record<string, string>> | null;
  wikidata: Map<string, WikidataEntry>;
}

export function writeAliasTable(root: string, inputs: AliasTableInputs): void {
  // Built by the aliases track (aliases.md, implementation step 2).
  void root;
  void inputs;
}
