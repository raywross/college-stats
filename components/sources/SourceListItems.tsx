"use client";

import { ExternalLink } from "lucide-react";

/** One numbered source of a profile's list: what the row shows, nothing more. */
export interface SourceListEntry {
  /** React key: the source's key and url. */
  id: string;
  label: string;
  url: string;
  publisher: string;
  years: string;
  retrieved: string;
}

/**
 * The numbered rows of SourceList (components/sources/SourceNote.tsx), drawn here so the page's payload carries each
 * source's few strings instead of every row's markup (round 5, U3; specs/serving-architecture.md "Round 5: the public
 * pages' payload"). The HTML is the same as the server rendered before; the list sits in a closed `<details>`.
 */
export function SourceListItems({ sources }: { sources: SourceListEntry[] }) {
  return (
    <ol className="mt-4 grid gap-3 sm:grid-cols-2">
      {sources.map((s, i) => (
        <li key={s.id} className="flex gap-3 rounded-2xl border bg-card p-4 text-sm">
          <span className="font-display font-bold text-muted-foreground tabular-nums">{i + 1}</span>
          <div className="min-w-0">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-primary">
              {s.label} <ExternalLink className="size-3" aria-hidden />
            </a>
            <p className="text-xs text-muted-foreground">
              {s.publisher} · {s.years} · retrieved {s.retrieved}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
