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

/* ------------------------------------------------------------------ */
/* 1. Split                                                            */
/* ------------------------------------------------------------------ */

/**
 * Splits one IPEDS IALIAS (or similar free-text) value into candidate aliases: `|`, `,`, `;`, ` / ` (space, slash,
 * space), and runs of two or more bare spaces all separate entries; a single space inside a name ("Auburn
 * Montgomery") is left alone. Each piece is trimmed; empty pieces (e.g. from "AUM||Auburn…") are dropped.
 */
export function splitAliasField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*\|\s*|\s*;\s*|\s*,\s*|\s+\/\s+|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* 2. Normalize (aliasKey above keeps the compressed key; this keeps a "spaced" key for the drop rules below)       */
/* ------------------------------------------------------------------ */

/** Lower case, accents stripped, every run of non-alphanumeric characters collapsed to one space, trimmed. */
function spacedForm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* 3. Drop                                                             */
/* ------------------------------------------------------------------ */

/** Common filler words that never make a useful alias on their own (checked against the compressed key). */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "of", "at", "in", "on", "for", "to",
  "university", "college", "institute", "school", "state", "campus", "main",
]);

/** A bare hostname ("uga.edu"): Wikidata and IPEDS both occasionally list one as if it were a name. */
const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * True when `alias` occurs as a whole word or phrase inside `officialName` — not merely as a run of letters inside a
 * longer word. "Cal" is not a substring of "University of California-Berkeley" by this test (it's a fragment of the
 * single word "California", with no boundary after it); "Georgia" is, inside "University of Georgia". Checking at
 * the word level (not the character level) is what lets "Cal" and "Pitt" survive as curated aliases for schools
 * whose own names happen to contain those letters.
 */
function isPlainSubstringOfName(alias: string, officialName: string): boolean {
  const a = spacedForm(alias);
  if (!a) return true;
  const name = spacedForm(officialName);
  return new RegExp(`\\b${escapeRegExp(a)}\\b`).test(name);
}

/**
 * Every reason a split, trimmed alias value never becomes a row (specs/school-identity/aliases.md, "Drop"): equal to
 * the official name's key, a bare domain, one character, a stop word, a plain substring of the official name,
 * `Unull`/`null`/`-`, or over 60 characters. A curated alias may repeat a word of the name: the curated file is the
 * only place to rank one college above another, and "Miami" must reach the University of Miami ahead of Miami
 * University-Oxford, whose name merely starts with it.
 */
