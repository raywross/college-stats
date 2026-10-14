"use server";
/**
 * The redesigned plan's Server Actions (specs/planner/redesign/build-plan.md "Server actions"): a round the student
 * picks (or hands back to the suggestion), the Dream, the numbers, the intake guide's one save, and a picked test date.
 * Groups are Quad's only (specs/planner/redesign/intake.md "Groups"), so there's no group action. Each one: sign in
 * and the entitlement check (`planner.tab`), the write with the caller's own session so row-level security decides,
 * then `syncAndRegenerate` (one pass that both stores the model's group and round on every `auto` row that changed,
 * and regenerates the tasks that follow rounds and test dates; U17 "faster saves" merged what used to be two
 * sequential full passes — each with its own plan read and profile fetch — into one). Returns
 * `{ ok: true } | { ok: false; message }`.
 *
 * A "use server" module exports only async functions (a const export breaks `next build`); the validation and write
 * sets are pure, in lib/planner/plan-writes.ts.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { myHome } from "@/lib/home-store";
import { profileFor, profilesICanSee, saveProfile } from "@/lib/student-profile-store";
import { effectiveGradYear, sanitizeProfile, type StudentProfileData } from "@/lib/student-profile";
import type { ListRound } from "@/lib/list-rules";
import { generatorInputFor, readPlan, todayIso, writeAutoWrites, writeMerge } from "./context";
import { autoWrites, planView } from "./plan-view";
import { planEstimates } from "./plan-estimates";
import { generateTasks, mergeTasks } from "./tasks";
import { applyNumbers, isUuid, parseNumbers, roundPatch, togglePlannedDate, type PlanNumbers } from "./plan-writes";
import { applyIntake, parseIntakeSave, type IntakeSave } from "./intake";
import { mergeCoursesForSave } from "@/lib/chances/courses";
import { span } from "@/lib/timing";
import { afterResponse, withTiming } from "@/lib/timing-server";
import { inRequestScope } from "@/lib/request-memo";
import { freshPlanBundle } from "@/lib/bundles";
import { planDataFromBundle } from "@/lib/bundle-read";
import type { PlanData } from "./read-plan";

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
  void span("revalidate", () => {
    try {
      revalidatePath("/plan");
      revalidatePath("/household", "layout");
    } catch (err) {
      // After the response (the intake's background pass) there is no client to refresh; never fail the pass on it.
      console.error(`planner: revalidate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** A profile the caller just read or saved, so the pass below never re-fetches it from the database. */
type KnownProfile = { studentId: string; profile: StudentProfileData };

/**
 * One list's plan, read once, then both the suggestion sync (lib/planner/plan-view.ts autoWrites: the model's group
 * and round on every `auto` row that differs) and the task regeneration (lib/planner/tasks.ts mergeTasks) from that
 * single read — instead of the two independent full passes this replaced (each its own readPlan, profile fetch, and
 * generatorInputFor/planSchools build). The two sets of writes run in parallel; neither depends on the other's
 * result. `known`, when given and for this list's own student, skips the profile fetch entirely (the caller already
 * has it, usually because it just saved it). Returns how many rows changed across both. Never touches a `student`
 * row, an applied or decided college's round, or a task whose source is gone (it's marked orphaned instead).
 */
