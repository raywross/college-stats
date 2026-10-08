/**
 * The stage machine (specs/planner/model.md "Stages"). Pure: a student's stage is computed from their list's facts,
 * never stored, so nobody "advances" anything. `stageCounts()` gives each of the six stages a state and the short
 * count the strip shows ("2 to sort", "2 to decide", "3 of 8 in", "1 conflict"); `stageOf()` adds the current one.
 *
 * The current stage is the earliest of List, Rounds, Apply, and Offers with open work. Actions (3) is a side stage
 * that is always open, and Timeline (4) is the backbone that stays open once its first window has opened; neither
 * takes the lead while one of the four has work: Timeline leads when it is open and the four are done or not yet,
 * and Actions leads only when nothing else is open.
 */
import type { PlanItem, PlanTask, Stage, StageState } from "./types.ts";

export interface StageInfo {
  stage: Stage;
  key: "list" | "rounds" | "actions" | "timeline" | "apply" | "offers";
  /** The pill's name. */
  label: string;
  /** What the student is doing, for the hub's caption ("Applying · 3 of 8 in"). */
  doing: string;
}

export const STAGES: readonly StageInfo[] = [
  { stage: 1, key: "list", label: "List", doing: "Building the list" },
  { stage: 2, key: "rounds", label: "Rounds", doing: "Choosing rounds" },
  { stage: 3, key: "actions", label: "Actions", doing: "Visiting and following" },
  { stage: 4, key: "timeline", label: "Timeline", doing: "Working the timeline" },
  { stage: 5, key: "apply", label: "Apply", doing: "Applying" },
  { stage: 6, key: "offers", label: "Offers", doing: "Deciding" },
];

export const STAGE_NUMBERS: readonly Stage[] = [1, 2, 3, 4, 5, 6];

export function isStage(v: unknown): v is Stage {
  return typeof v === "number" && (STAGE_NUMBERS as readonly number[]).includes(v);
}

/** `?stage=3` → 3; anything else → null. */
export function parseStage(v: unknown): Stage | null {
  const n = typeof v === "string" ? Number(v) : v;
  return isStage(n) ? n : null;
}

/** What the machine reads. `conflicts`: the rounds stage's open conflicts when U3's checker has run; else the red ones counted here. */
export interface StageInput {
  items: Pick<PlanItem, "id" | "category" | "status" | "outcome" | "round" | "enrolling" | "visited_on">[];
  tasks: Pick<PlanTask, "item_id" | "kind" | "due_on" | "window_start" | "window_end" | "done_at" | "dismissed" | "snoozed_until">[];
  today: string;
  conflicts?: number;
}

export type StageCounts = Record<Stage, { state: StageState; count: string }>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The minimum list the List stage asks for (model.md: "3+ colleges, all categorized"). */
export const MIN_LIST = 3;

/** Commit-step kinds: Offers is done once a college is chosen and these are all ticked (or dismissed) for it. */
export const COMMIT_KINDS = ["deposit", "housing_deposit", "withdraw"] as const;

/**
 * Round choices that can't stand together (early-rounds.md "Conflicts", the red ones): two EDs, two ED IIs, or ED
 * with REA. U3's `conflicts()` checks the amber ones too and passes its count as `conflicts`.
 */
export function redConflicts(items: Pick<PlanItem, "round">[]): number {
  const n = (r: string) => items.filter((i) => i.round === r).length;
  let count = 0;
  if (n("ed") > 1) count++;
  if (n("ed2") > 1) count++;
  if (n("ed") > 0 && n("rea") > 0) count++;
  return count;
}

const openTask = (t: StageInput["tasks"][number], today: string) => t.done_at === null && !t.dismissed && !(t.snoozed_until && t.snoozed_until > today);

