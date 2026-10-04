/**
 * Short names and nicknames (specs/school-identity/aliases.md): splitting, normalizing, and weighting aliases from
 * IPEDS, Wikidata, the homepage domain, and data/aliases-curated.json into data/aliases.json, and the scorer search
 * and Explore share. Pure.
 */
import type { AliasRow } from "./identity-files";

export type { AliasRow };

/** The search key for an alias or a query: lower case, accents stripped, punctuation and spaces removed. */
export function aliasKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