async function syncAndRegenerate(supabase: Supabase, listId: string, known?: KnownProfile): Promise<number> {
  // One call for the list's plan and its student's stored grad year when plan_bundle() is installed (fresh: this runs
  // after a write), alongside the profile (unless the caller has it) and the home; else readPlan and the grad-year
  // read, side by side.
  const [bundle, profiles, home] = await span("read", () =>
    Promise.all([freshPlanBundle(null, listId), known ? Promise.resolve(null) : profilesICanSee(), myHome()]),
  );
  let plan: PlanData | null;
  let stored: number | null = null;
  if (bundle) {
    plan = planDataFromBundle(bundle);
    stored = bundle.student?.grad_year ?? null;
  } else {
    plan = await span("readPlan", () => readPlan(supabase, listId));
    if (plan?.list.student_id) {
      const s = await supabase.from("students").select("grad_year").eq("id", plan.list.student_id).maybeSingle();
      stored = (s.data as { grad_year: number | null } | null)?.grad_year ?? null;
    }
  }
  if (!plan) return 0;
  let gradYear: number | null = null;
  let profile: StudentProfileData | null = null;
  if (plan.list.student_id) {
    if (known && known.studentId === plan.list.student_id) {
      profile = known.profile;
      gradYear = effectiveGradYear(profile.basics, stored);
    } else {
      const studentId = plan.list.student_id;
      const p = profiles ? (profiles.find((x) => x.student.id === studentId) ?? null) : await profileFor(studentId);
      gradYear = p ? effectiveGradYear(p.data.basics, stored) : stored;
      profile = p?.data ?? null;
    }
  }
  const today = todayIso();
  // The estimates feed both the suggestion sync and (next steps, review note 3) the generators, so they're computed
  // once, beside the dataset read (planEstimates returns {} at once for an empty list).
  const [input, estimates] = await Promise.all([
    span("planSchools", () => generatorInputFor(plan, { gradYear, profile, home, today })),
    span("estimates", () => planEstimates(profile, plan.items, { gradYear, today, visits: plan.visits })),
  ]);
  input.estimates = estimates;

  const jobs: Promise<number>[] = [];
  if (plan.items.length > 0 && !plan.sourcesMissing) {
    jobs.push(
      (async () => {
        const writes = autoWrites(planView({ items: plan.items, schools: input.schools, profile, estimates, today }));
        return writes.length > 0 ? writeAutoWrites(supabase, writes) : 0;
      })(),
    );
  }
  const merge = mergeTasks(plan.tasks, generateTasks(input));
  jobs.push(
    (async () => {
      const wrote = await writeMerge(supabase, listId, merge);
      return wrote ? merge.upserts.length + merge.orphans.length : 0;
    })(),
  );
  const totals = await Promise.all(jobs);
  return totals.reduce((a, b) => a + b, 0);
}

/**
 * Stores the model's group and round on every `auto` row of a list that differs, and regenerates its tasks. Also
 * runs on every plan open for editors (lib/planner/load.ts). A reader who can't edit writes nothing.
 */
