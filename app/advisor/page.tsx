import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PlanFrame } from "@/components/planner/PlanFrame";
import { PlanPeople, type PlanPerson, type PlanPersonDetail } from "@/components/planner/PlanPeople";
import { Splash } from "@/components/advisor/Splash";
import { authConfigured, getUser } from "@/lib/auth";
import { type PlanLoad, loadPlanFor, planViewer, type PlanChild } from "@/lib/planner/load";
import { resolveSelectedChild, type SwitchableChild } from "@/lib/planner/plan-frame";
import { profileProgress, SECTION_STEP } from "@/lib/planner/profile-progress";
import { recordHref, recordProgress, type RecordBack } from "@/lib/planner/record";
import { RecordInline } from "@/components/record/RecordInline";
import { defaultTab, parseTab, planHref, type PlanTab } from "@/lib/planner/plan-tabs";
import { ADVISOR_SHORT } from "@/lib/planner/advisor";
import { nowMoves, topMove } from "@/lib/planner/moves";
import { importanceFactsFrom } from "@/lib/planner/importance-facts";
import { withTiming } from "@/lib/timing-server";
import { planBundle } from "@/lib/bundles";
import { bundleKnownMissing } from "@/lib/bundle-read";
import { myHome } from "@/lib/home-store";
import { myLists } from "@/lib/lists";
import { essaysTabData } from "@/lib/essays/tab-data";
import type { EssaysTabData } from "@/lib/essays/tab-view";
import { isUuid } from "@/lib/planner/plan-writes";
import { profileFor, profilesICanSee } from "@/lib/student-profile-store";
import type { StudentProfileData } from "@/lib/student-profile";
import type { Season } from "@/lib/planner/seasons";

export const metadata: Metadata = { title: ADVISOR_SHORT };

/** Set by `PlanPeople.tsx` on every pick; read here so a guardian's next visit opens the same child (page.md
 * "Routes", decision 2026-10-11). A plain non-`httpOnly` cookie: a per-viewer convenience, nothing sensitive. */
const PLAN_CHILD_COOKIE = "plan_child";

const firstNameOf = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

/** "No list yet" / "not set up yet" / "can't see this" — the states loadPlanFor returns besides "ready". */
function planFallback(loaded: PlanLoad, first: string | null): ReactNode | null {
  if (loaded.kind === "ready") return null;
  if (loaded.kind === "empty") {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        <h2 className="font-display text-xl font-bold text-foreground">No list yet</h2>
        <p className="mt-1">{first ? `${first}'s advisor starts from their list.` : "Your advisor starts from your list."} Add colleges from Explore or any college&apos;s page to get started.</p>
      </section>
    );
  }
  if (loaded.kind === "setup-missing") {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        <h2 className="font-display text-xl font-bold text-foreground">Your advisor isn&apos;t set up yet</h2>
        <p className="mt-1">The planner&apos;s tables haven&apos;t been added to the database. The list still works.</p>
      </section>
    );
  }
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      That student&apos;s advisor isn&apos;t one you can see.
    </section>
  );
}

/**
 * The selected student's chip details on the people line: the profile-section count and ring (lib/planner/profile-
 * progress.ts) always, and for "Next:" the loaded plan's top move (next steps, seasons.md "The people line's
 * 'Next:'": `topMove(nowMoves(...))`) when there is one, so profile steps that became early-season moves still show
 * once, as a move rather than twice. Edit, for an editor. No GPA or test score (owner, 2026-10-12).
 */
function detailFor(load: PlanLoad | undefined, person: string | null): PlanPersonDetail | null {
  if (!load || load.kind !== "ready") return null;
  const { ctx, view } = load;
  const base = detailFrom(ctx.profile, ctx.viewer.canEdit, ctx.student?.id ?? person, person, ctx.season);
  const facts = importanceFactsFrom(ctx, view);
  const groups = nowMoves(ctx.tasks, { season: ctx.season, gradYear: ctx.gradYear, today: ctx.today, viewer: "student", facts });
  const move = topMove(groups);
  return { ...base, next: move ? { label: move.title, href: planHref({ person, tab: "next", move: move.id }) } : null };
}

/**
 * The chip details from a profile alone: what detailFor shows once the plan is loaded, for every child at once. The
 * ring reads the record's completeness (`recordProgress`, the overview's thirteen steps) rather than the fourteen-
 * section `profileProgress`, whose `next`/`nextLabel` still drive the "Next:" text and link (its own section order,
 * story and recommenders gated by `season` once R3 has it: the batched "every child at once" branch below has no
 * loaded plan yet, so no season there either, same as before). Edit opens the record overview, not the intake.
 */
