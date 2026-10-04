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
import { checkedDates, checkedLabel, type CampusPagesRows } from "../../../lib/campus-pages.ts";
import { readLabel, type Classification, type DirectoryTier, type PolicyCheck } from "../../../lib/directories.ts";
import type { LineageRecord, School } from "../../../lib/types.ts";
import type { DirectoryFile, MatchedEntry } from "../directories/files.mts";
import type { PagesFile } from "./files.mts";

/**
 * Fact types the 2026-10-04 pilot run published below ~95% precision against the hand-checked key (specs/
 * college-reported-data.md, "Campus-life pilot, as built"): kept in data/campus-pages.json for re-scoring, never merged
 * into the dataset until a later run clears the bar. Remove an entry only with a new score that shows it does.
 */
export const HELD_BACK = {
  greek: ["members_total", "housing", "deferred", "formal_term"],
  // Round 2 (2026-10-04): the faith office fell to 13 of 14 across both rounds (UNC's Campus Y was read as one), and a
  // group's own size estimate from 2016 was published although estimates expire; both held until a re-scored run.
  faith: ["office"],
  // Round 3 (2026-10-04): council membership read from reports was wrong at Rutgers (0 of 4); the LGBTQ+ center from
  // college pages fell to 12 of 15 across three rounds (general diversity offices read as LGBTQ+ centers); the
  // nondiscrimination items to about 91% (FAMU's replaced list read as covering both; TCU's short notice read as
  // "no" though its full policy covers both). Held until a re-scored run; the national lists still credit these.
  councilFields: ["members"],
  lgbtq: ["center"],
  policies: ["health_plan_transition", "nondiscrimination_orientation", "nondiscrimination_identity"],
  listings: ["faith/group", "lgbtq/group", "faith/estimate"],
} as const;

/** Which fact types to hold back; tests of the merge's mechanics pass `NONE_HELD`. */
export interface HeldBack {
  greek: readonly string[];
  /** Fields of each Greek council row blanked (set to null) rather than the whole row dropped. */
  councilFields: readonly string[];
  faith: readonly string[];
  lgbtq: readonly string[];
  policies: readonly string[];
  listings: readonly string[];
}
export const NONE_HELD: HeldBack = { greek: [], councilFields: [], faith: [], lgbtq: [], policies: [], listings: [] };

/** `pages` without the HELD_BACK fact types (blocks left empty are dropped). Pure. */
export function withoutHeld(pages: PagesFile, held: HeldBack = HELD_BACK): PagesFile {
  return {
    ...pages,
    colleges: pages.colleges.map((c) => {
      const out = { ...c };
      if (c.greek) {
        const greek: Record<string, unknown> = { ...c.greek };
        for (const k of held.greek) delete greek[k];
        if (Array.isArray(greek.councils) && held.councilFields.length) {
          // Blank the held fields; a row left with neither chapters nor members says nothing and is dropped.
          const rows = (greek.councils as Record<string, unknown>[])
            .map((row) => {
              const kept = { ...row };
              for (const f of held.councilFields) if (f in kept) kept[f] = null;
              return kept;
            })
            .filter((row) => row.chapters != null || row.members != null);
          if (rows.length) greek.councils = rows;
          else delete greek.councils;
        }
        if (Object.keys(greek).length) out.greek = greek as typeof c.greek;
        else delete out.greek;
      }
      if (c.faith) {
        const faith: Record<string, unknown> = { ...c.faith };
        for (const k of held.faith) delete faith[k];
        if (Object.keys(faith).length) out.faith = faith as typeof c.faith;
        else delete out.faith;
      }
      if (c.lgbtq) {
        const lgbtq: Record<string, unknown> = { ...c.lgbtq };
        for (const k of held.lgbtq) delete lgbtq[k];
        if (c.lgbtq.policies) {
          const policies = c.lgbtq.policies.filter((p) => !held.policies.includes(p.key));
          if (policies.length) lgbtq.policies = policies;
          else delete lgbtq.policies;
        }
        if (Object.keys(lgbtq).length) out.lgbtq = lgbtq as typeof c.lgbtq;
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

/** Removes any earlier tier A policy facts and their lineage from `school.lgbtq.policies` (idempotent re-merging). */
export function stripLgbtqPolicies(school: School): School {
  if (!school.lgbtq?.policies && school.lineage?.["lgbtq.policies"] === undefined) return school;
  const out = structuredClone(school);
  if (out.lgbtq) delete out.lgbtq.policies;
  if (out.lineage) {
    delete out.lineage["lgbtq.policies"];
    if (!Object.keys(out.lineage).length) delete out.lineage;
  }
  return out;
}

/**
 * The pilot's published (non-held) policy facts into `school.lgbtq.policies` (field `lgbtq.policies`, source
 * `policy-page`), the same rows the `campus_pages` detail table stores (held back the same way, `withoutHeld`), so
 * the checklist (lib/lgbtq-policy.ts `policyChecklist`) shows a tier A fact — including a "no" with its quote — in
 * place of a tier D lead for the same key, and Explore's filters and Compare's checklist row read it too
 * (`policyIsYes`, `comparedChecklist`), not only the profile. Each `PolicyCheck` keeps its own `verified_by`; a
 * college with no `lgbtq` object at all (not in IPEDS) is left alone rather than inventing one.
 */
export function applyLgbtqPolicies(schools: readonly School[], pages: PagesFile, held: HeldBack = HELD_BACK): School[] {
  const byId = new Map<string, PolicyCheck[]>();
  for (const c of withoutHeld(pages, held).colleges) {
    if (c.lgbtq?.policies?.length) byId.set(c.unit_id, c.lgbtq.policies);
  }
  return schools.map((s) => {
    const clean = stripLgbtqPolicies(s);
    const policies = byId.get(s.unit_id);
    if (!policies?.length || !clean.lgbtq) return clean;
    const newest = policies.map((p) => p.checked).sort().at(-1)!;
    const lineage: LineageRecord = { source: "policy-page", year: checkedLabel(newest), retrieved: newest };
    // Right after `directories` (applyDirectories always puts that one first) and before anything else:
    // `lgbtq.policies`, like `directories`, is never touched by stripReported/restoreFederal (it's not a
    // REPORTED_PATHS or admissions.* key), but reported.*/admissions.* entries are removed and re-appended at the end
    // on every mergeReported pass, so either path must sit ahead of them to survive that round-trip byte for byte
    // (tests/merge-reported.test.mts), while `directories` itself must still come first (tests/directories.test.mts,
    // whose own fresh `applyDirectories` call always puts it there).
    const { directories, ...restLineage } = clean.lineage ?? {};
    const newLineage = directories !== undefined ? { directories, "lgbtq.policies": lineage, ...restLineage } : { "lgbtq.policies": lineage, ...restLineage };
    return { ...clean, lgbtq: { ...clean.lgbtq, policies }, lineage: newLineage };
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
