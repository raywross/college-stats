import { CATEGORY_LABELS } from "@/lib/list-rules";
import { GROUP_CLASS } from "@/lib/planner/colors";
import type { PlanRowView } from "@/lib/planner/plan-view";
import { actToSat, satToAct, type TestKind } from "@/lib/planner/standing";
import { SourceTip } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { cn } from "@/lib/utils";

/** The bar's axis for each test (scores.md "College by college"), fixed regardless of the student's own score. */
const AXIS: Record<TestKind, [number, number]> = { sat: [1000, 1600], act: [18, 36] };

const SEND_LABEL = {
  send: "Send it",
  "consider-not-sending": "Optional here: consider not sending",
  "required-missing": "Score required",
  "not-used": "Doesn't use scores",
} as const;

/**
 * One college on the Scores tab's "College by college" list (specs/planner/redesign/scores.md): the middle 50% as
 * a bar on the student's own test's axis, their score as a dot, the group chip, the send advice, the range's
 * citation, and "1420 → Target" when a realistic retake would move the college up a group. Never a probability or
 * an admit rate. A college compared through the concordance says so.
 */
export default function ScoreRow({ row, kind, score }: { row: PlanRowView; kind: TestKind; score: number }) {
  const t = row.standing?.test ?? null;
  const [lo, hi] = AXIS[kind];
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  // A concorded range is drawn on the student's own test's scale, not the one the college reported.
  const range: [number, number] | null = t
    ? t.concorded
      ? kind === "act"
        ? [satToAct(t.range[0]) ?? lo, satToAct(t.range[1]) ?? hi]
        : [actToSat(t.range[0]) ?? lo, actToSat(t.range[1]) ?? hi]
      : t.range
    : null;
  const cites = row.school?.cites ?? {};
  const cite = (t ? (t.kind === "sat" ? cites["derived.sat_total"] : cites["admissions.act_composite_25_75"]) : (cites["reported.test_policy"] ?? cites["admissions.test_policy"])) as AnyCited | undefined;
  const send = row.standing?.send ?? null;

  return (
    <li className="grid grid-cols-1 items-center gap-2 px-4 py-3 sm:grid-cols-[14rem_1fr_13rem]">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{row.school?.name ?? "A college"}</p>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", GROUP_CLASS[row.group])}>{CATEGORY_LABELS[row.group]}</span>
      </div>
      {range ? (
        <div>
          <div className="relative h-6" aria-label={`Middle 50% ${range[0]} to ${range[1]}; your score ${score}`}>
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted-foreground/30" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />
            <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card" style={{ left: pct(score) }} />
          </div>
          {/* The range as one line under the bar, not two positioned labels: those collided on a phone (browser QA 2026-10-10). */}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Middle 50%: {range[0]}–{range[1]}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{send === "not-used" ? "Test-blind: scores aren't read." : "No score range on record."}</p>
      )}
      <div className="flex flex-wrap items-center gap-1 text-xs sm:justify-end">
        {send && <span className={cn("font-semibold", send === "send" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{SEND_LABEL[send]}</span>}
        {cite && <SourceTip cited={cite} />}
        {row.moveUp && (
          <span className="w-full text-muted-foreground sm:text-right">
            {row.moveUp.score} → {CATEGORY_LABELS[row.moveUp.to]}
            {t?.concorded ? " (via concordance)" : ""}
          </span>
        )}
      </div>
    </li>
  );
}
