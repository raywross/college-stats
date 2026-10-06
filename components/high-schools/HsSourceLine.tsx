import Link from "next/link";
import { BookMarked } from "lucide-react";
import type { HighSchoolMeta, HighSchoolView } from "@/lib/high-school-types";
import { hsSourcesForFields, type HsFieldPath } from "@/lib/hs-fields";
import { SourceItem } from "@/components/sources/SourceNote";
import { cn } from "@/lib/utils";

/**
 * Section footnote for a high school page (mirrors components/sources/SourceNote.tsx's SourceLine, which this reuses
 * for the linked, dated source items themselves — both are generic over AnyCitedSource, lib/lineage.ts).
 */
export function HsSourceLine({
  paths,
  view,
  className,
}: {
  paths: readonly HsFieldPath[];
  view: Pick<HighSchoolView, "school" | "state_report" | "detail" | "meta">;
  className?: string;
}) {
  const sources = hsSourcesForFields(paths, view.school, view.meta as HighSchoolMeta, { stateReport: view.state_report, detail: view.detail });
  if (!sources.length) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span>{sources.length > 1 ? "Sources" : "Source"}:</span>
      {sources.map((s, i) => (
        <SourceItem key={`${s.key}${s.url}${s.year}`} s={s} last={i === sources.length - 1} />
      ))}
      <span aria-hidden>·</span>
      <Link href="/data#high-schools" className="font-medium hover:text-primary hover:underline">
        About the data
      </Link>
    </p>
  );
}
