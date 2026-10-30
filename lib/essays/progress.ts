/**
 * What is left to write (specs/product/essays/moves.md "What counts as work left"; tab.md "The screen"): one reading
 * of the student's drafts against the list's colleges, shared by the essays move (lib/planner/generators/essays.ts),
 * its card, the store's tick (lib/essays/move-tick.ts), and the Essays tab, so the card and the screen never
 * disagree.
 *
 * Rules (moves.md, with the build's choices noted):
 * - A prompt is **served** by a draft whose `prompt_ref` is the prompt's ref or that is linked to it (`essay_links`).
 *   The first serving draft decides the state: a draft written for the prompt before one linked to it, then the
 *   most recently edited (the read's order), then the id. `ready` and `submitted` both count as ready.
 * - **Required**: the prompt says required and applies to every applicant (`applies_to: "all"`). A program prompt is
 *   optional (moves.md open question 2); a transfer prompt is left out (a first-year applicant never answers it); an
 *   international one is optional.
 * - A **choose** set (`essays.choose`): the prompts not required on their own that apply to all, the first `of` of
 *   them in page order (the data marks every member `required: false`, lib/types.ts SchoolEssays). They sit in
 *   `required` with `chooseGroup`, and count as `n` slots filled by any `n` ready drafts among them. So a college's
 *   `ready`/`total` are the counts to read, never `required.length`.
 * - `status: "none"`: nothing beyond the platform's. `refers_to_form` and no `essays` block at all are **unknown**:
 *   zero required, flagged by `onFile`. The student can add what the college asks as their own prompts (below).
 * - **Free drafts tied to a college** (`own`): the build's rule. `createEssay` stores nothing that ties a `free`
 *   draft to a college, so a college's own prompts are drafts on an **own ref**, `college:<unit_id>:<cycle>:own-<n>`
 *   (`ownRef`, `nextOwnRef`; parsed by lib/essays/prompts.ts as a college ref with `own: true`), written by the tab's
 *   "Add what {College} asks" or linked from a free draft. Each counts once, by its own status. A plain `free` draft
 *   with no link stays "Not for a college yet" and counts nowhere.
 * - The **personal essay** (`platform:common_app:main`) counts once when any college on the list takes the Common
 *   App (the item's platform is Common App, or unset at a Common App member); `main` is null otherwise. It is not in
 *   any college's `required`: `takesCommonApp` says the college uses it, and an unfinished personal essay makes every
 *   Common App college "work left" (moves.md open question 1). The Coalition's prompts are never required.
 * - Out: withdrawn colleges, and a college whose outcome is in and that the student isn't enrolling at.
 * - Order: the deadline the plan resolves (`applyDate` for the chosen round, in the student's cycle; else the regular
 *   round's), undated last, then the list's own order, then the name.
 *
 * Pure, no I/O; safe in client components. Never reads or returns a word of essay text: titles are the prompt's kind.
 */
import type { ListRound } from "../list-rules.ts";
import { applyDate, ROUND_SHORT, shortDay } from "../planner/generators/college.ts";
import type { PlanEssays, PlanItem, PlanSchool } from "../planner/types.ts";
import type { EssayPrompt } from "../types.ts";
import { collegeRef, KIND_LABEL, MAIN_LIMIT, MAIN_REF, parsePromptRef, type EssayKind } from "./prompts.ts";
import { refsOf, type EssayLinkRow, type EssayRow } from "./rows.ts";

export type PromptState = "not_started" | "draft" | "ready";
export interface PromptProgress {
  ref: string;
  title: string;
  kind: EssayKind;
  limit: EssayPrompt["limit"];
  state: PromptState;
  essayId: string | null;
  count: number | null;
  chooseGroup?: { n: number; of: number };
}
export interface CollegeEssayProgress {
  unit_id: string;
  item_id: string;
  name: string;
  round: ListRound | null;
  /** ISO, via applyDate in the student's cycle. */
  deadline: string | null;
  onFile: "published" | "none" | "refers_to_form" | "not_on_file";
  required: PromptProgress[];
  optional: PromptProgress[];
  /** Drafts on the college's own refs (the prompts the student added for it). */
  own: { id: string; title: string; state: PromptState; count: number | null }[];
  /** Over required (a choose set as its `n` slots) + own. */
  ready: number;
  total: number;
  /** The main essay counts here. */
  takesCommonApp: boolean;
}
export interface EssayProgress {
  /** Null without a Common App college. */
  main: { state: PromptState; essayId: string | null; count: number; limit: number } | null;
  /** Deadline order, undated last; withdrawn/declined out. */
  colleges: CollegeEssayProgress[];
  /** Main + every college's required + own. */
  remaining: number;
  total: number;
  /** First with work left (the main essay counts at each Common App college). */
  next: CollegeEssayProgress | null;
  /** Colleges whose prompts aren't on file (refers_to_form or no page read) and that have no own prompts added yet. */
  notOnFile: number;
}

