/**
 * The Colleges tab for the sample student: a presentational twin of `PlanList` + `PlanRow` (components/planner/), which
 * need a `PlanContext` and the list's store. Same section card, header line, group pills (`GROUP_CLASS`, the real
 * `GROUP_HEADING` words), row spacing, heart, and `CollegeChip`; no edit controls (nothing here writes). One line the
 * real row doesn't carry: the college's city and how many it admits, cited, so the page's figures are on the frame.
 * The real `ListExplainer` ("How Quad reads your list") takes no data, so it is the real one.
 */
import { Heart } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { ListExplainer } from "@/components/planner/ListExplainer";
import { MetricLabel } from "@/components/ui/info-tip";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { GROUP_HEADING } from "@/lib/planner/list-row";
import { cn } from "@/lib/utils";
import type { SampleCollege } from "./sample";

export function SampleList({ colleges }: { colleges: SampleCollege[] }) {
  return (
    <section className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b px-4 py-1.5">
        <p className="text-sm font-semibold">{`${colleges.length} college${colleges.length === 1 ? "" : "s"}`}</p>
        <ListExplainer />
      </div>
      {colleges.map((c, i) => (
        <div key={c.unit_id}>
          <div className="border-b px-4 py-3">
            <p className={cn("splash-pop inline-flex h-8 animate-pop-in items-center rounded-full px-3 text-xs font-bold", GROUP_CLASS[c.level])} style={{ animationDelay: `${150 + i * 90}ms` }}>
              {GROUP_HEADING[c.level]} · 1
            </p>
          </div>
          <ul className="divide-y border-b last:border-b-0">
            <li>
              <div className="flex items-center gap-2 p-3 sm:px-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground/60" aria-hidden>
                  <Heart className={cn("size-5", c.dream && "fill-rose-500 text-rose-500")} />
                </span>
                <div className="min-w-0 flex-1">
                  <CollegeChip school={{ unit_id: c.unit_id, name: c.name, brand: c.brand }} size="sm" link className="max-w-full" />
                  {c.dream && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">Dream</p>}
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                    <span>
                      {c.city}, {c.state}
                    </span>
                    {c.admitted && c.admittedCite && (
                      <>
                        <span aria-hidden>·</span>
                        <MetricLabel term="acceptance-rate" cited={c.admittedCite}>
                          <span>{c.admitted} admitted</span>
                        </MetricLabel>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </li>
          </ul>
        </div>
      ))}
    </section>
  );
}
