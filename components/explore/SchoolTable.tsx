import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { School, SortKey } from "@/lib/types";
import type { TermKey } from "@/lib/glossary";
import { DOMAINS, METRICS, admitRateGap, admitRatesBySex, aidGenerosity, diversityIndex, satComposite } from "@/lib/metrics";
import { compact, moneyCompact, num, pct, pctSmart } from "@/lib/format";
import { getData } from "@/lib/data";
import { Crest } from "@/components/school/Crest";
import { crestBrand } from "@/lib/brand";
import { CompareButton } from "@/components/compare/CompareButton";
import { AddToListButton } from "@/components/lists/AddToListButton";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;

function sortHref(params: Params, key: SortKey, currentBy: string, currentDir: string) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v) next.set(k, v);
  const dir =
    currentBy === key
      ? currentDir === "asc"
        ? "desc"
        : "asc"
      : ["name", "acceptance_rate", "avg_cost", "net_price", "avg_cost_change", "admit_rate_change"].includes(key)
        ? "asc"
        : "desc";
  next.delete("page");
  next.set("sortBy", key);
  next.set("sortDir", dir);
  return `/explore?${next}`;
}

/** The table with the 10-year change columns switched on or off (`?changes=1`), keeping every other parameter. */
function changesHref(params: Params, on: boolean) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "changes") next.set(k, v);
  if (on) next.set("changes", "1");
  return `/explore?${next}`;
}

/** "+12%" / "−3 pts" / "+0.06" (diversity index), with a muted "from → to" underneath. */
function ChangeCell({ change, points, index, from, to }: { change: number | null; points?: boolean; index?: boolean; from?: string; to?: string }) {
  if (change === null) return <Value v={null} />;
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  const abs = Math.round(Math.abs(change) * 100);
  return (
    <span className="block">
      <span className="font-semibold">{index ? `${sign}${Math.abs(change).toFixed(2)}` : `${sign}${abs}${points ? " pts" : "%"}`}</span>
      {from && to && <span className="block text-[11px] text-muted-foreground">{`${from} → ${to}`}</span>}
    </span>
  );
}

