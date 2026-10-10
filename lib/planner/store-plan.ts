"use server";
/**
 * The redesigned plan's Server Actions (specs/planner/redesign/build-plan.md "Server actions"): a group or round the
 * student picks (or hands back to the suggestion), the Dream, the numbers, and a picked test date. Each one: sign in
 * and the entitlement check (`planner.tab`), the write with the caller's own session so row-level security decides,
 * then `syncAuto` (store the model's group and round on every `auto` row that changed) and `regenerate` (tasks follow
 * rounds and test dates). Returns `{ ok: true } | { ok: false; message }`.
 *
 * A "use server" module exports only async functions (a const export breaks `next build`); the validation and write
 * sets are pure, in lib/planner/plan-writes.ts.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { myHome } from "@/lib/home-store";
import { profileFor, saveProfile } from "@/lib/student-profile-store";
import { effectiveGradYear } from "@/lib/student-profile";
import type { ListRound } from "@/lib/list-rules";
import { generatorInputFor, readPlan, todayIso, writeAutoWrites } from "./context";
import { autoWrites, planView } from "./plan-view";
import { applyNumbers, groupPatch, isUuid, parseNumbers, roundPatch, togglePlannedDate, type PickedGroup, type PlanNumbers } from "./plan-writes";
import { regenerate, setDream } from "./store";

export type PlanWriteResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const NOT_EDITOR = "Only someone who can edit this plan can change it.";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

async function ready(): Promise<{ userId: string; supabase: Supabase } | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, "planner.tab"))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

/** The Plan page, the household pages that still show the plan, and the hub's caption. */
function refresh() {
  revalidatePath("/plan");
  revalidatePath("/household", "layout");
}

/** The suggestion sync for one list, with a session the caller already built. Returns rows changed. */
async function syncWith(supabase: Supabase, listId: string): Promise<number> {
  const plan = await readPlan(supabase, listId);
  if (!plan || plan.items.length === 0) return 0;
  let gradYear: number | null = null;
  let profile = null;
  if (plan.list.student_id) {
    const [p, s] = await Promise.all([profileFor(plan.list.student_id), supabase.from("students").select("grad_year").eq("id", plan.list.student_id).maybeSingle()]);
    const stored = (s.data as { grad_year: number | null } | null)?.grad_year ?? null;
    gradYear = p ? effectiveGradYear(p.data.basics, stored) : stored;
    profile = p?.data ?? null;
  }
  const today = todayIso();
  const input = await generatorInputFor(plan, { gradYear, profile, home: await myHome(), today });
  const writes = autoWrites(planView({ items: plan.items, schools: input.schools, profile, today }));
  return writes.length > 0 ? writeAutoWrites(supabase, writes) : 0;
}

/**
 * Stores the model's group and round on every `auto` row of a list that differs (lib/planner/plan-view.ts
 * autoWrites). Never touches a `student` row or an applied or decided college's round. Also runs on every plan open
 * for editors (lib/planner/load.ts). A reader who can't edit writes nothing.
 */
export async function syncAuto(listId: string): Promise<PlanWriteResult & { changed?: number }> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  try {
    return { ok: true, changed: await syncWith(r.supabase, listId) };
  } catch (err) {
    console.error(`planner: syncAuto failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, message: FAILED };
  }
}

/** After a write: the suggestions, then the tasks. */
async function followUp(supabase: Supabase, listIds: string[]): Promise<void> {
  for (const id of listIds) {
    try {
      await syncWith(supabase, id);
    } catch (err) {
      console.error(`planner: syncAuto failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await regenerate(id);
  }
  refresh();
}

async function updateItem(itemId: string, patch: Record<string, unknown>, what: string): Promise<PlanWriteResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("list_items").update(patch).eq("id", itemId).select("list_id");
  if (error) {
    console.error(`planner: ${what} failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  if (!data?.length) return { ok: false, message: NOT_EDITOR };
  await followUp(r.supabase, [(data[0] as { list_id: string }).list_id]);
  return { ok: true };
}

/** A group the student picks (theirs from then on), or null: "Use the suggestion" (back to the model's group). */
export async function setGroup(itemId: string, group: PickedGroup | null): Promise<PlanWriteResult> {
  const patch = groupPatch(group);
  if (!patch) return { ok: false, message: FAILED };
  return updateItem(itemId, patch, "setGroup");
}

/** A round the student picks (theirs from then on), or null: "Use the starting round". Tasks follow the round. */
export async function setPlanRound(itemId: string, round: ListRound | null): Promise<PlanWriteResult> {
  const patch = roundPatch(round);
  if (!patch) return { ok: false, message: FAILED };
  return updateItem(itemId, patch, "setPlanRound");
}

/** Marks (or clears) the Dream with the built setDream, then re-syncs the starting rounds the Dream decides. */
export async function setPlanDream(itemId: string, dream: boolean): Promise<PlanWriteResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const done = await setDream(itemId, Boolean(dream));
  if (!done.ok) return done;
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data } = await r.supabase.from("list_items").select("list_id").eq("id", itemId).maybeSingle();
  const listId = (data as { list_id: string } | null)?.list_id;
  if (listId) {
    let changed = 0;
    try {
      changed = await syncWith(r.supabase, listId);
    } catch (err) {
      console.error(`planner: syncAuto failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // setDream regenerated already; only a round that moved since needs another pass.
    if (changed > 0) await regenerate(listId);
  }
  refresh();
  return { ok: true };
}

/** Every list of a student (their groups and tasks follow their numbers and test dates). */
async function studentLists(supabase: Supabase, studentId: string): Promise<string[]> {
  const { data } = await supabase.from("lists").select("id").eq("student_id", studentId);
  return ((data ?? []) as { id: string }[]).map((l) => l.id);
}

async function saveTheirProfile(studentId: string, change: (p: NonNullable<Awaited<ReturnType<typeof profileFor>>>) => { ok: true; data: unknown } | { ok: false; message: string }): Promise<PlanWriteResult> {
  if (!isUuid(studentId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const profile = await profileFor(studentId);
  if (!profile) return { ok: false, message: FAILED };
  if (!profile.canEdit) return { ok: false, message: NOT_EDITOR };
  const next = change(profile);
  if (!next.ok) return next;
  const saved = await saveProfile(studentId, next.data);
  if (!saved.ok) return saved;
  await followUp(r.supabase, await studentLists(r.supabase, studentId));
  return { ok: true };
}

/** The numbers form (standing.md "The numbers"): GPA and scale, which test, the score, and the practice flag. */
export async function setNumbers(studentId: string, numbers: PlanNumbers): Promise<PlanWriteResult> {
  const parsed = parseNumbers(numbers);
  if (!parsed) return { ok: false, message: "Check the numbers: one of them is out of range." };
  return saveTheirProfile(studentId, (p) => ({ ok: true, data: applyNumbers(p.data, parsed) }));
}

/** "I'll take it" on a test date (scores.md "Test dates"), or undoing it; the cycle generator follows. */
export async function setPlannedDate(studentId: string, entryKey: string, on: boolean): Promise<PlanWriteResult> {
  return saveTheirProfile(studentId, (p) => {
    const t = togglePlannedDate(p.data, entryKey, Boolean(on));
    return t.ok ? { ok: true, data: t.profile } : t;
  });
}
