import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { KindTag } from "@/components/release-notes/KindTag";
import { getReleaseNotes } from "@/lib/release-notes-docs";
import { RELEASE_KINDS, formatReleaseDate, type ReleaseKind } from "@/lib/release-notes";

export const metadata: Metadata = {
  title: "Release notes",
  description: "Every change to Quad: new features, newer data, fixes, and plans, newest first.",
};

export default function ReleaseNotesPage() {
  const notes = getReleaseNotes();
  const days = [...new Set(notes.map((n) => n.date))];
  const kinds = (Object.keys(RELEASE_KINDS) as ReleaseKind[]).filter((k) => notes.some((n) => n.kind === k));

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">Release notes</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            What&apos;s <span className="highlight">new</span>
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Every change to the site, newest first: new features, newer data, fixes, and the plans behind what&apos;s
            coming. Each one links to the full notes. For what&apos;s next, see the{" "}
            <Link href="/roadmap" className="font-semibold text-foreground hover:text-primary">
              roadmap
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-start rounded-3xl border bg-card px-5 py-4 sm:self-auto">
          <Sparkles className="size-6 text-primary" />
          <div>
            <p className="font-display text-3xl leading-none font-extrabold">{notes.length}</p>
            <p className="text-xs text-muted-foreground">releases</p>
          </div>
        </div>
      </header>

      <section aria-labelledby="kinds-heading" className="mb-12 rounded-3xl border bg-surface-2 p-5 sm:p-6">
        <h2 id="kinds-heading" className="text-sm font-bold">
          Kinds of change
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kinds.map((kind) => (
            <div key={kind}>
              <dt className="flex items-center justify-between gap-2">
                <KindTag kind={kind} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {notes.filter((n) => n.kind === kind).length}
                </span>
              </dt>
              <dd className="mt-1 text-sm text-muted-foreground">{RELEASE_KINDS[kind].description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="space-y-12">
        {days.map((day) => (
          <section key={day} aria-labelledby={`day-${day}`} className="md:grid md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h2
              id={`day-${day}`}
              className="mb-3 font-display text-lg font-bold tracking-tight md:sticky md:top-[calc(var(--header-h)+1.5rem)] md:mb-0 md:self-start"
            >
              <time dateTime={day}>{formatReleaseDate(day)}</time>
            </h2>
            <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
              {notes
                .filter((n) => n.date === day)
                .map((note) => (
                  <li key={note.slug}>
                    <Link
                      href={`/release-notes/${note.slug}`}
                      className="group grid gap-3 p-5 transition-colors hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_1.25rem] sm:items-center sm:gap-6"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <KindTag kind={note.kind} />
                          <span className="text-xs text-muted-foreground tabular-nums">#{note.pr}</span>
                        </p>
                        <p className="mt-2 font-semibold group-hover:text-primary">{note.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{note.summary}</p>
                      </div>
                      <ArrowRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary sm:block" />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
