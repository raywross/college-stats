/**
 * Matching the colleges a high school profile lists ("UCLA", "University of California, Los Angeles", "Cornell") to
 * IPEDS unit ids in data/schools.json, with the alias table (lib/aliases.ts aliasKey, data/aliases.json). Pure.
 *
 * Never a guess: a name matches only when exactly one college answers it at the strongest rule that answers at all.
 * Two or more colleges at that rule ("USC": Southern California or South Carolina; "Columbia College") is
 * `ambiguous` and goes to the review queue with the candidates; no rule answering is `none` (a community college, a
 * college abroad, a service academy outside the 4-year set, or a short form no alias lists yet). Resolving either is a
 * curated alias (data/aliases-curated.json), not a code change.
 *
 * Rules, strongest first:
 *   1. the official name's key ("University of California-Los Angeles" and "University of California, Los Angeles"
 *      share one key), also with a leading "The" dropped and "&" read as "and";
 *   2. an alias row's key (curated, IPEDS, Wikidata, domain);
 *   3. the official name minus an IPEDS "-Main Campus" suffix ("Purdue University" → "Purdue University-Main Campus");
 *   4. the name plus "University" or "College", or "University of" plus the name ("Cornell" → "Cornell University").
 * A state hint written after the name ("Miami University (OH)", "Westminster College, PA") narrows any rule's
 * candidates to that state.
 */
import { aliasKey } from "../../../../lib/aliases.ts";

export interface MatchCollege {
  unit_id: string;
  name: string;
  state: string;
}

export interface MatchAlias {
  unit_id: string;
  key: string;
  weight: number;
}

export type NameMatch =
  | { kind: "matched"; unit_id: string; rule: 1 | 2 | 3 | 4 }
  | { kind: "ambiguous"; candidates: string[]; rule: 1 | 2 | 3 | 4 }
  | { kind: "none" };

export interface CollegeIndex {
  byName: Map<string, Set<string>>;
  byAlias: Map<string, Set<string>>;
  byMain: Map<string, Set<string>>;
  stateOf: Map<string, string>;
  ids: Set<string>;
}

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "),
);

/** Spelling variants that should share a key: "&" → "and", "St." → "Saint", a leading "The". */
export function nameKeys(name: string): string[] {
  const base = name.replace(/&/g, " and ").replace(/\bSt\.?\s+(?=[A-Z])/g, "Saint ").replace(/\bUniv\.?(?=\s|$)/gi, "University");
  const keys = new Set([aliasKey(name), aliasKey(base), aliasKey(base.replace(/^the\s+/i, ""))]);
  keys.delete("");
  return [...keys];
}

/** A trailing state hint: "Miami University (OH)" → OH; "Westminster College, PA" → PA. */
export function stateHint(name: string): { name: string; state: string | null } {
  const m = /^(.*?)\s*(?:\(([A-Z]{2})\)|,\s*([A-Z]{2}))\s*$/.exec(name.trim());
  const st = m ? (m[2] ?? m[3]) : null;
  if (m && st && STATES.has(st)) return { name: m[1].trim(), state: st };
  return { name: name.trim(), state: null };
}

const add = (map: Map<string, Set<string>>, key: string, id: string) => {
  if (!key) return;
  const s = map.get(key) ?? new Set<string>();
  s.add(id);
  map.set(key, s);
};

export function buildCollegeIndex(colleges: readonly MatchCollege[], aliases: readonly MatchAlias[] = []): CollegeIndex {
  const byName = new Map<string, Set<string>>();
  const byAlias = new Map<string, Set<string>>();
  const byMain = new Map<string, Set<string>>();
  const stateOf = new Map<string, string>();
  for (const c of colleges) {
    stateOf.set(c.unit_id, c.state);
    for (const k of nameKeys(c.name)) add(byName, k, c.unit_id);
    const main = /^(.*?)-\s*Main Campus$/i.exec(c.name);
    if (main) for (const k of nameKeys(main[1])) add(byMain, k, c.unit_id);
  }
  const known = new Set(colleges.map((c) => c.unit_id));
  for (const a of aliases) if (known.has(a.unit_id)) add(byAlias, a.key, a.unit_id);
  return { byName, byAlias, byMain, stateOf, ids: known };
}

function lookup(map: Map<string, Set<string>>, keys: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const k of keys) for (const id of map.get(k) ?? []) out.add(id);
  return out;
}

/** Matches one listed name; see the module comment for the rules. */
export function matchCollege(index: CollegeIndex, listed: string): NameMatch {
  const cleaned = listed.replace(/\s*[*†‡]+\s*$/, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { kind: "none" };
  const { name, state } = stateHint(cleaned);
  const keys = nameKeys(name);
  const suffixed = keys.flatMap((k) => [`${k}university`, `${k}college`, `universityof${k}`]);
  const rules: [1 | 2 | 3 | 4, Set<string>][] = [
    [1, lookup(index.byName, keys)],
    [2, lookup(index.byAlias, keys)],
    [3, lookup(index.byMain, keys)],
    [4, lookup(index.byName, suffixed)],
  ];
  for (const [rule, found] of rules) {
    let ids = [...found];
    if (state) ids = ids.filter((id) => index.stateOf.get(id) === state);
    if (ids.length === 1) return { kind: "matched", unit_id: ids[0], rule };
    if (ids.length > 1) return { kind: "ambiguous", candidates: ids.sort(), rule };
  }
  return { kind: "none" };
}
