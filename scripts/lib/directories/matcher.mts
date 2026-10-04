/**
 * Matches a directory's free-text campus ("University of Texas, Austin", "Penn State Altoona") to IPEDS unit ids
 * (specs/campus-directories.md#matching). Pure: build an index once with `buildIndex(colleges, aliases)`, then
 * `matchEntry` each entry.
 *
 * Rules, strongest first. A match below MATCH_THRESHOLD is never taken: the entry goes to
 * data/directories/unmatched/<org>.json for review, with the closest candidates.
 *   hand-checked (data/directories/matches.json)  1.00
 *   exact name after normalization                 1.00 (0.95 without a state)
 *   the college's own web domain in the entry's url 0.95
 *   IPEDS alias (HD IALIAS) or known abbreviation  0.95 (0.90 without a state)
 *   name + city: one candidate in the listed city  0.90
 *   flagship of a system ("University of Washington" → Seattle)  0.90
 *   name is the start of exactly one college's name ("Miami University" → "Miami University-Oxford")  0.85
 *   close spelling, same state, clear winner       ≤ 0.95 × similarity
 * The state, when given, must agree. Two candidates at the same strength are ambiguous, never a coin toss.
 */
import { stateByPostal, STATES } from "../../../lib/states.ts";

export const MATCH_THRESHOLD = 0.85;

export interface College {
  unit_id: string;
  name: string;
  city: string;
  state: string;
  website?: string | null;
}

export type MatchMethod = "reviewed" | "exact" | "url" | "alias" | "city" | "flagship" | "prefix" | "fuzzy";

export interface Match {
  unit_id: string;
  name: string;
  confidence: number;
  method: MatchMethod;
}

export type MatchResult =
  | { status: "matched"; matches: Match[]; multi: boolean }
  | { status: "unmatched"; reason: string; candidates: { unit_id: string; name: string; score: number }[] };

