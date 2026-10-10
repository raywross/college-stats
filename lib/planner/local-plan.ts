/**
 * The signed-out plan, kept in the browser (specs/planner/redesign/page.md "Signed out"; build-plan.md "U7
 * Signed-out Plan"). A visitor's numbers already live in `localStorage` under `lib/student-profile.ts`'s
 * `LOCAL_PROFILE_KEY`; this is just the list — which colleges, the Dream, and any group or round the visitor picked
 * themselves. A group or round that's still the model's own suggestion isn't stored here at all, the same
 * `auto`/`student` split `list_items.category_source`/`round_source` use once signed in (standing.md "Suggested
 * until changed"), so `planItemsFor` below can hand the stored shape straight to `planView`.
 *
 * Pure module: the sanitizing and pure-transform functions below take no browser APIs and are safe in tests; the
 * handful that do touch `localStorage` (`getLocalPlan`, `setLocalPlan`, `clearLocalPlan`, `subscribeLocalPlan`) wrap
 * every call in try/catch, mirroring `components/me/useLocalProfile.ts`'s pattern, so a blocked store (private
 * browsing, a full quota, a locked-down test environment) never throws — the page just won't persist for that
 * visit.
 */
import { isUnitId } from "../follow-state.ts";
import { isListRound, type ListRound } from "../list-rules.ts";
import type { Fit } from "./standing.ts";
import type { PlanItem } from "./types.ts";

export interface LocalPlan {
  unitIds: string[];
  dream: string | null;
  /** Only colleges whose group the visitor picked themselves; everything else is the model's live suggestion. */
  groups: Record<string, Fit>;
  /** Only colleges whose round the visitor picked themselves; everything else is the starting round. */
  rounds: Record<string, ListRound>;
}

/** New key: the signed-out profile (numbers) keeps its own, separate key (`LOCAL_PROFILE_KEY`). */
export const LOCAL_PLAN_KEY = "plan-local";
const EVENT = "plan-local-updated";
/** Keeps the signed-out list to a sane size; also the most ids `/api/plan/schools` accepts in one call. */
export const MAX_LOCAL_COLLEGES = 20;

const FIT_VALUES: readonly Fit[] = ["reach", "target", "likely"];
const isFit = (v: unknown): v is Fit => typeof v === "string" && (FIT_VALUES as readonly string[]).includes(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function emptyLocalPlan(): LocalPlan {
  return { unitIds: [], dream: null, groups: {}, rounds: {} };
}

/**
 * Turns unknown input (whatever JSON `localStorage` happens to hold) into a valid LocalPlan: drops anything
 * invalid, dedupes the ids and caps them at `MAX_LOCAL_COLLEGES`, and keeps a group/round/Dream only for a college
 * still on the (possibly trimmed) list. Never throws; always returns a complete shape.
 */
export function sanitizeLocalPlan(input: unknown): LocalPlan {
  const empty = emptyLocalPlan();
  if (!isObj(input)) return empty;

  const unitIds: string[] = [];
  if (Array.isArray(input.unitIds)) {
    for (const v of input.unitIds) {
      if (unitIds.length >= MAX_LOCAL_COLLEGES) break;
      if (isUnitId(v) && !unitIds.includes(v)) unitIds.push(v);
    }
  }

  const dream = typeof input.dream === "string" && unitIds.includes(input.dream) ? input.dream : null;

  const groups: Record<string, Fit> = {};
  if (isObj(input.groups)) {
    for (const id of unitIds) {
      const v = input.groups[id];
      if (isFit(v)) groups[id] = v;
    }
  }

  const rounds: Record<string, ListRound> = {};
  if (isObj(input.rounds)) {
    for (const id of unitIds) {
      const v = input.rounds[id];
      if (isListRound(v)) rounds[id] = v;
    }
  }

  return { unitIds, dream, groups, rounds };
}

/* ------------------------------------------------------------------ */
/* Pure transforms (every tap on the page goes through one of these)   */
/* ------------------------------------------------------------------ */

/** Adds a college, deduped and capped; returns the same reference when there's nothing to do. */
export function addLocalCollege(plan: LocalPlan, unitId: string): LocalPlan {
  if (!isUnitId(unitId) || plan.unitIds.includes(unitId) || plan.unitIds.length >= MAX_LOCAL_COLLEGES) return plan;
  return { ...plan, unitIds: [...plan.unitIds, unitId] };
}

/** Removes a college (and whatever group/round/Dream it held). */
export function removeLocalCollege(plan: LocalPlan, unitId: string): LocalPlan {
  if (!plan.unitIds.includes(unitId)) return plan;
  const groups = { ...plan.groups };
  delete groups[unitId];
  const rounds = { ...plan.rounds };
  delete rounds[unitId];
  return { unitIds: plan.unitIds.filter((id) => id !== unitId), dream: plan.dream === unitId ? null : plan.dream, groups, rounds };
}

/** Marks (or clears, with null) the Dream; refuses a college not on the list. */
export function setLocalDream(plan: LocalPlan, unitId: string | null): LocalPlan {
  if (unitId !== null && !plan.unitIds.includes(unitId)) return plan;
  return plan.dream === unitId ? plan : { ...plan, dream: unitId };
}

/** A group the visitor picks, or null for "use the suggestion" (back to auto). */
export function setLocalGroup(plan: LocalPlan, unitId: string, group: Fit | null): LocalPlan {
  if (!plan.unitIds.includes(unitId)) return plan;
  const groups = { ...plan.groups };
  if (group === null) delete groups[unitId];
  else groups[unitId] = group;
  return { ...plan, groups };
}

/** A round the visitor picks, or null for "use the starting round". */
export function setLocalRound(plan: LocalPlan, unitId: string, round: ListRound | null): LocalPlan {
  if (!plan.unitIds.includes(unitId)) return plan;
  const rounds = { ...plan.rounds };
  if (round === null) delete rounds[unitId];
  else rounds[unitId] = round;
  return { ...plan, rounds };
}

/* ------------------------------------------------------------------ */
/* Storage (every call wrapped; a blocked or missing store is never fatal) */
/* ------------------------------------------------------------------ */

let cache: { raw: string | null; data: LocalPlan } = { raw: null, data: emptyLocalPlan() };

function read(): LocalPlan {
  if (typeof window === "undefined") return emptyLocalPlan();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LOCAL_PLAN_KEY);
  } catch {
    return emptyLocalPlan();
  }
  if (raw === cache.raw) return cache.data;
  let data: LocalPlan;
  try {
    data = sanitizeLocalPlan(raw ? JSON.parse(raw) : null);
  } catch {
    data = emptyLocalPlan();
  }
  cache = { raw, data };
  return data;
}

