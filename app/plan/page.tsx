import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { ChildSwitcher, type SwitcherChild } from "@/components/planner/ChildSwitcher";
import FamilyCalendar from "@/components/planner/FamilyCalendar";
import { PlanFrame } from "@/components/planner/PlanFrame";
import { PlanOpened } from "@/components/planner/PlanOpened";
import SignedOutPlan from "@/components/planner/SignedOutPlan";
import type { CalendarChild } from "@/components/planner/tabs/types";
import { authConfigured, getUser } from "@/lib/auth";
import { KID_VARS } from "@/lib/planner/colors";
import { type PlanLoad, loadPlanFor, planViewer, type PlanChild } from "@/lib/planner/load";
import { resolveSelectedChild, shortSummaryLine } from "@/lib/planner/plan-frame";
import { defaultTab, parseTab } from "@/lib/planner/plan-tabs";
import { summaryLine } from "@/lib/planner/summary";

export const metadata: Metadata = { title: "Plan" };

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

function summaryFor(load: Extract<PlanLoad, { kind: "ready" }>): string {
  const { ctx } = load;
  return summaryLine({ current: ctx.current, stages: ctx.stages, tasks: ctx.tasks, items: ctx.items, schools: ctx.schools, visits: ctx.visits, today: ctx.today });
}

/**
 * /plan (specs/planner/redesign/page.md): one address for a student's own plan and for a parent's family. Signed
 * out: the pitch and the numbers step (SignedOutPlan, U7). A student: their own plan, Colleges by default. A
 * guardian: the child switcher, defaulting to Everyone's calendar, or `?for=` for one child. `?tab=` opens a tab
 * (links, so back and forward work); an unrecognized or unavailable one falls back to the viewer's default
 * (PlanFrame reconciles that for a selected child; here for Everyone, which is always the calendar).
 */
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ for?: string; tab?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { for: forParam, tab: tabParam } = await searchParams;
  const tab = parseTab(tabParam);

  const user = await getUser();
  if (!user) return <SignedOutPlan />;

  const viewer = await planViewer();
  if (viewer.kind === "self") {
    const loaded = await loadPlanFor(viewer.student.id);
    const fallback = planFallback(loaded, null);
    if (fallback || loaded.kind !== "ready") return fallback;
    return (
      <PlanFrame
        ctx={loaded.ctx}
        view={loaded.view}
        relation="self"
        firstName={null}
        color={KID_VARS[0]}
        colorSlot={0}
        personId={null}
        tab={tab ?? defaultTab("student", false)}
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
  const forExplicit = typeof forParam === "string" && children.some((c) => c.studentId === forParam);
  const selected = resolveSelectedChild({ forParam: forParam ?? null, children });
  const loads = await Promise.all(children.map((c) => loadPlanFor(c.studentId)));
  const byId = new Map<string, PlanLoad>(children.map((c, i) => [c.studentId, loads[i]]));

  const switcherChildren: SwitcherChild[] = children.flatMap((c) => {
    const load = byId.get(c.studentId);
    if (!load || load.kind !== "ready") return [];
    return [{ studentId: c.studentId, name: c.name, gradYear: c.gradYear, colorSlot: c.colorSlot, summary: shortSummaryLine(summaryFor(load)) }];
  });

  if (selected === null) {
    // Everyone: the calendar across every child (page.md "The child switcher").
    const calendarChildren: CalendarChild[] = children.flatMap((c) => {
      const load = byId.get(c.studentId);
      if (!load || load.kind !== "ready") return [];
      return [{ studentId: c.studentId, name: c.name ?? "Student", colorSlot: c.colorSlot, ring: false, gradYear: c.gradYear, ctx: load.ctx, view: load.view }];
    });
    return (
      <div className="space-y-6">
        <PlanOpened tab="calendar" viewer="guardian" everyone />
        <ChildSwitcher kids={switcherChildren} selected={null} forExplicit={forExplicit} />
        {calendarChildren.length === 0 ? (
          <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">No plans to show yet.</section>
        ) : (
          // eslint-disable-next-line react/no-children-prop -- CalendarTabProps.children is the list of child lanes, by contract
          <FamilyCalendar children={calendarChildren} viewer="guardian" everyone />
        )}
      </div>
    );
  }

  const meta = children.find((c) => c.studentId === selected) as PlanChild;
  const load = byId.get(selected)!;
  const fallback = planFallback(load, firstNameOf(meta.name));
  return (
    <div className="space-y-6">
      <ChildSwitcher kids={switcherChildren} selected={selected} forExplicit={forExplicit} />
      {fallback || (load.kind === "ready" && (
        <PlanFrame
          ctx={load.ctx}
          view={load.view}
          relation="guardian"
          firstName={firstNameOf(meta.name)}
          color={KID_VARS[meta.colorSlot]}
          colorSlot={meta.colorSlot}
          personId={selected}
          tab={tab ?? defaultTab("guardian", false)}
        />
      ))}
    </div>
  );
}