export interface MatchInput {
  campus: string;
  campuses?: string[];
  city?: string;
  state?: string;
  url?: string;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

const DROP = new Set(["the", "at", "in", "campus", "inc"]);
const WORD = new Map([
  ["saint", "st"],
  ["ste", "st"],
  ["mount", "mt"],
  ["univ", "university"],
  ["coll", "college"],
  ["inst", "institute"],
]);
/** Phrases rewritten before comparison (joined, space-separated, after word rules). */
const PHRASES: [RegExp, string][] = [
  [/\bstate university of new york\b|\bstate university new york\b/g, "suny"],
  [/\bcity university of new york\b/g, "cuny"],
  [/\bpenn state university\b|\bpenn state\b/g, "pennsylvania state university"],
  [/\bmain(?: campus)?$/g, ""],
];
/** Whole leading abbreviations, expanded (IALIAS covers many more, per college). */
const ABBREVIATIONS: [string, string][] = [
  ["ut", "university of texas"],
  ["uc", "university of california"],
  ["ucla", "university of california los angeles"],
  ["ucsd", "university of california san diego"],
  ["ucsb", "university of california santa barbara"],
  ["uci", "university of california irvine"],
  ["ucsc", "university of california santa cruz"],
  ["ucr", "university of california riverside"],
  ["usc", "university of southern california"],
  ["unc", "university of north carolina"],
  ["umass", "university of massachusetts"],
  ["uconn", "university of connecticut"],
  ["lsu", "louisiana state university"],
  ["byu", "brigham young university"],
  ["mit", "massachusetts institute of technology"],
  ["nyu", "new york university"],
  ["ole miss", "university of mississippi"],
  ["cal state", "california state university"],
  ["cal poly", "california polytechnic state university"],
  ["virginia tech", "virginia polytechnic institute and state university"],
  ["georgia tech", "georgia institute of technology"],
];
const SYSTEM = new Set(["suny", "cuny"]);

/** Collapses an immediately repeated leading phrase ("pennsylvania state university pennsylvania state university altoona"). */
function dedupeLead(t: string[]): string[] {
  for (let k = Math.floor(t.length / 2); k >= 2; k--) {
    if (t.slice(0, k).join(" ") === t.slice(k, 2 * k).join(" ")) return [...t.slice(0, k), ...t.slice(2 * k)];
  }
  return t;
}

/** Tokens of a normalized college name. */
export function normTokens(raw: string): string[] {
  let s = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  s = s
    .split(" ")
    .map((w) => WORD.get(w) ?? w)
    .join(" ");
  for (const [abbr, full] of ABBREVIATIONS) if (s === abbr || s.startsWith(`${abbr} `)) s = full + s.slice(abbr.length);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const tokens = s.split(" ").filter((w) => w && !DROP.has(w));
  return dedupeLead(tokens);
}

export const normKey = (raw: string) => normTokens(raw).join(" ");
const core = (t: readonly string[]) => t.filter((w) => !SYSTEM.has(w));
const startsWith = (a: readonly string[], b: readonly string[]) => b.length <= a.length && b.every((w, i) => a[i] === w);

const STATE_NAME_KEYS = new Map([...STATES.values()].map((s) => [normKey(s.name), s.postal]));

/** "TX", "Texas", "texas" → "TX"; anything else → null. */
export function postalOf(state: string | undefined | null): string | null {
  if (!state) return null;
  const s = state.trim();
  if (/^[A-Za-z]{2}$/.test(s) && stateByPostal(s.toUpperCase())) return s.toUpperCase();
  return STATE_NAME_KEYS.get(normKey(s)) ?? null;
}

/** "Miami University (Ohio)" → { name: "Miami University", state: "OH" }; also a trailing ", Ohio" or ", OH". */
export function splitState(campus: string): { name: string; state: string | null } {
  const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(campus);
  if (paren && postalOf(paren[2])) return { name: paren[1], state: postalOf(paren[2]) };
  const comma = /^(.*),\s*([^,]+)$/.exec(campus);
  if (comma && postalOf(comma[2])) return { name: comma[1], state: postalOf(comma[2]) };
  return { name: campus, state: null };
}

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

/**
 * Systems whose plain name means one campus, by IPEDS name (tests check each names exactly one college). Used only
 * when the plain name starts several colleges' names and no city picks one.
 */
export const FLAGSHIPS: Record<string, string> = {
  "university of washington": "University of Washington-Seattle Campus",
  "miami university": "Miami University-Oxford",
  "university of minnesota": "University of Minnesota-Twin Cities",
  "university of michigan": "University of Michigan-Ann Arbor",
  "university of missouri": "University of Missouri-Columbia",
  "university of south carolina": "University of South Carolina-Columbia",
  "university of colorado": "University of Colorado Boulder",
  "university of maryland": "University of Maryland-College Park",
  "university of massachusetts": "University of Massachusetts-Amherst",
  "university of nebraska": "University of Nebraska-Lincoln",
  "ohio state university": "Ohio State University-Main Campus",
  "rutgers university": "Rutgers University-New Brunswick",
  "purdue university": "Purdue University-Main Campus",
  "university of hawaii": "University of Hawaii at Manoa",
  "indiana university": "Indiana University-Bloomington",
  "university of illinois": "University of Illinois Urbana-Champaign",
  "university of houston": "University of Houston",
  "university of maine": "University of Maine",
  "texas a and m university": "Texas A&M University-College Station",
  "university of pittsburgh": "University of Pittsburgh-Pittsburgh Campus",
  "colorado state university": "Colorado State University-Fort Collins",
  "university of tennessee": "The University of Tennessee-Knoxville",
  "texas tech": "Texas Tech University",
  "louisiana state university": "Louisiana State University and Agricultural & Mechanical College",
};

/** Named groups of colleges a single chapter often serves. */
export const CONSORTIA: Record<string, { state: string; names: string[] }> = {
  "claremont colleges": {
    state: "CA",
    names: ["Pomona College", "Claremont McKenna College", "Harvey Mudd College", "Scripps College", "Pitzer College"],
  },
  "tri college": { state: "PA", names: ["Bryn Mawr College", "Haverford College", "Swarthmore College"] },
  "atlanta university center": { state: "GA", names: ["Clark Atlanta University", "Morehouse College", "Spelman College"] },
};

interface Indexed extends College {
  tokens: string[];
  key: string;
  aliasKeys: string[];
  cityKey: string;
  host: string | null;
}

export interface MatchIndex {
  colleges: Indexed[];
  byKey: Map<string, Indexed[]>;
  byAlias: Map<string, Indexed[]>;
  byId: Map<string, Indexed>;
  /** Hand-checked answers: "campus|ST" → unit ids ([] = reviewed, not a college on the site). */
  reviewed: Map<string, string[]>;
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).host.toLowerCase().replace(/^www\d?\./, "");
  } catch {
    return null;
  }
};

