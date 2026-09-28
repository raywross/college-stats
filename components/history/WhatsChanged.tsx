import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getHistoryFiles } from "@/lib/data";
import { formatChange, historyYearLabel } from "@/lib/history";
import { movedBy } from "@/lib/insights";
import { Sparkline } from "@/components/charts/Sparkline";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { Term } from "@/components/ui/info-tip";

function FactCard({
  big,
  children,
  chart,
  footer,
  href,
  cta,
}: {
  big: string;
  children: React.ReactNode;
  chart: React.ReactNode;
  footer: React.ReactNode;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-3xl border bg-card p-5 sm:p-6">
      <p className="font-display text-5xl font-extrabold tracking-tight tabular-nums">{big}</p>
      <p className="mt-2 text-muted-foreground">{children}</p>
      <div className="mt-5">{chart}</div>
      <div className="mt-4 flex-1">{footer}</div>
      <Link href={href} className="group mt-4 inline-flex items-center gap-1 self-start text-sm font-bold text-primary hover:underline">
        {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/**
 * Home "What's changed": national trend facts over fixed panels, precomputed by `npm run sync-history` into
 * data/history/facts.json (specs/trends-design.md#home-whats-changed-3-facts). Renders nothing without history.
 */
export async function WhatsChanged({ valueColor, admissionsColor }: { valueColor: string; admissionsColor: string }) {
  const files = await getHistoryFiles();
  const facts = files?.facts;
  if (!files || !facts || (!facts.priceGap && !facts.harderToGetIn)) return null;
  const { priceGap: pg, harderToGetIn: hi } = facts;

  return (
    <section>
      <div className="mb-6">
        <p className="mb-1.5 text-xs font-bold tracking-[0.18em] text-primary uppercase">Over time</p>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">What&apos;s changed</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Ten years of federal data, measured over a <Term term="fixed-panel">fixed panel</Term> of the same colleges at both ends, with
          money <Term term="inflation-adjusted">after inflation</Term>.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {pg && (
          <FactCard
            big={formatChange({ measure: "ratio", change: pg.avgPaidChange })}
            href="/explore?sortBy=avg_cost"
            cta="Compare what colleges cost"
            chart={
              <>
                <Sparkline
                  label={`Median full price and average total cost, indexed to 100 in ${historyYearLabel(pg.from, "academic")}`}
                  start={pg.from}
                  kind="academic"
                  format="int"
                  series={[
                    { name: "Full price", color: "var(--muted-foreground)", values: pg.fullPriceIndex },
                    { name: "Paid", color: valueColor, values: pg.avgPaidIndex },
                  ]}
                />
                <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: valueColor }} aria-hidden /> What students paid (average total cost)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 rounded-full bg-muted-foreground" aria-hidden /> Full price
                  </span>
                  <span>Medians, {historyYearLabel(pg.from, "academic")} = 100</span>
                </div>
              </>
            }
            footer={<HistorySourceNote keys={["full_price", "avg_paid_all"]} files={files} range={[pg.from, pg.to]} />}
          >
            <b className="text-foreground">The price gap.</b> Since {historyYearLabel(pg.from, "academic")}, what the typical college&apos;s first-years
            actually paid, on average, {movedBy(pg.avgPaidChange)} after inflation; its full price {movedBy(pg.fullPriceChange)}. Across{" "}
            {pg.n.toLocaleString("en-US")} colleges reporting both years.
          </FactCard>
        )}
        {hi && (
          <FactCard
            big={formatChange({ measure: "ratio", change: hi.applicantsChange })}
            href="/explore?sortBy=acceptance_rate"
            cta="See the most selective colleges"
            chart={
              <>
                <Sparkline
                  label={`Applications per enrolled first-year at the ${hi.n} most selective colleges, ${historyYearLabel(hi.from, "fall")} to ${historyYearLabel(hi.to, "fall")}`}
                  start={hi.from}
                  kind="fall"
                  format="fixed2"
                  series={[{ name: "Applications per seat", color: admissionsColor, values: hi.perSeat }]}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Applications per enrolled first-year:{" "}
                  <b className="text-foreground">
                    {hi.perSeat.find((v) => v !== null)?.toFixed(1)} → {[...hi.perSeat].reverse().find((v) => v !== null)?.toFixed(1)}
                  </b>
                </p>
              </>
            }
            footer={<HistorySourceNote keys={["applicants", "enrolled"]} files={files} range={[hi.from, hi.to]} />}
          >
            <b className="text-foreground">Harder to get in.</b> Applications to today&apos;s {hi.n} most selective colleges{" "}
            {movedBy(hi.applicantsChange)} since {historyYearLabel(hi.from, "fall").toLowerCase()}; the number of first-years they enrolled{" "}
            {movedBy(hi.enrolledChange)}.
          </FactCard>
        )}
      </div>
    </section>
  );
}
