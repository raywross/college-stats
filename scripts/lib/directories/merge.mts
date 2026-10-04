/**
 * Directory listings into the dataset (specs/campus-directories.md#merge): data/directories/<org>.json → one
 * `directories` table per college in data/detail/schools/{id}.json (each listing credited), the `school.directories`
 * summary with its lineage record, and the three source kinds in meta.json. Shared by `npm run merge-directories` and
 * `npm run sync-data`, so the two can't disagree. Pure: no I/O.
 */
import type { DatasetMeta, LineageRecord, School } from "../../../lib/types.ts";
import { DETAIL_TABLES, formatDetail, type DetailTableKey, type SchoolDetail } from "../../../lib/detail.ts";
import {
  newestRead,
  readLabel,
  sortListings,
  summarize,
  type DirectoryCredit,
  type DirectoryRows,
  type Listing,
} from "../../../lib/directories.ts";
import type { DirectoryFile } from "./files.mts";

export function creditOf(f: DirectoryFile): DirectoryCredit {
  return { organization: f.organization, publisher: f.publisher, list_url: f.list_url, read: f.crawled, tier: f.tier, ...f.classification } as DirectoryCredit;
}

/** One `directories` table per college any list matched, for colleges in `knownIds` only. Sorted by unit id. */
export function directoryDetails(files: readonly DirectoryFile[], knownIds: ReadonlySet<string>): SchoolDetail[] {
  const byId = new Map<string, DirectoryRows>();
  for (const f of files) {
    const credit = creditOf(f);
    for (const e of f.entries) {
      const listing: Listing = {
        org: f.org,
        ...(e.tier && e.tier !== f.tier ? { tier: e.tier } : {}),
        ...(e.name ? { name: e.name } : {}),
        ...(e.url ? { url: e.url } : {}),
        ...(e.status ? { status: e.status } : {}),
        ...(e.fact ? { fact: e.fact } : {}),
        ...(e.quote ? { quote: e.quote } : {}),
        ...(e.multi ? { multi: true as const } : {}),
      };
      for (const m of e.matches) {
        if (!knownIds.has(m.unit_id)) continue;
        const rows = byId.get(m.unit_id) ?? byId.set(m.unit_id, { credits: {}, listings: [] }).get(m.unit_id)!;
        rows.credits[f.org] = credit;
        // The same chapter listed twice (two spellings of one campus) is one listing.
        if (!rows.listings.some((l) => JSON.stringify(l) === JSON.stringify(listing))) rows.listings.push(listing);
      }
    }
  }
  return [...byId.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([unit_id, rows]) => {
      const credits = Object.fromEntries(Object.entries(rows.credits).sort((a, b) => a[0].localeCompare(b[0])));
      const sorted: DirectoryRows = { credits, listings: sortListings(rows.listings, credits) };
      return { unit_id, tables: { directories: { source: "directory", vintage: null, year: readLabel(newestRead(sorted)), rows: sorted } } };
    });
}

/** The summary's lineage: the directories behind it and the newest date one was read. */
export function summaryLineage(rows: DirectoryRows): LineageRecord {
  const read = newestRead(rows);
  return { source: "directory", method: "derived", year: readLabel(read), retrieved: read };
}

/** Removes any earlier `directories` summary and its lineage (re-merging starts clean, so it's idempotent). */
export function stripDirectories(school: School): School {
  if (school.directories === undefined && !school.lineage?.directories) return school;
  const { directories: _drop, ...rest } = school;
  void _drop;
  const out = rest as School;
  if (out.lineage?.directories) {
    const { directories: _l, ...lineage } = out.lineage;
    void _l;
    if (Object.keys(lineage).length) out.lineage = lineage;
    else delete out.lineage;
  }
  return out;
}

