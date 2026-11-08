import Link from "next/link";
import { CORE_INPUT_KEYS, INPUT_LABELS, type InputCounts } from "@/lib/admin/estimate-inputs";
import { STATUS_LABELS, type HealthStatus } from "@/lib/admin/health-rules";
import { inputsHref, type InputFilters } from "@/lib/admin/inputs-view";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { cn } from "@/lib/utils";

const BASE = "/admin/data/health";
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

      <InputTable counts={counts} filters={filters} />
    </section>
  );
}

function InputTable({ counts, filters }: { counts: InputCounts; filters: InputFilters }) {
  const columns: Column<EstimateInputKeyRow>[] = [
    { key: "input", header: "Input", role: "title", cell: (k) => INPUT_LABELS[k] },
    ...STATUSES.map((s): Column<EstimateInputKeyRow> => ({
      key: s,
      header: STATUS_LABELS[s],
      align: "right",
      cell: (k) => {
        const n = counts.inputs[k][s];
        const on = filters.input === k && filters.status === s;
        return n === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <Link
            href={on ? inputsHref(BASE, filters, { input: null, status: null }) : inputsHref(BASE, filters, { input: k, status: s })}
            aria-current={on ? "true" : undefined}
            className={cn("inline-block min-w-8 rounded-md px-1.5 py-0.5 underline decoration-dotted underline-offset-2", on && "bg-foreground text-background no-underline")}
          >
            {num(n)}
          </Link>
        );
      },
    })),
  ];
  return <ResponsiveTable rows={CORE_INPUT_KEYS} columns={columns} rowKey={(k) => k} caption="By core input" empty="No core input." />;
}

type EstimateInputKeyRow = (typeof CORE_INPUT_KEYS)[number];
