import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { ComplexityMeter } from "@/components/roadmap/ComplexityMeter";
import { getRoadmapDoc } from "@/lib/roadmap-docs";
import { REPO_URL } from "@/lib/roadmap-render";
import { COMPLEXITY, ROADMAP, ROADMAP_GROUPS, STATUS_LABELS, roadmapPages, roadmapSpec } from "@/lib/roadmap";

type Props = { params: Promise<{ slug: string }> };

// Every spec is rendered at build time; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return roadmapPages().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = getRoadmapDoc(slug);
  if (!doc) return {};
  return { title: `${doc.title} · Roadmap`, description: roadmapSpec(slug)?.summary };
}

export default async function RoadmapSpecPage({ params }: Props) {
  const { slug } = await params;
  const doc = getRoadmapDoc(slug);
  if (!doc) notFound();
  const spec = roadmapSpec(slug);
  const group = spec && ROADMAP_GROUPS.find((g) => g.key === spec.group);
  const index = spec ? ROADMAP.indexOf(spec) : -1;
  const prev = index > 0 ? ROADMAP[index - 1] : null;
  const next = index >= 0 && index < ROADMAP.length - 1 ? ROADMAP[index + 1] : null;
  const after = (spec?.after ?? []).map((s) => roadmapSpec(s)).filter((s) => s != null);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12 sm:px-6 sm:pt-8">
      <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <Link href="/roadmap" className="inline-flex items-center gap-1.5 font-semibold hover:text-foreground">
          <ArrowLeft className="size-4" /> Roadmap
        </Link>
        {group && (
          <>
            <span aria-hidden>·</span>
            <span>{group.title}</span>
          </>
        )}
      </nav>

      <header className="max-w-3xl">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{doc.title}</h1>
        {spec && <p className="mt-3 text-lg text-muted-foreground">{spec.summary}</p>}
      </header>

      {spec && (
        <dl className="mt-6 grid gap-px overflow-hidden rounded-2xl border bg-border text-sm sm:grid-cols-3">
          <div className="bg-card p-4">
            <dt className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Complexity</dt>
            <dd className="mt-1.5">
              <ComplexityMeter value={spec.complexity} />
              <p className="mt-1.5 text-muted-foreground">{spec.complexityNote}</p>
            </dd>
          </div>
          <div className="bg-card p-4">
            <dt className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</dt>
            <dd className="mt-1.5 font-semibold">{STATUS_LABELS[spec.status]}</dd>
            {after.length > 0 && (
              <dd className="mt-1.5 text-muted-foreground">
                Builds on{" "}
                {after.map((s, i) => (
                  <span key={s.slug}>
                    {i > 0 && ", "}
                    <Link href={`/roadmap/${s.slug}`} className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
                      {getRoadmapDoc(s.slug)?.title}
                    </Link>
                  </span>
                ))}
              </dd>
            )}
          </div>
          <div className="bg-card p-4">
            <dt className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source data</dt>
            <dd className="mt-1.5 font-semibold">{doc.source ?? "Multiple sources"}</dd>
            <dd className="mt-1.5">
              <a
                href={`${REPO_URL}/blob/main/${doc.file}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                View on GitHub <ExternalLink className="size-3.5" />
              </a>
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-12">
        <aside className="lg:order-2">
          {doc.toc.length > 1 && (
            <>
              <details className="mb-8 rounded-2xl border bg-card lg:hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">On this page</summary>
                <TocList toc={doc.toc} className="border-t px-4 py-3" />
              </details>
              <div className="sticky top-24 hidden lg:block">
                <p className="mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">On this page</p>
                <TocList toc={doc.toc} />
              </div>
            </>
          )}
        </aside>
        <article className="spec-prose min-w-0 lg:order-1" dangerouslySetInnerHTML={{ __html: doc.html }} />
      </div>

      {(prev || next) && (
        <nav aria-label="More specs" className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2">
          {prev ? <PagerLink slug={prev.slug} direction="prev" /> : <span />}
          {next && <PagerLink slug={next.slug} direction="next" />}
        </nav>
      )}
    </div>
  );
}

function TocList({ toc, className }: { toc: { id: string; text: string }[]; className?: string }) {
  return (
    <ol className={`space-y-2 text-sm ${className ?? ""}`}>
      {toc.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} className="text-muted-foreground hover:text-foreground">
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

function PagerLink({ slug, direction }: { slug: string; direction: "prev" | "next" }) {
  const spec = roadmapSpec(slug);
  const title = getRoadmapDoc(slug)?.title ?? slug;
  const Icon = direction === "prev" ? ArrowLeft : ArrowRight;
  return (
    <Link
      href={`/roadmap/${slug}`}
      className={`group rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/50 ${direction === "next" ? "sm:col-start-2 sm:text-right" : ""}`}
    >
      <span className={`flex items-center gap-1 text-xs font-semibold text-muted-foreground ${direction === "next" ? "sm:justify-end" : ""}`}>
        {direction === "prev" && <Icon className="size-3.5" />}
        {direction === "prev" ? "Previous" : "Next"}
        {direction === "next" && <Icon className="size-3.5" />}
      </span>
      <span className="mt-1 block font-semibold group-hover:text-primary">{title}</span>
      {spec && <span className="mt-0.5 block text-xs text-muted-foreground">{COMPLEXITY[spec.complexity].label}</span>}
    </Link>
  );
}
