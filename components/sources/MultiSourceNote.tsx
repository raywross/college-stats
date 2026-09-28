import Link from "next/link";
import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { sourcesForSchools } from "@/lib/data";
import { SourceLine } from "@/components/sources/SourceNote";

/** Colleges' own documents beyond this many are summarized ("Common Data Sets from 8 colleges"). */
const MAX_LISTED = 3;

/**
 * Citation for views that show several schools (Compare, Explore, Home): the
 * union of every shown school's sources for these fields.
 */
export function MultiSourceNote({ schools, fields, className }: { schools: School[]; fields: readonly FieldPath[]; className?: string }) {
  const all = sourcesForSchools(fields, schools);
  const federal = all.filter((s) => s.key !== "cds");
  const cds = all.filter((s) => s.key === "cds");
  if (cds.length <= MAX_LISTED) return <SourceLine sources={all} className={className} />;
  return (
    <SourceLine
      sources={federal}
      className={className}
      extra={<SourceItemSummary count={cds.length} />}
    />
  );
}

function SourceItemSummary({ count }: { count: number }) {
  return (
    <span>
      <Link href="/sources#cds-list" className="font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary">
        Common Data Sets from {count} colleges
      </Link>
    </span>
  );
}