/** Each stage's state and count. */
export function stageCounts(input: StageInput): StageCounts {
  const { items, tasks, today } = input;
  const n = items.length;

  // 1 List
  const unsorted = items.filter((i) => i.category === "unsorted").length;
  const list: StageCounts[1] =
    unsorted > 0
      ? { state: "open", count: `${unsorted} to sort` }
      : n < MIN_LIST
        ? { state: "open", count: n === 0 ? "No colleges yet" : `Add ${MIN_LIST - n} more` }
        : { state: "done", count: plural(n, "college") };

  // 2 Rounds
  const conflicts = input.conflicts ?? redConflicts(items);
  const live = items.filter((i) => i.status !== "decided");
  const undecided = live.filter((i) => i.round === null).length;
  const rounds: StageCounts[2] =
    n === 0
      ? { state: "not_yet", count: "After the list" }
      : conflicts > 0
        ? { state: "open", count: plural(conflicts, "conflict") }
        : undecided > 0
          ? { state: "open", count: `${undecided} to decide` }
          : { state: "done", count: "Rounds set" };

  // 3 Actions: always open (a side stage).
  const visited = items.filter((i) => i.visited_on !== null).length;
  const actions: StageCounts[3] = { state: "open", count: visited > 0 ? `${visited} visited` : "Follow and visit" };

  // 4 Timeline: open once the first task's window (or date) has come; never done.
  const starts = tasks.map((t) => t.window_start ?? t.due_on).filter((d): d is string => d !== null);
  const started = starts.some((d) => d <= today);
  const open = tasks.filter((t) => openTask(t, today));
  const weekEnd = addDays(today, 7);
  const overdue = open.filter((t) => (t.due_on ?? t.window_end) !== null && (t.due_on ?? t.window_end)! < today).length;
  const week = open.filter((t) => {
    const d = t.due_on ?? t.window_end;
    return d !== null && d >= today && d <= weekEnd;
  }).length;
  const timeline: StageCounts[4] = !started
    ? { state: "not_yet", count: tasks.length > 0 ? plural(tasks.length, "step") : "Nothing dated yet" }
    : { state: "open", count: overdue > 0 ? `${overdue} overdue` : week > 0 ? `${week} this week` : plural(open.length, "to do", "to do") };

  // 5 Apply
  const inPlay = items.filter((i) => i.status !== "considering");
  const submitted = inPlay.filter((i) => i.status === "applied" || i.status === "decided").length;
  const apply: StageCounts[5] =
    inPlay.length === 0
      ? { state: "not_yet", count: "Nothing started" }
      : submitted < inPlay.length
        ? { state: "open", count: `${submitted} of ${inPlay.length} in` }
        : { state: "done", count: `${submitted} of ${inPlay.length} in` };

  // 6 Offers
  const decided = items.filter((i) => i.status === "decided");
  const admitted = decided.filter((i) => i.outcome === "admitted").length;
  const chosen = items.find((i) => i.enrolling) ?? null;
  const commitOpen = chosen
    ? tasks.some((t) => t.item_id === chosen.id && (COMMIT_KINDS as readonly string[]).includes(t.kind) && t.done_at === null && !t.dismissed)
    : false;
  const offers: StageCounts[6] =
    decided.length === 0
      ? { state: "not_yet", count: "No decisions yet" }
      : chosen && !commitOpen
        ? { state: "done", count: "Chosen" }
        : chosen
          ? { state: "open", count: "Finish the commit steps" }
          : { state: "open", count: admitted > 0 ? plural(admitted, "admit") : `${decided.length} decided` };

  return { 1: list, 2: rounds, 3: actions, 4: timeline, 5: apply, 6: offers };
}

/** The stage the strip opens by default (see the module comment), and every stage's state and count. */
export function stageOf(input: StageInput): { current: Stage; stages: StageCounts } {
  const stages = stageCounts(input);
  const lead = ([1, 2, 5, 6] as Stage[]).find((s) => stages[s].state === "open");
  if (lead) return { current: lead, stages };
  if (stages[4].state === "open") return { current: 4, stages };
  // Everything done: the last stage with something to show; nothing started: the list.
  if (stages[6].state === "done") return { current: 6, stages };
  return { current: input.items.length === 0 ? 1 : 3, stages };
}

/** The hub's caption for a student ("Applying · 3 of 8 in"). */
export function stageCaption(current: Stage, stages: StageCounts): string {
  const info = STAGES.find((s) => s.stage === current)!;
  return `${info.doing} · ${stages[current].count}`;
}

/** yyyy-mm-dd plus `days` (UTC calendar arithmetic). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
