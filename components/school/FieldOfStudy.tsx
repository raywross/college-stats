import type { Cited } from "@/lib/lineage";
import type { SchoolDetail } from "@/lib/detail";
import { topEarningPrograms, type ProgramEarnings } from "@/lib/field-of-study";
import { DOMAINS } from "@/lib/metrics";
import { money, num } from "@/lib/format";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { InfoTip, SourceChip } from "@/components/ui/info-tip";

/** Never blank or 0 for a value that exists but was too small a group to report (specs/data-lineage.md). */
const TOO_FEW = "Too few graduates to report";

function EarningsDetail({ p, cited }: { p: ProgramEarnings; cited: Cited }) {
  const scaleMax = Math.max(p.earnings.y4 ?? 0, p.earnings.y4_national ?? 0, p.earnings.y1 ?? 0, 1) * 1.25;
  return (
    <div className="mt-3 space-y-3 border-l-2 pl-3">
      <p className="text-xs text-muted-foreground">
        1 year after completion: <b className="text-foreground">{p.earnings.y1 !== null ? money(p.earnings.y1) : TOO_FEW}</b>
      </p>
      {p.earnings.y4 !== null ? (
        <BenchmarkBar
          label="4 years after completion"
          term="earnings-after-completion"
          cited={cited}
          value={p.earnings.y4}
          median={p.earnings.y4_national ?? undefined}
          scale={[0, scaleMax]}
          format={money}
          color={DOMAINS.size.color}
          size="sm"
        />
      ) : (
        <p className="text-xs text-muted-foreground">4 years after completion: {TOO_FEW}</p>
      )}
      {(p.earnings.y4_pell !== null || p.earnings.y4_non_pell !== null) && (
        <p className="text-xs text-muted-foreground">
          4 years out, Pell: <b className="text-foreground">{p.earnings.y4_pell !== null ? money(p.earnings.y4_pell) : TOO_FEW}</b> · Non-Pell:{" "}
          <b className="text-foreground">{p.earnings.y4_non_pell !== null ? money(p.earnings.y4_non_pell) : TOO_FEW}</b>
          <span className="block">(an older graduating class than the figure above — see the (i) for why)</span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Median federal debt: <b className="text-foreground">{p.debt_median !== null ? money(p.debt_median) : TOO_FEW}</b>
        {p.graduates !== null && <> · {num(p.graduates)} graduates, two most recent years combined</>}
      </p>
    </div>
  );
}

/**
 * "Top-earning majors here" (specs/data-expansion/field-of-study.md): the 5 bachelor's programs with the highest
 * post-completion earnings among those with any earnings data, each expandable (native <details>, no client JS) to
 * 1- and 4-year earnings with the national median, the Pell/non-Pell split, debt, and graduate count. Sits right after
 * "Most popular majors" (components/school/Majors.tsx, by graduate count) in the profile's Academics section; that list
 * shows each program's group earnings inline, this card ranks by them.
 */
export function FieldOfStudy({ detail, cited, id }: { detail: SchoolDetail | null; cited: Cited; id?: string }) {
  const top = topEarningPrograms(detail?.tables.programs?.rows, 5);
  if (!top.length) return null;
  return (
    <div id={id} className="rounded-3xl border bg-card p-4 sm:p-6 lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 className="flex items-center gap-1 font-display text-lg font-bold">
          Top-earning majors here <InfoTip term="field-of-study" cited={cited} />
          <SourceChip cited={cited} />
        </h3>
        <p className="text-xs text-muted-foreground">
          By earnings 4 years after completion <InfoTip term="earnings-after-completion" />
        </p>
      </div>
      <ol className="space-y-3">
        {top.map((p) => (
          <li key={p.cip4}>
            <details className="group open:pb-1">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 py-1 [&::-webkit-details-marker]:hidden">
                <span className="truncate text-sm font-medium group-open:font-semibold">{p.title}</span>
                <span className="shrink-0 tabular-nums">
                  <b>{money(p.earnings.y4 ?? p.earnings.y1 ?? 0)}</b>{" "}
                  <span className="text-xs text-muted-foreground">{p.earnings.y4 !== null ? "4 yrs out" : "1 yr out"}</span>
                </span>
              </summary>
              <EarningsDetail p={p} cited={cited} />
            </details>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        Bachelor&apos;s programs only, among graduates who received federal financial aid and were working (not enrolled in school) in the
        measurement year.
      </p>
    </div>
  );
}