/** IALIAS cells: "UW-Seattle, UDub, UW, Washington", "City Tech | New York City College of Technology". */
export function splitAliases(cell: string): string[] {
  return cell
    .split(/\s*[|;,]\s*|\s{2,}/)
    .map((a) => a.trim())
    .filter((a) => a.length >= 2);
}

export const reviewKey = (campus: string, state: string | null | undefined) => `${campus.trim()}|${postalOf(state) ?? ""}`;

export function buildIndex(colleges: readonly College[], aliases: ReadonlyMap<string, string[]> = new Map(), reviewed: Record<string, string[]> = {}): MatchIndex {
  const indexed: Indexed[] = colleges.map((c) => {
    const tokens = normTokens(c.name);
    return { ...c, tokens, key: tokens.join(" "), aliasKeys: [], cityKey: normKey(c.city), host: hostOf(c.website) };
  });
  const byKey = new Map<string, Indexed[]>();
  for (const c of indexed) (byKey.get(c.key) ?? byKey.set(c.key, []).get(c.key)!).push(c);
  const byAlias = new Map<string, Indexed[]>();
  for (const c of indexed) {
    for (const a of aliases.get(c.unit_id) ?? []) {
      const k = normKey(a);
      // An alias that is another college's own name, or a bare state name, says nothing about this one.
      if (!k || (byKey.has(k) && !byKey.get(k)!.includes(c)) || STATE_NAME_KEYS.has(k) || c.aliasKeys.includes(k)) continue;
      c.aliasKeys.push(k);
      (byAlias.get(k) ?? byAlias.set(k, []).get(k)!).push(c);
    }
  }
  return {
    colleges: indexed,
    byKey,
    byAlias,
    byId: new Map(indexed.map((c) => [c.unit_id, c])),
    reviewed: new Map(Object.entries(reviewed).map(([k, v]) => [k, v])),
  };
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** Token-sequence similarity (Dice over the longest common subsequence): word order matters, so "Miami University" ≠ "University of Miami". */
export function similarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (2 * dp[a.length][b.length]) / (a.length + b.length);
}

const one = (c: Indexed, confidence: number, method: MatchMethod): Match => ({ unit_id: c.unit_id, name: c.name, confidence: Math.round(confidence * 100) / 100, method });
const unmatched = (reason: string, near: Indexed[] = [], tokens: string[] = []): MatchResult => ({
  status: "unmatched",
  reason,
  candidates: near.slice(0, 3).map((c) => ({ unit_id: c.unit_id, name: c.name, score: Math.round(similarity(tokens, c.tokens) * 100) / 100 })),
});
const uniq = (xs: Indexed[]) => [...new Set(xs)];

