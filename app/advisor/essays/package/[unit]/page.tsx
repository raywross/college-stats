import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { Package, type PackageItemView } from "@/components/essays/Package";
import { authConfigured } from "@/lib/auth";
import { getData } from "@/lib/data";
import { activitiesForPackage, limitLine, packagePromptRefs, type PackageActivity } from "@/lib/essays/docx";
import { essaysViewer, promptLookup, readEssay, readEssays } from "@/lib/essays/load";
import { resolvePrompt } from "@/lib/essays/prompts";
import { refsOf } from "@/lib/essays/rows";
import { profileFor } from "@/lib/student-profile-store";
import { withTiming } from "@/lib/timing-server";

type Params = Promise<{ unit: string }>;
type Search = Promise<{ for?: string }>;

const CARD = "rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { unit } = await params;
  const { getSchoolById } = await getData();
  const school = getSchoolById(unit);
  return { title: school ? `${school.name}: essay package` : "Essay package" };
}

/**
 * /advisor/essays/package/<unit_id> (specs/product/essays/workspace.md "Where it lives"): everything for one
 * college, in prompt order, with a copy button each, the downloads, the activities list, and the checklist. A
 * guardian sees the same page (the family's package, like the editor pages).
 */
export default async function PackagePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  await connection();
  const { unit } = await params;
  return withTiming("/advisor/essays/package/[unit]", () => render(unit, searchParams));
}

async function render(unitId: string, searchParams: Search) {
  if (!authConfigured()) return <AuthUnavailable />;
  const sp = await searchParams;
  const viewer = await essaysViewer(sp.for);
  if (viewer.kind === "signed-out") return <SignInPrompt reason="see your essay package" next={`/advisor/essays/package/${encodeURIComponent(unitId)}`} className="mx-auto max-w-xl" />;
  if (viewer.kind === "none") return <section className={CARD}>No student yet.</section>;

  const { getSchoolById } = await getData();
  const school = getSchoolById(unitId);
  if (!school) notFound();

  const [lookup, read, profileAccess] = await Promise.all([promptLookup(), readEssays(viewer.student.id, viewer), profileFor(viewer.student.id)]);
  if (read.kind === "setup-missing") {
    return (
      <section className={CARD}>
        <h1 className="font-display text-xl font-bold text-foreground">Essay package</h1>
        <p className="mt-1">The essay workspace isn&apos;t set up in the database yet.</p>
      </section>
    );
  }

  const commonApp = !!school.apply?.common_app;
  const coalitionPrompts = school.coalition ? lookup.platform?.coalition?.prompts ?? [] : [];
  const refs = packagePromptRefs(lookup.schoolRecord(unitId)?.essays ?? null, { commonApp, coalitionPrompts });

  const matched = refs.map((ref) => ({ ref, essay: read.essays.find((e) => refsOf(e, read.links).includes(ref)) ?? null }));
  const bodies = new Map<string, string>();
  const uniqueIds = [...new Set(matched.flatMap((m) => (m.essay ? [m.essay.id] : [])))];
  await Promise.all(
    uniqueIds.map(async (id) => {
      const one = await readEssay(id, viewer);
      if (one.kind === "ready") bodies.set(id, one.essay.body);
    }),
  );

  const items: PackageItemView[] = matched.map(({ ref, essay }) => {
    const prompt = resolvePrompt(ref, lookup);
    const body = essay ? bodies.get(essay.id) ?? "" : "";
    return {
      essayId: essay?.id ?? null,
      title: prompt.found ? prompt.title : "Prompt not on file",
      promptText: prompt.text,
      limitLine: limitLine(prompt.limit, prompt.required),
      body,
      started: !!essay && body.trim().length > 0,
    };
  });

  const activities: PackageActivity[] = activitiesForPackage(profileAccess?.data.academics.activities ?? []);
  const person = viewer.person;
  const back = (
    <Link href={`/advisor/essays${person ? `?for=${person}` : ""}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      All essays
    </Link>
  );

  return (
    <article className="mx-auto min-w-0 max-w-3xl space-y-6" aria-labelledby="package-title">
      <header className="space-y-2">
        {back}
        <h1 id="package-title" className="font-display text-2xl font-bold sm:text-3xl">
          {school.name}: essay package
        </h1>
        <p className="max-w-prose text-muted-foreground">Everything {school.name} asks for, in one place to paste from.</p>
      </header>

      {items.length === 0 ? (
        <section className={CARD}>No prompts on file for this college yet.</section>
      ) : (
        <Package collegeName={school.name} unitId={unitId} items={items} activities={activities} person={person} />
      )}
    </article>
  );
}
