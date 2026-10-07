import { aliasKey, compareMatches, queryForms, scoreSchool, type AliasLookupRow, type AliasRow, type SchoolMatch } from "./aliases.ts";
import { crestBrand } from "./brand.ts";
// Types only: lib/dataset.ts is the server's query code; the browser imports this module for `matchIndex`.
import type { Dataset, SchoolIndexEntry } from "./dataset.ts";
import type { School } from "./types.ts";

/**
 * The search index (specs/serving-architecture.md#3-search-in-the-browser): one entry per college, built at deploy
 * time by `app/search-index.json/route.ts`, fetched once by the browser, and matched there with the same scorer
 * `Dataset.searchSchools` uses (lib/aliases.ts). Pure: no fs, no Next, nothing that reads the request.
 */

export interface SearchIndexEntry extends SchoolIndexEntry {
  /** Tie-break, as `compareMatches` does: the bigger applicant pool first. */
  applicants: number | null;
  /** Display form and weight; the key is computed client-side with `aliasKey()` once per index load. */
  aliases: [alias: string, weight: number][];
}

export interface SearchIndex {
  /** `meta.retrieved` (the data's date): for cache-busting in tests only. */
  generated: string;
  schools: SearchIndexEntry[];
}

/**
 * `toIndexEntry` (lib/dataset.ts) field for field. Repeated here, not imported, so the browser bundle that runs
 * `matchIndex` doesn't carry the dataset's query code; tests/search-index.test.mts compares the two.
 */
function indexEntry(s: School): SchoolIndexEntry {
  const brand = crestBrand(s);
  return {
    id: s.unit_id,
    name: s.name,
    city: s.location.city,
    state: s.location.state,
    type: s.type,
    acceptance: s.admissions.acceptance_rate,
    ...(brand ? { brand } : {}),
  };
}

/**
 * One entry per college, in dataset order (so equal scores keep the order `searchSchools` gives them). `dataset`
 * only needs its schools and meta; `aliasRows` is the rows of data/aliases.json, which the dataset keeps private
 * (the route reads the file and passes them in).
 */
export function buildSearchIndex(
  dataset: Pick<Dataset, "getAllSchools" | "getMeta">,
  aliasRows: readonly Pick<AliasRow, "unit_id" | "alias" | "weight">[] = [],
): SearchIndex {
  const byUnit = new Map<string, [string, number][]>();
  for (const row of aliasRows) {
    const list = byUnit.get(row.unit_id);
    if (list) list.push([row.alias, row.weight]);
    else byUnit.set(row.unit_id, [[row.alias, row.weight]]);
  }
  return {
    generated: dataset.getMeta().retrieved,
    schools: dataset.getAllSchools().map((s) => ({
      ...indexEntry(s),
      applicants: s.admissions.applicants,
      aliases: byUnit.get(s.unit_id) ?? [],
    })),
  };
}

/** One entry with what the scorer reads, rebuilt once per index load. */
interface Prepared {
  entry: SearchIndexEntry;
  school: { name: string; location: { city: string; state: string }; admissions: { applicants: number | null } };
  aliasRows: AliasLookupRow[];
}

const preparedByIndex = new WeakMap<SearchIndex, Prepared[]>();

function prepare(index: SearchIndex): Prepared[] {
  let prepared = preparedByIndex.get(index);
  if (!prepared) {
    prepared = index.schools.map((entry) => ({
      entry,
      school: { name: entry.name, location: { city: entry.city, state: entry.state }, admissions: { applicants: entry.applicants } },
      aliasRows: entry.aliases.map(([alias, weight]) => ({ alias, key: aliasKey(alias), weight })),
    }));
    preparedByIndex.set(index, prepared);
  }
  return prepared;
}

/** The entry without the fields only the scorer needs: the shape `searchSchools` returns. */
export function toSchoolEntry(e: SearchIndexEntry): SchoolIndexEntry {
  const { id, name, city, state, type, acceptance } = e;
  return { id, name, city, state, type, acceptance, ...(e.brand ? { brand: e.brand } : {}) };
}

/**
 * Same semantics as `Dataset.searchSchools`: alias-exact first, then name-prefix, alias-prefix, word-prefix, then
 * anywhere; ties go to bigger applicant pools, then to dataset order. An empty query matches nothing.
 */
export function matchIndex(index: SearchIndex, q: string, opts: { limit?: number; exclude?: string[] } = {}): (SchoolIndexEntry & { matched?: string })[] {
  if (!q.trim()) return [];
  const forms = queryForms(q);
  const skip = new Set(opts.exclude ?? []);
  const scored: { match: SchoolMatch; school: Prepared["school"]; entry: SearchIndexEntry }[] = [];
  for (const p of prepare(index)) {
    if (skip.has(p.entry.id)) continue;
    const match = scoreSchool(p.school, q, p.aliasRows, forms);
    if (match) scored.push({ match, school: p.school, entry: p.entry });
  }
  return scored
    .sort(compareMatches)
    .slice(0, opts.limit ?? 8)
    .map(({ match, entry }) => ({ ...toSchoolEntry(entry), ...(match.matched ? { matched: match.matched } : {}) }));
}
