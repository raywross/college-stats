/**
 * The essays move (specs/product/essays/moves.md): one list-wide move, kind `essays`, key `{list}:essays:next`,
 * always pointed at the next college with essays left. Its title, why, date, and button come from `essayProgress`
 * (lib/essays/progress.ts), the same reading the Essays tab shows.
 *
 * - Season: emitted from `summer_before_senior` through `senior_winter`, stamped with the **current** season on each
 *   regeneration (never carried, so never the −10). Before summer it isn't generated (a junior never sees it); the
 *   application gate in `eligibleNow` covers it too (importance.ts: `essays` opens with the summer).
 * - States (moves.md "What it says, by state"): nothing started, the personal essay in progress, a college's essays,
 *   only colleges not on file, everything ready. See `essaysMove`.
 * - The button: `open_tab essays`, with the named college's anchor; "Write it" with work left, "See them" when all
 *   is ready (`essaysButton`).
 *
 * Never a word of essay text: counts and college names only. Pure; no I/O.
 */
import { allReady, collegeTotal, essayProgress, firstNotOnFile, roundWord, type CollegeEssayProgress, type EssayProgress } from "../../essays/progress.ts";
import { seasonRank, type Season } from "../seasons.ts";
import { taskKey } from "../tasks.ts";
import type { GeneratedTask, GeneratorInput, MoveAction } from "../types.ts";
import { shortDay } from "./college.ts";

/** The seasons the move is generated in (moves.md "When it shows"). */
export const ESSAYS_SEASONS: readonly Season[] = ["summer_before_senior", "senior_fall", "senior_winter"];
export const isEssaysSeason = (s: Season): boolean => ESSAYS_SEASONS.includes(s);

export type EssaysMoveState = "nothing" | "personal" | "college" | "check" | "ready";

/** The card's button words (the brief's "Words on screen"). */
export const ESSAYS_BUTTON = { work: "Write it", ready: "See them" } as const;

/** "Write it" with work left, "See them" when everything is ready. */
export function essaysButton(p: EssayProgress): string {
  return allReady(p) ? ESSAYS_BUTTON.ready : ESSAYS_BUTTON.work;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const possessive = (name: string) => `${name}'s`;

/** Which row of moves.md's table the plan is in, and the college it names (if any). */
export function essaysMoveState(p: EssayProgress, season: Season): { state: EssaysMoveState; college: CollegeEssayProgress | null } {
  if (allReady(p)) return { state: "ready", college: null };
  const mainOpen = p.main !== null && p.main.state !== "ready";
  // The summer is the personal essay's (moves.md: "the summer for the personal essay"); so is any season with no
  // college prompts on file or added yet.
  if (mainOpen && (season === "summer_before_senior" || collegeTotal(p) === 0)) {
    return { state: p.main!.state === "not_started" ? "nothing" : "personal", college: null };
  }
  if (p.next) return { state: "college", college: p.next };
  const unknown = firstNotOnFile(p);
  if (unknown) return { state: "check", college: unknown };
  return { state: "nothing", college: null };
}

export interface EssaysMoveText {
  state: EssaysMoveState;
  title: string;
  why: string;
  due_on: string | null;
  college: string | null;
}

/** The move's words and date for a reading (moves.md "What it says, by state"). */
export function essaysMove(p: EssayProgress, season: Season): EssaysMoveText {
  const { state, college } = essaysMoveState(p, season);
  const summer = season === "summer_before_senior";
  switch (state) {
    case "ready":
      return { state, title: "Your essays are ready", why: `All ${p.total} ready. Paste each college's package into its form when you apply.`, due_on: null, college: null };
    case "personal": {
      const m = p.main!;
      return { state, title: "Finish your personal essay", why: `${m.count} of ${m.limit} words, draft. Start from your story.`, due_on: null, college: null };
    }
    case "nothing":
      return {
        state,
        title: "Write your essays",
        why: summer
          ? "The personal essay is the summer's work: 650 words, and 4 to 8 drafts is normal. Your colleges' own prompts arrive by August."
          : p.main
            ? "Start with the personal essay: 650 words, and 4 to 8 drafts is normal. Add what each college asks as you meet it."
            : "Add what each college asks on the Essays tab as you meet it, and write each one here.",
        due_on: null,
        college: null,
      };
    case "check": {
      const c = college!;
      return {
        state,
        title: `Check what ${c.name} asks you to write`,
        why: `We haven't read ${possessive(c.name)} essay page yet. Add what it asks for and write it here.`,
        due_on: c.deadline,
        college: c.unit_id,
      };
    }
    case "college": {
      const c = college!;
      const mainOpen = p.main !== null && p.main.state !== "ready";
      const toGo = c.total - c.ready;
      const round = roundWord(c.round);
      const forWhat = round ? ` for the ${round} deadline` : "";
      const when = c.deadline ? ` (${shortDay(c.deadline)})` : "";
      const parts: string[] = [];
      if (toGo > 0) {
        const including = mainOpen && c.takesCommonApp ? `, including your personal essay (${p.main!.count} of ${p.main!.limit})` : "";
        parts.push(`${toGo} of ${c.total} to go${forWhat}${when}${including}.`);
      } else {
        parts.push(`Your personal essay is left${forWhat}${when}: ${p.main!.count} of ${p.main!.limit} words.`);
      }
      const after = p.colleges.find((x) => x.unit_id !== c.unit_id && x.ready < x.total);
      if (after) parts.push(`Then ${after.name}${after.deadline ? `, ${shortDay(after.deadline)}` : ""}.`);
      const withWork = p.colleges.filter((x) => x.ready < x.total).length;
      parts.push(withWork > 1 ? `${plural(p.remaining, "essay")} left across ${withWork} colleges.` : `${p.remaining} left.`);
      return { state, title: `Finish ${possessive(c.name)} essays`, why: parts.join(" "), due_on: c.deadline, college: c.unit_id };
    }
  }
}

/** The season the move is stamped with: the current one inside its seasons; the all-moves preview files it under senior fall otherwise. */
function stampFor(input: GeneratorInput): Season | null {
  if (isEssaysSeason(input.season)) return input.season;
  if (input.allMoves === true && input.season !== "unknown" && seasonRank(input.season) < seasonRank("summer_after")) return "senior_fall";
  return null;
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  const season = stampFor(input);
  if (season === null) return [];
  const progress = essayProgress({ items: input.items, schools: input.schools, essays: input.essays ?? null });
  const move = essaysMove(progress, season);
  const action: MoveAction = move.college ? { kind: "open_tab", tab: "essays", college: move.college } : { kind: "open_tab", tab: "essays" };
  return [
    {
      key: taskKey(input.list.id, "essays", "next"),
      item_id: null,
      kind: "essays",
      title: move.title.slice(0, 200),
      detail: move.why.slice(0, 1000),
      due_on: move.due_on,
      window_start: null,
      window_end: null,
      assignee: "student",
      source: "season",
      source_field: null,
      source_edition: null,
      date_note: null,
      position: 0,
      season,
      action,
    },
  ];
}