/** Each school with its summary from `details` (schools without a table get none). Returns new objects for changed schools. */
export function applyDirectories(schools: readonly School[], details: readonly SchoolDetail[]): School[] {
  const byId = new Map(details.map((d) => [d.unit_id, d.tables.directories?.rows]));
  return schools.map((s) => {
    const clean = stripDirectories(structuredClone(s));
    const rows = byId.get(s.unit_id);
    const summary = summarize(rows);
    if (!rows || !summary) return clean;
    // Key order is fixed so merge-reported (which re-appends `reported` and its lineage at the end) and this step can
    // run in either order without reshuffling lines: the summary goes before `lineage`/`trends`/`reported`, and its
    // lineage record first in `lineage`.
    const lineage = { directories: summaryLineage(rows), ...(clean.lineage ?? {}) };
    const entries = Object.entries(clean).filter(([k]) => k !== "lineage");
    const at = entries.findIndex(([k]) => k === "trends" || k === "reported");
    entries.splice(at < 0 ? entries.length : at, 0, ["directories", summary], ["lineage", lineage]);
    return Object.fromEntries(entries) as unknown as School;
  });
}

/** The three source kinds (meta.json `sources`), described from the lists read. */
export function addDirectoryMeta(meta: DatasetMeta, files: readonly DirectoryFile[]): void {
  const lists = files.filter((f) => f.tier !== "C");
  const estimates = files.filter((f) => f.tier === "C" || f.entries.some((e) => e.tier === "C"));
  const dates = files.map((f) => f.crawled).sort();
  const range = dates.length ? (dates[0] === dates.at(-1) ? `read ${dates[0]}` : `read ${dates[0]} to ${dates.at(-1)}`) : "none read yet";
  const names = (fs: readonly DirectoryFile[]) => fs.map((f) => f.organization).join(", ") || "none yet";
  meta.sources.directory = {
    label: "National directories of campus chapters and groups",
    publisher: "Each organization, credited on every listing",
    edition: `Lists ${range}`,
    url: "/data#sources",
    description: `Lists that national organizations publish of their campus chapters and groups, matched to colleges by name, city, and state. Each listing names the organization, the list, and the date we read it; a listing is the organization's claim, not confirmed by the college. Now: ${names(lists)}.`,
  };
  meta.sources["org-estimate"] = {
    label: "Organization estimates for a campus",
    publisher: "Each organization, credited on every figure",
    edition: "Dated per figure",
    url: "/data#sources",
    description: `Figures an organization publishes about one campus, such as how many students of a faith it estimates. Shown with the organization's name and the date we read it, never ranked or compared as official counts. Now: ${names(estimates)}.`,
  };
  meta.sources["policy-page"] = {
    label: "College policy pages",
    publisher: "Each college",
    edition: "Checked per page",
    url: "/data#sources",
    description:
      "A college's own current policy page or handbook (nondiscrimination, housing, records, health plan, conduct code), checked on a date and quoted. Findings of a restriction or a missing policy are confirmed by a second, independent model check against the quote and the page before they are published.",
  };
}

/** Every detail file with its `directories` table replaced by `built` (files that end up empty are dropped). */
export function withDirectoryTables(existing: readonly SchoolDetail[], built: readonly SchoolDetail[]): { details: SchoolDetail[]; changed: Set<string> } {
  const byId = new Map(existing.map((d) => [d.unit_id, d]));
  const builtById = new Map(built.map((d) => [d.unit_id, d]));
  const order = Object.keys(DETAIL_TABLES) as DetailTableKey[];
  const changed = new Set<string>();
  const out: SchoolDetail[] = [];
  for (const id of [...new Set([...byId.keys(), ...builtById.keys()])].sort()) {
    const tables: Record<string, unknown> = { ...(byId.get(id)?.tables ?? {}) };
    delete tables.directories;
    if (builtById.get(id)?.tables.directories) tables.directories = builtById.get(id)!.tables.directories;
    const d = { unit_id: id, tables: Object.fromEntries(order.filter((k) => tables[k]).map((k) => [k, tables[k]])) } as SchoolDetail;
    const before = byId.get(id);
    if (!before || formatDetail(before) !== formatDetail(d)) changed.add(id);
    if (Object.keys(d.tables).length) out.push(d);
  }
  return { details: out, changed };
}

/** Colleges whose summary has no detail table behind it (a file the per-file checks never see). */
export function orphanSummaries(schools: readonly School[], details: readonly SchoolDetail[]): string[] {
  const withTable = new Set(details.filter((d) => d.tables.directories).map((d) => d.unit_id));
  return schools.filter((s) => s.directories && !withTable.has(s.unit_id)).map((s) => `${s.name} (${s.unit_id}): school.directories has no directories table in its detail file`);
}
