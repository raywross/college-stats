/**
 * The guides registry (specs/planner/v3/now.md "The guide pattern"; build-plan.md review note 1 and "Guides"): which
 * guide a move opens, the guide's words (title, the card's button, its one-line purpose), and the guide page's URL.
 * A move's card asks `guideFor(task)` first; when there is a guide, its one button is the guide's, otherwise the
 * built action stays. Each guide is a page at `/plan/guide/<slug>` (app/advisor/guide/[slug]/page.tsx), its component in
 * lib/planner/guides-server.ts.
 *
 * Matching, first hit wins: the task's kind, then its playbook key (`{list}:playbook:<key>`), then its cycle key
 * (`{list}:cycle:<key>`). A kind or key with no entry has no guide.
 *
 * Every word here passes the catalog guard (tests/planner-guides.test.mts): no number from the estimate, no "odds".
 * Pure (no React, no server imports); safe in client components and tests.
 */
import { ADVISOR_PATH } from "./advisor.ts";
import { STANDING_LEVELS } from "../chances/levels.ts";
import type { StandingLevel } from "../chances/types.ts";
import type { PlanItem, PlanTask, TaskKind } from "./types.ts";

export type GuideSlug = "list" | "interest" | "test" | "story" | "courses" | "recommenders" | "ed";
export const GUIDE_SLUGS: readonly GuideSlug[] = ["list", "interest", "test", "story", "courses", "recommenders", "ed"];

/** Where a guide was opened from (`plan_guide_opened.from`). */
export type GuideFrom = "move" | "pill" | "notice" | "profile" | "numbers" | "card";
export const GUIDE_FROMS: readonly GuideFrom[] = ["move", "pill", "notice", "profile", "numbers", "card"];

/** What a guide link may carry besides the slug. */
export interface GuideHrefQuery {
  /** The student (`?for=`), for a guardian's view; null for a student's own plan. */
  person?: string | null;
  /** The move that led here (a plan_tasks id). */
  move?: string | null;
  /** A college's unit id (the interest and ED guides). */
  college?: string | null;
  /** The level that's missing (the list guide). */
  level?: StandingLevel | null;
  from?: GuideFrom | null;
}

/**
 * Options for `hrefFor`. `items` (beyond the brief) lets a caller that has the plan's rows turn the task's `item_id`
 * into the college's unit id for `?college=`; without it no college is added.
 */
export interface GuideHrefOpts {
  person: string | null;
  items?: readonly Pick<PlanItem, "id" | "unit_id">[];
}

export interface GuideEntry {
  slug: GuideSlug;
  title: string;
  /** The move card's button. */
  button: string;
  /** The guide's one line under its title when no move led there. */
  purpose: string;
  /** The guide's URL for a move (or for none): `?move=` and `from=move` with a move, plus the guide's own query. */
  hrefFor: (task: PlanTask | null, opts: GuideHrefOpts) => string;
}

/** `/advisor/guide/{slug}?for=…&move=…&college=…&level=…&from=…` (only the parts given, in that order). */
export function guideHref(slug: GuideSlug, q: GuideHrefQuery = {}): string {
  const p = new URLSearchParams();
  if (q.person) p.set("for", q.person);
  if (q.move) p.set("move", q.move);
  if (q.college) p.set("college", q.college);
  if (q.level) p.set("level", q.level);
  if (q.from) p.set("from", q.from);
  const s = p.toString();
  return s ? `${ADVISOR_PATH}/guide/${slug}?${s}` : `${ADVISOR_PATH}/guide/${slug}`;
}

/** The unit id of the task's college, when the caller passed the rows. */
function collegeOf(task: PlanTask | null, opts: GuideHrefOpts): string | null {
  if (!task?.item_id || !opts.items) return null;
  return opts.items.find((i) => i.id === task.item_id)?.unit_id ?? null;
}

/** A `shape_gap` move's missing level (its action is `show_rail { level }`). */
function levelOf(task: PlanTask | null): StandingLevel | null {
  if (!task || task.kind !== "shape_gap") return null;
  const a = task.action;
  return a && "level" in a ? a.level : null;
}

const base = (slug: GuideSlug, task: PlanTask | null, opts: GuideHrefOpts, extra: GuideHrefQuery = {}) =>
  guideHref(slug, { person: opts.person, move: task?.id ?? null, ...extra, from: task ? "move" : (extra.from ?? null) });

