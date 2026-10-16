import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { GuideFrame } from "@/components/planner/guides/GuideFrame";
import { authConfigured, getUser } from "@/lib/auth";
import { GUIDES, parseGuideFrom, parseGuideQuery, parseGuideSlug, type GuideSlug } from "@/lib/planner/guides";
import { GUIDE_PAGES } from "@/lib/planner/guides-server";
import { loadPlanFor, planViewer, type PlanLoad } from "@/lib/planner/load";
import { resolveSelectedChild } from "@/lib/planner/plan-frame";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ for?: string; move?: string; college?: string; level?: string; from?: string }>;

/** Set by PlanPeople.tsx on every pick (app/plan/page.tsx reads it the same way). */
const PLAN_CHILD_COOKIE = "plan_child";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseGuideSlug((await params).slug);
  return { title: slug ? GUIDES[slug].title : "Plan" };
}

/** "No list yet" / "not set up yet" / "can't see this": the same fallbacks /plan shows (app/plan/page.tsx). */
function Fallback({ loaded }: { loaded: Exclude<PlanLoad, { kind: "ready" }> }) {
  const body =
    loaded.kind === "empty" ? (
      <>
        <h2 className="font-display text-xl font-bold text-foreground">No list yet</h2>
        <p className="mt-1">The plan starts from the list. Add colleges from Explore or any college&apos;s page to get started.</p>
      </>
    ) : loaded.kind === "setup-missing" ? (
      <>
        <h2 className="font-display text-xl font-bold text-foreground">The plan isn&apos;t set up yet</h2>
        <p className="mt-1">The planner&apos;s tables haven&apos;t been added to the database. The list still works.</p>
      </>
    ) : (
      <>That plan isn&apos;t one you can see.</>
    );
  return <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">{body}</section>;
}

/**
 * /plan/guide/<slug> (specs/planner/v3/now.md "The guide pattern"; build-plan.md "The guide page"): one guide for one
 * student. The student is resolved as /plan does: a student's own plan, or for a guardian the child `?for=` names
 * (else the last child viewed, else the first). `?move=` opens the move's footer when it is one of this plan's tasks;
 * `?college=`, `?level=` are the guide's own; `?from=` is where it was opened from (telemetry). An unknown slug is a
 * 404; signed out goes to /plan.
 */
export default async function GuidePageRoute({ params, searchParams }: { params: Params; searchParams: Search }) {
  await connection();
  const slug = parseGuideSlug((await params).slug);
  if (!slug) notFound();
  if (!authConfigured()) return <AuthUnavailable />;
  const user = await getUser();
  if (!user) redirect("/plan");
  const sp = await searchParams;

  const viewer = await planViewer();
  if (viewer.kind === "none") {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        No student yet. Add one from <Link href="/household" className="font-semibold text-primary hover:underline">Household</Link> to start a plan.
      </section>
    );
  }

  let studentId: string;
  let person: string | null;
  if (viewer.kind === "self") {
    studentId = viewer.student.id;
    person = null;
  } else {
    const lastViewed = (await cookies()).get(PLAN_CHILD_COOKIE)?.value ?? null;
    const selected = resolveSelectedChild({
      forParam: sp.for ?? null,
      children: viewer.children.map((c) => ({ studentId: c.studentId, nextDeadline: null })),
      lastViewed,
    });
    if (selected === null) return <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">No plans to show yet.</section>;
    studentId = selected;
    person = selected;
  }

  const loaded = await loadPlanFor(studentId);
  if (loaded.kind !== "ready") return <Fallback loaded={loaded} />;
  return renderGuide(slug, loaded, person, sp);
}

async function renderGuide(slug: GuideSlug, loaded: Extract<PlanLoad, { kind: "ready" }>, person: string | null, sp: Awaited<Search>) {
  const { ctx, view } = loaded;
  const query = parseGuideQuery(sp);
  const move = query.move ? (ctx.tasks.find((t) => t.id === query.move) ?? null) : null;
  const page = GUIDE_PAGES[slug];
  const data = page.load ? await page.load(ctx, view, query) : undefined;
  return (
    <GuideFrame
      slug={slug}
      from={parseGuideFrom(sp.from, move !== null)}
      Component={page.Component}
      ctx={ctx}
      view={view}
      move={move}
      query={query}
      data={data}
      person={person}
    />
  );
}
