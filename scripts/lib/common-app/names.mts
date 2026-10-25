/**
 * Joins Requirements Grid names to Common App members (specs/data-expansion/common-app.md "Checks"), and through a
 * member's IPEDS id to the site's `unit_id`. Rules, in order, each needing exactly one member:
 *   1. the member's Explore title, exactly;
 *   2. the title normalized: case, curly quotes, and the spaces and dash kinds around a hyphen ("University of
 *      Michigan- Dearborn" ≡ "University of Michigan-Dearborn", "Marian University - Indiana" ≡ "Marian University-Indiana");
 *   3. a row of data/aliases.json whose key equals the grid name's `aliasKey` and whose unit_id is exactly one
 *      member's IPEDS id;
 *   4. data/common-app/name-map.json (grid name → slug), checked by hand against the Explore record.
 * Never a similarity guess: a name no rule matches goes to `unmatched`. A name the grid prints on several differing
 * rows ("Siena University" ×3 in 2026-27) is never joined, since nothing says which row is which.
 *
 * A matched row gets the member's `slug`; its `unit_id` is the member's IPEDS id when data/schools.json carries it,
 * else null (counted separately: non-US members, community colleges, ids the site doesn't carry). Pure.
 */
import { aliasKey } from "../../../lib/aliases.ts";
import type { AliasRow } from "../../../lib/identity-files.ts";
import type { GridRow, Member, NameMap } from "../../../lib/common-app/types.ts";
import { repeatedNames } from "./grid.mts";

export type JoinRule = "title" | "normalized" | "alias" | "name-map";

/** Case, curly quotes, runs of spaces, and spaces/dash kinds around a hyphen don't count. */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface JoinResult {
  rows: GridRow[];
  /** Grid names no rule matched (or printed on several differing rows), in grid order. */
  unmatched: string[];
  /** Per joined row (by index into `rows`): the rule that joined it. */
  rule: (JoinRule | null)[];
  /** Name-map entries naming a slug that isn't a member, or a grid name that isn't in the grid. */
  staleMap: string[];
  /** Slugs claimed by more than one grid row (each row keeps its join; listed for review). */
  sharedSlugs: Map<string, string[]>;
  stats: {
    rows: number;
    joined: number;
    /** Joined to a member whose IPEDS id is in data/schools.json. */
    matched: number;
    /** Joined to a member with no IPEDS id. */
    member_without_ipeds: number;
    /** Joined to a member whose IPEDS id data/schools.json doesn't carry. */
    ipeds_not_carried: number;
    by_rule: Record<JoinRule, number>;
    unmatched: number;
  };
}

/** Members keyed by a function, keeping only keys with exactly one member. */
function uniqueBy(members: readonly Member[], key: (m: Member) => string | null): Map<string, Member> {
  const all = new Map<string, Member[]>();
  for (const m of members) {
    const k = key(m);
    if (k) all.set(k, [...(all.get(k) ?? []), m]);
  }
  return new Map([...all].filter(([, ms]) => ms.length === 1).map(([k, ms]) => [k, ms[0]]));
}

export function joinNames(
  rows: readonly GridRow[],
  members: readonly Member[],
  aliases: readonly Pick<AliasRow, "unit_id" | "key">[],
  nameMap: NameMap,
  schools: readonly { unit_id: string }[]
): JoinResult {
  const schoolIds = new Set(schools.map((s) => s.unit_id));
  const byTitle = uniqueBy(members, (m) => m.title);
  const byNorm = uniqueBy(members, (m) => normalizeTitle(m.title));
  const byIpeds = uniqueBy(members, (m) => m.ipeds);
  const bySlug = new Map(members.map((m) => [m.slug, m]));
  const aliasIds = new Map<string, Set<string>>();
  for (const a of aliases) {
    if (!byIpeds.has(a.unit_id)) continue;
    aliasIds.set(a.key, (aliasIds.get(a.key) ?? new Set()).add(a.unit_id));
  }
  const repeated = repeatedNames(rows);
  const out: GridRow[] = [];
  const rule: (JoinRule | null)[] = [];
  const unmatched: string[] = [];
  const by_rule: Record<JoinRule, number> = { title: 0, normalized: 0, alias: 0, "name-map": 0 };
  let matched = 0;
  let member_without_ipeds = 0;
  let ipeds_not_carried = 0;
  const claims = new Map<string, string[]>();

  for (const r of rows) {
    let m: Member | undefined;
    let how: JoinRule | null = null;
    if (!repeated.has(r.name.trim().toLowerCase())) {
      if ((m = byTitle.get(r.name))) how = "title";
      else if ((m = byNorm.get(normalizeTitle(r.name)))) how = "normalized";
      else {
        const ids = aliasIds.get(aliasKey(r.name));
        if (ids && ids.size === 1 && (m = byIpeds.get([...ids][0]))) how = "alias";
        else if (nameMap[r.name] && (m = bySlug.get(nameMap[r.name]))) how = "name-map";
      }
    }
    if (!m || !how) {
      out.push({ ...r, unit_id: null, slug: null });
      rule.push(null);
      unmatched.push(r.name);
      continue;
    }
    by_rule[how]++;
    const carried = m.ipeds !== null && schoolIds.has(m.ipeds);
    if (carried) matched++;
    else if (m.ipeds === null) member_without_ipeds++;
    else ipeds_not_carried++;
    claims.set(m.slug, [...(claims.get(m.slug) ?? []), r.name]);
    out.push({ ...r, unit_id: carried ? m.ipeds : null, slug: m.slug });
    rule.push(how);
  }

  const gridNames = new Set(rows.map((r) => r.name));
  const staleMap = Object.entries(nameMap)
    .filter(([name, slug]) => !bySlug.has(slug) || !gridNames.has(name))
    .map(([name, slug]) => `${name} → ${slug}${bySlug.has(slug) ? " (name not in this grid)" : " (not a member)"}`);
  const sharedSlugs = new Map([...claims].filter(([, names]) => names.length > 1));
  return {
    rows: out,
    unmatched,
    rule,
    staleMap,
    sharedSlugs,
    stats: {
      rows: rows.length,
      joined: rows.length - unmatched.length,
      matched,
      member_without_ipeds,
      ipeds_not_carried,
      by_rule,
      unmatched: unmatched.length,
    },
  };
}
