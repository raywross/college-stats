import { Quote } from "lucide-react";
import { citePage, policyRows, type CampusPagesRows } from "@/lib/campus-pages";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * Facts read from the college's own pages by the campus-life pilot (lib/campus-pages.ts). Most now render inside their
 * domain's own block, beside the national lists for the same thing (2026-10-04 redesign): the council counts,
 * recruitment, and chapter houses in GreekLife; the faith office and religious composition in ReligiousLife; the
 * center and policy items in LgbtqLife. What's left here is the one fact nothing else shows: the conduct-code quote.
 */

const today = () => new Date().toISOString().slice(0, 10);
const rowsOf = (detail: SchoolDetail | null): CampusPagesRows | null => detail?.tables.campus_pages?.rows ?? null;

/**
 * The conduct-code quote (lgbtq-life.md Measures 3), under the spec's own neutral heading. Describes; never grades.
 * Renders inside LgbtqLife's card when `bare`.
 */
export function LgbtqPolicies({ school, detail, bare = false }: { school: School; detail: SchoolDetail | null; bare?: boolean }) {
  const now = today();
  const conduct = policyRows(rowsOf(detail), now).find((p) => p.key === "conduct_restriction" && p.value === "yes");
  if (!conduct) return null;
  const ref = { url: conduct.url, checked: conduct.checked, quote: conduct.quote ?? "", verified_by: conduct.verified_by };
  const body = (
    <div>
      <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        What the student conduct policy says <InfoTip term="conduct-code-restriction" cited={citePage(ref, school.name, "What the student conduct policy says")} />
      </h4>
      <blockquote className="flex gap-2 rounded-2xl bg-surface-2/60 p-4 text-sm italic">
        <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {conduct.quote}
      </blockquote>
    </div>
  );
  if (bare) return body;
  return (
    <div id="lgbtq-pages" className="rounded-3xl border bg-card p-4 sm:p-6">
      {body}
    </div>
  );
}
