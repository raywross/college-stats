/**
 * Joining the lists' names to the site's colleges (specs/data-expansion/coalition-app.md "Joining names to
 * colleges"): the admissions link's domain when the list prints one (the college's own site is the strongest
 * identifier: the Coalition's "Wheaton College" links wheatoncollege.edu, Massachusetts, while the exact name is
 * Illinois's), then the name exactly, the name normalized, an alias-table key, and the hand map; each rule needs
 * exactly one college, and nothing is ever guessed by similarity. Pure.
 */
import { aliasKey, type AliasRow } from "../../../lib/aliases.ts";
import type { CoalitionJoinRule } from "../../../lib/coalition.ts";
import { normalizeTitle } from "../common-app/names.mts";

export interface JoinCollege {
  unit_id: string;
  name: string;
  website: string | null;
}

export interface JoinIndex {
  byName: Map<string, string[]>;
  byNormalized: Map<string, string[]>;
  byAliasKey: Map<string, string[]>;
  byDomain: Map<string, string[]>;
  /** A name → one unit id, or several when one printed name stands for more than one college (St. John's two campuses). */
  nameMap: Record<string, string | string[]>;
  known: Set<string>;
}

/** The registrable part of a host: "admissions.vanderbilt.edu" → "vanderbilt.edu"; "www.aber.ac.uk" → "aber.ac.uk". */
export function baseDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  const parts = host.split(".");
  if (parts.length < 2) return null;
  const n = parts.length >= 3 && parts.at(-1)!.length === 2 && ["ac", "co", "edu", "org", "gov"].includes(parts.at(-2)!) ? 3 : 2;
  return parts.slice(-n).join(".");
}

const push = (m: Map<string, string[]>, k: string, id: string) => {
  const list = m.get(k) ?? [];
  if (!list.includes(id)) list.push(id);
  m.set(k, list);
};

export function buildJoinIndex(colleges: readonly JoinCollege[], aliases: readonly AliasRow[], nameMap: Record<string, string | string[]>): JoinIndex {
  const byName = new Map<string, string[]>();
  const byNormalized = new Map<string, string[]>();
  const byAliasKey = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();
  const known = new Set<string>();
  for (const c of colleges) {
    known.add(c.unit_id);
    push(byName, c.name, c.unit_id);
    push(byNormalized, normalizeTitle(c.name), c.unit_id);
    const d = c.website ? baseDomain(c.website) : null;
    if (d) push(byDomain, d, c.unit_id);
  }
  for (const a of aliases) if (known.has(a.unit_id)) push(byAliasKey, a.key, a.unit_id);
  return { byName, byNormalized, byAliasKey, byDomain, nameMap, known };
}

const one = (list: string[] | undefined): string | null => (list && list.length === 1 ? list[0] : null);

/** The hand map's ids for a name, kept to the colleges the site carries (a stale entry is ignored, never trusted). */
export function mappedIds(index: Pick<JoinIndex, "nameMap" | "known">, name: string): string[] {
  const v = index.nameMap[name];
  const ids = v === undefined ? [] : Array.isArray(v) ? v : [v];
  return ids.filter((id) => index.known.has(id));
}

/**
 * The college a printed name joins to, and the rule that did it; `tried` lists the rules attempted that gave no single
 * answer (the domain rule is attempted only when the list prints a link). A hand-map entry with several ids is the
 * caller's to expand (sync-coalition.mts); here it is no single answer.
 */
export function joinName(index: JoinIndex, name: string, admissionsUrl: string | null): { unit_id: string | null; join: CoalitionJoinRule | null; tried: CoalitionJoinRule[] } {
  const tried: CoalitionJoinRule[] = [];
  const attempt = (rule: CoalitionJoinRule, id: string | null) => {
    if (id) return { unit_id: id, join: rule, tried };
    tried.push(rule);
    return null;
  };
  const mapped = mappedIds(index, name);
  return (
    (admissionsUrl ? attempt("domain", one(index.byDomain.get(baseDomain(admissionsUrl) ?? ""))) : null) ??
    attempt("name", one(index.byName.get(name))) ??
    attempt("normalized", one(index.byNormalized.get(normalizeTitle(name)))) ??
    attempt("alias", one(index.byAliasKey.get(aliasKey(name)))) ??
    attempt("name-map", one(mapped)) ?? { unit_id: null, join: null, tried }
  );
}