/* ------------------------------------------------------------------ */
/* Own refs                                                            */
/* ------------------------------------------------------------------ */

/** "2026-27" for the cycle that starts in 2026 (lib/planner/cycle.ts cycleKey, kept here so this module stays light). */
export function cycleLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** A prompt the student adds for a college: `college:<unit_id>:<cycle>:own-<n>` (n from 1). */
export function ownRef(unitId: string, cycle: string, n: number): string {
  return `college:${unitId}:${cycle}:own-${n}`;
}

/** The next free own ref for a college in a cycle: one past the highest `own-<n>` any draft or link already uses. */
export function nextOwnRef(unitId: string, cycle: string, essays: PlanEssays | null): string {
  let max = 0;
  for (const ref of allRefs(essays)) {
    const p = parsePromptRef(ref);
    if (p?.kind === "college" && p.own && p.unitId === unitId && p.cycle === cycle) max = Math.max(max, p.n);
  }
  return ownRef(unitId, cycle, max + 1);
}

function allRefs(essays: PlanEssays | null): string[] {
  if (!essays) return [];
  return [...essays.rows.map((r) => r.prompt_ref), ...essays.links.map((l) => l.prompt_ref)];
}

/* ------------------------------------------------------------------ */
/* The reading                                                         */
/* ------------------------------------------------------------------ */

const stateOf = (row: Pick<EssayRow, "status">): PromptState => (row.status === "draft" ? "draft" : "ready");

/** Which drafts serve which ref, the first-serving order already applied. */
function servingIndex(rows: readonly EssayRow[], links: readonly EssayLinkRow[]): Map<string, EssayRow[]> {
  const index = new Map<string, { row: EssayRow; direct: boolean; at: number }[]>();
  rows.forEach((row, at) => {
    for (const ref of refsOf(row, links)) {
      const list = index.get(ref) ?? [];
      list.push({ row, direct: row.prompt_ref === ref, at });
      index.set(ref, list);
    }
  });
  const out = new Map<string, EssayRow[]>();
  for (const [ref, list] of index) {
    list.sort((a, b) => (a.direct === b.direct ? 0 : a.direct ? -1 : 1) || a.at - b.at || a.row.id.localeCompare(b.row.id));
    out.set(ref, list.map((x) => x.row));
  }
  return out;
}

/** Out of the essays: withdrawn, or the outcome is in and the student isn't enrolling there. */
function isOut(item: PlanItem): boolean {
  return Boolean(item.withdrawn_on) || (item.outcome !== null && !item.enrolling);
}

/** The item takes the Common App: its platform says so, or it's unset at a member (`apply` is the member's grid row). */
function takesCommonApp(item: PlanItem, school: PlanSchool): boolean {
  if (item.application_platform === "common_app") return true;
  return item.application_platform == null && school.apply != null;
}

/** The plan's own deadline: the chosen round's date, else the regular round's (moves.md "What it says"). */
function deadlineOf(item: PlanItem, school: PlanSchool): string | null {
  return (applyDate(school, item.round) ?? (item.round !== null && item.round !== "rd" ? applyDate(school, null) : null))?.date ?? null;
}

function onFileOf(school: PlanSchool): CollegeEssayProgress["onFile"] {
  const e = school.essays;
  if (!e) return "not_on_file";
  return e.status;
}

