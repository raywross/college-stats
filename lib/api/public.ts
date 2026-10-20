/**
 * The public read API's shapes (specs/product/assistants.md): the same numbers the site shows, each with the source
 * and year its lineage gives, serialized for an assistant or a developer. Shared by the MCP tools (lib/api/mcp.ts) and
 * the plain GET routes under /api/v1. Pure over a Dataset: no request, no session, nothing from the estimate.
 *
 * What's here is what the site's own pages show: the Compare table's rows (lib/compare-topics.ts) are the facts, so
 * the API never computes separately; the search is the site's search; the filters are Explore's (lib/params.ts).
 * Hidden fields (lib/fields.ts HIDDEN_FIELDS) are dropped by iterating the registry, never by naming a path.
 */
import type { Dataset, SchoolIndexEntry } from "@/lib/dataset";
import { paginate } from "@/lib/dataset";
import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import { citesYear, yearLabel } from "@/lib/lineage";
import { HIDDEN_FIELDS, type FieldPath } from "@/lib/fields";
import { TABLE_GROUPS, type CompareRow } from "@/lib/compare-topics";
import { admissionProfileCellField } from "@/lib/cds/compare-rows";
import { GLOSSARY, GLOSSARY_CATEGORIES, isTermKey, type GlossaryCategory, type GlossaryEntry } from "@/lib/glossary";
import { tierText } from "@/lib/selectivity-tier";
import { parseFilters } from "@/lib/params";
import { resolveNear } from "@/lib/zip-centroids";
import { estimatesShown } from "@/lib/cost-curve";
import { isUnitId } from "@/lib/follow-state";

/** A source and year for one value: the lineage's citation, flattened to what a reader needs to repeat it. */
export interface ApiSource {
  label: string;
  publisher: string;
  /** Display year, or null when the release has no single year ("most recent release"). */
  year: string | null;
  url: string;
  /** The college's own words, when the value was read from its document. */
  quote?: string;
}

export interface CollegeSummary {
  unit_id: string;
  name: string;
  city: string;
  state: string;
  type: School["type"];
  /** The site's page for this college. */
  url: string;
  /** A share, 0–1, to four places; null when not reported. */
  acceptance_rate: number | null;
  undergrad_enrollment: number | null;
  /** Quad's selectivity tier in words ("Highly selective"), both pools where a public's differ; never a number. */
  selectivity: string | null;
}

export interface CollegeFact {
  /** The registered field path, so a reader can ask for its lineage. */
  field: FieldPath;
  label: string;
  /** The value as the site displays it ("6.8%", "1480–1570", "$23,500"). */
  value: string;
  /** The glossary key explaining the label. */
  term: string;
  source: ApiSource;
}

export interface CollegeFacts {
  college: CollegeSummary;
  /** Region, website, admissions and visit links. */
  about: { region: string; website: string | null; admissions: string | null; visit: string | null };
  sections: { title: string; facts: CollegeFact[] }[];
  /** How to credit the numbers. */
  attribution: string;
}

export interface CompareResult {
  colleges: CollegeSummary[];
  rows: { group: string; label: string; term: string; source: ApiSource; values: { unit_id: string; value: string | null; year: string | null }[] }[];
  attribution: string;
}

export interface GlossaryItem {
  key: string;
  term: string;
  short: string;
  long?: string;
  why?: string;
  category: GlossaryCategory;
  related: string[];
}

/** Glossary entries the API leaves out: account and planner terms describe signed-in screens, not colleges. */
const PRIVATE_CATEGORIES: ReadonlySet<GlossaryCategory> = new Set<GlossaryCategory>(["Your account"]);

export const ATTRIBUTION = "Data: Quad (College Scorecard, IPEDS, and each college's Common Data Set, as cited per value).";

export function sourceOf(c: Cited): ApiSource {
  const s: ApiSource = { label: c.label, publisher: c.publisher, year: citesYear(c) ? yearLabel(c) : null, url: c.url };
  if (c.quote) s.quote = c.quote;
  return s;
}

