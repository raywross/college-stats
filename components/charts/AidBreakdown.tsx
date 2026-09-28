import type { School } from "@/lib/types";
import { INCOME_BANDS } from "@/lib/metrics";
import { money, moneyCompact, num, pct } from "@/lib/format";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import { SourceNote } from "@/components/sources/SourceNote";
import { getData } from "@/lib/data";
import { stickerPhrase } from "@/lib/insights";

const COLOR = "var(--d-value)";

function ShareBar({ label, share, avg, term }: { label: string; share: number | null; avg?: number | null; term?: Parameters<typeof MetricLabel>[0]["term"] }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-xs sm:grid-cols-[10rem_1fr_auto]">
      <MetricLabel term={term} className="text-muted-foreground">
        {label}
      </MetricLabel>
      <span className="h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${COLOR} 16%, transparent)` }}>
        {share !== null && (
          <span className="block h-full origin-left animate-grow-x rounded-full" style={{ width: `${Math.max(1.5, share * 100)}%`, backgroundColor: COLOR }} />
        )}
      </span>
      <span className="w-[7.5rem] text-right whitespace-nowrap tabular-nums">
        {share === null ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <>
            <b>{pct(share)}</b>
            {avg != null && <span className="text-muted-foreground"> · avg {moneyCompact(avg)}</span>}
          </>
        )}
      </span>
    </div>
  );
}

/**
 * "Who actually gets aid": grant vs. no-grant split, aid by source, federal-aid
 * recipients by family income, and Common Data Set need/merit detail when the
 * school publishes one.
 */
