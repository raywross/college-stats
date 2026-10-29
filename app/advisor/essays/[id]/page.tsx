import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { Editor } from "@/components/essays/Editor";
import { ReusePicker } from "@/components/essays/PromptPicker";
import { WhyFold } from "@/components/ui/why-fold";
import { authConfigured } from "@/lib/auth";
import { countLabel } from "@/lib/essays/count";
import { essaysViewer, planColleges, promptLookup, readEssay } from "@/lib/essays/load";
import { KIND_LABEL, pickerGroups, resolvePrompt, type ResolvedPrompt } from "@/lib/essays/prompts";
import { refsOf, rowLimit } from "@/lib/essays/rows";
import { baseChangedSince, reuseChoices } from "@/lib/essays/variants";
import { withTiming } from "@/lib/timing-server";

export const metadata: Metadata = { title: "Your essays" };

type Params = Promise<{ id: string }>;
type Search = Promise<{ for?: string }>;

const CARD = "rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6";

const readDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/** Where the prompt was read: the college's page (or the platform's homepage) and the day, as the prompt's citation. */
function PromptSource({ prompt }: { prompt: ResolvedPrompt }) {
  if (!prompt.source) return null;
  const who = prompt.college ? `${prompt.college.name}'s site` : "the platform's site";
  return (
    <p className="text-xs text-muted-foreground">
      As published on{" "}
      <a href={prompt.source.url} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
        {who}
      </a>
      {prompt.source.cycle ? ` for ${prompt.source.cycle}` : ""}, read {readDay(prompt.source.retrieved)}.
    </p>
  );
}

/**
 * /advisor/essays/<id> (specs/product/essays/workspace.md "Where it lives"): one draft. The prompt heading (its text,
 * limit, and college; "what this college says it looks for" in a fold), the editor with its count bar, the comment
 * thread, the version list, status, and "use for another college". A guardian gets the same page with the field
 * read-only and the comment box live. Unknown or unreadable drafts are a 404.
 */
export default async function EssayPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  await connection();
  const { id } = await params;
  return withTiming("/advisor/essays/[id]", () => render(id, searchParams));
}

async function render(id: string, searchParams: Search) {
  if (!authConfigured()) return <AuthUnavailable />;
  const sp = await searchParams;
  const viewer = await essaysViewer(sp.for);
  if (viewer.kind === "signed-out") return <SignInPrompt reason="write your essays" next={`/advisor/essays/${encodeURIComponent(id)}`} className="mx-auto max-w-xl" />;
  if (viewer.kind === "none") return <section className={CARD}>No student yet.</section>;

  const read = await readEssay(id, viewer);
  if (read.kind === "setup-missing") return <section className={CARD}>The essay workspace isn&apos;t set up in the database yet.</section>;
  if (read.kind === "not-found") notFound();

  const { essay, versions, links, comments, base } = read;
  const canWrite = viewer.canWrite && essay.student_id === viewer.student.id;
  const person = viewer.role === "guardian" ? essay.student_id : null;
  const q = person ? `?for=${person}` : "";

  const [colleges, lookup] = await Promise.all([planColleges(essay.student_id), promptLookup()]);
  const prompt = resolvePrompt(essay.prompt_ref, lookup);
  const limit = rowLimit(essay);
  const refs = refsOf(essay, links);
  const also = refs
    .filter((r) => r !== essay.prompt_ref)
    .map((r) => resolvePrompt(r, lookup))
    .map((p) => (p.college ? p.college.name : p.title));
  const baseChanged = base ? baseChangedSince(essay.created, base.updated) : false;
  const choices = canWrite
    ? reuseChoices({ kind: essay.kind, limit, refs }, pickerGroups(colleges, lookup)).map((c) => ({ groupLabel: c.group.label, prompt: c.prompt, mode: c.mode }))
    : [];
  const limitLine = [limit ? `Up to ${countLabel(limit.max, null, limit.kind)}` : null, limit?.min ? `at least ${limit.min.toLocaleString("en-US")}` : null, prompt.required === false ? "optional" : null]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="mx-auto min-w-0 max-w-5xl space-y-5" aria-labelledby="essay-title">
      <header className="space-y-2">
        <Link href={`/advisor/essays${q}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          All essays
        </Link>
        <p className="text-sm text-muted-foreground">
          {prompt.college ? `${prompt.college.name} · ` : ""}
          {prompt.found ? KIND_LABEL[prompt.kind] : prompt.title}
          {limitLine ? ` · ${limitLine}` : ""}
        </p>
        <h1 id="essay-title" className="font-display text-2xl font-bold break-words sm:text-3xl">
          {essay.title || prompt.title}
        </h1>
        {prompt.text && <p className="max-w-prose text-base">{prompt.text}</p>}
        {prompt.options.length > 0 && (
          <WhyFold title="The seven prompts to choose from" screen="essay" section="platform_prompts">
            <ol className="list-decimal space-y-1.5 pl-5">
              {prompt.options.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ol>
          </WhyFold>
        )}
        <PromptSource prompt={prompt} />
        {prompt.college && prompt.quote && (
          <WhyFold title="What this college says it looks for" screen="essay" section="looks_for">
            <p>“{prompt.quote}”</p>
            <PromptSource prompt={prompt} />
          </WhyFold>
        )}
        {!prompt.found && essay.prompt_ref !== "free" && <p className="text-sm text-muted-foreground italic">This prompt isn&apos;t on file anymore; the draft is kept as it is.</p>}
        {also.length > 0 && <p className="text-sm text-muted-foreground">Also used for {also.join(", ")}.</p>}
        {base && (
          <p className="text-sm text-muted-foreground">
            A copy of{" "}
            <Link href={`/advisor/essays/${base.id}${q}`} className="font-semibold text-primary hover:underline">
              {base.title || "another draft"}
            </Link>
            {baseChanged ? ", which has changed since this copy was made." : "."}
          </p>
        )}
        {read.variants > 0 && <p className="text-sm text-muted-foreground">{read.variants === 1 ? "1 copy of this draft is" : `${read.variants} copies of this draft are`} used for other prompts.</p>}
        {canWrite && (
          <div className="pt-1">
            <ReusePicker essayId={essay.id} choices={choices} person={person} />
          </div>
        )}
      </header>

      <Editor
        essay={{ id: essay.id, title: essay.title, body: essay.body, updated: essay.updated, status: essay.status, countKind: essay.count_kind, limit }}
        canWrite={canWrite}
        userId={viewer.userId}
        person={person}
        versions={versions}
        comments={comments}
        forCollege={prompt.college}
        planColleges={colleges}
        label={essay.title || prompt.title}
      />
    </article>
  );
}