/** One name (no lists) against the index. */
function matchName(index: MatchIndex, rawName: string, cityIn: string | undefined, stateIn: string | undefined, url: string | undefined): MatchResult {
  const split = splitState(rawName);
  const state = postalOf(stateIn) ?? split.state;
  if (stateIn && !postalOf(stateIn)) return unmatched(`unknown state "${stateIn}"`);
  const tokens = normTokens(split.name);
  const key = tokens.join(" ");
  if (!key) return unmatched("no campus name");
  const hasSystem = tokens.some((w) => SYSTEM.has(w));
  const effState = state ?? (hasSystem ? "NY" : null);
  const pool = effState ? index.colleges.filter((c) => c.state === effState) : index.colleges;
  const inPool = (c: Indexed) => !effState || c.state === effState;
  const cityKey = cityIn ? normKey(cityIn) : null;
  const noState = !effState;

  // Name-based candidates at each strength.
  const ct = core(tokens);
  const coreKey = ct.join(" ");
  // Exact, ignoring a SUNY/CUNY prefix on either side ("Hunter College" = "CUNY Hunter College").
  const exact = uniq([...(index.byKey.get(key) ?? []), ...pool.filter((c) => c.key !== key && core(c.tokens).join(" ") === coreKey)]).filter(inPool);
  const alias = (index.byAlias.get(key) ?? []).filter(inPool).filter((c) => !exact.includes(c));
  const prefix = pool.filter((c) => c.tokens.length > tokens.length && startsWith(core(c.tokens), ct) && core(c.tokens).length > ct.length && !exact.includes(c));
  // The entry adds the college's own city or state after its name: "Texas State University San Marcos", or
  // "Penn State University Park" (name and city share "university").
  const suffixed = pool.filter((c) => {
    const cc = core(c.tokens);
    if (cc.length >= ct.length || !startsWith(ct, cc) || exact.includes(c)) return false;
    const extra = ct.slice(cc.length).join(" ");
    if (extra === c.cityKey || STATE_NAME_KEYS.get(extra) === c.state) return true;
    const city = c.cityKey.split(" ");
    for (let k = Math.min(cc.length, city.length); k > 0; k--) {
      if (cc.slice(-k).join(" ") === city.slice(0, k).join(" ") && [...cc, ...city.slice(k)].join(" ") === coreKey) return true;
    }
    return false;
  });
  // SUNY/CUNY: "SUNY Binghamton" names "Binghamton University"; compare without the system and generic words.
  const generic = new Set(["university", "college", "of", "and"]);
  const bare = (t: readonly string[]) => core(t).filter((w) => !generic.has(w)).join(" ");
  const system = hasSystem ? pool.filter((c) => bare(c.tokens) === bare(tokens) && bare(tokens) !== "") : [];

  let pick: Match | null = null;
  let conflict: Indexed[] = [];
  const named = uniq([...exact, ...alias, ...suffixed, ...prefix, ...system]);

  if (cityKey && named.length > 1) {
    const inCity = named.filter((c) => c.cityKey === cityKey);
    if (inCity.length === 1) pick = one(inCity[0], exact.includes(inCity[0]) ? 1 : 0.9, exact.includes(inCity[0]) ? "exact" : "city");
  }
  if (!pick && exact.length === 1) {
    // Without a state, a same-name college elsewhere ("St. John's University-New York" for "Saint John's University") makes it ambiguous.
    const sameNameElsewhere = noState ? prefix.filter((c) => STATE_NAME_KEYS.has(core(c.tokens).slice(ct.length).join(" "))) : [];
    if (sameNameElsewhere.length) conflict = [exact[0], ...sameNameElsewhere];
    else pick = one(exact[0], noState ? 0.95 : 1, "exact");
  } else if (!pick && exact.length > 1) conflict = exact;
  if (!pick && !conflict.length) {
    if (alias.length === 1 && (!noState || key.length >= 4)) pick = one(alias[0], noState ? 0.9 : 0.95, "alias");
    else if (alias.length > 1) conflict = alias;
  }
  if (!pick && !conflict.length && system.length === 1) pick = one(system[0], 0.85, "prefix");
  if (!pick && !conflict.length && suffixed.length === 1) pick = one(suffixed[0], 0.9, "city");
  if (!pick && !conflict.length && prefix.length === 1) pick = one(prefix[0], 0.85, "prefix");
  if (!pick && !conflict.length && prefix.length > 1) {
    const flagship = FLAGSHIPS[key];
    const f = flagship ? prefix.find((c) => c.name === flagship) : undefined;
    if (f) pick = one(f, 0.9, "flagship");
    else conflict = prefix;
  }
  // Close spelling: only within a known state, with a clear winner.
  if (!pick && !conflict.length && effState) {
    const scored = pool.map((c) => ({ c, s: similarity(tokens, c.tokens) })).sort((a, b) => b.s - a.s);
    const [best, next] = scored;
    if (best && best.s * 0.95 >= MATCH_THRESHOLD && (!next || best.s - next.s >= 0.1)) pick = one(best.c, best.s * 0.95, "fuzzy");
  }

  // The college's own web domain in the entry's link: confirms a name match, or decides when names can't.
  const host = hostOf(url);
  if (host) {
    const byHost = index.colleges.filter((c) => c.host && (host === c.host || host.endsWith(`.${c.host}`)) && inPool(c));
    const longest = Math.max(0, ...byHost.map((c) => c.host!.length));
    const hostPick = byHost.filter((c) => c.host!.length === longest);
    if (hostPick.length === 1) {
      const h = hostPick[0];
      if (pick && pick.unit_id !== h.unit_id) return unmatched(`name says ${pick.name}, link says ${h.name}`, [index.byId.get(pick.unit_id)!, h], tokens);
      if (pick) pick = { ...pick, confidence: Math.max(pick.confidence, 0.95) };
      else if (!conflict.length || conflict.includes(h)) pick = one(h, 0.95, "url");
    }
  }

  if (pick && pick.confidence >= MATCH_THRESHOLD) return { status: "matched", matches: [pick], multi: false };
  if (conflict.length) return unmatched(`ambiguous: ${uniq(conflict).length} colleges fit`, uniq(conflict), tokens);
  const near = [...pool].sort((a, b) => similarity(tokens, b.tokens) - similarity(tokens, a.tokens));
  return unmatched(effState ? `no college in ${effState} matches` : "no college matches (no state given)", near, tokens);
}

