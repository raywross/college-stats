import Link from "next/link";
import { CORE_INPUT_KEYS, INPUT_LABELS, coreInput, type EstimateInputKey } from "@/lib/admin/estimate-inputs";
import type { InputRowView } from "@/lib/admin/estimate-inputs-load";
import { pctSmart } from "@/lib/format";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";

const collegeHref = (unit: string) => `/admin/data/colleges/${unit}#estimate-inputs`;

function Title({ row }: { row: InputRowView }) {
  return (
    <>
      <Link href={collegeHref(row.inputs.unitId)} className="underline decoration-dotted underline-offset-2">
        {row.name}
      </Link>
      <div className="text-xs font-normal text-muted-foreground">
        {row.inputs.unitId}
        {row.state && ` · ${row.state}`}
      </div>
    </>
  );
}

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

const columns: readonly Column<InputRowView>[] = [
  { key: "college", header: "College", role: "title", cell: (row) => <Title row={row} /> },
  { key: "tier", header: "Tier and admit rate", cell: (row) => <Tier row={row} /> },
  { key: "overall", header: "Overall", cell: (row) => <HealthChip status={row.inputs.overall} /> },
  ...CORE_INPUT_KEYS.map((k): Column<InputRowView> => ({ key: k, header: INPUT_LABELS[k], cell: (row) => <InputCell row={row} input={k} /> })),
];

/**
 * Every college in the page's slice by its core estimate inputs, through `ResponsiveTable`. Each input cell shows
 * its status and the year it describes, with the deciding reason as its tooltip; the name opens the college's
 * Estimate inputs panel, which lists every field's source and dates.
 */
export function EstimateInputsTable({ rows }: { rows: InputRowView[] }) {
  return (
    <ResponsiveTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.inputs.unitId}
      caption="Colleges by the health of the estimate's inputs"
      empty="No college matches these filters."
    />
  );
}
