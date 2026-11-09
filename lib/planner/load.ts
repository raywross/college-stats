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
import { householdChildren, scheduleStudentReadLog } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { getOrCreateDefaultList, myLists } from "@/lib/lists";
import { createServerSupabase } from "@/lib/supabase-server";
import { profileFor } from "@/lib/student-profile-store";
import { effectiveGradYear, type StudentProfileData } from "@/lib/student-profile";
import { after } from "next/server";
import { openAsksForStudent } from "@/lib/orgs";
import { splitAsks } from "@/lib/org-caseload";
import type { OpenOrgAsk } from "@/lib/org-rules";
import { readOffers, type OffersRead } from "./offers-server";
import { hasDecision } from "./plan-tabs";
import { generatorInputFor, planContextFrom, PlannerSetupError, readItems, readPlan, readTasks, writeAutoWrites, writeMerge } from "./context";
import { autoWrites, planView, type PlanView } from "./plan-view";
import { planEstimates, startEstimateContext } from "./plan-estimates";
import { afterOne } from "./load-waves";
import { appSettings } from "./settings-server";
import { readEssayOverrides } from "@/lib/essays/overrides";
import type { CiteMode } from "./plan-cites";
import { generateTasks, mergeTasks } from "./tasks";
import type { PlanContext } from "./types";
import type { Season } from "./seasons";
import { coursePlanViewFor } from "@/lib/chances/course-plan-server";
import { inRegistrationWindow } from "@/lib/chances/course-plan-view";
import { span } from "@/lib/timing";
import { planBundle, type PlanBundle } from "@/lib/bundles";
import { bundleKnownMissing, planDataFromBundle } from "@/lib/bundle-read";
import { readPlanEssays, type PlanData } from "./read-plan";
import { isParent } from "@/lib/viewer-relation";
import { isUuid } from "./plan-writes";
import { plannerToday } from "./today-server";

export type PlanLoad =
  /** The plan, ready for the tabs. `tabs` is what the advisor's panels read besides it, when asked for (`opts.tabs`). */
  | { kind: "ready"; ctx: PlanContext; view: PlanView; access: StudentAccess; tabs?: PlanTabsRead }
  /** No list yet (and the viewer can't start one), or the list isn't readable. */
  | { kind: "empty"; access: StudentAccess }
  /** The planner's tables aren't in the database yet. */
  | { kind: "setup-missing"; access: StudentAccess }
  /** The viewer can't see this student. */
  | { kind: "not-found" };

/**
 * What the advisor's tab panels read besides the plan (round 5; specs/planner/redesign/page.md "Tabs switch in place"),
 * read with it so every panel renders from the load and the tabs switch in place. Kept out of `ctx`, which the client
 * components receive.
 */
