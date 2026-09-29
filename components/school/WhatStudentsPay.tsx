import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { stickerPhrase } from "@/lib/insights";
import { DOMAINS } from "@/lib/metrics";
import { money, moneyCompact, pct } from "@/lib/format";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { CostBreakdown } from "@/components/charts/CostBreakdown";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";

const COLOR = DOMAINS.value.color;

/**
 * The headline cost view: estimated average paid by ALL first-years, split into
 * students with grants (average net price) and without (full sticker price),
 * plus sticker prices by residency for public universities. Same-year IPEDS data.
 */
export async function WhatStudentsPay({ school }: { school: School }) {
  const { metricMedian } = await getData();
  const c = school.cost;
  const all = c?.avg_paid_all ?? null;
  const share = school.aid?.grant_pct ?? null;
  const aided = c?.aided_net_price ?? null;
  const sticker = c?.sticker;
  const tf = c?.tuition_fees;
  const res = c?.residency;
  const year = c?.year ?? "";
  const isPublic = school.type === "public";
  const inState = sticker?.in_state ?? sticker?.in_district ?? null;
  const stickerText = stickerPhrase(school);

  const residencyRows = isPublic
    ? ([
        { key: "in_district", label: "In-district" },
        { key: "in_state", label: "In-state" },
        { key: "out_of_state", label: "Out-of-state" },
      ] as const).filter(
        (r) =>
          tf?.[r.key] != null &&
          // Show in-district only when it's a distinct rate someone actually pays.
          (r.key !== "in_district" || ((res?.in_district ?? 0) > 0 && tf.in_district !== tf.in_state))
      )
    : [];
  const livingCosts = inState !== null && tf?.in_state != null ? inState - tf.in_state : null;

  if (all === null && !sticker) return null;

  // National comparison + caveats: under the breakdown for publics; in the (otherwise short) right column for privates.
  const comparison = (
    <div className="space-y-5">
          {all !== null && (
          <BenchmarkBar
            label="Compared to all colleges"
            value={all}
            median={metricMedian("avgCost") ?? undefined}
            scale={[0, 80000]}
            format={money}
            color={COLOR}
            size="sm"
          />
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Housing and food use the college&apos;s on-campus rates, so the estimate runs high where many students live at
          home. &ldquo;Other expenses&rdquo; is the college&apos;s estimate of personal and transportation costs. Loans aren&apos;t
          subtracted because they&apos;re repaid.
        </p>
    </div>
  );

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.25fr] lg:gap-10">
        {/* Headline estimate */}
        <div className="space-y-5">
          <div>
            <MetricLabel term="average-cost" className="text-xs font-semibold text-muted-foreground">
              Average total cost per year, all first-years (est.)
            </MetricLabel>
            <p className="mt-1 font-display text-5xl font-extrabold tracking-tight">{all !== null ? money(all) : "–"}</p>
            <p className="text-xs text-muted-foreground">
              Tuition, housing, food, books & other expenses, after grants · {year}
            </p>
          </div>
          <CostBreakdown school={school} />
          {isPublic && comparison}
        </div>

        {/* Who pays what */}
        <div className="space-y-5">
          {share !== null && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Who pays what</p>
              {[
                {
                  label: "Received grants",
                  term: "grant-aid" as const,
                  share,
                  value: aided !== null ? `${money(aided)} average` : "–",
                  sub: isPublic ? "net price (in-state students)" : "net price after grants",
                },
                {
                  label: "No grants",
                  term: "cost-of-attendance" as const,
                  share: 1 - share,
                  value: inState !== null ? (isPublic && sticker?.out_of_state != null && sticker.out_of_state !== inState ? `${moneyCompact(inState)} / ${moneyCompact(sticker.out_of_state)}` : money(inState)) : "–",
                  sub: isPublic && sticker?.out_of_state != null && sticker.out_of_state !== inState ? "full price, in-state / out-of-state" : "full sticker price",
                },
              ].map((r, i) => (
                <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
                  <MetricLabel term={r.term} className="text-xs text-muted-foreground">
                    {r.label} · <b className="text-foreground">{pct(r.share)}</b>
                  </MetricLabel>
                  <span className="row-span-2 text-right">
                    <span className="block font-display text-lg font-extrabold whitespace-nowrap">{r.value}</span>
                    <span className="block text-[11px] text-muted-foreground">{r.sub}</span>
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full origin-left animate-grow-x rounded-full"
                      style={{ width: `${Math.max(1.5, r.share * 100)}%`, backgroundColor: i === 0 ? COLOR : "color-mix(in oklch, var(--foreground) 35%, transparent)" }}
                    />
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Share of first-year students, {year}.</p>
            </div>
          )}

          {isPublic && residencyRows.length > 0 ? (
            <div>
              <p className="mb-2 flex items-center gap-1 text-sm font-semibold">
                Sticker price by residency <InfoTip term="in-state-tuition" />
              </p>
              <div className="overflow-hidden rounded-2xl border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-[11px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Rate</th>
                      <th className="px-3 py-2 text-right font-semibold">Tuition & fees</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        <Term term="cost-of-attendance">Full cost</Term>
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">First-years</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y tabular-nums">
                    {residencyRows.map((r) => (
                      <tr key={r.key}>
                        <td className="px-3 py-2 font-medium">{r.label}</td>
                        <td className="px-3 py-2 text-right">{tf?.[r.key] != null ? money(tf[r.key]!) : "–"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{sticker?.[r.key] != null ? money(sticker[r.key]!) : "–"}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{res?.[r.key] != null ? pct(res[r.key]!) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Full cost adds books, on-campus room & board, and other expenses{livingCosts !== null ? ` (${money(livingCosts)})` : ""} to tuition and fees.
              </p>
            </div>
          ) : (
            inState !== null &&
            !c?.breakdown && (
              <div>
                <p className="mb-2 text-sm font-semibold">
                  <Term term="cost-of-attendance">Sticker price</Term>, {year}
                </p>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl bg-muted/60 p-3 text-sm tabular-nums">
                  <span>
                    <b>{tf?.in_state != null ? money(tf.in_state) : "–"}</b> <span className="text-muted-foreground">tuition & fees</span>
                  </span>
                  {livingCosts !== null && (
                    <span>
                      + <b>{money(livingCosts)}</b> <span className="text-muted-foreground">housing, food, books & other</span>
                    </span>
                  )}
                  <span>
                    = <b>{money(inState)}</b>
                  </span>
                </div>
              </div>
            )
          )}
          {stickerText === null && share === null && <p className="text-sm text-muted-foreground">Price details aren&apos;t reported.</p>}
          {!isPublic && comparison}
        </div>
      </div>
    </div>
  );
}