export async function AidBreakdown({ school }: { school: School }) {
  const { citeField } = await getData();
  const aid = school.aid;
  const grant = aid?.grant_pct ?? null;
  const cds = aid?.cds;
  const byIncome = aid?.by_income ?? null;
  const counts = byIncome?.counts ?? [];
  const federalTotal = counts.reduce<number>((a, b) => a + (b ?? 0), 0);
  const maxCount = Math.max(1, ...counts.map((c) => c ?? 0));
  const noGrant = grant === null ? null : 1 - grant;

  // Partition the whole first-year class so the income table (federal-aid recipients only) isn't mistaken for everyone.
  const cohort = aid?.cohort ?? null;
  const grantCount = aid?.grant_count ?? null;
  const fedGranted = byIncome?.granted?.reduce<number>((a, b) => a + (b ?? 0), 0) ?? null;
  const fedGrantTotal = byIncome?.total_grants?.reduce<number>((a, b) => a + (b ?? 0), 0) ?? null;
  const otherGranted = grantCount !== null && fedGranted !== null ? grantCount - fedGranted : null;
  const otherAvg =
    otherGranted && otherGranted > 0 && aid?.grant_total != null && fedGrantTotal !== null
      ? (aid.grant_total - fedGrantTotal) / otherGranted
      : null;
  const noneCount = cohort !== null && grantCount !== null ? cohort - grantCount : null;
  const fedAvg = fedGranted && fedGrantTotal !== null ? fedGrantTotal / fedGranted : null;
  const classRows =
    cohort && fedGranted !== null && otherGranted !== null && noneCount !== null && otherGranted >= 0
      ? [
          { label: "Federal aid + grants", n: fedGranted, note: fedAvg !== null ? `avg grant ${moneyCompact(fedAvg)}` : "", color: COLOR },
          { label: "Grants, no federal aid", n: otherGranted, note: otherAvg !== null ? `avg grant ${moneyCompact(otherAvg)}` : "", color: `color-mix(in oklch, ${COLOR} 45%, var(--card))` },
          { label: "No grants", n: noneCount, note: "pay full price", color: "color-mix(in oklch, var(--foreground) 30%, transparent)" },
        ]
      : null;
  const oneIn = noGrant && noGrant > 0.05 ? Math.round(1 / noGrant) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Grants split + by source */}
        <div className="space-y-6 rounded-3xl border bg-card p-5 sm:p-6">
          <div>
            <h3 className="flex items-center gap-1 font-display text-lg font-bold">
              Who gets grants <span className="sr-only">and scholarships</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Full-time first-year students{aid?.cohort != null && <> ({num(aid.cohort)})</>}, {citeField("aid.grant_pct", school).year}
            </p>
          </div>
          {grant !== null ? (
            <div className="space-y-2">
              <div className="flex h-8 gap-[2px] overflow-hidden rounded-lg" role="img" aria-label={`${pct(grant)} received grants, ${pct(1 - grant)} did not`}>
                <div className="flex origin-left animate-grow-x items-center rounded-l-lg px-2 text-xs font-bold text-[#1f1402]" style={{ width: `${grant * 100}%`, backgroundColor: COLOR }}>
                  {grant >= 0.18 && pct(grant)}
                </div>
                <div className="flex flex-1 items-center justify-end rounded-r-lg bg-muted px-2 text-xs font-bold">{1 - grant >= 0.12 && pct(1 - grant)}</div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: COLOR }} />
                  Received grants or scholarships{aid?.grant_avg != null && <>, avg {money(aid.grant_avg)}</>}
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2.5 rounded-full bg-muted ring-1 ring-foreground/10" /> No grants
                </span>
              </div>
              {oneIn && (
                <p className="text-sm">
                  About <b>1 in {oneIn}</b> first-year students got no grant aid and paid the full sticker price
                  {stickerPhrase(school) ? <> of <b>{stickerPhrase(school)}</b></> : ""}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Grant aid isn&apos;t reported.</p>
          )}

          <div className="space-y-2.5">
            <p className="text-sm font-medium">Where the aid comes from</p>
            <ShareBar label="From the college" share={aid?.institutional_pct ?? null} avg={aid?.institutional_avg} term="institutional-aid" />
            <ShareBar label="Pell Grants" share={aid?.pell_pct ?? null} avg={aid?.pell_avg} term="pell-grant" />
            <ShareBar label="State or local grants" share={aid?.state_pct ?? null} />
            <ShareBar label="Student loans" share={aid?.loan_pct ?? null} avg={aid?.loan_avg} term="median-debt" />
            <p className="text-[11px] text-muted-foreground">Share of first-year students receiving each; averages are per recipient.</p>
          </div>
        </div>

        {/* By family income */}
        <div className="rounded-3xl border bg-card p-5 sm:p-6">
          <h3 className="flex items-center gap-1 font-display text-lg font-bold">
            Aid by family income <InfoTip term="federal-aid" />
          </h3>
          {classRows && cohort && (
            <div className="mt-3 mb-6 space-y-2">
              <p className="text-xs font-semibold">The whole first-year class ({num(cohort)})</p>
              <div className="flex h-4 gap-[2px] overflow-hidden rounded-md" role="img" aria-label={classRows.map((r) => `${r.label}: ${r.n}`).join(", ")}>
                {classRows.map((r) => (
                  <div key={r.label} className="h-full origin-left animate-grow-x first:rounded-l-md last:rounded-r-md" style={{ width: `${(r.n / cohort) * 100}%`, backgroundColor: r.color }} />
                ))}
              </div>
              <ul className="space-y-1 text-xs">
                {classRows.map((r) => (
                  <li key={r.label} className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="ml-auto font-semibold tabular-nums">{num(r.n)}</span>
                    <span className="w-28 text-right text-muted-foreground">{r.note}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Students with grants but no federal aid usually got the college&apos;s own need-based aid (without federal loans or
                Pell) or merit aid.
              </p>
            </div>
          )}
          <p className="mb-4 text-xs text-muted-foreground">
            <b className="text-foreground">By family income</b>: only students who received federal aid
            {federalTotal > 0 && aid?.cohort ? (
              <>
                {" "}({num(federalTotal)} of {num(aid.cohort)})
              </>
            ) : null}
            , because income is only reported for them.
          </p>
          {byIncome ? (
            <div className="space-y-3">
              <div className="grid grid-cols-[4.5rem_1fr_4.5rem] gap-3 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                <span>Income</span>
                <span>Students</span>
                <span className="text-right">Avg grant</span>
              </div>
              {INCOME_BANDS.map((band, i) => {
                const c = counts[i];
                const g = byIncome.avg_grant[i];
                return (
                  <div key={band} className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-3 text-xs">
                    <span className="font-medium text-muted-foreground">{band}</span>
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        {c != null && (
                          <span
                            className="block h-full origin-left animate-grow-x rounded-full"
                            style={{ width: `${Math.max(2, (c / maxCount) * 100)}%`, backgroundColor: COLOR, animationDelay: `${i * 60}ms` }}
                          />
                        )}
                      </span>
                      <span className="w-9 text-right font-semibold tabular-nums">{c == null ? "–" : num(c)}</span>
                    </span>
                    <span className="text-right font-semibold tabular-nums">{g == null ? "–" : moneyCompact(g)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aid by family income isn&apos;t reported.</p>
          )}
        </div>
      </div>

      {cds && school.cds && (
        <div className="rounded-3xl border bg-card p-5 sm:p-6">
          <h3 className="font-display text-lg font-bold">From {school.name}&apos;s Common Data Set</h3>
          <p className="mb-4 text-xs text-muted-foreground">All full-time undergraduates, {citeField("aid.cds", school).year}. More detail than federal surveys collect.</p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                k: "Have financial need",
                v: cds.has_need != null && cds.undergrads ? pct(cds.has_need / cds.undergrads) : null,
                sub: cds.has_need != null ? `${num(cds.has_need)} students` : null,
                term: "need-based-aid" as const,
              },
              {
                k: "Of need met, on average",
                v: cds.pct_need_met != null ? pct(cds.pct_need_met) : null,
                sub: cds.need_fully_met != null && cds.has_need ? `${pct(cds.need_fully_met / cds.has_need)} fully met` : null,
                term: "need-met" as const,
              },
              {
                k: "Avg need-based grant",
                v: cds.avg_need_grant != null ? moneyCompact(cds.avg_need_grant) : null,
                sub: cds.avg_package != null ? `total package ${moneyCompact(cds.avg_package)}` : null,
                term: "need-based-aid" as const,
              },
              {
                k: "Merit aid, no need",
                v: cds.merit_no_need != null ? num(cds.merit_no_need) : null,
                sub: cds.merit_avg != null ? `avg ${moneyCompact(cds.merit_avg)}` : null,
                term: "merit-aid" as const,
              },
            ]
              .filter((d) => d.v !== null)
              .map((d) => (
                <div key={d.k} className="rounded-2xl bg-muted/60 p-3">
                  <dt>
                    <MetricLabel term={d.term} className="text-[11px] font-semibold text-muted-foreground">
                      {d.k}
                    </MetricLabel>
                  </dt>
                  <dd className="mt-1 font-display text-2xl font-extrabold">{d.v}</dd>
                  {d.sub && <dd className="text-[11px] text-muted-foreground">{d.sub}</dd>}
                </div>
              ))}
          </dl>
          <SourceNote fields={["aid.cds"]} school={school} className="mt-4" />
        </div>
      )}
    </div>
  );
}