export function essayProgress(input: { items: PlanItem[]; schools: Record<string, PlanSchool>; essays: PlanEssays | null; mainLimit?: number }): EssayProgress {
  const rows = input.essays?.rows ?? [];
  const links = input.essays?.links ?? [];
  const serving = servingIndex(rows, links);
  const prompt = (ref: string, title: string, kind: EssayKind, limit: EssayPrompt["limit"], chooseGroup?: { n: number; of: number }): PromptProgress => {
    const first = serving.get(ref)?.[0] ?? null;
    return {
      ref,
      title,
      kind,
      limit,
      state: first ? stateOf(first) : "not_started",
      essayId: first?.id ?? null,
      count: first ? first.count : null,
      ...(chooseGroup ? { chooseGroup } : {}),
    };
  };

  const colleges: CollegeEssayProgress[] = [];
  const position = new Map(input.items.map((i) => [i.id, i.position]));
  for (const item of input.items) {
    if (isOut(item)) continue;
    const school = input.schools[item.unit_id];
    if (!school) continue;
    const onFile = onFileOf(school);
    const required: PromptProgress[] = [];
    const optional: PromptProgress[] = [];
    let ready = 0;
    let total = 0;

    if (onFile === "published" && school.essays) {
      const prompts = school.essays.prompts.filter((p) => p.applies_to !== "transfer");
      const choose = school.essays.choose ?? null;
      const candidates = choose ? prompts.filter((p) => !p.required && p.applies_to === "all") : [];
      const set = new Set(choose && candidates.length > choose.of ? candidates.slice(0, choose.of) : candidates);
      const group = choose ? { n: choose.n, of: choose.of } : undefined;
      let setReady = 0;
      for (const p of prompts) {
        const ref = collegeRef(p.id);
        const title = KIND_LABEL[p.kind];
        if (set.has(p)) {
          const pp = prompt(ref, title, p.kind, p.limit, group);
          required.push(pp);
          if (pp.state === "ready") setReady++;
        } else if (p.required && p.applies_to === "all") {
          const pp = prompt(ref, title, p.kind, p.limit);
          required.push(pp);
          total++;
          if (pp.state === "ready") ready++;
        } else {
          optional.push(prompt(ref, title, p.kind, p.limit));
        }
      }
      if (choose && set.size > 0) {
        const slots = Math.min(choose.n, set.size);
        total += slots;
        ready += Math.min(slots, setReady);
      }
    }

    // The college's own prompts: drafts (or links) on an own ref for this college, each counted once.
    const own: CollegeEssayProgress["own"] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      const tied = refsOf(row, links).some((ref) => {
        const p = parsePromptRef(ref);
        return p?.kind === "college" && p.own === true && p.unitId === item.unit_id;
      });
      if (!tied) continue;
      seen.add(row.id);
      own.push({ id: row.id, title: row.title, state: stateOf(row), count: row.count });
      total++;
      if (stateOf(row) === "ready") ready++;
    }

    colleges.push({
      unit_id: item.unit_id,
      item_id: item.id,
      name: school.name,
      round: item.round,
      deadline: deadlineOf(item, school),
      onFile,
      required,
      optional,
      own,
      ready,
      total,
      takesCommonApp: takesCommonApp(item, school),
    });
  }

  colleges.sort((a, b) => {
    if (a.deadline !== b.deadline) {
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return a.deadline.localeCompare(b.deadline);
    }
    return (position.get(a.item_id) ?? 0) - (position.get(b.item_id) ?? 0) || a.name.localeCompare(b.name);
  });
  const ordered = colleges;

  let main: EssayProgress["main"] = null;
  if (ordered.some((c) => c.takesCommonApp)) {
    const m = prompt(MAIN_REF, KIND_LABEL.personal, "personal", MAIN_LIMIT);
    main = { state: m.state, essayId: m.essayId, count: m.count ?? 0, limit: input.mainLimit ?? MAIN_LIMIT.max };
  }
  const mainOpen = main !== null && main.state !== "ready";

  const total = (main ? 1 : 0) + ordered.reduce((s, c) => s + c.total, 0);
  const done = (main && !mainOpen ? 1 : 0) + ordered.reduce((s, c) => s + c.ready, 0);
  const next = ordered.find((c) => c.ready < c.total || (c.takesCommonApp && mainOpen)) ?? null;
  const notOnFile = ordered.filter(isUnknown).length;
  return { main, colleges: ordered, remaining: total - done, total, next, notOnFile };
}

/** A college whose prompts we haven't read and for which the student hasn't added any yet. */
function isUnknown(c: CollegeEssayProgress): boolean {
  return (c.onFile === "refers_to_form" || c.onFile === "not_on_file") && c.own.length === 0;
}

/** The first college (deadline order) whose prompts aren't on file and that has nothing added: the "Check what {College} asks" college. */
export function firstNotOnFile(p: EssayProgress): CollegeEssayProgress | null {
  return p.colleges.find(isUnknown) ?? null;
}

/**
 * Everything is ready: something to write, all of it ready, and no college still waiting for its prompts. The store
 * ticks the move on this (moves.md "Done": `remaining` reaching zero, with the worked example's Nov 3 row, where every
 * known essay is ready but Yale isn't on file, kept open).
 */
export function allReady(p: EssayProgress): boolean {
  return p.total > 0 && p.remaining === 0 && p.notOnFile === 0;
}

/** Work on the colleges' own prompts (not the personal essay): what the list asks beyond the platform. */
export function collegeTotal(p: EssayProgress): number {
  return p.colleges.reduce((s, c) => s + c.total, 0);
}

/**
 * The tab's header line (tab.md "Header line"): "14 of 23 ready · next: Duke, Nov 1"; with nothing on file yet, the
 * summer's line; with everything ready, the all-ready line.
 */
export function progressLine(p: EssayProgress): string {
  if (allReady(p)) return `All ${p.total} ready. Paste each college's package into its form when you apply.`;
  if (collegeTotal(p) === 0 && p.notOnFile === 0) return "Your colleges' prompts arrive by August; the personal essay is the summer's work.";
  const named = p.next ?? firstNotOnFile(p);
  const head = `${p.total - p.remaining} of ${p.total} ready`;
  if (!named) return head;
  return `${head} · next: ${named.name}${named.deadline ? `, ${shortDay(named.deadline)}` : ""}`;
}

/** "EA", "ED I", "RD" for a round (rolling and none read as no round). */
export function roundWord(round: ListRound | null): string | null {
  if (round === null || round === "rolling") return null;
  return ROUND_SHORT[round];
}
