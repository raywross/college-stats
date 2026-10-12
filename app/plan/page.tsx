import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PlanFrame } from "@/components/planner/PlanFrame";
import { PlanPeople, type PlanPerson, type PlanPersonDetail } from "@/components/planner/PlanPeople";
import SignedOutPlan from "@/components/planner/SignedOutPlan";
import { authConfigured, getUser } from "@/lib/auth";
import { type PlanLoad, loadPlanFor, planViewer, type PlanChild } from "@/lib/planner/load";
import { resolveSelectedChild, type SwitchableChild } from "@/lib/planner/plan-frame";
import { profileProgress, SECTION_STEP } from "@/lib/planner/profile-progress";
import { defaultTab, parseTab, planHref } from "@/lib/planner/plan-tabs";

export const metadata: Metadata = { title: "Plan" };

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
        <p className="mt-1">The plan starts from {first ? `${first}'s` : "the"} list. Add colleges from Explore or any college&apos;s page to get started.</p>
      </section>
    );
  }
  if (loaded.kind === "setup-missing") {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        <h2 className="font-display text-xl font-bold text-foreground">The plan isn&apos;t set up yet</h2>
        <p className="mt-1">The planner&apos;s tables haven&apos;t been added to the database. The list still works.</p>
      </section>
    );
  }
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      That plan isn&apos;t one you can see.
    </section>
  );
}

/**
 * The selected student's chip details on the people line: a plain count of their profile sections with the one next
 * step (lib/planner/profile-progress.ts), linking to the intake on that step (or the Numbers page for major and state),
 * and Edit, for an editor. No GPA or test score (owner, 2026-10-12).
 */
function detailFor(load: PlanLoad | undefined, person: string | null): PlanPersonDetail | null {
  if (!load || load.kind !== "ready") return null;
  const { ctx } = load;
  const progress = profileProgress(ctx.profile);
  const canEdit = ctx.viewer.canEdit;
  const where = progress.next ? SECTION_STEP[progress.next] : null;
  const studentId = ctx.student?.id ?? person;
  const nextHref =
    !canEdit || where === null ? null : where === "numbers" ? (studentId ? `/household/${studentId}/numbers` : null) : planHref({ person, setup: true, step: where });
  return { progress, nextHref, editHref: canEdit ? planHref({ person, setup: true }) : null };
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
 * /plan (specs/planner/redesign/page.md): one address for a student's own plan and for a parent's family. Signed
 * out: the pitch and the numbers step (SignedOutPlan). A student: their own plan, Colleges by default. A guardian
 * always lands on one child now (decision 2026-10-11, no Everyone): `?for=` when it names a real child, else the
 * last child viewed (the `plan_child` cookie), else the child with the soonest open deadline, else the first.
 * `?tab=` opens a tab (links, so back and forward work); an unrecognized or unavailable one falls back to the
 * viewer's default (PlanFrame reconciles that). `?setup=1` opens the intake guide in edit mode.
 */
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ for?: string; tab?: string; setup?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { for: forParam, tab: tabParam, setup: setupParam } = await searchParams;
  const tab = parseTab(tabParam);
  const setup = setupParam === "1";

  const user = await getUser();
  if (!user) return <SignedOutPlan />;

  const viewer = await planViewer();
  if (viewer.kind === "self") {
    const loaded = await loadPlanFor(viewer.student.id);
    const fallback = planFallback(loaded, null);
    if (fallback || loaded.kind !== "ready") return fallback;
    const self: PlanPerson = { studentId: null, name: loaded.ctx.student?.display_name ?? "You", gradYear: loaded.ctx.student?.grad_year ?? null, colorSlot: 0, href: "/plan" };
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
      />
    );
  }

  if (viewer.kind === "none") {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        No student yet. Add one from <Link href="/household" className="font-semibold text-primary hover:underline">Household</Link> to start a plan.
      </section>
    );
  }

  const { children } = viewer;
  const loads = await Promise.all(children.map((c) => loadPlanFor(c.studentId)));
  const byId = new Map<string, PlanLoad>(children.map((c, i) => [c.studentId, loads[i]]));

  const switchable: SwitchableChild[] = children.map((c) => ({ studentId: c.studentId, nextDeadline: nextDeadlineOf(byId.get(c.studentId)) }));
  const cookieStore = await cookies();
  const lastViewed = cookieStore.get(PLAN_CHILD_COOKIE)?.value ?? null;
  const selected = resolveSelectedChild({ forParam: forParam ?? null, children: switchable, lastViewed });

  // Every child, in roster order, as an initials circle (page.md "The people line"); the status text is gone.
  const people: PlanPerson[] = children.map((c) => ({ studentId: c.studentId, name: c.name, gradYear: c.gradYear, colorSlot: c.colorSlot, href: planHref({ person: c.studentId }) }));

  if (selected === null) {
    // No children on the roster (defensive: planViewer only returns "guardian" when there's at least one).
    return <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">No plans to show yet.</section>;
  }

  const meta = children.find((c) => c.studentId === selected) as PlanChild;
  const load = byId.get(selected)!;
  const fallback = planFallback(load, firstNameOf(meta.name));
  const line = <PlanPeople people={people} selected={selected} detail={detailFor(load, selected)} />;
  if (fallback || load.kind !== "ready") {
    return (
      <div className="space-y-6">
        {line}
        {fallback}
      </div>
    );
  }
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
    />
  );
}