export interface PlanTabsRead {
  /** The Offers stage's reads (lib/planner/offers-server.ts readOffers): only when the plan has a decision (the tab's
   * own gate, plan-tabs.ts hasDecision); null without one, or when the read failed (the stage then reads itself). */
  offers: OffersRead | null;
  /** The open asks the notice above Next steps shows (components/org/AskNotice.tsx), the satisfied ones already
   * closed; null for a counselor (who reads asks on the caseload) or a failed read (no notice, as before). */
  asks: OpenOrgAsk[] | null;
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** The Offers stage's reads when the plan has a decision, else null; fails soft (logged, null). */
function offersFor(supabase: Awaited<ReturnType<typeof createServerSupabase>>, plan: PlanData, profile: StudentProfileData | null): Promise<OffersRead | null> {
  if (!hasDecision(plan.items)) return Promise.resolve(null);
  return readOffers(supabase, plan, profile).catch((err) => {
    console.error(`plan: reading the offers stage failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
}

/** The student's open asks with the viewer's session; null on a failed read (no notice, never a broken plan). */
function asksFor(studentId: string): Promise<OpenOrgAsk[] | null> {
  return openAsksForStudent(studentId).catch((err) => {
    console.error(`org: reading the open asks failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
}

/**
 * The asks the notice shows: the open ones minus those the plan's facts already satisfy, which are closed after the
 * response (org_ask_done; the notice "checks when it renders", specs/product/counselor-portal.md). Marking the shown
 * ones seen is the browser's (components/org/MarkAsksSeen.tsx), the first time Next steps shows.
 */
function shownAsks(asks: OpenOrgAsk[], supabase: Awaited<ReturnType<typeof createServerSupabase>>, facts: Parameters<typeof splitAsks>[1]): OpenOrgAsk[] {
  const { done, shown } = splitAsks(asks, facts);
  if (done.length > 0) {
    const close = async () => {
      for (const a of done) {
        const { error } = await supabase.rpc("org_ask_done", { p_request: a.id });
        if (error) console.error(`org: org_ask_done failed: ${error.message}`);
      }
    };
    try {
      after(close);
    } catch {
      void close().catch(() => {});
    }
  }
  return shown;
}

/**
 * The course-plan card's windows (specs/chances/course-plan.md; next-steps U1b): freshman and sophomore only in the
 * usual registration season (February–April), junior winter always (its own window runs into April; cheap to check
 * here, kept cheap by skipping the read entirely outside these seasons rather than computing it and hiding the card).
 */
function inCoursePlanWindow(season: Season, today: string): boolean {
  if (season === "junior_winter") return true;
  return (season === "freshman" || season === "sophomore") && inRegistrationWindow(today);
}

/**
 * One student's plan as the signed-in user sees it. `viewer` is the viewer's access to the student when the page
 * already resolved it (a person page); otherwise it's looked up. A guardian's read is logged for the student. An
 * editor's open writes the suggested groups and rounds that changed (plan-view.ts autoWrites, only `auto` rows) and
 * regenerates the tasks (cheap and idempotent), so a data publish or new numbers show up on the next open.
 *
 * U20 "real speed": every read that doesn't depend on another starts at once. With the batched reads installed
 * (supabase/migrations/20261012140000_plan_bundle.sql) that is two calls side by side, the viewer bundle (access,
 * account, profile, home) and the plan bundle (the student's default list and its whole plan); `early` is a plan
 * bundle the page already started for this student. Without them, the per-table reads, in two waves instead of
 * five. `cites`: the colleges' citations are references the ⓘ fetches on open unless `"full"` (the print page only;
 * lib/planner/context.ts planSchoolFor).
 *
 * Two database waves for a reader (specs/serving-architecture.md "Left, after this PR"; build-plan.md "Multi-child
 * loading"). Wave 1 starts everything that needs only the ids: the plan bundle, the viewer bundle (studentsICanSee,
 * getAccount), the student's profile, home, the planner's settings (settings-server.ts appSettings: pretend today and
 * the all-moves preview in one read), the student's essays with their links, open comments, and suggestions
 * (read-plan.ts readPlanEssays), and the open cycle's hand-read prompts (lib/essays/overrides.ts, the one read planSchools
 * and the Essays tab's prompt lookup share). Wave 2 is the estimate's high-school reads, chained on the profile alone
 * (load-waves.ts afterOne), so they start the moment it resolves. Nothing else reads after that; an editor's open still
 * writes the suggested groups, rounds, and tasks when they changed (syncOnOpen).
 *
 * `tabs` (round 5, the advisor page): also what its tab panels read besides the plan (PlanTabsRead), so every tab
 * switches in place: the open asks in wave 1, and the Offers stage's reads chained on the bundle and the profile, only
 * when the plan has a decision. Neither adds a wave.
 */
export async function loadPlanFor(
  studentId: string,
  viewer?: StudentAccess | null,
  opts: { early?: Promise<PlanBundle | null>; cites?: CiteMode; tabs?: boolean } = {},
): Promise<PlanLoad> {
  const owner = { kind: "student" as const, id: studentId };
  const bundleP = (async () => {
    const early = opts.early ? await opts.early : null;
    return early && early.student?.id === studentId ? early : planBundle(studentId);
  })();
  // Without the bundle (known missing a moment ago), the lists read starts in the first wave too.
  const listsP = bundleKnownMissing("plan_bundle") ? myLists(owner) : null;
  // Essays, part 4 (specs/product/essays/moves.md): the student's drafts and links ride in the first wave beside the
  // plan bundle, with their open comments and suggestions for the Essays tab's counts (row-level security decides who
  // reads them); null without the tables.
  const supabaseP = createServerSupabase();
  const essaysP = supabaseP.then((s) => readPlanEssays(s, studentId)).catch(() => null);
  const profileP = profileFor(studentId);
  // Wave 2, started as soon as the profile resolves (not the whole first wave): the estimate's high-school reads.
  const estimateContextP = afterOne(profileP, (p) => startEstimateContext(p?.data ?? null));
  // Round 5, the tab panels' own reads (`opts.tabs`, the advisor page; PlanTabsRead): the student's open asks in this
  // wave (not for a counselor, who never sees the notice), and the Offers stage's reads chained on the plan bundle and
  // the profile alone (afterOne), so they start the moment those two resolve, run beside the colleges and the
  // estimate, and only when the plan has a decision. `undefined`: no bundle, so they wait for the per-table plan read.
  const asksP = opts.tabs && viewer?.relation !== "counselor" ? asksFor(studentId) : Promise.resolve(null);
  const offersEarlyP = opts.tabs
    ? afterOne(Promise.all([bundleP, profileP, supabaseP]), ([b, p, s]) => {
        const fromBundle = b?.list ? planDataFromBundle(b) : null;
        return fromBundle ? offersFor(s, fromBundle, p?.data ?? null) : Promise.resolve(undefined);
      })
    : null;
  const [accessList, account, profile, home, bundle, , , , asks] = await span("access+plan", () =>
    Promise.all([viewer ? Promise.resolve(null) : studentsICanSee(), getAccount(), profileP, myHome(), bundleP, essaysP, appSettings(), readEssayOverrides(null), asksP]),
  );
  const access = viewer ?? accessList?.find((a) => a.student.id === studentId) ?? null;
  if (!access || access.student.id !== studentId) return { kind: "not-found" };
  const { student, canEdit, relation } = access;
  const supabase = await supabaseP;

  let plan: PlanData | null = null;
  let listId: string | null = bundle?.list?.id ?? null;
  if (bundle && listId) {
    const fromBundle = planDataFromBundle(bundle);
    plan = fromBundle ? { ...fromBundle, essays: await essaysP } : null;
  } else {
    if (!bundle) {
      const lists = await span("lists", () => listsP ?? myLists(owner));
      listId = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
    }
    if (!listId && canEdit) listId = (await getOrCreateDefaultList(owner))?.id ?? null;
  }
  if (!listId) return { kind: "empty", access };

  // A parent's or a counselor's read is logged for the student (lib/viewer-relation.ts isViewer).
  if (relation !== "self") await scheduleStudentReadLog(student.id, "plan_tasks");
  const gradYear = profile ? effectiveGradYear(profile.data.basics, student.grad_year) : student.grad_year;
  const today = await plannerToday();
  const profileData = profile?.data ?? null;

  if (!plan) {
    try {
      const id = listId;
      plan = await span("readPlan", () => readPlan(supabase, id, { essays: essaysP }));
    } catch (err) {
      if (err instanceof PlannerSetupError) return { kind: "setup-missing", access };
      throw err;
    }
  }
  if (!plan) return { kind: "empty", access };


  const read = plan;
  // Quad's estimate for every college, on the server (specs/chances/estimate.md "In the planner"): the same for the
  // student and a guardian, who sees the student's AP exam scores too (owner, 2026-10-11). Beside the school slices; its
  // high-school reads started with the profile (estimateContextP), so here it only waits for what's left of them.
  // The Offers stage's reads (round 5), already running since the bundle resolved; without the bundle, started now.
  const offersP: Promise<OffersRead | null> =
    offersEarlyP === null ? Promise.resolve(null) : offersEarlyP.then((early) => (early !== undefined ? early : offersFor(supabase, read, profileData))).catch(() => null);
  const [schoolsInput, estimates, offers] = await Promise.all([
    span("planSchools", () => generatorInputFor(read, { gradYear, profile: profileData, home, today, cites: opts.cites })),
    span("estimates", () => planEstimates(profileData, read.items, { gradYear, today, visits: read.visits, context: estimateContextP })),
    offersP,
  ]);
  let input = schoolsInput;
  // Next steps (build-plan.md review note 3): the generators read each college's level, closeness, and ED verdict.
  input = { ...input, estimates };

  // Suggested until changed: store the model's group and round on every `auto` row that differs (syncAuto).
  if (canEdit) {
    const synced = await span("sync", () => syncOnOpen(supabase, listId, read, input, { profile: profileData, estimates, today }));
    plan = synced.plan;
    input = synced.input;
  }

  const ctx = planContextFrom(input, plan, {
    student: { id: student.id, display_name: student.display_name, grad_year: gradYear, user_id: student.user_id },
    home,
    viewer: {
      userId: account?.user.id ?? "",
      firstName: firstName(account?.profile.display_name),
      canEdit,
      relation,
      isGuardian: isParent(relation),
      isCounselor: relation === "counselor",
    },
  });
  const view = planView({ items: ctx.items, schools: ctx.schools, profile: ctx.profile, estimates, today });
  // No `rigor` or estimate fact citations any more: their only reader was the Scores tab's Courses section, removed
  // (owner, 2026-10-12; specs/planner/redesign/list.md). `coursePlan` is filled again (next steps U1b) for the
  // playbook's course-choice card (NextYearCard.tsx), only in the seasons that card shows, and only with a profile.
  const coursePlan =
    profileData && inCoursePlanWindow(input.season, today)
      ? await span("coursePlan", () => coursePlanViewFor({ profile: profileData, gradYear, items: ctx.items, today, canEdit }))
      : null;
  const tabs: PlanTabsRead | undefined = opts.tabs
    ? { offers, asks: asks && !ctx.viewer.isCounselor ? shownAsks(asks, supabase, { profile: ctx.profile, listCount: ctx.items.length }) : null }
    : undefined;
  return { kind: "ready", ctx: { ...ctx, coursePlan }, view, access, ...(tabs ? { tabs } : {}) };
}

/**
 * An editor's open: store the model's group and round on every `auto` row that differs (syncAuto), re-reading the
 * items when any changed, then merge the regenerated tasks, re-reading them when any were written.
 */
async function syncOnOpen(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  listId: string,
  plan: NonNullable<Awaited<ReturnType<typeof readPlan>>>,
  input: Awaited<ReturnType<typeof generatorInputFor>>,
  opts: { profile: Parameters<typeof planView>[0]["profile"]; estimates: Parameters<typeof planView>[0]["estimates"]; today: string },
) {
  // Before the redesign migration the source columns don't exist: show the suggestions, write none of them.
  const writes = plan.sourcesMissing ? [] : autoWrites(planView({ items: plan.items, schools: input.schools, profile: opts.profile, estimates: opts.estimates, today: opts.today }));
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
  return { plan, input };
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
 * The students the signed-in user can see as a guardian through their household (householdChildren: on its roster),
 * in the order they were added to it (the roster's join date), each with a color slot. A student viewing their own plan gets none (they aren't anyone's guardian).
 */
export async function myPlanChildren(): Promise<PlanChild[]> {
  const sorted = (await householdChildren())
    .sort((a, b) => a.joined.localeCompare(b.joined) || a.access.student.id.localeCompare(b.access.student.id))
    .map((c) => c.access);
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
/**
 * A counselor's `?for=` (specs/product/counselor-portal.md "A student": `/advisor?for=<id>` opens for a counselor as
 * it does for a parent): the student it names when the viewer reaches them through a counselor grant, else null. A
 * student reached both ways resolves to "guardian" (lib/accounts.ts resolveStudentAccess: the family's grant wins), so
 * a parent's own child never takes this path. The advisor, its guides, its print page, and the essays pages check this
 * before planViewer(), which only knows the household.
 */
export async function counselorAccessFor(forParam: string | null | undefined): Promise<StudentAccess | null> {
  if (!isUuid(forParam)) return null;
  const access = (await studentsICanSee()).find((a) => a.student.id === forParam);
  return access?.relation === "counselor" ? access : null;
}

export async function planViewer(): Promise<PlanViewer> {
  const children = await myPlanChildren();
  if (children.length > 0) return { kind: "guardian", children };
  const self = await currentStudent();
  return self ? { kind: "self", student: { id: self.id, display_name: self.display_name } } : { kind: "none" };
}
