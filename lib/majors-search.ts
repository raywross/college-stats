/**
 * The major picker's search (specs/planner/record/majors.md): type a word, see the matching major families by name and
 * by the words students actually use ("pre-med", "nursing", "CS", "finance"), with eight common families offered as
 * chips before anything is typed. Families and their names come from lib/majors.ts `MAJOR_FAMILIES`, so the picker,
 * the Explore filter, and the estimate's notes agree. Mirrors the AP picker's `searchAp` (lib/planner/intake.ts).
 * Pure and client-safe.
 */
import { MAJOR_FAMILIES, MAJOR_FAMILY_CODES, type MajorFamily } from "./majors.ts";

/**
 * The words students type for a family, lower-case, each to one or more families (majors.md "Typing"). The family
 * names' own words match without an entry here. A test checks every family is real.
 */
export const MAJOR_ALIASES: Readonly<Record<string, readonly MajorFamily[]>> = {
  "pre-med": ["26", "51"],
  premed: ["26", "51"],
  medicine: ["26", "51"],
  "pre-vet": ["26", "01"],
  veterinary: ["26", "01"],
  nursing: ["51"],
  nurse: ["51"],
  pharmacy: ["51"],
  dentistry: ["51"],
  "public health": ["51"],
  "physical therapy": ["51", "31"],
  cs: ["11"],
  coding: ["11"],
  programming: ["11"],
  software: ["11"],
  cybersecurity: ["11"],
  "game design": ["11", "50"],
  finance: ["52"],
  accounting: ["52"],
  marketing: ["52"],
  management: ["52"],
  entrepreneurship: ["52"],
  "pre-law": ["22", "45"],
  physics: ["40"],
  chemistry: ["40"],
  astronomy: ["40"],
  geology: ["40"],
  biochemistry: ["26", "40"],
  neuroscience: ["26", "42"],
  psych: ["42"],
  art: ["50"],
  music: ["50"],
  theater: ["50"],
  theatre: ["50"],
  film: ["50"],
  dance: ["50"],
  design: ["50"],
  econ: ["45"],
  economics: ["45"],
  "political science": ["45"],
  "poli sci": ["45"],
  politics: ["45"],
  government: ["45"],
  "international relations": ["45"],
  sociology: ["45"],
  anthropology: ["45"],
  geography: ["45"],
  kinesiology: ["31"],
  "sports medicine": ["31"],
  "exercise science": ["31"],
  architecture: ["04"],
  "data science": ["27"],
  statistics: ["27"],
  mathematics: ["27"],
  environmental: ["03"],
  forestry: ["03"],
  journalism: ["09"],
  media: ["09"],
  "public relations": ["09"],
  teaching: ["13"],
  "criminal justice": ["43"],
  "forensic science": ["43"],
  nutrition: ["19"],
  languages: ["16"],
  spanish: ["16"],
  french: ["16"],
  "social work": ["44"],
  "public policy": ["44"],
  religion: ["38"],
  "mechanical engineering": ["14"],
  "electrical engineering": ["14"],
  "civil engineering": ["14"],
  aerospace: ["14"],
};

/** The eight families most students pick, offered as chips before anything is typed, in this order (majors.md "Common picks"). */
export const POPULAR_MAJORS: readonly MajorFamily[] = ["52", "14", "26", "11", "42", "51", "50", "45"];

export interface MajorMatch {
  family: MajorFamily;
  /** The family's name (`MAJOR_FAMILIES`). */
  name: string;
  /** The alias that matched, shown muted beside the name ("Health professions · nursing"); null for a name match. */
  via: string | null;
}

/** Lowercase, anything but letters and digits read as a space ("Pre-Med" → "pre med"). */
function normalize(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Whether every word of the query starts some word of the text ("comp sci" in "computer science"). */
function wordsStart(text: string, q: string): boolean {
  const words = text.split(" ");
  return q.split(" ").every((p) => words.some((w) => w.startsWith(p)));
}

const ALIAS_INDEX: readonly { alias: string; norm: string; families: readonly MajorFamily[] }[] = Object.entries(MAJOR_ALIASES).map(([alias, families]) => ({
  alias,
  norm: normalize(alias),
  families,
}));

/** Name-prefix 0, alias 1 (one that starts with the query) or 1.5 (one that contains it), name-contains 2. */
type Rank = 0 | 1 | 1.5 | 2;

function popularity(f: MajorFamily): number {
  const i = POPULAR_MAJORS.indexOf(f);
  return i === -1 ? POPULAR_MAJORS.length : i;
}

/**
 * The picker's results. With no query, the common families (`POPULAR_MAJORS`) not yet picked. With one, every family
 * whose name or an alias starts with or contains the query's words: name-prefix matches first ("bus" → Business), then
 * alias matches ("nursing" → Health professions, `via` "nursing"), then names that contain it ("science" → Computer
 * science); within each, the common families first, then A–Z. Families in `exclude` (already picked) never appear;
 * at most `limit`.
 */
/**
 * Moves a picked major up (`dir: -1`) or down (`dir: 1`) in the picked list (R2, MajorChips' arrows): swaps it with
 * its neighbor; a move off either end, or an out-of-range index, leaves the order unchanged.
 */
export function moveMajor(majors: readonly MajorFamily[], index: number, dir: -1 | 1): MajorFamily[] {
  const j = index + dir;
  if (index < 0 || index >= majors.length || j < 0 || j >= majors.length) return [...majors];
  const next = [...majors];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

export function searchMajors(query: string, exclude: readonly MajorFamily[], limit = 6): MajorMatch[] {
  const skip = new Set<string>(exclude);
  const q = normalize(query);
  if (!q) {
    return POPULAR_MAJORS.filter((f) => !skip.has(f))
      .slice(0, limit)
      .map((family) => ({ family, name: MAJOR_FAMILIES[family], via: null }));
  }
  const best = new Map<MajorFamily, { rank: Rank; via: string | null }>();
  const offer = (family: MajorFamily, rank: Rank, via: string | null) => {
    if (skip.has(family)) return;
    const had = best.get(family);
    if (!had || rank < had.rank) best.set(family, { rank, via });
  };
  for (const family of MAJOR_FAMILY_CODES) {
    const name = normalize(MAJOR_FAMILIES[family]);
    if (name.startsWith(q)) offer(family, 0, null);
    // "cs" must not match "economics" or "physics" (QA 2026-10-16): a bare substring counts only for a longer query.
    else if (wordsStart(name, q) || (q.length >= 4 && name.includes(q))) offer(family, 2, null);
  }
  for (const a of ALIAS_INDEX) {
    const rank: Rank | null = a.norm.startsWith(q) ? 1 : wordsStart(a.norm, q) ? 1.5 : null;
    if (rank !== null) for (const family of a.families) offer(family, rank, a.alias);
  }
  return [...best.entries()]
    .sort(([fa, a], [fb, b]) => a.rank - b.rank || popularity(fa) - popularity(fb) || MAJOR_FAMILIES[fa].localeCompare(MAJOR_FAMILIES[fb]))
    .slice(0, limit)
    .map(([family, m]) => ({ family, name: MAJOR_FAMILIES[family], via: m.via }));
}