/** True when a row's field is one the site never shows (defense in depth; the compare rows carry none today). */
function hidden(field: FieldPath): boolean {
  for (const h of HIDDEN_FIELDS) if (h === field) return true;
  return false;
}

export function collegeUrl(origin: string, unitId: string): string {
  return `${origin}/schools/${unitId}`;
}

export function summarize(s: School, origin: string): CollegeSummary {
  return {
    unit_id: s.unit_id,
    name: s.name,
    city: s.location.city,
    state: s.location.state,
    type: s.type,
    url: collegeUrl(origin, s.unit_id),
    acceptance_rate: s.admissions.acceptance_rate == null ? null : Math.round(s.admissions.acceptance_rate * 10000) / 10000,
    undergrad_enrollment: s.demographics?.undergrad_enrollment ?? null,
    selectivity: tierText(s),
  };
}

/** The site's own name search (aliases first, then prefixes), optionally kept to one state. */
export function findColleges(data: Dataset, origin: string, query: string, opts: { state?: string | null; limit?: number } = {}): CollegeSummary[] {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const limit = clampLimit(opts.limit, 8, 25);
  const state = opts.state?.trim().toUpperCase().slice(0, 2) || null;
  const hits: SchoolIndexEntry[] = data.searchSchools(q, state ? limit * 4 : limit);
  const out: CollegeSummary[] = [];
  for (const h of hits) {
    if (state && h.state !== state) continue;
    const s = data.getSchoolById(h.id);
    if (s) out.push(summarize(s, origin));
    if (out.length >= limit) break;
  }
  return out;
}

export function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** A college by unit id, or by name when the id isn't one (the best search hit). */
export function resolveCollege(data: Dataset, idOrName: string): School | null {
  const key = idOrName.trim();
  if (!key) return null;
  const id = isUnitId(key) ? key : null;
  if (id) return data.getSchoolById(id);
  const hit = data.searchSchools(key.slice(0, 80), 1)[0];
  return hit ? data.getSchoolById(hit.id) : null;
}

function factFor(row: CompareRow, s: School, data: Dataset): CollegeFact | null {
  const [label, term, field, fmt] = row;
  if (hidden(field)) return null;
  const value = fmt(s);
  if (value === null || value === "") return null;
  const cited = data.citeField(admissionProfileCellField(label, s) ?? field, s);
  return { field, label, value, term, source: sourceOf(cited) };
}

/** Every Compare-table fact the college reports, grouped as the site groups them, each with its citation. */
export function collegeFacts(data: Dataset, s: School, origin: string, sectionTitles?: readonly string[]): CollegeFacts {
  const wanted = sectionTitles?.map((t) => t.toLowerCase());
  const sections: CollegeFacts["sections"] = [];
  for (const group of TABLE_GROUPS) {
    if (wanted && !wanted.includes(group.title.toLowerCase()) && !wanted.includes(group.topic)) continue;
    const facts: CollegeFact[] = [];
    for (const row of group.rows) {
      const fact = factFor(row, s, data);
      if (fact) facts.push(fact);
    }
    if (facts.length) sections.push({ title: group.title, facts });
  }
  return {
    college: summarize(s, origin),
    about: {
      region: s.location.region,
      website: s.links?.website ?? null,
      admissions: s.links?.admissions ?? null,
      visit: s.links?.visit ?? s.links?.virtual_tour ?? null,
    },
    sections,
    attribution: ATTRIBUTION,
  };
}

export const SECTION_TITLES: readonly string[] = TABLE_GROUPS.map((g) => g.title);

