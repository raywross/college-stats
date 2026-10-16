/**
 * The recommenders guide's own pure helpers (specs/planner/v3/guides/recommenders.md): ranking by arrows, status
 * transitions with their dates, the subject picks drawn from the student's course list, the folded "What your
 * colleges ask for" line, and when "Thank them" shows. `RecommenderEntry`/`RecommendersGuide`'s container does the
 * saving (lib/student-profile-store.ts saveRecommenders); this module never touches the network.
 *
 * `recommendations_count` is the student's own per-college count (lib/planner/store-apply.ts "not in any public
 * dataset"), not a college dataset field, so `collegesAskLine` has nothing to cite to `lib/fields.ts`; its `cites`
 * lists the colleges the line draws from instead, so a test can check the line never names one it didn't read.
 *
 * Pure (no React, no server imports); safe in client components and tests.
 */
import { catalogCourse } from "../chances/catalog.ts";
import type { CourseEntry } from "../chances/types.ts";
import { CORE_SUBJECT_KEYS, type RecommenderEntry, type RecommenderStatus } from "../student-profile.ts";
import { seasonRank, type Season } from "./seasons.ts";
import type { PlanItem, PlanSchool } from "./types.ts";

/** Rank order (ties by rank), the way the row list and `moveRank` read and reorder them. */
export function orderRecommenders(entries: readonly RecommenderEntry[]): RecommenderEntry[] {
  return [...entries].sort((a, b) => a.rank - b.rank);
}

/** The rank a newly added recommender gets: one past the highest rank already in use (1 when the list is empty). */
export function nextRank(entries: readonly RecommenderEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, e.rank), 0) + 1;
}

/**
 * Moves one entry up (`dir: -1`) or down (`dir: 1`) in rank order, swapping it with its neighbor; renumbers every
 * entry 1..n afterward so ranks stay dense. A move off either end, or an unknown id, leaves the order unchanged.
 */
export function moveRank(entries: readonly RecommenderEntry[], id: string, dir: -1 | 1): RecommenderEntry[] {
  const ordered = orderRecommenders(entries);
  const i = ordered.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return ordered;
  const next = [...ordered];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((e, idx) => ({ ...e, rank: idx + 1 }));
}

const STATUS_RANK: Record<RecommenderStatus, number> = { thinking: 0, asked: 1, agreed: 2, invited: 3 };

/**
 * Sets a recommender's status, dating the new status's own field the first time it's reached (never overwriting a
 * date already on file). A status never moves backward: the only way back to an earlier one is the explicit reset to
 * "thinking", which clears every date; any other backward request is left unchanged (build-plan.md "Rules for every
 * unit agent" — statuses are a one-way ladder except that reset).
 */
export function setStatus(entry: RecommenderEntry, status: RecommenderStatus, today: string): RecommenderEntry {
  if (status === "thinking") return { ...entry, status: "thinking", askedOn: null, agreedOn: null, invitedOn: null };
  if (STATUS_RANK[status] < STATUS_RANK[entry.status]) return entry;
  const next: RecommenderEntry = { ...entry, status };
  if (status === "asked" && !next.askedOn) next.askedOn = today;
  if (status === "agreed" && !next.agreedOn) next.agreedOn = today;
  if (status === "invited" && !next.invitedOn) next.invitedOn = today;
  return next;
}

/** "AP Chemistry", "English 11 (H)", or the student's typed name — the course's display name, as the courses guide reads it. */
function courseDisplayName(c: Pick<CourseEntry, "key" | "name">): string {
  if (c.key) {
    const entry = catalogCourse(c.key);
    if (entry) return entry.name;
  }
  return c.name?.trim() ?? "";
}

/**
 * Subject picks for the "add a teacher" box: unique course display names, core subjects (English, math, science,
 * history, language) first, in the course list's own order, then the rest. A name without a readable form (an
 * unnamed placeholder row) is skipped.
 */
export function subjectsFrom(courses: readonly CourseEntry[]): string[] {
  const isCore = (c: CourseEntry) => (CORE_SUBJECT_KEYS as readonly string[]).includes(c.subject);
  const ordered = [...courses.filter(isCore), ...courses.filter((c) => !isCore(c))];
  const names: string[] = [];
  for (const c of ordered) {
    const name = courseDisplayName(c);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export interface CollegesAskLine {
  text: string;
  /** The colleges (unit ids) the line names, so a test can check it never names one it didn't read. */
  cites: string[];
}

/**
 * The folded "What your colleges ask for" line ("Wake Forest asks for 2, Davidson for 1"): every open (not
 * withdrawn) item with a recommendation count on file, named in list order. Null without one.
 */
export function collegesAskLine(
  items: readonly Pick<PlanItem, "unit_id" | "recommendations_count" | "withdrawn_on">[],
  schools: Record<string, Pick<PlanSchool, "name">>,
): CollegesAskLine | null {
  const rows = items
    .filter((i) => !i.withdrawn_on && typeof i.recommendations_count === "number" && i.recommendations_count > 0)
    .map((i) => ({ unitId: i.unit_id, name: schools[i.unit_id]?.name ?? null, count: i.recommendations_count as number }))
    .filter((r): r is { unitId: string; name: string; count: number } => r.name !== null);
  if (rows.length === 0) return null;
  return {
    text: rows.map((r) => `${r.name} asks for ${r.count}`).join(", "),
    cites: rows.map((r) => r.unitId),
  };
}

/**
 * Whether "Thank them" shows (guides/recommenders.md "November on"): senior winter on, or senior fall from November 1
 * (the cycle's `thank_recommenders` window opens November 15, but the section itself reads as open a little ahead of
 * the cycle task so a family isn't caught flat by the exact date).
 */
export function thankSeason(season: Season, today: string): boolean {
  if (seasonRank(season) >= seasonRank("senior_winter") && seasonRank(season) <= seasonRank("graduated")) return true;
  if (season !== "senior_fall") return false;
  const month = Number(today.slice(5, 7));
  return Number.isFinite(month) && month >= 11;
}

const YEAR_NAME: Record<9 | 10 | 11 | 12, string> = { 9: "freshman year", 10: "sophomore year", 11: "junior year", 12: "senior year" };
const YEAR_ORDINAL: Record<9 | 10 | 11 | 12, string> = { 9: "9th", 10: "10th", 11: "11th", 12: "12th" };

/** "junior year" for one year, "10th–11th" for more than one; "" for none. */
export function yearsLabel(years: readonly (9 | 10 | 11 | 12)[]): string {
  if (years.length === 0) return "";
  const sorted = [...years].sort((a, b) => a - b);
  return sorted.length === 1 ? YEAR_NAME[sorted[0]] : sorted.map((y) => YEAR_ORDINAL[y]).join("–");
}

/** "What to think about" (guides/recommenders.md "The page"), the advisor consensus, cited once on the page. */
export const THINK_ABOUT: readonly string[] = [
  "A teacher who saw you work, not only the one who gave the highest grade.",
  "Junior-year, core subject (English, math, science, history, language) for most colleges; some engineering and science programs ask for a math or science teacher.",
  "Two teachers from different subjects shows range. A third, optional, from an elective or an activity.",
  "Your counselor writes a separate letter; the brag sheet feeds it.",
];

/** "How to ask", one sentence per line. */
export const HOW_TO_ASK: readonly string[] = [
  "In person, before the end of junior year.",
  "Say which colleges and why them.",
  "Offer your story and a short list of what you did in their class.",
  "Give the Common App invitation in August and at least four weeks before the first deadline.",
  "Thank them after decisions come.",
];