function write(data: LocalPlan): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_PLAN_KEY, JSON.stringify(data));
  } catch {
    // Private browsing or a full quota: the page still works for the session, it just won't persist.
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Some test/embedded environments don't implement CustomEvent dispatch; nothing else depends on it succeeding.
  }
}

export function getLocalPlan(): LocalPlan {
  return read();
}

export function setLocalPlan(data: LocalPlan): void {
  write(data);
}

export function clearLocalPlan(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_PLAN_KEY);
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // ignore
  }
}

/** Same-tab ("plan-local-updated") and cross-tab ("storage") updates, for `useSyncExternalStore`. */
export function subscribeLocalPlan(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/* ------------------------------------------------------------------ */
/* Rows, for the live preview (lib/planner/plan-view.ts planView)       */
/* ------------------------------------------------------------------ */

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

/**
 * The LocalPlan as `PlanItem[]`, in list order, so `planView` can build the same row view signed out as signed in.
 * Every college is `considering` (the signed-out page never tracks applying/applied/decided), and every field
 * `list_items` would otherwise hold is a harmless default — nothing here is ever written to a database.
 */
export function planItemsFor(plan: LocalPlan, now: () => string = TODAY_ISO): PlanItem[] {
  const today = now();
  return plan.unitIds.map((unitId, position) => {
    const group = plan.groups[unitId] ?? null;
    const round = plan.rounds[unitId] ?? null;
    return {
      id: unitId,
      list_id: "local",
      unit_id: unitId,
      category: group ?? "unsorted",
      category_source: group ? "student" : "auto",
      status: "considering",
      outcome: null,
      round,
      round_source: round ? "student" : "auto",
      position,
      added_by: null,
      added_at: today,
      decision_date: null,
      deadline_text: null,
      deadline_date: null,
      enrolling: false,
      updates: false,
      visited_on: null,
      follows_social: false,
      dream: plan.dream === unitId,
      priority: null,
      followed_networks: [],
      info_requested_on: null,
      application_platform: null,
      applied_on: null,
      complete_on: null,
      portal_url: null,
      committed_on: null,
      withdrawn_on: null,
      recommendations_count: null,
      supplements_count: null,
      transcript_shared: false,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Import on sign-up (page.md "Signed out" step 3)                     */
/* ------------------------------------------------------------------ */

export interface LocalImportPlan {
  /** Colleges to add to the student's default list (not already on it). */
  toAdd: string[];
  /** The college to mark as the Dream, or null when the local plan had none worth keeping. */
  dreamUnitId: string | null;
  /** Groups to set as `student` source (only ones the visitor actually picked themselves). */
  groupWrites: { unitId: string; group: Fit }[];
  /** Rounds to set as `student` source (only ones the visitor actually picked themselves). */
  roundWrites: { unitId: string; round: ListRound }[];
}

/**
 * What importing a signed-out plan onto a (possibly non-empty) list means: add whatever isn't already there, carry
 * over the Dream, and make only the groups/rounds the visitor actually changed `student` source — an `auto` one is
 * left alone, so the model keeps sorting it once signed in. Pure: the caller (a Server Action) does the writing.
 */
export function localImportPlan(local: LocalPlan, existingUnitIds: readonly string[]): LocalImportPlan {
  const existing = new Set(existingUnitIds);
  const toAdd = local.unitIds.filter((id) => !existing.has(id));
  const dreamUnitId = local.dream && local.unitIds.includes(local.dream) ? local.dream : null;
  const groupWrites = Object.entries(local.groups)
    .filter(([id]) => local.unitIds.includes(id))
    .map(([unitId, group]) => ({ unitId, group }));
  const roundWrites = Object.entries(local.rounds)
    .filter(([id]) => local.unitIds.includes(id))
    .map(([unitId, round]) => ({ unitId, round }));
  return { toAdd, dreamUnitId, groupWrites, roundWrites };
}
