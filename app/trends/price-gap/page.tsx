import type { Metadata } from "next";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { studyBySlug } from "@/lib/trend-studies";
import type { PriceGapValues } from "@/lib/trends";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { Dumbbell, type DumbbellRow } from "@/components/charts/Dumbbell";
import { TrendLine } from "@/components/charts/TrendLine";
import { SmallMultiples } from "@/components/trends/SmallMultiples";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { direction, groupingTiles } from "@/components/trends/tiles";
import { Term } from "@/components/ui/info-tip";
import Link from "next/link";

const study = studyBySlug("price-gap")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const EVENTS = [{ year: 2020, label: "Pandemic" }];
const COLOR = study.color;
const BAND_LABELS = ["$0–30K", "$30–48K", "$48–75K", "$75–110K", "$110K+"];

/**
 * Study 4, the price gap (specs/trends/price-gap.md): every number comes from data/history/trends/price-gap.json;
 * only the sentences are written here.
 */
export default async function PriceGapPage() {
  const [file, files] = await Promise.all([getTrendFile("price-gap"), getHistoryFiles()]);
  const v = file?.national.values;
  if (!file || !v) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, lineFrom } = file;
  const year = (y: number) => historyYearLabel(y, "academic").toLowerCase();
  const provisional = files?.meta.provisional.adm ?? null;

  const row = (grouping: string, key: string) => file.groupings.find((g) => g.grouping === grouping)?.groups.find((r) => r.key === key)?.values ?? null;
  const publics = row("control", "public");
  const privates = row("control", "private-nonprofit");
  const mostSelective = row("selectivity", "most");

  // Two indexed lines per group, same scale, used for both the national chart and every small-multiple tile.
  const indexSeries = (x: PriceGapValues) => [
    { key: "full", name: "Full price", color: COLOR, start: lineFrom, values: x.lines.fullPriceIndex },
    { key: "paid", name: "Average paid", color: COLOR, dashed: true, start: lineFrom, values: x.lines.avgPaidIndex },
  ];

  // "Who pays what now": median average paid per selectivity group, today's dollars, against the national median.
  const selectivityRows = file.groupings.find((g) => g.grouping === "selectivity")?.groups ?? [];
  // "Why the gap moved" and "net price by income" share this set of rows: the nation, public, and private nonprofit.
  const sectors: { label: string; values: PriceGapValues | null }[] = [
    { label: "All colleges", values: v },
    { label: "Public", values: publics },
    { label: "Private nonprofit", values: privates },
  ];
  const bandRows = (values: PriceGapValues | null): DumbbellRow[] =>
    values ? BAND_LABELS.map((label, i) => ({ label, from: values.netPriceByBand[i]?.[0] ?? null, to: values.netPriceByBand[i]?.[1] ?? null })) : [];

  return (
    <StudyPage
      study={study}
      file={file}
      headline={
        <>
          <TrendStat
            label={<>Full price, indexed</>}
            values={[100, v.lines.fullPriceIndex[v.lines.fullPriceIndex.length - 1] ?? 100]}
            format="num"
            from={from}
            to={to}
            kind="academic"
            counts="median college, after inflation"
            color={COLOR}
          />
          <TrendStat
            label={<>Average paid, indexed</>}
            values={[100, v.lines.avgPaidIndex[v.lines.avgPaidIndex.length - 1] ?? 100]}
            format="num"
            from={from}
            to={to}
            kind="academic"
            counts="median college, after inflation"
            color={COLOR}
          />
          <TrendStat
            label={
              <>
                <Term term="aid-generosity">Discount</Term> at the median college
              </>
            }
            values={v.discount}
            format="pct"
            from={from}
            to={to}
            kind="academic"
            counts="1 − average paid ÷ full price"
          />
        </>
      }
      nationalIntro={
        <>
          <Term term="cost-of-attendance">Full price</Term> and <Term term="average-cost">what students actually paid</Term>, both{" "}
          <Term term="inflation-adjusted">after inflation</Term> and indexed to 100 in {year(lineFrom)}, each academic year since. Median college, not students.
        </>
      }
      national={
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Full price and average paid, indexed to 100 in {year(lineFrom)}</figcaption>
            <div className="mt-3">
              <TrendLine
                series={indexSeries(v)}
                from={lineFrom}
                to={to}
                kind="academic"
                format="num"
                events={EVENTS}
                provisionalYear={provisional}
                label={`Full price (solid) and average paid (dashed), indexed to 100 in ${year(lineFrom)}, for ${file.n} colleges, ${year(lineFrom)} to ${year(to)}`}
              />
            </div>
          </figure>
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">
              <Term term="aid-generosity">Discount</Term> at the median college
            </figcaption>
            <div className="mt-3">
              <TrendLine
                series={[{ key: "discount", name: "Median discount", color: COLOR, start: lineFrom, values: v.lines.discount }]}
                from={lineFrom}
                to={to}
                kind="academic"
                format="pct"
                events={EVENTS}
                provisionalYear={provisional}
                label={`Median college's discount off full price, ${year(lineFrom)} to ${year(to)}`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">1 − average paid ÷ full price, at the median college each year.</p>
          </figure>

          {file.resets.length > 0 && (
            <div className="min-w-0 rounded-3xl border bg-surface-2 p-4 sm:p-5 lg:col-span-2">
              <p className="text-sm font-semibold">
                Tuition resets: full price fell {pct(Math.abs(file.resetThreshold))} or more, after inflation, in a single year
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Among the {file.n.toLocaleString("en-US")} panel colleges, the {file.resets.length} with the biggest single-year drop in full price since {year(from)}.
              </p>
              <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {file.resets.map((r) => (
                  <li key={r.unitId} className="flex items-baseline justify-between gap-3">
                    <Link href={`/schools/${r.unitId}/cost`} className="truncate font-medium hover:text-primary hover:underline" title={r.name}>
                      {r.name}
                    </Link>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {pct(r.drop)} in {year(r.year + 1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      breakdownsIntro={<>The same two lines for each group, on one scale.</>}
      breakdowns={
        <SmallMultiples
          label="Full price and average paid, indexed"
          from={lineFrom}
          to={to}
          kind="academic"
          events={EVENTS}
          provisionalYear={provisional}
          views={[
            {
              key: "colleges",
              label: "Colleges",
              caption: `Full price (solid) and average paid (dashed), indexed to 100 in ${year(lineFrom)}, by group. Numbers: ${year(from)} → ${year(to)}.`,
              format: "num",
              legend: [
                { name: "Full price", color: COLOR },
                { name: "Average paid", color: COLOR, dashed: true },
              ],
              groupings: groupingTiles(file.groupings, (x) => ({
                series: indexSeries(x),
                summary: `Discount ${pct(x.discount[0])} → ${pct(x.discount[1])} · paid now ${money(x.paidNow)}`,
              })),
            },
          ]}
        />
      }
      takeaway={<Takeaway v={v} from={from} to={to} year={year} publics={publics} privates={privates} mostSelective={mostSelective} />}
      method={[
        <>
          <b className="text-foreground">Money.</b> Every dollar figure is <Term term="inflation-adjusted">adjusted for inflation</Term> into {year(to)} dollars with the site&apos;s CPI table. Full
          price is residency-weighted for public colleges (one figure blending in-state and out-of-state); the in-state/out-of-state split is its own study.
        </>,
        <>
          <b className="text-foreground">Discount.</b> 1 − average paid ÷ full price, at the median college each year; it rises when either full price climbs or average paid falls.
        </>,
        <>
          <b className="text-foreground">Tuition resets.</b> A college counts when one year&apos;s full price fell {pct(Math.abs(file.resetThreshold))} or more, after inflation, from the year
          before, anywhere in the panel window.
        </>,
      ]}
      links={[
        { href: "/explore?sortBy=aid_generosity", label: "Colleges by aid generosity" },
        { href: "/glossary#average-cost", label: "What “average cost” means" },
      ]}
    >
      <section aria-labelledby="who-pays" className="min-w-0">
        <h2 id="who-pays" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Who pays what now
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Median <Term term="average-cost">average paid</Term> today, by selectivity, against the national median ({money(v.paidNow)}). The most selective colleges raised
          full price the most and discount the least, so they also charge the most.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {selectivityRows.map((r) =>
            r.tooFew || !r.values ? (
              <div key={r.key} className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                {r.label}: <Term term="too-few-colleges">too few colleges to say</Term>
              </div>
            ) : (
              <div key={r.key} className="rounded-2xl border bg-card p-4">
                <BenchmarkBar
                  label={r.label}
                  value={r.values.paidNow}
                  median={v.paidNow}
                  scale={[0, Math.max(v.paidNow, ...selectivityRows.map((g) => g.values?.paidNow ?? 0)) * 1.1]}
                  format={money}
                  color={COLOR}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Full price {direction(100, 100 * (1 + r.values.fullPriceChange))} {pct(Math.abs(r.values.fullPriceChange))} after inflation since {year(from)}.
                </p>
              </div>
            )
          )}
        </div>
      </section>

      <section aria-labelledby="why-moved" className="min-w-0">
        <h2 id="why-moved" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Why the gap moved
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          More first-years with a <Term term="grant-aid">grant</Term>, or bigger awards? Both rose almost everywhere; the mix differs by group.
        </p>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border bg-card p-4 sm:p-5">
            <p className="text-sm font-semibold">Share of first-years with a grant</p>
            <div className="mt-3">
              <Dumbbell
                rows={sectors.map((s) => ({ label: s.label, from: s.values?.grantPct[0] ?? null, to: s.values?.grantPct[1] ?? null }))}
                fromLabel={year(from)}
                toLabel={year(to)}
                format="pct"
                color={COLOR}
              />
            </div>
          </div>
          <div className="rounded-3xl border bg-card p-4 sm:p-5">
            <p className="text-sm font-semibold">
              <Term term="inflation-adjusted">Average grant</Term>, after inflation
            </p>
            <div className="mt-3">
              <Dumbbell
                rows={sectors.map((s) => ({ label: s.label, from: s.values?.grantAvg[0] ?? null, to: s.values?.grantAvg[1] ?? null }))}
                fromLabel={year(from)}
                toLabel={year(to)}
                format="money"
                color={COLOR}
              />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="by-income" className="min-w-0">
        <h2 id="by-income" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Did the fall in price reach lower-income families
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Median <Term term="net-price-by-income">net price</Term> by family income band, after inflation, {year(from)} → {year(to)}.
        </p>
        <div className="mt-5 grid gap-6 lg:grid-cols-3">
          {sectors.map((s) => (
            <div key={s.label} className="rounded-3xl border bg-card p-4 sm:p-5">
              <p className="text-sm font-semibold">{s.label}</p>
              <div className="mt-3">
                <Dumbbell rows={bandRows(s.values)} fromLabel={year(from)} toLabel={year(to)} format="money" color={COLOR} />
              </div>
            </div>
          ))}
        </div>
      </section>

    </StudyPage>
  );
}

function Takeaway({ v, from, to, year, publics, privates, mostSelective }: { v: PriceGapValues; from: number; to: number; year: (y: number) => string; publics: PriceGapValues | null; privates: PriceGapValues | null; mostSelective: PriceGapValues | null }) {
  return (
    <>
      <p>
        Across {" "}
        {direction(100, 100 * (1 + v.fullPriceChange)) === "held steady" ? "roughly held-steady full prices" : `full prices that ${direction(100, 100 * (1 + v.fullPriceChange))} ${pct(Math.abs(v.fullPriceChange))}`},
        the median college&apos;s discount off the sticker grew from {pct(v.discount[0])} to {pct(v.discount[1])} between {year(from)} and {year(to)}, and what students actually paid fell{" "}
        {pct(Math.abs(v.avgPaidChange))} after inflation.
      </p>
      {mostSelective && (
        <p>
          The most selective colleges are the exception: full price rose {pct(mostSelective.fullPriceChange)} and average paid barely moved ({pct(mostSelective.avgPaidChange)}), while they
          charge the most of any group ({money(mostSelective.paidNow)}).
        </p>
      )}
      {publics && privates && (
        <p className="text-muted-foreground">
          Publics cut full price slightly ({pct(publics.fullPriceChange)}) and discounted far less ({pct(publics.discount[1])} now) than private nonprofits ({pct(privates.discount[1])}
          ), a different mechanism (state appropriations and in-state tuition) this page doesn&apos;t attribute.
        </p>
      )}
    </>
  );
}
