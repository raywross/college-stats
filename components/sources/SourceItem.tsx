"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { citesYear, isEditedSource, yearLabel, type AnyCitedSource } from "@/lib/lineage";

/** What a source line shows of a source: its name, link, and year. */
export type SourceItemSource = Pick<AnyCitedSource, "key" | "label" | "url" | "year">;

/**
 * One linked source: "IPEDS Admissions survey, Fall 2024"; an admin's edit reads "Edited by Quad" (no year). A client
 * component so a page's payload carries each source's four strings, not its markup (round 5, U3); the HTML is the same.
 */
export function SourceItem({ s, last }: { s: SourceItemSource; last: boolean }) {
  if (isEditedSource(s)) {
    return (
      <span>
        <Link href="/data#edits" className="font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary">
          Edited by Quad
        </Link>
        {last ? "" : ";"}
      </span>
    );
  }
  return (
    <span>
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary"
      >
        {s.label}
        <ExternalLink className="size-2.5" aria-hidden />
      </a>
      {citesYear(s) && `, ${yearLabel(s)}`}
      {last ? "" : ";"}
    </span>
  );
}