export function shouldDropAlias(alias: string, officialName: string, opts: { curated?: boolean } = {}): boolean {
  const trimmed = alias.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (lower === "unull" || lower === "null" || lower === "-") return true;
  if (trimmed.length > 60) return true;
  if (BARE_DOMAIN_RE.test(trimmed)) return true;
  const key = aliasKey(trimmed);
  if (key.length <= 1) return true;
  if (STOP_WORDS.has(key)) return true;
  if (key === aliasKey(officialName)) return true;
  if (!opts.curated && isPlainSubstringOfName(trimmed, officialName)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* 4. Weight, build, and dedupe                                        */
/* ------------------------------------------------------------------ */

export const ALIAS_WEIGHTS = { curated: 4, ipeds: 3, wikidata: 2, domain: 2 } as const satisfies Record<AliasRow["source"], number>;

/** One curated entry (data/aliases-curated.json): see specs/school-identity/aliases.md for the format. */
export interface CuratedAliasEntry {
  unit_id: string;
  alias: string;
  /** Overrides the default curated weight (4) — only to pin one college above another sharing the same alias (USC). */
  weight?: number;
}

/** Builds one row; `weight` defaults to the source's standard weight. */
export function buildAliasRow(unitId: string, alias: string, source: AliasRow["source"], weight: number = ALIAS_WEIGHTS[source]): AliasRow {
  return { unit_id: unitId, alias, key: aliasKey(alias), source, weight };
}

/** Source priority used only to break a tie in weight (e.g. Wikidata's "UGA" over the domain label "uga": both weight 2). */
const SOURCE_PRIORITY: Record<AliasRow["source"], number> = { curated: 4, ipeds: 3, wikidata: 2, domain: 1 };

/**
 * Collapses to one row per (unit_id, key), keeping the highest weight; a tie keeps the higher-priority source. The
 * result is sorted by (unit_id, key), the order data/aliases.json is written in.
 */
export function dedupeAliases(rows: readonly AliasRow[]): AliasRow[] {
  const best = new Map<string, AliasRow>();
  for (const row of rows) {
    const k = `${row.unit_id}\u0000${row.key}`;
    const cur = best.get(k);
    if (!cur || row.weight > cur.weight || (row.weight === cur.weight && SOURCE_PRIORITY[row.source] > SOURCE_PRIORITY[cur.source])) {
      best.set(k, row);
    }
  }
  return [...best.values()].sort((a, b) => (a.unit_id === b.unit_id ? a.key.localeCompare(b.key) : a.unit_id.localeCompare(b.unit_id)));
}

/**
 * The short, identifying label of a homepage's domain ("https://www.uga.edu" → "uga"; "https://admissions.gatech.edu"
 * → "gatech"): strips a leading www/web/my/home/portal subdomain, then prefers the label just before the TLD when
 * one remains (so an unrecognized subdomain like "admissions.harvard.edu" still gives "harvard"). Null for
 * unparseable URLs and generic leftovers ("www", "edu").
 */
const SKIP_DOMAIN_LABELS = new Set(["www", "edu", "web", "my", "home", "info", "online", "portal", "go", "welcome"]);
const STRIP_SUBDOMAINS = new Set(["www", "web", "my", "home", "portal", "www2"]);

export function domainLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  let parts = host.split(".").filter(Boolean);
  while (parts.length > 2 && STRIP_SUBDOMAINS.has(parts[0])) parts = parts.slice(1);
  const label = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  if (!label || label.length <= 1 || SKIP_DOMAIN_LABELS.has(label)) return null;
  return label;
}

/* ------------------------------------------------------------------ */
/* 5. Search: the scorer searchSchools and Explore's q filter share     */
/* ------------------------------------------------------------------ */

/** The school fields the scorer needs; a real `School` (lib/types.ts) satisfies this structurally. */
export interface ScorableSchool {
  name: string;
  location: { city: string; state: string };
  admissions: { applicants: number | null };
}

/** One alias row's fields the scorer reads. */
export type AliasLookupRow = Pick<AliasRow, "alias" | "key" | "weight">;

/** One school's match against a search query: its score, and (for an alias match) the display form that matched. */
export interface SchoolMatch {
  score: number;
  /** The alias' display form ("Georgia Tech"), present only when an alias tier produced the winning score. */
  matched?: string;
}

function best(candidates: readonly (SchoolMatch | null)[]): SchoolMatch | null {
  let out: SchoolMatch | null = null;
  for (const c of candidates) if (c && (!out || c.score > out.score)) out = c;
  return out;
}

/** A query's two normalized forms: trimmed lower case, and the alias key. */
export interface QueryForms {
  q: string;
  qKey: string;
}

/** The forms `scoreSchool` needs; a caller scoring many schools against one query computes them once and passes them in. */
export function queryForms(query: string): QueryForms {
  return { q: query.trim().toLowerCase(), qKey: aliasKey(query) };
}

/**
 * Scores one school against a query, per specs/school-identity/aliases.md's table: an alias key equal to the
 * query's key (5 + the alias' weight); the official name starting with the query (3); an alias key starting with
 * the query's key, query at least 2 characters (2.5 + weight ÷ 10); a word of the name starting with the query (2);
 * the name containing the query (1); the city starting with the query or the state equaling it (0.5). Null when
 * nothing matches. The query is normalized the same way alias keys are, so "U of A", "u-of-a", and "uofa" are one
 * query; a query with spaces is also tried as a name/word prefix, so "Georgia Tech" still matches the name's words.
 * `precomputed` (from `queryForms(query)`) skips re-normalizing the query for each school of a scan.
 */
export function scoreSchool(
  school: ScorableSchool,
  query: string,
  aliases: readonly AliasLookupRow[] = [],
  precomputed?: QueryForms,
): SchoolMatch | null {
  const { q, qKey } = precomputed ?? queryForms(query);
  if (!q) return null;
  const name = school.name.toLowerCase();
  const city = school.location.city.toLowerCase();
  const state = school.location.state.toLowerCase();

  let aliasExact: SchoolMatch | null = null;
  let aliasPrefix: SchoolMatch | null = null;
  if (qKey) {
    for (const a of aliases) {
      if (a.key === qKey) {
        if (!aliasExact || 5 + a.weight > aliasExact.score) aliasExact = { score: 5 + a.weight, matched: a.alias };
      } else if (qKey.length >= 2 && a.key.startsWith(qKey)) {
        const score = 2.5 + a.weight / 10;
        if (!aliasPrefix || score > aliasPrefix.score) aliasPrefix = { score, matched: a.alias };
      }
    }
  }

  return best([
    aliasExact,
    name.startsWith(q) ? { score: 3 } : null,
    aliasPrefix,
    name.includes(` ${q}`) || name.includes(`-${q}`) ? { score: 2 } : null,
    name.includes(q) ? { score: 1 } : null,
    city.startsWith(q) || state === q ? { score: 0.5 } : null,
  ]);
}

/** Ties (equal score) break by applicants, most first — ASU: Arizona State before Appalachian/Alabama/Angelo/Arkansas. */
export function compareMatches(a: { match: SchoolMatch; school: ScorableSchool }, b: { match: SchoolMatch; school: ScorableSchool }): number {
  return b.match.score - a.match.score || (b.school.admissions.applicants ?? 0) - (a.school.admissions.applicants ?? 0);
}

/* ------------------------------------------------------------------ */
/* 6. File invariant (the fixture-based check `npm test` runs)         */
/* ------------------------------------------------------------------ */

/** Problems with a built alias table: a duplicate (unit_id, key), or a row naming a college not in `schoolIds`. */
export function aliasTableProblems(rows: readonly AliasRow[], schoolIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const k = `${row.unit_id}\u0000${row.key}`;
    if (seen.has(k)) problems.push(`duplicate row for unit_id ${row.unit_id}, key "${row.key}"`);
    seen.add(k);
    if (!schoolIds.has(row.unit_id)) problems.push(`unit_id ${row.unit_id} (alias "${row.alias}") is not in data/schools.json`);
  }
  return problems;
}
