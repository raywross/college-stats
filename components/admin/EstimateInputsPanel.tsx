import { Empty, Muted, Panel } from "@/components/admin/Panel";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import type { CollegeInputs, InputField, InputHealth } from "@/lib/admin/estimate-inputs";
import { dateLabel } from "@/lib/releases";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const when = (v: string | null) => (v ? (ISO.test(v) ? dateLabel(v) : v) : null);

function Field({ f }: { f: InputField }) {
  return (
    <li className="space-y-0.5 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="font-medium">{f.label}</span>
        <span className="font-mono text-[13px] tabular-nums">{f.value ?? <Muted>Not reported</Muted>}</span>
      </div>
      {f.value !== null && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs text-muted-foreground">
          <dt>Source</dt>
          <dd>
            {f.source ? (
              f.url && /^https?:/.test(f.url) ? (
                <a href={f.url} className="underline decoration-dotted underline-offset-2" rel="noreferrer" target="_blank">
                  {f.source}
                </a>
              ) : (
                f.source
              )
            ) : (
              "Derived"
            )}
            {f.from && <> · from {f.from.map((i) => `${i.label}${i.year ? ` (${i.year})` : ""}`).join("; ")}</>}
          </dd>
          <dt>Describes</dt>
          <dd>{f.describes ?? "Year not stated by the source"}</dd>
          <dt>Published</dt>
          <dd>{when(f.published) ?? "Not dated"}</dd>
          <dt>Collected</dt>
          <dd>{when(f.collected) ?? "Not dated"}</dd>
        </dl>
      )}
    </li>
  );
}

function Input({ input }: { input: InputHealth }) {
  return (
    <section aria-label={input.label} className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h3 className="text-base font-bold">{input.label}</h3>
        {input.core ? <HealthChip status={input.status} /> : <span className="text-xs text-muted-foreground">Supporting: not judged</span>}
      </div>
      {input.reason && <p className="text-sm text-muted-foreground">{input.reason}</p>}
      <ul className="divide-y text-sm">
        {input.fields.map((f) => (
          <Field key={f.path} f={f} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Every fact the admission estimate reads for this college (specs/product/admin-health-views.md "On a college's admin
 * page"): the core inputs with their status first, then the supporting ones; each field's value, source, the year it
 * describes, when its source published it, and when we collected it. Which facts, never how they are combined.
 */
export function EstimateInputsPanel({ inputs }: { inputs: CollegeInputs | null }) {
  return (
    <Panel title="Estimate inputs" id="estimate-inputs" aside={inputs ? <HealthChip status={inputs.overall} /> : undefined}>
      {!inputs ? (
        <Empty>The estimate inputs couldn&apos;t be worked out for this college.</Empty>
      ) : (
        <div className="space-y-6">
          {inputs.inputs.filter((i) => i.core).map((i) => (
            <Input key={i.key} input={i} />
          ))}
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold">Supporting inputs ({inputs.inputs.filter((i) => !i.core).length})</summary>
            <div className="mt-4 space-y-6">
              {inputs.inputs.filter((i) => !i.core).map((i) => (
                <Input key={i.key} input={i} />
              ))}
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}
