/**
 * The pilot's published facts (data/campus-pages.json) into the dataset, shared by `npm run merge-directories` and
 * `npm run sync-data` (like ../directories/merge.mts, which it feeds):
 * - tier A facts → a `campus_pages` table in each college's detail file (source `policy-page`, the newest date checked);
 * - tier B lists (groups the college's own pages name) and tier C estimates (a group's own claim) → in-memory
 *   directory files, one per college and list page, matched to that one college, so the `directories` table credits
 *   each listing to the page it came from (owner decision 4) and `school.directories` summarizes them.
 * Pure: no I/O.
 */
import { DETAIL_TABLES, formatDetail, type DetailTableKey, type SchoolDetail } from "../../../lib/detail.ts";
import { checkedDates, type CampusPagesRows } from "../../../lib/campus-pages.ts";
import { readLabel, type Classification, type DirectoryTier } from "../../../lib/directories.ts";
import type { DirectoryFile, MatchedEntry } from "../directories/files.mts";
import type { PagesFile } from "./files.mts";

/**
 * Fact types the 2026-10-04 pilot run published below ~95% precision against the hand-checked key (specs/
 * college-reported-data.md, "Campus-life pilot, as built"): kept in data/campus-pages.json for re-scoring, never merged
 * into the dataset until a later run clears the bar. Remove an entry only with a new score that shows it does.
 */
export const HELD_BACK = {
  greek: ["members_total", "housing", "deferred", "formal_term"],
  policies: ["health_plan_transition"],
  listings: ["faith/group", "lgbtq/group"],
} as const;

/** Which fact types to hold back; tests of the merge's mechanics pass `NONE_HELD`. */
export interface HeldBack {
  greek: readonly string[];
  policies: readonly string[];
  listings: readonly string[];
}
export const NONE_HELD: HeldBack = { greek: [], policies: [], listings: [] };

/** `pages` without the HELD_BACK fact types (blocks left empty are dropped). Pure. */
export function withoutHeld(pages: PagesFile, held: HeldBack = HELD_BACK): PagesFile {
  return {
    ...pages,
    colleges: pages.colleges.map((c) => {
      const out = { ...c };
      if (c.greek) {
        const greek: Record<string, unknown> = { ...c.greek };
        for (const k of held.greek) delete greek[k];
        if (Object.keys(greek).length) out.greek = greek as typeof c.greek;
        else delete out.greek;
      }
      if (c.lgbtq?.policies) {
        const policies = c.lgbtq.policies.filter((p) => !held.policies.includes(p.key));
        const lgbtq = { ...c.lgbtq, policies };
        if (!policies.length) delete (lgbtq as Partial<typeof lgbtq>).policies;
        if (Object.keys(lgbtq).length) out.lgbtq = lgbtq;
        else delete out.lgbtq;
      }
      if (c.listings) out.listings = c.listings.filter((l) => !held.listings.includes(`${l.domain}/${l.kind}`));
      return out;
    }),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "group";

/**
 * One directory file per college, list page, and classification (a credit has one list URL and one classification),
 * each entry matched to its college with method "reviewed" (the college's own page, so no name matching).
 */
export function pilotDirectoryFiles(pages: PagesFile, held: HeldBack = HELD_BACK): DirectoryFile[] {
  const files = new Map<string, DirectoryFile>();
  for (const c of withoutHeld(pages, held).colleges) {
    const keyN = new Map<string, number>();
    for (const l of c.listings ?? []) {
      const cls: Classification = l.domain === "faith" ? { domain: "faith", tradition: l.tradition ?? "other" } : { domain: "lgbtq", kind: "group" };
      const tier: DirectoryTier = l.kind === "estimate" ? "C" : "B";
      const base = l.kind === "estimate" ? `estimate-${slug(l.publisher)}` : `college-${l.domain === "faith" ? slug(l.tradition ?? "other") : "lgbtq-groups"}`;
      const id = `${c.unit_id}|${base}|${l.url}`;
      let f = files.get(id);
      if (!f) {
        const n = (keyN.get(base) ?? 0) + 1;
        keyN.set(base, n);
        f = {
          org: n === 1 ? base : `${base}-${n}`,
          organization: l.kind === "estimate" ? l.publisher : c.name,
          publisher: l.kind === "estimate" ? l.publisher : c.name,
          list_url: l.url,
          tier,
          classification: cls,
          crawled: l.checked,
          counts: { entries: 0, matched: 0, multi: 0, unmatched: 0, colleges: 1 },
          entries: [],
        };
        files.set(id, f);
      }
      const entry: MatchedEntry = {
        campus: c.name,
        name: l.name,
        quote: l.quote,
        ...(l.fact ? { fact: l.fact, tier: "C" as const } : {}),
        matches: [{ unit_id: c.unit_id, name: c.name, confidence: 1, method: "reviewed" }],
      };
      f.entries.push(entry);
      f.counts.entries++;
      f.counts.matched++;
    }
  }
  return [...files.values()];
}

/** One `campus_pages` table per college with tier A facts, for colleges in `knownIds`. Sorted by unit id. */
export function campusPagesDetails(pages: PagesFile, knownIds: ReadonlySet<string>, held: HeldBack = HELD_BACK): SchoolDetail[] {
  return withoutHeld(pages, held).colleges
    .filter((c) => knownIds.has(c.unit_id) && (c.greek || c.faith || c.lgbtq))
    .sort((a, b) => a.unit_id.localeCompare(b.unit_id))
    .map((c) => {
      const rows: CampusPagesRows = { ...(c.greek ? { greek: c.greek } : {}), ...(c.faith ? { faith: c.faith } : {}), ...(c.lgbtq ? { lgbtq: c.lgbtq } : {}) };
      const newest = checkedDates(rows).at(-1) ?? c.checked;
      return { unit_id: c.unit_id, tables: { campus_pages: { source: "policy-page" as const, vintage: null, year: readLabel(newest), rows } } };
    });
}

/** Every detail file with table `key` replaced by `built`'s (files left empty are dropped), and which files changed. */
export function withTable(existing: readonly SchoolDetail[], built: readonly SchoolDetail[], key: DetailTableKey): { details: SchoolDetail[]; changed: Set<string> } {
  const byId = new Map(existing.map((d) => [d.unit_id, d]));
  const builtById = new Map(built.map((d) => [d.unit_id, d]));
  const order = Object.keys(DETAIL_TABLES) as DetailTableKey[];
  const changed = new Set<string>();
  const out: SchoolDetail[] = [];
  for (const id of [...new Set([...byId.keys(), ...builtById.keys()])].sort()) {
    const tables: Record<string, unknown> = { ...(byId.get(id)?.tables ?? {}) };
    delete tables[key];
    if (builtById.get(id)?.tables[key]) tables[key] = builtById.get(id)!.tables[key];
    const d = { unit_id: id, tables: Object.fromEntries(order.filter((k) => tables[k]).map((k) => [k, tables[k]])) } as SchoolDetail;
    const before = byId.get(id);
    if (!before || formatDetail(before) !== formatDetail(d)) changed.add(id);
    if (Object.keys(d.tables).length) out.push(d);
  }
  return { details: out, changed };
}