/** "Boston Area (Boston University, Northeastern University)" → the named colleges; an area alone names none. */
export function campusParts(input: MatchInput): { parts: string[]; area: boolean } {
  if (input.campuses?.length) return { parts: input.campuses, area: false };
  const consortium = CONSORTIA[normKey(input.campus).replace(/^the /, "")];
  if (consortium) return { parts: consortium.names, area: false };
  const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(input.campus);
  if (paren && !postalOf(paren[2])) {
    const inner = paren[2].split(/\s*(?:;|,|\/|\band\b)\s*/).filter((s) => /[a-z]/i.test(s));
    if (inner.length >= 2) return { parts: inner, area: false };
  }
  const area = /\b(area|greater|metro|city[- ]wide|region|consortium)\b/i.test(input.campus);
  return { parts: [input.campus], area };
}

/** Matches one directory entry: one college, several (a chapter serving several colleges), or none with a reason. */
export function matchEntry(index: MatchIndex, input: MatchInput): MatchResult {
  const reviewed = index.reviewed.get(reviewKey(input.campus, input.state));
  if (reviewed) {
    if (!reviewed.length) return { status: "unmatched", reason: "reviewed: not a college on the site", candidates: [] };
    const matches = reviewed.map((id) => {
      const c = index.byId.get(id);
      if (!c) throw new Error(`data/directories/matches.json: ${reviewKey(input.campus, input.state)} names unknown unit id ${id}`);
      return one(c, 1, "reviewed");
    });
    return { status: "matched", matches, multi: matches.length > 1 };
  }
  const { parts, area } = campusParts(input);
  if (area && parts.length === 1) return unmatched("an area chapter that names no college (add it to data/directories/matches.json after review)");
  const consortiumState = CONSORTIA[normKey(input.campus).replace(/^the /, "")]?.state;
  if (parts.length === 1) return matchName(index, parts[0], input.city, input.state, input.url);
  const results = parts.map((p) => matchName(index, p, undefined, input.state ?? consortiumState, undefined));
  const failed = results.filter((r) => r.status === "unmatched");
  // Every named college must match; a partly readable list goes to review whole rather than half-published.
  if (failed.length) return unmatched(`${failed.length} of ${parts.length} named colleges didn't match (${failed.map((f) => f.status === "unmatched" && f.reason).join("; ")})`);
  const matches = results.flatMap((r) => (r.status === "matched" ? r.matches : []));
  return { status: "matched", matches: [...new Map(matches.map((m) => [m.unit_id, m])).values()], multi: true };
}
