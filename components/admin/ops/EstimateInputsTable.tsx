import Link from "next/link";
import { CORE_INPUT_KEYS, INPUT_LABELS, coreInput, type EstimateInputKey } from "@/lib/admin/estimate-inputs";
import type { InputRowView } from "@/lib/admin/estimate-inputs-load";
import { pctSmart } from "@/lib/format";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";

const collegeHref = (unit: string) => `/admin/colleges/${unit}#estimate-inputs`;

function InputCell({ row, input }: { row: InputRowView; input: EstimateInputKey }) {
  const i = coreInput(row.inputs, input);
  if (!i) return <span className="text-muted-foreground">—</span>;
  return (
    <div title={i.reason}>
      <HealthChip status={i.status} />
      <div className="text-xs text-muted-foreground">{i.year ?? (i.status === "fresh" ? "" : "—")}</div>
    </div>
  );
}

function Tier({ row }: { row: InputRowView }) {
  return (
    <>
      <span>{row.tier.label}</span>
      <span className="text-muted-foreground"> · {row.admitRate === null ? "no admit rate" : `${pctSmart(row.admitRate)} admitted`}</span>
    </>
  );
}

/**
 * Every college in the page's slice by its core estimate inputs: a table from `md`, cards below it. Each input cell
 * shows its status and the year it describes, with the deciding reason as its tooltip; the name opens the college's
 * Estimate inputs panel, which lists every field's source and dates.
 */
export function EstimateInputsTable({ rows }: { rows: InputRowView[] }) {
  if (!rows.length) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No college matches these filters.</p>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
        <table className="w-full min-w-[60rem] text-sm">
          <caption className="sr-only">Colleges by the health of the estimate&apos;s inputs</caption>
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                College
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Tier and admit rate
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Overall
              </th>
              {CORE_INPUT_KEYS.map((k) => (
                <th key={k} scope="col" className="px-3 py-2 font-medium">
                  {INPUT_LABELS[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.inputs.unitId} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <Link href={collegeHref(row.inputs.unitId)} className="underline decoration-dotted underline-offset-2">
                    {row.name}
                  </Link>
                  <div className="text-xs font-normal text-muted-foreground">
                    {row.inputs.unitId}
                    {row.state && ` · ${row.state}`}
                  </div>
                </th>
                <td className="px-3 py-2">
                  <Tier row={row} />
                </td>
                <td className="px-3 py-2">
                  <HealthChip status={row.inputs.overall} />
                </td>
                {CORE_INPUT_KEYS.map((k) => (
                  <td key={k} className="px-3 py-2">
                    <InputCell row={row} input={k} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.inputs.unitId} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={collegeHref(row.inputs.unitId)} className="font-semibold underline decoration-dotted underline-offset-2">
                  {row.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {row.inputs.unitId}
                  {row.state && ` · ${row.state}`}
                </div>
              </div>
              <HealthChip status={row.inputs.overall} />
            </div>
            <p className="mt-1 text-sm">
              <Tier row={row} />
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {CORE_INPUT_KEYS.map((k) => (
                <div key={k}>
                  <div className="text-xs font-medium text-muted-foreground">{INPUT_LABELS[k]}</div>
                  <InputCell row={row} input={k} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
