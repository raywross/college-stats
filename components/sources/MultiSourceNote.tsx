import Link from "next/link";
import { BookMarked, ExternalLink } from "lucide-react";
import type { School, Topic } from "@/lib/types";
import { sourcesFor, type ResolvedSource } from "@/lib/data";

/** Citation for views that show several schools (Compare): the union of their sources. */
export function MultiSourceNote({ schools, topics }: { schools: School[]; topics: Topic[] }) {
  const seen = new Map<string, ResolvedSource>();
  for (const s of schools) for (const src of sourcesFor(topics, s, { includeCds: true })) seen.set(`${src.key}${src.url}`, src);
  const sources = [...seen.values()];
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground">
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span>Sources:</span>
      {sources.map((s, i) => (
        <span key={`${s.key}${s.url}`}>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary">
            {s.label}
            <ExternalLink className="size-2.5" aria-hidden />
          </a>
          , {s.edition}
          {i < sources.length - 1 ? ";" : ""}
        </span>
      ))}
      <span aria-hidden>·</span>
      <Link href="/sources" className="font-medium hover:text-primary hover:underline">
        About the data
      </Link>
    </p>
  );
}
