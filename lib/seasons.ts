/**
 * The three discovery seasons for a college's fall figures (specs/college-reported-fall-figures.md Decisions 1, 4, 6):
 * when to look for a notice, which colleges to look for, how a link or page names the term, and which old dated
 * class-profile URLs are really notices. Pure: no I/O. Used by the pipeline (scripts/lib/college-reported/*) and the
 * workflow's schedule.
 */
import type { School } from "./types";
import type { RecipeSource, SeasonKey } from "./reported.ts";
import { fallYear } from "./reported.ts";

export type { SeasonKey } from "./reported.ts";

export interface Season {
  key: SeasonKey;
  /** The entering term the season looks for: "Fall <this year>". */
  term: string;
  cadence: "weekly" | "biweekly";
}

/** Each season's first and last day (inclusive, "MM-DD") and cadence, as Decision 4 sets them. */
export const SEASON_WINDOWS: readonly { key: SeasonKey; from: string; to: string; cadence: Season["cadence"] }[] = [
  { key: "admits", from: "03-15", to: "05-15", cadence: "weekly" },
  { key: "systems", from: "06-01", to: "07-31", cadence: "biweekly" },
  { key: "census", from: "08-15", to: "11-15", cadence: "weekly" },
];

/** The season `today` (ISO) falls in, or null: admits Mar 15–May 15, systems Jun 1–Jul 31, census Aug 15–Nov 15; term = "Fall <this year>". */
export function seasonOn(today: string): Season | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!m) return null;
  const md = `${m[2]}-${m[3]}`;
  const w = SEASON_WINDOWS.find((s) => md >= s.from && md <= s.to);
  return w ? { key: w.key, term: `Fall ${m[1]}`, cadence: w.cadence } : null;
}

/** Quad's four selectivity tiers that get season passes (owner decision 1, 2026-11-11). */
const IN_SCOPE_TIERS = new Set(["elite", "highly_selective", "very_selective", "selective"]);

/**
 * The four site tiers in scope (owner decision 1); when `selectivity` is null, the pilot tiers "very selective" and
 * "selective" (an admit rate under 50%, as scripts/lib/college-reported/pilot.mts tierOf names them).
 */
export function inSeasonScope(school: Pick<School, "selectivity" | "admissions">): boolean {
  const tier = school.selectivity?.tier;
  if (tier) return IN_SCOPE_TIERS.has(tier);
  const rate = school.admissions?.acceptance_rate;
  return rate !== null && rate !== undefined && rate < 0.5;
}

/**
 * Link text/URL patterns that mark a notice for a term, and the term tokens ("2026", "class of 2030", "class-of-2030").
 * Tokens are lower case, most specific first; match them case-insensitively (a notice's text is windowed around the
 * first one found). `text` matches a link whose text or URL names the term or uses one of the notice phrases
 * (Decision 5: record applications, first-year class, welcomes, enrolls, admits, offers of admission); a phrase match
 * alone doesn't say which year, so callers keep only links that also name the term or sit on a page for it.
 */
export function noticePatterns(term: string): { tokens: string[]; text: RegExp } {
  const year = fallYear(term);
  if (year === null) throw new Error(`noticePatterns: "${term}" isn't "Fall YYYY"`);
  const cls = year + 4;
  const tokens = [`fall ${year}`, `class of ${cls}`, `class-of-${cls}`, `classof${cls}`, `class-${cls}`, `${year}`];
  const termPart = `fall[\\s_-]+${year}|class[\\s_-]*of[\\s_-]*${cls}|class[\\s_-]+${cls}|(?<!\\d)${year}(?!\\d)`;
  const phrases = [
    "record[\\s\\S]{0,40}applica",
    "most applications",
    "first[\\s_-]+year[\\s_-]+(?:class|students)",
    "freshman[\\s_-]+class",
    "incoming[\\s_-]+class",
    "new[\\s_-]+class",
    "welcom",
    "enrolls",
    "admits",
    "offers?[\\s_-]+of[\\s_-]+admission",
    "class[\\s_-]+profile",
  ].join("|");
  return { tokens, text: new RegExp(`${termPart}|${phrases}`, "i") };
}

/** The entering fall a URL names, from "class-of-2029" / "class-2029" / "classof2029" / "Class%20of%202029" (minus 4) or a year 2015–2099. */
function urlFall(url: string): number | null {
  const cls = /class(?:[_-]|%20)?(?:of(?:[_-]|%20)?)?(20\d{2})(?!\d)/i.exec(url);
  if (cls) return Number(cls[1]) - 4;
  const years = [...url.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((m) => Number(m[1])).filter((y) => y >= 2015 && y <= 2099);
  return years.length ? Math.max(...years) : null;
}

/** "…/2025/09/18/…" → "2025-09-18"; null when the URL carries no full date. */
function urlDate(url: string): string | null {
  const m = /(?<!\d)(20\d{2})\/(\d{2})\/(\d{2})(?!\d)/.exec(url);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Reclassify a class-profile source whose URL names a year or class ≤ last year's as a notice of that term
 * (Decision 1): a dated article (UT Austin's 2025 release) or a class-of-2029 PDF was right when found and will never be
 * right again, so it becomes a dated notice (`found_by: "reclassified"`) and the season passes look for this year's.
 * The term is the extraction's own entering term when it has one, else the URL's (a class year minus four). An
 * evergreen URL (no year) and a URL naming this fall or later are left alone. Returns the same array when nothing changed.
 */
export function reclassifyDated(sources: RecipeSource[], today: string): { sources: RecipeSource[]; changed: number } {
  const lastFall = Number(today.slice(0, 4)) - 1;
  let changed = 0;
  const out = sources.map((s) => {
    if (s.kind !== "class-profile") return s;
    const fall = urlFall(s.url);
    if (fall === null || fall > lastFall) return s;
    const own = fallYear(s.extraction?.entering_term);
    const published = s.published ?? urlDate(s.url);
    changed++;
    return { ...s, kind: "notice" as const, term: `Fall ${own ?? fall}`, ...(published ? { published } : {}), found_by: "reclassified" as const };
  });
  return { sources: changed ? out : sources, changed };
}