/** The facts as plain text, for assistants that read a document rather than JSON (ChatGPT's `fetch`). */
export function factsAsText(facts: CollegeFacts): string {
  const c = facts.college;
  const lines: string[] = [];
  lines.push(`${c.name} (${c.city}, ${c.state}) · ${typeLabel(c.type)}${c.selectivity ? ` · Quad's selectivity: ${c.selectivity}` : ""}`);
  lines.push(`Quad page: ${c.url}`);
  if (facts.about.website) lines.push(`Website: ${facts.about.website}`);
  for (const section of facts.sections) {
    lines.push("", section.title);
    for (const f of section.facts) {
      const src = `${f.source.label}${f.source.year ? `, ${f.source.year}` : ""}`;
      lines.push(`- ${f.label}: ${f.value} (${src})`);
    }
  }
  lines.push("", facts.attribution);
  return lines.join("\n");
}

export function typeLabel(t: School["type"]): string {
  return t === "public" ? "Public" : t === "private-nonprofit" ? "Private nonprofit" : "Private for-profit";
}

/** The Compare table for two to four colleges: one row per metric, a value and its year per college. */
export function compareColleges(data: Dataset, origin: string, ids: readonly string[]): CompareResult | { error: string } {
  const unique = [...new Set(ids.map((i) => i.trim()).filter(isUnitId))].slice(0, 4);
  const schools = data.getSchoolsByIds(unique);
  if (schools.length < 2) return { error: "Give two to four college ids (unit_id) that Quad knows." };
  const rows: CompareResult["rows"] = [];
  for (const group of TABLE_GROUPS) {
    for (const [label, term, field, fmt] of group.rows) {
      if (hidden(field)) continue;
      const values = schools.map((s) => {
        const value = fmt(s);
        const year = value === null ? null : data.citeField(admissionProfileCellField(label, s) ?? field, s).year;
        return { unit_id: s.unit_id, value, year };
      });
      if (values.every((v) => v.value === null)) continue;
      rows.push({ group: group.title, label, term, source: sourceOf(data.citeField(field)), values });
    }
  }
  return { colleges: schools.map((s) => summarize(s, origin)), rows, attribution: ATTRIBUTION };
}

/** Explore's own filters and sorts over the dataset; `forMe` (the signed-in estimate) is never applied here. */
export function exploreColleges(
  data: Dataset,
  origin: string,
  params: Record<string, string | undefined>,
  opts: { limit?: number; page?: number } = {},
): { total: number; page: number; pages: number; items: CollegeSummary[] } {
  const clean: Record<string, string | undefined> = { ...params };
  delete clean.forMe;
  delete clean.view;
  const filters = resolveNear(parseFilters(clean));
  filters.showEstimates = estimatesShown();
  const schools = data.getSchools(filters);
  const perPage = clampLimit(opts.limit, 20, 50);
  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const paged = paginate(schools, page, perPage);
  return { total: paged.total, page: paged.page, pages: paged.pages, items: paged.items.map((s) => summarize(s, origin)) };
}

/** The glossary, less the account terms; `term` narrows by key or by a case-insensitive match on the term. */
export function glossary(term?: string | null): GlossaryItem[] {
  const needle = term?.trim().toLowerCase() ?? "";
  const out: GlossaryItem[] = [];
  for (const category of GLOSSARY_CATEGORIES) {
    if (PRIVATE_CATEGORIES.has(category)) continue;
    for (const [key, entry] of Object.entries(GLOSSARY) as [string, GlossaryEntry][]) {
      if (entry.category !== category) continue;
      if (needle && key !== needle && !entry.term.toLowerCase().includes(needle)) continue;
      out.push({
        key,
        term: entry.term,
        short: entry.short,
        ...(entry.long ? { long: entry.long } : {}),
        ...(entry.why ? { why: entry.why } : {}),
        category,
        related: (entry.related ?? []).filter(isTermKey),
      });
    }
  }
  return out;
}

/** The dataset's publish stamp for the `X-Dataset-Publish` header: the date the data was retrieved. */
export function datasetStamp(data: Dataset): string {
  return data.getMeta().retrieved;
}
