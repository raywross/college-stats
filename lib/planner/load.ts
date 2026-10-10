import "server-only";
/**
 * Loads a student's plan for the signed-in viewer (specs/planner/redesign/build-plan.md "Multi-child loading"):
 * the list, the plan read with the viewer's session (row-level security decides), the suggested groups and rounds
 * written for an editor (syncAuto), the regenerated tasks, the PlanContext, and the view model every tab reads
 * (lib/planner/plan-view.ts). Also the children a parent can switch between, with their color slots.
 *
 * Server only (not a "use server" module): the Plan pages call it while rendering; the browser never does.
 */
import { currentStudent, getAccount, studentsICanSee } from "@/lib/auth";
import type { StudentAccess } from "@/lib/accounts";
import { myHouseholds, scheduleStudentReadLog } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { getOrCreateDefaultList, myLists } from "@/lib/lists";
import { createServerSupabase } from "@/lib/supabase-server";
import { profileFor } from "@/lib/student-profile-store";
import { effectiveGradYear } from "@/lib/student-profile";
import { generatorInputFor, planContextFrom, PlannerSetupError, readItems, readPlan, readTasks, todayIso, writeAutoWrites, writeMerge } from "./context";
import { autoWrites, planView, type PlanView } from "./plan-view";
import { generateTasks, mergeTasks } from "./tasks";
import type { PlanContext } from "./types";

export type PlanLoad =
  /** The plan, ready for the tabs. */
  | { kind: "ready"; ctx: PlanContext; view: PlanView; access: StudentAccess }
  /** No list yet (and the viewer can't start one), or the list isn't readable. */
  | { kind: "empty"; access: StudentAccess }
  /** The planner's tables aren't in the database yet. */
  | { kind: "setup-missing"; access: StudentAccess }
  /** The viewer can't see this student. */
  | { kind: "not-found" };

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/**
 * One student's plan as the signed-in user sees it. `viewer` is the viewer's access to the student when the page
 * already resolved it (a person page); otherwise it's looked up. A guardian's read is logged for the student. An
 * editor's open writes the suggested groups and rounds that changed (plan-view.ts autoWrites, only `auto` rows) and
 * regenerates the tasks (cheap and idempotent), so a data publish or new numbers show up on the next open.
 */
export async function loadPlanFor(studentId: string, viewer?: StudentAccess | null): Promise<PlanLoad> {
  const access = viewer ?? (await studentsICanSee()).find((a) => a.student.id === studentId) ?? null;
  if (!access || access.student.id !== studentId) return { kind: "not-found" };
  const { student, canEdit, relation } = access;
  const owner = { kind: "student" as const, id: student.id };
  const lists = await myLists(owner);
  let listId: string | null = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
  if (!listId && canEdit) listId = (await getOrCreateDefaultList(owner))?.id ?? null;
  if (!listId) return { kind: "empty", access };

  const supabase = await createServerSupabase();
  const [account, profile, home] = await Promise.all([getAccount(), profileFor(student.id), myHome()]);
  if (relation === "guardian") await scheduleStudentReadLog(student.id, "plan_tasks");
  const gradYear = profile ? effectiveGradYear(profile.data.basics, student.grad_year) : student.grad_year;
  const today = todayIso();
  const profileData = profile?.data ?? null;

  let plan;
  try {
    plan = await readPlan(supabase, listId);
  } catch (err) {
    if (err instanceof PlannerSetupError) return { kind: "setup-missing", access };
    throw err;
  }
  if (!plan) return { kind: "empty", access };

  let input = await generatorInputFor(plan, { gradYear, profile: profileData, home, today });

  // Suggested until changed: store the model's group and round on every `auto` row that differs (syncAuto).
  if (canEdit) {
    // Before the redesign migration the source columns don't exist: show the suggestions, write none of them.
    const writes = plan.sourcesMissing ? [] : autoWrites(planView({ items: plan.items, schools: input.schools, profile: profileData, today }));
    if (writes.length > 0 && (await writeAutoWrites(supabase, writes)) > 0) {
      const fresh = await readItems(supabase, listId);
      if (fresh.data) {
        plan = { ...plan, items: fresh.data };
        input = { ...input, items: fresh.data };
      }
    }
    if (await writeMerge(supabase, listId, mergeTasks(plan.tasks, generateTasks(input)))) {
      plan = { ...plan, tasks: await readTasks(supabase, listId) };
    }
  }

  const ctx = planContextFrom(input, plan, {
    student: { id: student.id, display_name: student.display_name, grad_year: gradYear, user_id: student.user_id },
    home,
    viewer: {
      userId: account?.user.id ?? "",
      firstName: firstName(account?.profile.display_name),
      canEdit,
      relation: relation === "self" ? "self" : "guardian",
      isGuardian: relation === "guardian",
    },
  });
  const view = planView({ items: ctx.items, schools: ctx.schools, profile: ctx.profile, today });
  return { kind: "ready", ctx, view, access };
}

/** A child a parent can switch to (page.md "The child switcher"). */
export interface PlanChild {
  studentId: string;
  /** The student's display name (first word for the pill is the caller's choice). */
  name: string | null;
  gradYear: number | null;
  /** Household color slot, in the order the children were added (KID_VARS in lib/planner/colors.ts). */
  colorSlot: 0 | 1 | 2;
  canEdit: boolean;
}

/**
 * The students the signed-in user can see as a guardian, in the order they were added to the household (the roster's
 * join date), each with a color slot. A student viewing their own plan gets none (they aren't anyone's guardian).
 */
export async function myPlanChildren(): Promise<PlanChild[]> {
  const [access, households] = await Promise.all([studentsICanSee(), myHouseholds()]);
  const asGuardian = access.filter((a) => a.relation === "guardian");
  if (asGuardian.length === 0) return [];
  const joined = new Map<string, string>();
  for (const m of households.flatMap((h) => h.members)) {
    if (m.role === "student" && m.student_id && !joined.has(m.student_id)) joined.set(m.student_id, m.joined);
  }
  const sorted = [...asGuardian].sort((a, b) => {
    const ja = joined.get(a.student.id) ?? a.student.created;
    const jb = joined.get(b.student.id) ?? b.student.created;
    return ja.localeCompare(jb) || a.student.id.localeCompare(b.student.id);
  });
  return sorted.map((a, i) => ({
    studentId: a.student.id,
    name: a.student.display_name,
    gradYear: a.student.grad_year,
    colorSlot: (i % 3) as 0 | 1 | 2,
    canEdit: a.canEdit,
  }));
}

export type PlanViewer =
  | { kind: "guardian"; children: PlanChild[] }
  | { kind: "self"; student: { id: string; display_name: string | null } }
  | { kind: "none" };

/**
 * Who /plan is for. A guardian of any student gets the family view first: `currentStudent()` creates an empty student
 * record for an account whose role hint is missing or "student" (lib/accounts.ts wantsOwnStudent), and the sign-up
 * form defaults to "student", so a parent who never switched it would otherwise land on their own empty plan (found
 * in browser QA 2026-10-10). Only someone who is nobody's guardian gets their own plan, and only then is
 * `currentStudent()` called.
 */
export async function planViewer(): Promise<PlanViewer> {
  const children = await myPlanChildren();
  if (children.length > 0) return { kind: "guardian", children };
  const self = await currentStudent();
  return self ? { kind: "self", student: { id: self.id, display_name: self.display_name } } : { kind: "none" };
}
