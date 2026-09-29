import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { KindTag } from "@/components/release-notes/KindTag";
import { getReleaseNote, getReleaseNotes } from "@/lib/release-notes-docs";
import { formatReleaseDate, type ReleaseNote } from "@/lib/release-notes";
import { REPO_URL } from "@/lib/roadmap-render";

type Props = { params: Promise<{ slug: string }> };

// Every note is rendered at build time; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return getReleaseNotes().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const note = getReleaseNote(slug);
  if (!note) return {};
  return { title: `${note.title} · Release notes`, description: note.summary };
}

export default async function ReleaseNotePage({ params }: Props) {
  const { slug } = await params;
  const note = getReleaseNote(slug);
  if (!note) notFound();
  const notes = getReleaseNotes();
  const index = notes.findIndex((n) => n.slug === slug);
  // The list is newest first, so the next entry is the older release.
  const newer = index > 0 ? notes[index - 1] : null;
  const older = index < notes.length - 1 ? notes[index + 1] : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12 sm:px-6 sm:pt-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href="/release-notes" className="inline-flex items-center gap-1.5 font-semibold hover:text-foreground">
          <ArrowLeft className="size-4" /> Release notes
        </Link>
      </nav>

      <header className="max-w-3xl">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <KindTag kind={note.kind} className="text-foreground" />
          <span aria-hidden>·</span>
          <time dateTime={note.date}>{formatReleaseDate(note.date)}</time>
          <span aria-hidden>·</span>
          <a
            href={`${REPO_URL}/pull/${note.pr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            Pull request #{note.pr} <ExternalLink className="size-3.5" />
          </a>
        </p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{note.title}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{note.summary}</p>
      </header>

      <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-12">
        <aside className="lg:order-2">
          {note.toc.length > 1 && (
            <div className="sticky top-24 hidden lg:block">
              <p className="mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">On this page</p>
              <ol className="space-y-2 text-sm">
                {note.toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="text-muted-foreground hover:text-foreground">
                      {item.text}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
        <article className="spec-prose min-w-0 lg:order-1" dangerouslySetInnerHTML={{ __html: note.html }} />
      </div>

      {(older || newer) && (
        <nav aria-label="More releases" className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2">
          {older ? <PagerLink note={older} direction="older" /> : <span />}
          {newer && <PagerLink note={newer} direction="newer" />}
        </nav>
      )}
    </div>
  );
}

function PagerLink({ note, direction }: { note: ReleaseNote; direction: "older" | "newer" }) {
  const newer = direction === "newer";
  return (
    <Link
      href={`/release-notes/${note.slug}`}
      className={`group rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/50 ${newer ? "sm:col-start-2 sm:text-right" : ""}`}
    >
      <span className={`flex items-center gap-1 text-xs font-semibold text-muted-foreground ${newer ? "sm:justify-end" : ""}`}>
        {!newer && <ArrowLeft className="size-3.5" />}
        {newer ? "Newer" : "Older"}
        {newer && <ArrowRight className="size-3.5" />}
      </span>
      <span className="mt-1 block font-semibold group-hover:text-primary">{note.title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{formatReleaseDate(note.date)}</span>
    </Link>
  );
}
