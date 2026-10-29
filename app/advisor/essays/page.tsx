import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { EssayList } from "@/components/essays/EssayList";
import { PromptPicker } from "@/components/essays/PromptPicker";
import { authConfigured } from "@/lib/auth";
import { essaysViewer, planColleges, promptLookup, readEssays } from "@/lib/essays/load";
import { pickerGroups } from "@/lib/essays/prompts";
import { groupEssays } from "@/lib/essays/rows";
import { planHref } from "@/lib/planner/plan-tabs";
import { withTiming } from "@/lib/timing-server";

export const metadata: Metadata = { title: "Your essays" };

type Search = Promise<{ for?: string; college?: string }>;

const CARD = "rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6";

/**
 * /advisor/essays (specs/product/essays/workspace.md "Where it lives"): the workspace's list. Drafts grouped by
 * college, the main essay first, with counts and status; "Write a new one" opens the prompt picker (the plan's
 * colleges' prompts, the platforms', or free). A guardian sees the same list, read-only. `?college=<unit_id>` narrows
 * to one college (the apply card's "Essays for {college}"); `?for=` picks the child, as on /advisor. Signed out: the
 * sign-in invitation.
 */
export default async function EssaysPage({ searchParams }: { searchParams: Search }) {
  await connection();
  return withTiming("/advisor/essays", () => render(searchParams));
}

async function render(searchParams: Search) {
  if (!authConfigured()) return <AuthUnavailable />;
  const sp = await searchParams;
  const viewer = await essaysViewer(sp.for);
  if (viewer.kind === "signed-out") return <SignInPrompt reason="write your essays" next="/advisor/essays" className="mx-auto max-w-xl" />;
  if (viewer.kind === "none") {
    return (
      <section className={CARD}>
        No student yet. Add one from{" "}
        <Link href="/household" className="font-semibold text-primary hover:underline">
          Household
        </Link>{" "}
        to get started.
      </section>
    );
  }

  const college = typeof sp.college === "string" && /^\d{1,12}$/.test(sp.college) ? sp.college : null;
  const [colleges, read, lookup] = await Promise.all([planColleges(viewer.student.id), readEssays(viewer.student.id, viewer), promptLookup()]);
  const person = viewer.person;
  const back = (
    <Link href={planHref({ person, tab: "next" })} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      Back to your advisor
    </Link>
  );

  if (read.kind === "setup-missing") {
    return (
      <div className="space-y-4">
        {back}
        <section className={CARD}>
          <h1 className="font-display text-xl font-bold text-foreground">Your essays</h1>
          <p className="mt-1">The essay workspace isn&apos;t set up in the database yet.</p>
        </section>
      </div>
    );
  }

  const nameOf = (id: string) => lookup.schoolRecord(id)?.name ?? null;
  const record = college ? lookup.schoolRecord(college) : null;
  const withPlatform = !!record && (!!record.apply?.common_app || !!record.coalition);
  const groups = groupEssays(read.essays, read.links, colleges, nameOf, { college, withPlatform });
  const collegeName = college ? (nameOf(college) ?? "this college") : null;
  const q = person ? `?for=${person}` : "";
  const first = viewer.student.name?.trim().split(/\s+/)[0] ?? null;

  return (
    <article className="mx-auto min-w-0 max-w-3xl space-y-6" aria-labelledby="essays-title">
      <header className="space-y-2">
        {back}
        <h1 id="essays-title" className="font-display text-2xl font-bold sm:text-3xl">
          {collegeName ? `Essays for ${collegeName}` : "Your essays"}
        </h1>
        <p className="max-w-prose text-muted-foreground">
          {viewer.canWrite ? "Every draft, counted against its limit and kept in versions." : `Only ${first ?? "the student"} edits a draft; you can read and comment.`}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {viewer.canWrite && <PromptPicker groups={pickerGroups(colleges, lookup)} person={person} />}
          {college && (
            <Link href={`/advisor/essays${q}`} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted">
              All essays
            </Link>
          )}
        </div>
      </header>

      <EssayList
        groups={groups}
        openComments={read.openComments}
        person={person}
        emptyLine={viewer.canWrite ? "No drafts yet. Start with the Common App's personal essay: it goes to every Common App college." : "No drafts yet."}
      />
    </article>
  );
}
