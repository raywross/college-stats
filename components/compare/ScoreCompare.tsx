import { getData } from "@/lib/data";
import { satTotal } from "@/lib/metrics";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import type { School } from "@/lib/types";
import { RangeBar } from "@/components/charts/RangeBar";
import { Term } from "@/components/ui/info-tip";
import { YouScoreRow } from "@/components/me/YouScoreRow";

/** SAT total or ACT composite middle 50% per college on one shared axis, with the national median midpoint marked. */
export async function ScoreCompare({ schools, test }: { schools: School[]; test: "sat" | "act" }) {
  const { metricMedian } = await getData();
  // The SAT total each college shows (derived.sat_total: its own CDS total when reported, else the sum of sections).
  const ranges = schools.map((s) => (test === "sat" ? satTotal(s) : s.admissions.act_composite_25_75));
  const present = ranges.filter((r): r is [number, number] => r !== null);
  const title = test === "sat" ? "SAT total" : "ACT composite";
  if (present.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed p-5 text-sm text-muted-foreground">
        None of these colleges report {title} ranges.
      </div>
    );
  }
  const minLo = Math.min(...present.map((r) => r[0]));
  const lo = test === "sat" ? Math.floor((minLo - 60) / 100) * 100 : Math.max(1, minLo - 4);
  const hi = test === "sat" ? 1600 : 36;
  const median = metricMedian(test === "sat" ? "sat" : "act");
  return (
    <div className="rounded-3xl border bg-card p-5">
      <h3 className="mb-4 flex items-center gap-1 font-display text-base font-bold">
        {title}, <Term term="middle-50">middle 50%</Term>
      </h3>
      <div className="space-y-3">
        {schools.map((s, i) => {
          const r = ranges[i];
          return (
            <div key={s.unit_id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[6rem_1fr_5rem]">
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              {r ? (
                <RangeBar low={r[0]} high={r[1]} scale={[lo, hi]} color={SLOT_COLORS[i]} medianMid={median ?? undefined} compact />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {s.admissions.test_policy === "not-considered" ? "Test-blind" : "Not reported"}
                </span>
              )}
              <span className="text-right text-sm font-bold whitespace-nowrap tabular-nums">{r ? `${r[0]}–${r[1]}` : "–"}</span>
            </div>
          );
        })}
        <YouScoreRow test={test} lo={lo} hi={hi} />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Axis runs {lo}–{hi}. The dark tick marks the national median midpoint.
      </p>
    </div>
  );
}