function detailFrom(profile: StudentProfileData | null, canEdit: boolean, studentId: string | null, person: string | null, season?: Season): PlanPersonDetail {
  const progress = profileProgress(profile, { season });
  const record = recordProgress(profile);
  const where = progress.next ? SECTION_STEP[progress.next] : null;
  const nextHref = !canEdit || where === null ? null : planHref({ person, setup: true, step: where });
  return {
    progress: { done: record.done, total: record.total, nextLabel: progress.nextLabel },
    nextHref,
    // Edit expands the record on the plan page itself (owner, 2026-10-16), not the household's record page.
    editHref: canEdit ? recordHref({ person }) : null,
  };
}

/**
 * The Essays tab's read (specs/product/essays/tab.md "Files"): the drafts, links, and open-comment counts by the plan's
 * student, the picker's groups, and the prompt lookup, only when that tab is the one opening (the other tabs never pay
 * for it). A failed read leaves the tab on the plan's own `ctx.essays` (U1), logged, rather than failing the page.
 */
async function essaysFor(load: PlanLoad, tab: PlanTab | null, viewer: "student" | "guardian"): Promise<EssaysTabData | null> {
  if (tab !== "essays" || load.kind !== "ready") return null;
  try {
    return await essaysTabData(load.ctx, viewer);
  } catch (err) {
    console.error(`advisor: reading the essays tab failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The soonest open deadline still to meet on a ready plan (resolveSelectedChild's tie-breaker), or null. */
function nextDeadlineOf(load: PlanLoad | undefined): string | null {
  if (!load || load.kind !== "ready") return null;
  const today = load.ctx.today;
  const isos = load.view.rows
    .filter((r) => (r.item.status === "considering" || r.item.status === "applying") && !r.item.withdrawn_on && r.deadline !== null && r.deadline.iso >= today)
    .map((r) => r.deadline!.iso);
  return isos.sort()[0] ?? null;
}

/**
 * /advisor, formerly /plan (specs/product/advisor.md; specs/planner/redesign/page.md): one address for a student's own plan and for a parent's family. Signed
 * out: Quad Advisor's splash page (components/advisor/Splash.tsx; advisor.md "3. The page"). A student: their own plan, Colleges by default. A guardian
 * always lands on one child now (decision 2026-10-11, no Everyone): `?for=` when it names a real child, else the
 * last child viewed (the `plan_child` cookie), else the child with the soonest open deadline, else the first.
 * `?tab=` opens a tab (links, so back and forward work); an unrecognized or unavailable one falls back to the
 * viewer's default (PlanFrame reconciles that). `?setup=1` opens the intake guide in edit mode; `?record=1` means the
 * same thing (record/steps.md "Edit mode"), and `?step=n` (read by PlanIntake itself) opens it at a step; `?back=
 * plan|record` says where saving or closing it returns to (default the plan).
 */
export default async function PlanPage(props: { searchParams: Promise<{ for?: string; tab?: string; setup?: string; record?: string; step?: string; back?: string }> }) {
  await connection();
  return withTiming("/advisor", () => renderPlan(props));
}

async function renderPlan({
  searchParams,
}: {
  searchParams: Promise<{ for?: string; tab?: string; setup?: string; record?: string; step?: string; back?: string }>;
}) {
  if (!authConfigured()) return <AuthUnavailable />;
  const { for: forParam, tab: tabParam, setup: setupParam, record: recordParam, step: stepParam, back: backParam } = await searchParams;
  // `record=1` alone expands the record overview on this page (RecordInline; owner 2026-10-16); with `step=n` it opens
  // the tour at that step, as `setup=1` does.
  const recordInline = recordParam === "1" && !stepParam;
  const tab = parseTab(tabParam);
  // `record=1` means what `setup=1` means (record/steps.md "Edit mode"); `step` is additive and read by PlanIntake
  // itself via useSearchParams, so it needs no server-side parsing here.
  const setup = setupParam === "1" || (recordParam === "1" && !!stepParam);
  const back: RecordBack = backParam === "record" || backParam === "inline" ? backParam : "plan";

  const user = await getUser();
  if (!user) return <Splash />;

  // The plan most likely to be shown starts loading now, alongside who the viewer is (U20 "real speed"): the child
  // named by `?for=` or last viewed, else (null) the viewer's own. loadPlanFor uses it only if it's that student's.
  const cookieStore = await cookies();
  const lastViewed = cookieStore.get(PLAN_CHILD_COOKIE)?.value ?? null;
  const candidate = [forParam, lastViewed].find((id) => isUuid(id)) ?? null;
  const early = planBundle(candidate);
  // Without the batched reads (lib/bundles.ts), the reads every branch below needs start now too, so they share the
  // first round trip with the viewer's instead of waiting for it (each is memoized per request; a failure surfaces
  // where it's awaited).
  if (bundleKnownMissing("viewer_bundle")) {
    for (const warm of [profilesICanSee(), myHome(), candidate ? myLists({ kind: "student", id: candidate }) : null]) warm?.catch(() => {});
  }

  const viewer = await planViewer();
  if (viewer.kind === "self") {
    const loaded = await loadPlanFor(viewer.student.id, undefined, candidate === null ? { early } : {});
    const fallback = planFallback(loaded, null);
    if (fallback || loaded.kind !== "ready") return fallback;
    const self: PlanPerson = { studentId: null, name: loaded.ctx.student?.display_name ?? "You", gradYear: loaded.ctx.student?.grad_year ?? null, colorSlot: 0, href: planHref({}) };
    if (recordInline && loaded.ctx.viewer.canEdit) {
      const profile = await profileFor(viewer.student.id);
      if (profile) {
        return (
          <div className="space-y-6">
            <PlanPeople people={[self]} selected={null} detail={detailFor(loaded, null)} />
            <RecordInline profile={profile} plan={loaded} person={null} />
          </div>
        );
      }
    }
    const essays = await essaysFor(loaded, tab, "student");
    return (
      <PlanFrame
        people={<PlanPeople people={[self]} selected={null} detail={detailFor(loaded, null)} />}
        ctx={loaded.ctx}
        view={loaded.view}
        relation="self"
        firstName={null}
        colorSlot={0}
        personId={null}
        tab={tab ?? defaultTab("student", false)}
        setup={setup}
        back={back}
        essays={essays}
      />
    );
  }

  if (viewer.kind === "none") {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        No student yet. Add one from <Link href="/household" className="font-semibold text-primary hover:underline">Household</Link> to get started.
      </section>
    );
  }

  const { children } = viewer;
  // `?for=` or the last child viewed decides alone when it names a child: then only that child's plan is loaded (it
  // used to load every child's to compare deadlines). Only without either are all loaded, for the soonest deadline.
  const named = resolveSelectedChild({ forParam: forParam ?? null, children: children.map((c) => ({ studentId: c.studentId, nextDeadline: null })), lastViewed });
  const decided = named !== null && (named === forParam || named === lastViewed);
  const toLoad = decided ? children.filter((c) => c.studentId === named) : children;
  const [loads, profiles] = await Promise.all([Promise.all(toLoad.map((c) => loadPlanFor(c.studentId, undefined, c.studentId === candidate ? { early } : {}))), profilesICanSee()]);
  const byId = new Map<string, PlanLoad>(toLoad.map((c, i) => [c.studentId, loads[i]]));

  const switchable: SwitchableChild[] = children.map((c) => ({ studentId: c.studentId, nextDeadline: nextDeadlineOf(byId.get(c.studentId)) }));
  const selected = decided ? named : resolveSelectedChild({ forParam: forParam ?? null, children: switchable, lastViewed });

  // Every child, in roster order, as an initials circle (page.md "The people line"); the status text is gone.
  const people: PlanPerson[] = children.map((c) => ({ studentId: c.studentId, name: c.name, gradYear: c.gradYear, colorSlot: c.colorSlot, href: planHref({ person: c.studentId }) }));
  // Each child's chip details from their profile, so tapping a circle shows the chip and Edit at once (PlanPeople,
  // app/advisor/loading.tsx) while that child's plan loads.
  const profileOf = new Map(profiles.map((p) => [p.student.id, p]));
  const details: Record<string, PlanPersonDetail> = Object.fromEntries(
    children.map((c) => {
      const p = profileOf.get(c.studentId);
      return [c.studentId, detailFrom(p?.data ?? null, p?.canEdit ?? c.canEdit, c.studentId, c.studentId)];
    }),
  );

  if (selected === null) {
    // No children on the roster (defensive: planViewer only returns "guardian" when there's at least one).
    return <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">No plans to show yet.</section>;
  }

  const meta = children.find((c) => c.studentId === selected) as PlanChild;
  const load = byId.get(selected)!;
  const fallback = planFallback(load, firstNameOf(meta.name));
  const line = <PlanPeople people={people} selected={selected} detail={detailFor(load, selected)} details={details} />;
  if (fallback || load.kind !== "ready") {
    return (
      <div className="space-y-6">
        {line}
        {fallback}
      </div>
    );
  }
  if (recordInline) {
    const profile = await profileFor(selected);
    if (profile) {
      return (
        <div className="space-y-6">
          {line}
          <RecordInline profile={profile} plan={load} person={selected} />
        </div>
      );
    }
  }
  const essays = await essaysFor(load, tab, "guardian");
  return (
    <PlanFrame
      people={line}
      ctx={load.ctx}
      view={load.view}
      relation="guardian"
      firstName={firstNameOf(meta.name)}
      colorSlot={meta.colorSlot}
      personId={selected}
      tab={tab ?? defaultTab("guardian", false)}
      setup={setup}
      back={back}
      essays={essays}
    />
  );
}