export const GUIDES: Record<GuideSlug, GuideEntry> = {
  list: {
    slug: "list",
    title: "Build your list",
    button: "Help me build it",
    purpose: "What a good list looks like this season, where yours stands, and colleges like the ones already on it.",
    hrefFor: (task, opts) => base("list", task, opts, { level: levelOf(task) }),
  },
  interest: {
    slug: "interest",
    title: "Show a college you're interested",
    button: "Show me how",
    purpose: "The ways a college counts interest, in the order the evidence supports, with its own upcoming events.",
    hrefFor: (task, opts) => base("interest", task, opts, { college: collegeOf(task, opts) }),
  },
  test: {
    slug: "test",
    title: "Reach your score",
    button: "Help me get there",
    purpose: "Study resources for your test and the dates whose scores would arrive in time.",
    hrefFor: (task, opts) => base("test", task, opts),
  },
  story: {
    slug: "story",
    title: "Your story",
    button: "Write it",
    purpose: "One page in your own words. The counselor's questionnaire and the essay both start from it.",
    hrefFor: (task, opts) => base("story", task, opts),
  },
  courses: {
    slug: "courses",
    title: "Choose next year's courses",
    button: "Help me choose",
    purpose: "The courses you've taken, the ones that would add depth, and any you want to add.",
    hrefFor: (task, opts) => base("courses", task, opts),
  },
  recommenders: {
    slug: "recommenders",
    title: "Pick your recommenders",
    button: "Help me pick",
    purpose: "The teachers you'd ask, in order, and how and when to ask them.",
    hrefFor: (task, opts) => base("recommenders", task, opts),
  },
  ed: {
    slug: "ed",
    title: "Early decision: the facts",
    button: "See the facts",
    purpose: "What a binding early application would mean at each college on your list that offers one.",
    hrefFor: (task, opts) => base("ed", task, opts, { college: collegeOf(task, opts) }),
  },
};

/** Kinds with a guide, whatever their key. */
export const GUIDE_BY_KIND: Partial<Record<TaskKind, GuideSlug>> = {
  shape_gap: "list",
  show_interest: "interest",
  visit_ed: "interest",
  story: "story",
  ed_decide: "ed",
  ed2_decide: "ed",
  test_register: "test",
  test_day: "test",
  recommendation: "recommenders",
};

/** Playbook keys (lib/planner/moves-catalog.ts) with a guide; `*` matches any prefix or suffix of a key. */
export const GUIDE_BY_PLAYBOOK_KEY: readonly (readonly [pattern: RegExp, slug: GuideSlug])[] = [
  [/^(build_list|long_list)$/, "list"],
  [/^(fall_break_visit|spring_break_visit|[a-z]+_visit_travel)$/, "interest"],
  [/^(pick_test|register_spring_test|reach_score_[a-z_]+)$/, "test"],
  [/^brag_sheet$/, "story"],
  [/^([a-z]+_choose_courses)$/, "courses"],
  [/^pick_recommenders$/, "recommenders"],
];

/** Cycle-file keys (data/application-cycle.json) with a guide. `choose_courses_YYYY` is beyond the brief: it's the built course choice that stands in for the playbook's. */
export const GUIDE_BY_CYCLE_KEY: readonly (readonly [pattern: RegExp, slug: GuideSlug])[] = [
  [/^(ask_recommenders|thank_recommenders)$/, "recommenders"],
  [/^personal_essay_draft$/, "story"],
  [/^choose_courses_\d{4}$/, "courses"],
];

const keyPart = (key: string | null, kind: "playbook" | "cycle"): string | null => {
  if (!key) return null;
  const m = new RegExp(`:${kind}:([a-z0-9_]+)$`).exec(key);
  return m ? m[1] : null;
};

/** The guide a move opens, or null. */
export function guideFor(task: Pick<PlanTask, "kind" | "key" | "item_id">): GuideEntry | null {
  const byKind = GUIDE_BY_KIND[task.kind];
  if (byKind) return GUIDES[byKind];
  const pb = keyPart(task.key, "playbook");
  if (pb) {
    const hit = GUIDE_BY_PLAYBOOK_KEY.find(([re]) => re.test(pb));
    if (hit) return GUIDES[hit[1]];
  }
  const cy = keyPart(task.key, "cycle");
  if (cy) {
    const hit = GUIDE_BY_CYCLE_KEY.find(([re]) => re.test(cy));
    if (hit) return GUIDES[hit[1]];
  }
  return null;
}

/** Untrusted `?slug` as a guide slug, or null. */
export function parseGuideSlug(v: unknown): GuideSlug | null {
  return typeof v === "string" && (GUIDE_SLUGS as readonly string[]).includes(v) ? (v as GuideSlug) : null;
}

/** A guide page's own query from untrusted search params (components/planner/guides/types.ts GuideQuery's shape). */
export function parseGuideQuery(q: { college?: unknown; level?: unknown; move?: unknown }): { college: string | null; level: StandingLevel | null; move: string | null } {
  const college = typeof q.college === "string" && /^\d{1,12}$/.test(q.college) ? q.college : null;
  const level = typeof q.level === "string" && (STANDING_LEVELS as readonly string[]).includes(q.level) ? (q.level as StandingLevel) : null;
  const move = typeof q.move === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.move) ? q.move : null;
  return { college, level, move };
}

/** Untrusted `?from=` as a GuideFrom; else "move" when a move is open, "profile" otherwise (build-plan.md "The guide page"). */
export function parseGuideFrom(v: unknown, hasMove: boolean): GuideFrom {
  return typeof v === "string" && (GUIDE_FROMS as readonly string[]).includes(v) ? (v as GuideFrom) : hasMove ? "move" : "profile";
}
