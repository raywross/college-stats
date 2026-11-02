import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CASELOAD_HREF } from "@/lib/org-hrefs";
import { cn } from "@/lib/utils";

const chipCls =
  "inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pr-4 pl-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * The household hub's strip for a counselor (specs/product/counselor-portal.md "A student"; household-hub.md "A
 * person's page"): in place of the family's people strip, "Caseload" back to `/org` and one chip, the student being
 * shown, ink-filled like the people strip's active chip. A counselor has no household, so nothing of one (seats,
 * invitations, settings, "+ Add") appears. A server component: no state, the chip is always the page being shown.
 */
export function CaseloadStrip({ studentId, name, gradYear }: { studentId: string; name: string | null; gradYear: number | null }) {
  const full = name?.trim() || "A student";
  const first = full.split(/\s+/)[0];
  return (
    <nav aria-label="Caseload">
      <ul className="flex flex-wrap items-center gap-2">
        <li className="flex">
          <Link href={CASELOAD_HREF} className={cn(chipCls, "bg-card pl-3 text-sm font-semibold hover:border-primary/40 hover:bg-muted/60")}>
            <ArrowLeft className="size-4" aria-hidden />
            Caseload
          </Link>
        </li>
        <li className="flex min-w-0">
          <Link href={`/household/${encodeURIComponent(studentId)}`} aria-current="page" title={full} className={cn(chipCls, "min-w-0 border-foreground bg-foreground text-background")}>
            <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-background/15 text-sm font-bold text-background">
              {first.charAt(0).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="max-w-48 truncate text-sm leading-tight font-semibold">{first}</span>
              <span className="text-[11px] leading-tight whitespace-nowrap text-background/75">{gradYear ? `Student · Class of ${gradYear}` : "Student"}</span>
            </span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