export async function syncAuto(listId: string): Promise<PlanWriteResult & { changed?: number }> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  try {
    return { ok: true, changed: await syncAndRegenerate(r.supabase, listId) };
  } catch (err) {
    console.error(`planner: syncAuto failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, message: FAILED };
  }
}

/**
 * After a write: the suggestions and the tasks, for every affected list at once. `known`, when given, is the
 * profile the caller just read or saved for `listIds`' student — passed through so `syncAndRegenerate` never
 * re-reads from the database the profile the server action already has in memory.
 */
async function followUp(supabase: Supabase, listIds: string[], known?: KnownProfile): Promise<void> {
  await Promise.all(
    listIds.map(async (id) => {
      try {
        await syncAndRegenerate(supabase, id, known);
      } catch (err) {
        console.error(`planner: syncAuto failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
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

/** A round the student picks (theirs from then on), or null: "Use the starting round". Tasks follow the round. */
export async function setPlanRound(itemId: string, round: ListRound | null): Promise<PlanWriteResult> {
  const patch = roundPatch(round);
  if (!patch) return { ok: false, message: FAILED };
  return updateItem(itemId, patch, "setPlanRound");
}

/**
 * Marks (or clears) the Dream (the database itself moves the star off any other item: a trigger behind
 * `list_items_one_dream_idx`), then re-syncs the starting rounds the Dream decides and the tasks that follow them —
 * one combined pass (syncAndRegenerate), not the sync-then-regenerate-again chain this replaced.
 */
export async function setPlanDream(itemId: string, dream: boolean): Promise<PlanWriteResult> {
  if (!isUuid(itemId)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("list_items").update({ dream: Boolean(dream) }).eq("id", itemId).select("list_id");
  if (error) {
    console.error(`planner: setPlanDream failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  if (!data?.length) return { ok: false, message: NOT_EDITOR };
  const listId = (data[0] as { list_id: string }).list_id;
  try {
    await syncAndRegenerate(r.supabase, listId);
  } catch (err) {
    console.error(`planner: syncAndRegenerate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  refresh();
  return { ok: true };
}

/** Every list of a student (their groups and tasks follow their numbers and test dates). */
async function studentLists(supabase: Supabase, studentId: string): Promise<string[]> {
  const { data } = await supabase.from("lists").select("id").eq("student_id", studentId);
  return ((data ?? []) as { id: string }[]).map((l) => l.id);
}

/**
 * The shared base of the profile saves: read the profile with the caller's access (one call with the viewer bundle),
 * apply `change`, write it (one call with save_student_profile()), then the follow-up pass over every list of the
 * student. `background` (the intake's save; U20 "real speed"): the write is durable when the function returns, so the
 * follow-up runs after the response (lib/timing-server.ts afterResponse, Next's `after()`) instead of before it, and
 * the response carries no re-render: the intake moves on (Done, or back to the plan) with one navigation of its own,
 * whose render runs the same sync for the list it shows (lib/planner/load.ts). Without it (a test date, the numbers
 * form), the pass and the revalidation run before the response, as they always have.
 */
async function saveTheirProfile(
  studentId: string,
  change: (p: NonNullable<Awaited<ReturnType<typeof profileFor>>>) => { ok: true; data: unknown } | { ok: false; message: string },
  opts: { background?: boolean } = {},
): Promise<PlanWriteResult> {
  if (!isUuid(studentId)) return { ok: false, message: FAILED };
  return inRequestScope(() => saveTheirProfileNow(studentId, change, opts));
}

async function saveTheirProfileNow(
  studentId: string,
  change: (p: NonNullable<Awaited<ReturnType<typeof profileFor>>>) => { ok: true; data: unknown } | { ok: false; message: string },
  opts: { background?: boolean },
): Promise<PlanWriteResult> {
  const r = await span("auth", () => ready());
  if (!("supabase" in r)) return r;
  const profile = await span("profile read", () => profileFor(studentId));
  if (!profile) return { ok: false, message: FAILED };
  if (!profile.canEdit) return { ok: false, message: NOT_EDITOR };
  const next = change(profile);
  if (!next.ok) return next;
  const saved = await span("profile write", () => saveProfile(studentId, next.data));
  if (!saved.ok) return saved;
  // Sanitized exactly like saveProfile's own write, so this matches what the database now holds: the follow-up pass
  // reads the student's grad year fresh (with the plan) but never re-reads the profile itself.
  const known = { studentId, profile: sanitizeProfile(next.data) };
  const pass = async () => {
    const lists = await span("lists", () => studentLists(r.supabase, studentId));
    await followUp(r.supabase, lists, known);
  };
  if (opts.background) await afterResponse("followUp", pass);
  else await span("followUp", pass);
  return { ok: true };
}

/** The numbers form (standing.md "The numbers"): GPA and scale, which test, the score, and the practice flag. */
export async function setNumbers(studentId: string, numbers: PlanNumbers): Promise<PlanWriteResult> {
  const parsed = parseNumbers(numbers);
  if (!parsed) return { ok: false, message: "Check the numbers: one of them is out of range." };
  return saveTheirProfile(studentId, (p) => ({ ok: true, data: applyNumbers(p.data, parsed) }));
}

/**
 * The intake guide's one save (specs/planner/redesign/intake.md "Saving"): the class year, GPA and scale, the test, its
 * score, practice flag, and target, and the AP courses. Validated again here (parseIntakeSave). The class year goes on
 * the profile (`basics.gradYear`), and saveProfile keeps `students.grad_year` in step (the same column setGradYear
 * writes); the follow-up regenerates every list's tasks, as setGradYear does. A guardian's courses go through
 * mergeCoursesForSave, so exam scores the student keeps private survive and the privacy switch stays as saved.
 */
export async function saveIntake(studentId: string, input: IntakeSave): Promise<PlanWriteResult> {
  const parsed = parseIntakeSave(input);
  if (!parsed) return { ok: false, message: "Check your answers: one of them is out of range." };
  const today = todayIso();
  return withTiming(
    "/plan save",
    () =>
      saveTheirProfile(
        studentId,
        (p) => {
          const next = applyIntake(p.data, parsed, today);
          const merged = mergeCoursesForSave(
            { courses: p.data.academics.courses, apExamsPrivate: p.data.academics.apExamsPrivate },
            { courses: next.academics.courses, apExamsPrivate: next.academics.apExamsPrivate },
            p.relation,
          );
          return { ok: true, data: { ...next, academics: { ...next.academics, ...merged } } };
        },
        { background: true },
      ),
    { respond: true },
  );
}

/** "I'll take it" on a test date (scores.md "Test dates"), or undoing it; the cycle generator follows. */
export async function setPlannedDate(studentId: string, entryKey: string, on: boolean): Promise<PlanWriteResult> {
  return saveTheirProfile(studentId, (p) => {
    const t = togglePlannedDate(p.data, entryKey, Boolean(on));
    return t.ok ? { ok: true, data: t.profile } : t;
  });
}
