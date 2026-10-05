import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { POWER_FOUR } from "@/lib/conferences";
import { formatBy, type FormatKind } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import type { ConferenceRow, ConferencesFile } from "@/lib/trends";
import { Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";

interface Metric {
  key: string;
  label: string;
  term: TermKey;
  format: FormatKind;
  color: string;
  value: (r: ConferenceRow) => number | null;
  signed?: boolean;
}

/**
 * The Power 4 side by side (specs/trends/conferences.md): one card per conference, four measures each, every bar on
 * the same scale across the four cards so they compare at a glance. Values printed; years from the file.
 */
export function PowerFour({ file }: { file: ConferencesFile }) {
  const rows = POWER_FOUR.map((c) => file.conferences.find((r) => r.code === c)).filter((r): r is ConferenceRow => !!r && !r.tooFew);
  if (!rows.length) return null;
  const g = (k: string) => file.glance.find((x) => x.key === k);
  const fall = (y: number | null | undefined) => (y ? historyYearLabel(y, "fall").toLowerCase() : "");
  const ar = g("acceptance_rate");
  const cost = g("avg_paid_all");
  const ug = g("undergrads");
  const apps = file.measures.find((m) => m.key === "applicants")!;
  const metrics: Metric[] = [
    { key: "ar", label: `Acceptance rate, ${fall(ar?.year)}`, term: "acceptance-rate", format: "pct", color: "var(--d-admissions)", value: (r) => r.glance?.acceptance_rate?.median ?? null },
    {
      key: "cost",
      label: `Average total cost, ${cost?.year ? historyYearLabel(cost.year, "academic") : ""}`,
      term: "average-cost",
      format: "money",
      color: "var(--d-value)",
      value: (r) => r.glance?.avg_paid_all?.median ?? null,
    },
    { key: "ug", label: `Undergraduates, ${fall(ug?.year)}`, term: "undergrad-enrollment", format: "compact", color: "var(--d-size)", value: (r) => r.glance?.undergrads?.median ?? null },
    {
      key: "apps",
      label: `Applications, ${fall(apps.from)} to ${fall(apps.to)}`,
      term: "applicants",
      format: "pct",
      color: "var(--d-admissions)",
      value: (r) => r.change?.applicants ?? null,
      signed: true,
    },
  ];
  const max = Object.fromEntries(metrics.map((m) => [m.key, Math.max(...rows.map((r) => Math.abs(m.value(r) ?? 0)))]));

  return (
    <div className="grid gap-4 max-sm:gap-3 max-sm:rail sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((r) => (
        <Link key={r.code} href={`/trends/conferences/${r.slug}`} className="group min-w-0 rounded-3xl border bg-card p-4 transition-colors hover:border-primary sm:p-5">
          <p className="font-display text-lg leading-tight font-bold group-hover:text-primary">{r.name}</p>
          <p className="text-xs text-muted-foreground">{r.members.length} members on the site · medians</p>
          <dl className="mt-4 space-y-3">
            {metrics.map((m) => {
              const v = m.value(r);
              return (
                <div key={m.key}>
                  <dt className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{m.label}</span>
                    <b className="text-sm text-foreground tabular-nums">
                      {v === null ? "—" : `${m.signed && v > 0 ? "+" : m.signed && v < 0 ? "−" : ""}${formatBy(m.format, m.signed ? Math.abs(v) : v)}`}
                    </b>
                  </dt>
                  <dd className="mt-1 h-1.5 rounded-full bg-foreground/8">
                    {v !== null && max[m.key] > 0 && <div className="h-full rounded-full" style={{ width: `${(Math.abs(v) / max[m.key]) * 100}%`, background: m.color }} />}
                  </dd>
                </div>
              );
            })}
          </dl>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary">
            See the conference <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}

/** The Power 4 strip's footnote: what the numbers are. */
export function PowerFourNote({ file }: { file: ConferencesFile }) {
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      Median member of each conference, today&apos;s members (<Term term="conference-membership">which members</Term>). Applications is the median
      member&apos;s own change. Each measure&apos;s bars share one scale across the four cards. {file.conferences.length} conferences in all.
    </p>
  );
}