function Value({ v }: { v: string | null }) {
  return v === null ? (
    <span className="text-muted-foreground" title="Not reported">–</span>
  ) : (
    <span className="font-semibold">{v}</span>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(4, (value / max) * 100))}%`, backgroundColor: color }} />
    </span>
  );
}

function SortHeader({
  k,
  label,
  term,
  className,
  params,
  sortBy,
  sortDir,
}: {
  k: SortKey;
  label: string;
  term?: TermKey;
  className?: string;
  params: Params;
  sortBy: string;
  sortDir: string;
}) {
  return (
    <th scope="col" className={cn("px-3 py-3 text-left align-bottom text-xs font-semibold whitespace-nowrap text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <Link
          href={sortHref(params, k, sortBy, sortDir)}
          scroll={false}
          className={cn("inline-flex items-center gap-1 hover:text-foreground", sortBy === k && "text-foreground")}
        >
          {label}
          {sortBy === k && (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </Link>
        {term && <InfoTip term={term} />}
      </span>
    </th>
  );
}

export async function SchoolTable({ schools, params }: { schools: School[]; params: Params }) {
  const { rankOf } = await getData();
  const sortBy = typeof params.sortBy === "string" ? params.sortBy : "applicants";
  const sortDir = typeof params.sortDir === "string" ? params.sortDir : sortBy === "applicants" ? "desc" : "asc";
  const SAT: [number, number] = [800, 1600];
  const changes = params.changes === "1";

  const cols: { key: SortKey; label: string; term?: TermKey; className?: string }[] = [
    // Column order keeps same-looking domain hues apart.
    { key: "acceptance_rate", label: "Admit rate", term: "acceptance-rate" },
    { key: "admit_gap", label: "Admit rate, men / women", term: "admit-rate-by-sex", className: "min-w-32" },
    { key: "enrollment", label: "Undergrads", term: "undergrad-enrollment" },
    { key: "sat", label: "SAT middle 50%", term: "middle-50", className: "min-w-36" },
    { key: "pell", label: "Pell", term: "pell-grant" },
    { key: "first_gen", label: "First-gen", term: "first-gen" },
    { key: "out_of_state", label: "Out of state", term: "in-state-student" },
    { key: "transfer_share", label: "Transfers, share of new", term: "transfer-in" },
    { key: "bachelors", label: "Bachelor's degrees, top major", term: "first-major", className: "min-w-52" },
    { key: "men_share", label: "Men", term: "gender-balance" },
    { key: "diversity", label: "Diversity", term: "diversity-index" },
    { key: "avg_cost", label: "Avg cost", term: "average-cost" },
    { key: "aid_generosity", label: "Aid generosity", term: "aid-generosity" },
    { key: "earnings", label: "Earnings", term: "median-earnings" },
    { key: "grad_rate", label: "Grad rate", term: "graduation-rate" },
    { key: "completion_8yr", label: "8-yr completion, all", term: "outcome-measures" },
    { key: "pell_gap", label: "Grad rate, Pell / neither", term: "pell-graduation-gap", className: "min-w-32" },
    { key: "loan_rate", label: "Borrow", term: "federal-loan-rate" },
    ...(changes
      ? [
          { key: "avg_cost_change" as const, label: "Avg cost, 10-yr change", term: "inflation-adjusted" as const },
          { key: "admit_rate_change" as const, label: "Admit rate, then → now", term: "acceptance-rate" as const },
          { key: "size_change" as const, label: "Undergrads, 10-yr change", term: "undergrad-enrollment" as const },
          { key: "apps_change" as const, label: "Applications, 10-yr change", term: "applicants" as const },
          { key: "diversity_change" as const, label: "Diversity, then → now", term: "diversity-index" as const },
          { key: "men_share_change" as const, label: "Men, then → now", term: "gender-balance" as const },
          { key: "loan_rate_change" as const, label: "Borrow, then → now", term: "federal-loan-rate" as const },
          { key: "pell_gap_change" as const, label: "Pell gap, then → now", term: "pell-graduation-gap" as const },
        ]
      : []),
  ];

  return (
    <div>
    <p className="mb-2 flex justify-end text-xs">
      <Link href={changesHref(params, !changes)} scroll={false} className="font-semibold text-primary hover:underline">
        {changes ? "Hide 10-year changes" : "Show 10-year changes"}
      </Link>
    </p>
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="overflow-x-auto">
        <table className={cn("w-full text-sm", changes ? "min-w-[3200px]" : "min-w-[2180px]")}>
          <thead className="border-b bg-surface-2">
            <tr>
              <SortHeader k="name" label="School" className="sticky left-0 z-10 bg-surface-2 pl-4" params={params} sortBy={sortBy} sortDir={sortDir} />
              {cols.map((c) => (
                <SortHeader key={c.key} k={c.key} label={c.label} term={c.term} className={c.className} params={params} sortBy={sortBy} sortDir={sortDir} />
              ))}
              <th className="px-3 py-3" aria-label="Compare" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {schools.map((s) => {
              const sat = satComposite(s);
              const left = sat ? ((sat[0] - SAT[0]) / (SAT[1] - SAT[0])) * 100 : 0;
              const width = sat ? ((sat[1] - sat[0]) / (SAT[1] - SAT[0])) * 100 : 0;
              const div = diversityIndex(s);
              const { acceptance_rate: ar } = s.admissions;
              const bySex = admitRatesBySex(s);
              const gap = admitRateGap(s);
              const { pell_grant_percent: pell, first_gen_percent: fg, men_share: men } = s.demographics;
              const transfer = METRICS.transferShare.get(s);
              const bachelors = s.academics?.bachelors_awarded ?? null;
              const topMajor = s.academics?.majors_top?.[0] ?? null;
              return (
                <tr key={s.unit_id} data-unit-id={s.unit_id} className="group transition-colors hover:bg-muted/40">
                  <td className="sticky left-0 z-10 bg-card py-2.5 pr-3 pl-4 transition-colors group-hover:bg-muted">
                    <Link href={`/schools/${s.unit_id}`} className="flex items-center gap-2.5">
                      <Crest id={s.unit_id} name={s.name} size="sm" brand={crestBrand(s)} />
                      <span className="min-w-0">
                        <span className="block max-w-44 truncate font-semibold group-hover:text-primary">{s.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {s.location.city}, {s.location.state}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="w-28 px-3 tabular-nums">
                    <Value v={ar === null ? null : pctSmart(ar)} />
                    {ar !== null && <Bar value={ar} max={1} color={DOMAINS.admissions.color} />}
                  </td>
                  <td className="w-32 px-3 tabular-nums">
                    <Value v={bySex.men === null || bySex.women === null ? null : `${pctSmart(bySex.men)} / ${pctSmart(bySex.women)}`} />
                    {gap !== null && Math.abs(gap) >= 0.03 && (
                      <span className="block text-[11px] text-muted-foreground">{METRICS.admitGap.format(gap)}</span>
                    )}
                  </td>
                  <td className="w-28 px-3 tabular-nums">
                    <Value v={compact(s.demographics.undergrad_enrollment)} />
                    <Bar value={rankOf(s, "enrollment") ?? 0} max={1} color={DOMAINS.size.color} />
                  </td>
                  <td className="px-3 tabular-nums">
                    <Value v={sat ? `${sat[0]}–${sat[1]}` : null} />
                    {sat && (
                      <span className="relative mt-1 block h-1.5 rounded-full bg-muted">
                        <span
                          className="absolute inset-y-0 rounded-full"
                          style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(2, width)}%`, backgroundColor: DOMAINS.scores.color }}
                        />
                      </span>
                    )}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={pell === null ? null : pct(pell)} />
                    {pell !== null && <Bar value={pell} max={1} color={DOMAINS.access.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={fg === null ? null : pct(fg)} />
                    {fg !== null && <Bar value={fg} max={1} color={DOMAINS.access.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={s.demographics.residence ? pct(s.demographics.residence.out_of_state) : null} />
                    {s.demographics.residence && <Bar value={s.demographics.residence.out_of_state} max={1} color={DOMAINS.diversity.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={transfer === null ? null : pct(transfer)} />
                    {transfer !== null && <Bar value={transfer} max={1} color={DOMAINS.access.color} />}
                  </td>
                  <td className="w-52 px-3">
                    <Value v={bachelors == null ? null : num(bachelors)} />
                    {topMajor && (
                      <span className="block max-w-48 truncate text-[11px] text-muted-foreground" title={`${topMajor.title}: ${pct(topMajor.share)} of graduates`}>
                        {topMajor.title} · {pct(topMajor.share)}
                      </span>
                    )}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={men == null ? null : pct(men)} />
                    {men != null && <Bar value={men} max={1} color={DOMAINS.access.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={div === null ? null : div.toFixed(2)} />
                    {div !== null && <Bar value={div} max={1} color={DOMAINS.diversity.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={s.cost?.avg_paid_all == null ? null : moneyCompact(s.cost.avg_paid_all)} />
                    {s.cost?.avg_paid_all != null && <Bar value={s.cost.avg_paid_all} max={80000} color={DOMAINS.value.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={aidGenerosity(s) === null ? null : pct(aidGenerosity(s)!)} />
                    {aidGenerosity(s) !== null && <Bar value={aidGenerosity(s)!} max={1} color={DOMAINS.value.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={s.outcomes?.median_earnings_10yr == null ? null : moneyCompact(s.outcomes.median_earnings_10yr)} />
                    {s.outcomes?.median_earnings_10yr != null && (
                      <Bar value={s.outcomes.median_earnings_10yr} max={150000} color={DOMAINS.value.color} />
                    )}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={s.outcomes?.graduation_rate == null ? null : pct(s.outcomes.graduation_rate)} />
                    {s.outcomes?.graduation_rate != null && <Bar value={s.outcomes.graduation_rate} max={1} color={DOMAINS.value.color} />}
                  </td>
                  <td className="w-32 px-3 tabular-nums">
                    <Value
                      v={s.outcomes?.grad_rate_pell == null || s.outcomes.grad_rate_no_pell_no_loan == null ? null : `${pct(s.outcomes.grad_rate_pell)} / ${pct(s.outcomes.grad_rate_no_pell_no_loan)}`}
                    />
                    {METRICS.pellGap.get(s) !== null && <span className="block text-[11px] text-muted-foreground">{METRICS.pellGap.format(METRICS.pellGap.get(s)!)}</span>}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={s.outcomes?.eight_year?.all.award == null ? null : pct(s.outcomes.eight_year.all.award)} />
                    {s.outcomes?.eight_year?.all.award != null && <Bar value={s.outcomes.eight_year.all.award} max={1} color={DOMAINS.value.color} />}
                  </td>
                  <td className="w-24 px-3 tabular-nums">
                    <Value v={s.outcomes?.federal_loan_rate == null ? null : pct(s.outcomes.federal_loan_rate)} />
                    {s.outcomes?.federal_loan_rate != null && <Bar value={s.outcomes.federal_loan_rate} max={1} color={DOMAINS.value.color} />}
                  </td>
                  {changes && (
                    <>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          change={s.trends?.avg_paid_all?.change ?? null}
                          from={s.trends?.avg_paid_all ? moneyCompact(s.trends.avg_paid_all.from) : undefined}
                          to={s.trends?.avg_paid_all ? moneyCompact(s.trends.avg_paid_all.to) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          points
                          change={s.trends?.acceptance_rate?.change ?? null}
                          from={s.trends?.acceptance_rate ? pctSmart(s.trends.acceptance_rate.from) : undefined}
                          to={s.trends?.acceptance_rate ? pctSmart(s.trends.acceptance_rate.to) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          change={METRICS.sizeChange.get(s)}
                          from={s.trends?.undergrads ? compact(s.trends.undergrads.from) : undefined}
                          to={s.trends?.undergrads ? compact(s.trends.undergrads.to) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          change={METRICS.applicantsChange.get(s)}
                          from={s.trends?.applicants ? compact(s.trends.applicants.from) : undefined}
                          to={s.trends?.applicants ? compact(s.trends.applicants.to) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          index
                          change={METRICS.diversityChange.get(s)}
                          from={s.trends?.diversity ? s.trends.diversity.from.toFixed(2) : undefined}
                          to={s.trends?.diversity ? s.trends.diversity.to.toFixed(2) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          points
                          change={METRICS.menShareChange.get(s)}
                          from={s.trends?.men_share ? pct(s.trends.men_share.from) : undefined}
                          to={s.trends?.men_share ? pct(s.trends.men_share.to) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          points
                          change={METRICS.loanRateChange.get(s)}
                          from={s.trends?.federal_loan_rate ? pct(s.trends.federal_loan_rate.from) : undefined}
                          to={s.trends?.federal_loan_rate ? pct(s.trends.federal_loan_rate.to) : undefined}
                        />
                      </td>
                      <td className="w-32 px-3 tabular-nums">
                        <ChangeCell
                          points
                          change={METRICS.pellGapChange.get(s)}
                          from={s.trends?.pell_gap ? `${Math.round(s.trends.pell_gap.from * 100)} pts` : undefined}
                          to={s.trends?.pell_gap ? `${Math.round(s.trends.pell_gap.to * 100)} pts` : undefined}
                        />
                      </td>
                    </>
                  )}
                  <td className="px-3 pr-4 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <CompareButton id={s.unit_id} variant="icon" />
                      <AddToListButton ids={s.unit_id} variant="icon" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    {changes && (
      <p className="mt-2 text-[11px] text-muted-foreground">
        Changes over each college&apos;s last 10 years of federal data: average cost after inflation; acceptance rate in percentage points;
        diversity index, men&apos;s share, borrowing, and the Pell graduation gap (by entering class, 100+ Pell students) in points; undergraduate, men&apos;s share, and borrowing changes left out for campuses under 300 students, and applications under 200
        applicants.
      </p>
    )}
    </div>
  );
}
