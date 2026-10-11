import { MetricLabel, Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import { ROUND_VAR } from "@/lib/planner/colors";
import { dayLabel, nextUpInfo } from "@/lib/planner/plan-frame";
import type { PlanView } from "@/lib/planner/plan-view";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import type { AnyCited } from "@/lib/lineage";
import type { ListRound } from "@/lib/list-rules";

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
 * chosen, with days to go; once every deadline is met, the next decision date; before the season, when it opens.
 * A dark card so it never competes visually with anything else on the page.
 */
export function NextUp({ view, today, cycleStartYear }: { view: PlanView; today: string; cycleStartYear: number | null }) {
  const info = nextUpInfo({ view, today, cycleStartYear });
  const row = info.row;
  const days = info.days ?? 0;
  const dayWord = `${days} day${Math.abs(days) === 1 ? "" : "s"}`;

  return (
    <div className="flex min-w-60 flex-col justify-center rounded-3xl bg-foreground p-5 text-background">
      <p className="text-xs font-bold tracking-wide uppercase opacity-80">Next up</p>
      {info.kind === "deadline" && row && row.deadline && (
        <>
          <p className="mt-1 font-display text-xl leading-tight font-bold">{row.school?.name ?? "A college"}</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <span className="size-3 shrink-0 rotate-45" style={{ background: ROUND_VAR[row.round] }} aria-hidden />
            <Term term={ROUND_TERM[row.round]} className="text-background underline-offset-2">
              {ROUND_SHORT[row.round]}
            </Term>
            due{" "}
            <MetricLabel cited={cited(row.school?.cites[row.deadline.field])} className="text-background">
              <span>{dayLabel(row.deadline.iso)}</span>
            </MetricLabel>{" "}
            · {dayWord}
          </p>
        </>
      )}
      {info.kind === "decision" && row && row.decision && (
        <>
          <p className="mt-1 font-display text-xl leading-tight font-bold">{row.school?.name ?? "A college"}</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
            Decision expected{" "}
            <MetricLabel cited={cited(row.school?.cites[row.decision.field])} className="text-background">
              <span>{dayLabel(row.decision.iso)}</span>
            </MetricLabel>{" "}
            · {dayWord}
          </p>
        </>
      )}
      {info.kind === "before_season" && cycleStartYear !== null && <p className="mt-1 text-sm font-semibold">Applications open Aug 1, {cycleStartYear}</p>}
      {info.kind === "none" && <p className="mt-1 text-sm font-semibold">No deadlines on record yet</p>}
    </div>
  );
}
