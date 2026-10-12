import { MetricLabel, Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import { ROUND_VAR } from "@/lib/planner/colors";
import { joinNames, nextUpGroup, nextUpInfo, weekdayLabel } from "@/lib/planner/plan-frame";
import type { PlanView } from "@/lib/planner/plan-view";
import { ROUND_LABELS, type ListRound } from "@/lib/list-rules";
import type { AnyCited } from "@/lib/lineage";

const ROUND_TERM: Record<ListRound, TermKey> = {
  ed: "early-decision",
  ed2: "early-decision-ii",
  ea: "early-action",
  rea: "restrictive-early-action",
  rd: "regular-decision",
  rolling: "rolling-admission",
};

const cited = (c: unknown) => (c ?? undefined) as AnyCited | undefined;

/**
 * Next up (specs/planner/redesign/page.md "The page"): the single nearest deadline on the list, in the round
 * chosen, with days to go; when two or more colleges share that exact date and round their names are joined
 * ("Georgia and South Carolina"). Once every deadline is met, the next decision date; before the season, when it
 * opens. A dark ink card so it never competes visually with anything else on the page.
 */
export function NextUp({ view, today, cycleStartYear }: { view: PlanView; today: string; cycleStartYear: number | null }) {
  const info = nextUpInfo({ view, today, cycleStartYear });
  const row = info.row;
  const days = info.days ?? 0;
  const dayWord = Math.abs(days) === 1 ? "day" : "days";

  if (info.kind === "deadline" && row && row.deadline) {
    const names = nextUpGroup(view, info).map((r) => r.school?.name ?? "A college");
    return (
      <div className="flex min-w-60 items-center justify-between gap-4 rounded-3xl bg-foreground p-5 text-background">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold opacity-80">
            <span className="size-2.5 shrink-0 rotate-45" style={{ background: ROUND_VAR[row.round] }} aria-hidden />
            Next up ·{" "}
            <Term term={ROUND_TERM[row.round]} className="text-background underline-offset-2">
              {ROUND_LABELS[row.round]}
            </Term>
          </p>
          <p className="mt-1 truncate font-display text-xl leading-tight font-bold">{joinNames(names)}</p>
          <p className="mt-1 text-sm opacity-80">
            Due{" "}
            <MetricLabel cited={cited(row.school?.cites[row.deadline.field])} className="text-background">
              <span>{weekdayLabel(row.deadline.iso)}</span>
            </MetricLabel>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-5xl leading-none font-extrabold text-pop">{days}</p>
          <p className="text-xs font-semibold tracking-wide text-background/70 uppercase">{dayWord}</p>
        </div>
      </div>
    );
  }

  if (info.kind === "decision" && row && row.decision) {
    const names = nextUpGroup(view, info).map((r) => r.school?.name ?? "A college");
    return (
      <div className="flex min-w-60 items-center justify-between gap-4 rounded-3xl bg-foreground p-5 text-background">
        <div className="min-w-0">
          <p className="text-sm font-semibold opacity-80">Next up · Decision expected</p>
          <p className="mt-1 truncate font-display text-xl leading-tight font-bold">{joinNames(names)}</p>
          <p className="mt-1 text-sm opacity-80">
            <MetricLabel cited={cited(row.school?.cites[row.decision.field])} className="text-background">
              <span>{weekdayLabel(row.decision.iso)}</span>
            </MetricLabel>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-5xl leading-none font-extrabold text-pop">{days}</p>
          <p className="text-xs font-semibold tracking-wide text-background/70 uppercase">{dayWord}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-60 flex-col justify-center rounded-3xl bg-foreground p-5 text-background">
      <p className="text-xs font-bold tracking-wide uppercase opacity-80">Next up</p>
      {info.kind === "before_season" && cycleStartYear !== null && <p className="mt-1 text-sm font-semibold">Applications open Aug 1, {cycleStartYear}</p>}
      {info.kind === "none" && <p className="mt-1 text-sm font-semibold">No deadlines on record yet</p>}
    </div>
  );
}
