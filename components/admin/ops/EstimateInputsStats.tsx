import Link from "next/link";
import { CORE_INPUT_KEYS, INPUT_LABELS, type InputCounts } from "@/lib/admin/estimate-inputs";
import { STATUS_LABELS, type HealthStatus } from "@/lib/admin/health-rules";
import { inputsHref, type InputFilters } from "@/lib/admin/inputs-view";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { cn } from "@/lib/utils";

const BASE = "/admin/health";
const num = (n: number) => n.toLocaleString("en-US");
/** Worst first. Only the admit rate can be Failing (specs/product/admin-health-views.md "Status per input"). */
const STATUSES: HealthStatus[] = ["failing", "stale", "watch", "fresh"];

/**
 * The Estimate inputs stat row: colleges by overall status, then per core input how many colleges are at each status.
 * Every number links to the table filtered to it; the filter on now is outlined. Counts cover every college.
 */
export function EstimateInputsStats({ counts, filters }: { counts: InputCounts; filters: InputFilters }) {
  const overallOn = (s: HealthStatus) => filters.status === s && !filters.input;
  return (
    <section aria-labelledby="inputs-stats" className="space-y-4">
      <h2 id="inputs-stats" className="sr-only">
        Colleges by the health of the estimate&apos;s inputs
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <li className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Colleges</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">{num(counts.total)}</p>
        </li>
        {STATUSES.map((s) => (
          <li key={s}>
            <Link
              href={inputsHref(BASE, filters, { status: overallOn(s) ? null : s, input: null })}
              aria-current={overallOn(s) ? "true" : undefined}
              className={cn("block h-full rounded-2xl border bg-card p-4 transition-colors hover:bg-muted", overallOn(s) ? "border-foreground ring-1 ring-foreground" : "border-border")}
            >
              <HealthChip status={s} className="text-muted-foreground" />
              <p className="mt-1 font-display text-3xl font-bold tabular-nums">
                {num(counts.overall[s])}
                <span className="sr-only"> {STATUS_LABELS[s]} colleges</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="px-4 pt-3 text-left text-sm font-semibold">By core input</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">
                Input
              </th>
              {STATUSES.map((s) => (
                <th key={s} scope="col" className="px-3 py-2 text-right font-medium">
                  {STATUS_LABELS[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORE_INPUT_KEYS.map((k) => (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {INPUT_LABELS[k]}
                </th>
                {STATUSES.map((s) => {
                  const n = counts.inputs[k][s];
                  const on = filters.input === k && filters.status === s;
                  return (
                    <td key={s} className="px-3 py-2 text-right tabular-nums">
                      {n === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <Link
                          href={on ? inputsHref(BASE, filters, { input: null, status: null }) : inputsHref(BASE, filters, { input: k, status: s })}
                          aria-current={on ? "true" : undefined}
                          className={cn("inline-block min-w-8 rounded-md px-1.5 py-0.5 underline decoration-dotted underline-offset-2", on && "bg-foreground text-background no-underline")}
                        >
                          {num(n)}
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
