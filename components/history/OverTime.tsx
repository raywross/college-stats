"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Table2, LineChart } from "lucide-react";
import { formatBy, type FormatKind } from "@/lib/format";
import {
  NET_PRICE_BANDS,
  SERIES,
  changeOver,
  firstPointFrom,
  formatChange,
  historyYearLabel,
  inDollarsOf,
  valueAt,
  type CpiTable,
  type NationalHistory,
  type SchoolHistory,
  type Series,
  type SeriesKey,
  type YearKind,
} from "@/lib/history";
import type { TermKey } from "@/lib/glossary";
import { TrendLine, type TrendBand, type TrendSeries } from "@/components/charts/TrendLine";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

type Range = "10" | "all";
type Dollars = "real" | "nominal";
type Residency = "blended" | "in" | "out";

export interface OverTimeProps {
  isPublic: boolean;
  history: SchoolHistory;
  national: NationalHistory["series"];
  cpi: CpiTable;
  latest: Record<YearKind, number>;
  provisional: Record<YearKind, number | null>;
  /** Server-rendered source lines per group (history editions and CPI). */
  sources: { cost: ReactNode; aid: ReactNode; admissions: ReactNode };
  colors: { value: string; admissions: string };
}

const CONTEXT = "var(--muted-foreground)";
const EVENTS = [{ year: 2020, label: "Pandemic" }];
const INCOME_LABELS = ["$0–30K", "$30–48K", "$48–75K", "$75–110K", "$110K+"];

/** Read and write the controls in the URL (?range=all&dollars=nominal&median=off&rate=in) without re-rendering the page. */
function useUrlState() {
  const [range, setRange] = useState<Range>("10");
  const [dollars, setDollars] = useState<Dollars>("real");
  const [median, setMedian] = useState(true);
  const [residency, setResidency] = useState<Residency>("blended");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the shared URL after hydration */
    if (p.get("range") === "all") setRange("all");
    if (p.get("dollars") === "nominal") setDollars("nominal");
    if (p.get("median") === "off") setMedian(false);
    const r = p.get("rate");
    if (r === "in" || r === "out") setResidency(r);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const write = (key: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
  };
  return {
    range,
    dollars,
    median,
    residency,
    setRange: (v: Range) => (setRange(v), write("range", v === "all" ? "all" : null)),
    setDollars: (v: Dollars) => (setDollars(v), write("dollars", v === "nominal" ? "nominal" : null)),
    setMedian: (v: boolean) => (setMedian(v), write("median", v ? null : "off")),
    setResidency: (v: Residency) => (setResidency(v), write("rate", v === "blended" ? null : v)),
  };
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border bg-card p-0.5 text-xs font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface PanelSeries {
  key: SeriesKey;
  name: string;
  color: string;
  dashed?: boolean;
  /** Draw the national band behind this series. */
  band?: boolean;
}

/** One chart panel: title, latest value and its change over the window, the chart, and a table view. */
function ChartPanel({
  title,
  term,
  specs,
  history,
  national,
  window,
  kind,
  format,
  dollars,
  cpi,
  showMedian,
  provisionalYear,
  headline,
  dollarsOf,
}: {
  title: string;
  term?: TermKey;
  specs: PanelSeries[];
  history: SchoolHistory;
  national: NationalHistory["series"];
  window: [number, number];
  kind: YearKind;
  format: FormatKind;
  dollars: Dollars;
  cpi: CpiTable;
  showMedian: boolean;
  provisionalYear: number | null;
  /** The series whose latest value and change head the panel. */
  headline: SeriesKey;
  /** Year whose dollars money is shown in (after inflation). */
  dollarsOf: number;
}) {
  const [table, setTable] = useState(false);
  const convert = (key: SeriesKey, s: Series) => (dollars === "real" ? inDollarsOf(s, SERIES[key].unit, cpi, dollarsOf) : s);
  const series: TrendSeries[] = specs
    .filter((p) => history.series[p.key])
    .map((p) => {
      const s = convert(p.key, history.series[p.key]!);
      return { key: p.key, name: p.name, color: p.color, dashed: p.dashed, start: s.start, values: s.values, approx: s.approx };
    });
  const bandSpec = specs.find((p) => p.band);
  const nat = bandSpec ? national[bandSpec.key] : undefined;
  const band: TrendBand | null =
    showMedian && bandSpec && nat
      ? {
          label: "National median",
          start: nat.start,
          stats: nat.stats.map((st, i) => {
            if (!st) return null;
            const k = (v: number) => (dollars === "real" && SERIES[bandSpec.key].unit === "usd" ? (v * cpiAt(cpi, dollarsOf)) / cpiAt(cpi, nat.start + i) : v);
            return [k(st[0]), k(st[1]), k(st[2])];
          }),
        }
      : null;

  const head = history.series[headline];
  const money = SERIES[headline].unit === "usd";
  // Money changes compare after inflation unless "As reported" is picked.
  const shown = (() => {
    // Under "All", measure from the headline's first year rather than the earliest year of any series.
    const cw: [number, number] = [Math.max(window[0], head?.start ?? window[0]), window[1]];
    const real = changeOver(headline, head, cw, cpi);
    if (!money || dollars === "real" || !real) return real;
    const start = firstPointFrom(head, cw[0])!;
    return { measure: "ratio" as const, from: start, change: real.to.value / start.value - 1 };
  })();
  // The latest year is the base year for inflation, so its value reads the same either way.
  const latestShown = valueAt(head, window[1]);

  if (!series.length) return null;
  return (
    <div className="flex min-w-0 flex-col rounded-3xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1 font-display text-base font-bold">
            {title} {term && <InfoTip term={term} />}
          </h4>
          <p className="mt-0.5 text-sm">
            {latestShown !== null && <b className="font-display text-xl font-extrabold tabular-nums">{formatBy(format, latestShown)}</b>}
            {latestShown !== null && <span className="ml-1.5 text-xs text-muted-foreground">{historyYearLabel(window[1], kind)}</span>}
          </p>
          {shown && (
            <p className="text-xs text-muted-foreground">
              <b className="text-foreground">{formatChange(shown)}</b>
              {money ? (dollars === "real" ? " after inflation" : " as reported") : ""} since {historyYearLabel(shown.from.year, kind).toLowerCase()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {table ? <LineChart className="size-3.5" /> : <Table2 className="size-3.5" />}
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {!table && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <svg width={14} height={4} aria-hidden>
                <line x1={0} x2={14} y1={2} y2={2} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "4 2" : undefined} />
              </svg>
              {s.name}
            </span>
          ))}
          {band && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm bg-foreground/10" aria-hidden />
              National middle 50% and median
            </span>
          )}
        </div>
      )}
      {table ? (
        <HistoryTable series={series} band={band} from={window[0]} to={window[1]} kind={kind} format={format} provisionalYear={provisionalYear} />
      ) : (
        <TrendLine
          series={series}
          band={band}
          from={window[0]}
          to={window[1]}
          kind={kind}
          format={format}
          provisionalYear={provisionalYear}
          events={EVENTS}
          label={`${title}, ${historyYearLabel(window[0], kind)} to ${historyYearLabel(window[1], kind)}`}
        />
      )}
    </div>
  );
}

function cpiAt(cpi: CpiTable, year: number): number {
  return cpi.values[year - cpi.start] ?? NaN;
}

function HistoryTable({
  series,
  band,
  from,
  to,
  kind,
  format,
  provisionalYear,
}: {
  series: TrendSeries[];
  band: TrendBand | null;
  from: number;
  to: number;
  kind: YearKind;
  format: FormatKind;
  provisionalYear: number | null;
}) {
  const years = Array.from({ length: to - from + 1 }, (_, i) => to - i);
  const at = (start: number, arr: readonly (number | null)[], y: number) => arr[y - start] ?? null;
  return (
    <div className="max-h-72 overflow-auto rounded-xl border">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-semibold">Year</th>
            {series.map((s) => (
              <th key={s.key} className="px-2 py-1.5 text-right font-semibold">
                {s.name}
              </th>
            ))}
            {band && <th className="px-2 py-1.5 text-right font-semibold">National median</th>}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y} className="border-b last:border-0">
              <th scope="row" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                {historyYearLabel(y, kind)}
                {y === provisionalYear ? " (provisional)" : ""}
              </th>
              {series.map((s) => {
                const v = at(s.start, s.values, y);
                return (
                  <td key={s.key} className="px-2 py-1 text-right">
                    {v === null ? "—" : formatBy(format, v)}
                    {v !== null && s.approx?.includes(y) ? "*" : ""}
                  </td>
                );
              })}
              {band && <td className="px-2 py-1 text-right text-muted-foreground">{(() => {
                const b = band.stats[y - band.start];
                return b ? formatBy(format, b[1]) : "—";
              })()}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A collapsible group of panels (collapsed by default on phones, except Cost). */
function Group({ title, color, open, onToggle, children, footer }: { title: string; color: string; open: boolean; onToggle: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mb-3 flex w-full items-center gap-2 text-left focus-visible:outline-none sm:pointer-events-none"
      >
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <h3 className="font-display text-xl font-extrabold tracking-tight">{title}</h3>
        <ChevronDown className={cn("ml-auto size-5 text-muted-foreground transition-transform sm:hidden", open && "rotate-180")} />
      </button>
      <div className={cn(!open && "hidden sm:block")}>
        {children}
        <div className="mt-3">{footer}</div>
      </div>
    </div>
  );
}

export function OverTime(props: OverTimeProps) {
  const { isPublic, history, national, cpi, latest, provisional, sources, colors } = props;
  const ui = useUrlState();
  const [open, setOpen] = useState({ cost: true, aid: true, admissions: true });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- collapse secondary groups once on small screens
    if (window.matchMedia("(max-width: 639px)").matches) setOpen({ cost: true, aid: false, admissions: false });
  }, []);

  const earliest = (keys: SeriesKey[]) => Math.min(...keys.map((k) => history.series[k]?.start ?? Infinity));
  const windowFor = (kind: YearKind, keys: SeriesKey[]): [number, number] => {
    const to = latest[kind];
    if (ui.range === "10") return [to - 10, to];
    const from = earliest(keys);
    return [Number.isFinite(from) ? Math.min(from, to - 10) : to - 10, to];
  };
  const common = { history, national, cpi, dollars: ui.dollars, showMedian: ui.median, dollarsOf: latest.academic };

  const fullPriceKey: SeriesKey = !isPublic || ui.residency === "blended" ? "full_price" : ui.residency === "in" ? "sticker_in_state" : "sticker_out_of_state";
  const fullPriceName = !isPublic || ui.residency === "blended" ? "Full price" : ui.residency === "in" ? "Full price, in-state" : "Full price, out-of-state";
  const costKeys: SeriesKey[] = [fullPriceKey, "avg_paid_all", "aided_net_price"];
  const costWindow = windowFor("academic", costKeys);
  const aidWindow = windowFor("academic", ["grant_pct", "aid_generosity"]);
  const admWindow = windowFor("fall", ["applicants", "acceptance_rate"]);

  const incomeRows = useMemo(() => {
    const conv = (p: { year: number; value: number } | null) =>
      p === null ? null : ui.dollars === "real" ? (p.value * cpiAt(cpi, latest.academic)) / cpiAt(cpi, p.year) : p.value;
    return NET_PRICE_BANDS.map((k, i) => {
      const s = history.series[k];
      const start = firstPointFrom(s, costWindow[0]);
      // Ends in the latest year, the inflation base, so it needs no conversion.
      return { label: INCOME_LABELS[i], from: conv(start), to: valueAt(s, costWindow[1]), fromYear: start?.year ?? null };
    });
  }, [history, costWindow, ui.dollars, cpi, latest.academic]);
  const incomeFromYear = incomeRows.find((r) => r.fromYear !== null)?.fromYear ?? null;
  const hasIncome = incomeRows.some((r) => r.from !== null || r.to !== null);

  const approxYears = (history.series.avg_paid_all?.approx ?? []).filter((y) => y >= costWindow[0]);
  const repeated = (history.repeated ?? []).filter((y) => y >= admWindow[0]);
  const joinYears = (ys: number[], kind: YearKind) => ys.map((y) => historyYearLabel(y, kind)).join(", ");

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Years shown" value={ui.range} onChange={ui.setRange} options={[{ value: "10", label: "10 years" }, { value: "all", label: "All" }]} />
        <Segmented label="Dollars" value={ui.dollars} onChange={ui.setDollars} options={[{ value: "real", label: "After inflation" }, { value: "nominal", label: "As reported" }]} />
        {isPublic && (
          <Segmented
            label="Full price for"
            value={ui.residency}
            onChange={ui.setResidency}
            options={[{ value: "blended", label: "All students" }, { value: "in", label: "In-state" }, { value: "out", label: "Out-of-state" }]}
          />
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground has-[:checked]:text-foreground">
          <input type="checkbox" checked={ui.median} onChange={(e) => ui.setMedian(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />
          National median
        </label>
        {ui.dollars === "real" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Money in {historyYearLabel(latest.academic, "academic")} dollars <InfoTip term="inflation-adjusted" />
          </span>
        )}
      </div>

      <Group title="Cost" color={colors.value} open={open.cost} onToggle={() => setOpen((o) => ({ ...o, cost: !o.cost }))} footer={
        <div className="space-y-1.5 text-[11px] text-muted-foreground">
          {approxYears.length > 0 && (
            <p>
              * {joinYears(approxYears, "academic")}: grant dollars per student estimated as share with grants × average grant; total grant dollars
              weren&apos;t reported yet.
            </p>
          )}
          {sources.cost}
        </div>
      }>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartPanel
            {...common}
            title="What a year costs"
            term="average-cost"
            kind="academic"
            format="money"
            window={costWindow}
            headline="avg_paid_all"
            provisionalYear={provisional.academic}
            specs={[
              { key: "avg_paid_all", name: "Average total cost", color: colors.value, band: true },
              { key: fullPriceKey, name: fullPriceName, color: CONTEXT },
              { key: "aided_net_price", name: isPublic ? "With grants (in-state)" : "With grants", color: CONTEXT, dashed: true },
            ]}
          />
          {hasIncome && (
            <div className="flex min-w-0 flex-col rounded-3xl border bg-card p-4 sm:p-5">
              <h4 className="mb-1 flex items-center gap-1 font-display text-base font-bold">
                Net price by family income <InfoTip term="net-price-by-income" />
              </h4>
              <p className="mb-4 text-xs text-muted-foreground">
                Students receiving federal aid{isPublic ? ", in-state" : ""}. {ui.dollars === "real" ? `In ${historyYearLabel(latest.academic, "academic")} dollars.` : "As reported."}
              </p>
              <Dumbbell
                rows={incomeRows}
                fromLabel={incomeFromYear ? historyYearLabel(incomeFromYear, "academic") : "Start"}
                toLabel={historyYearLabel(costWindow[1], "academic")}
                format="money"
                color={colors.value}
              />
            </div>
          )}
        </div>
      </Group>

      <Group title="Aid" color={colors.value} open={open.aid} onToggle={() => setOpen((o) => ({ ...o, aid: !o.aid }))} footer={sources.aid}>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartPanel
            {...common}
            title="Grants for first-years"
            term="grant-aid"
            kind="academic"
            format="pct"
            window={aidWindow}
            headline="grant_pct"
            provisionalYear={provisional.academic}
            specs={[
              { key: "grant_pct", name: "Share with grants", color: colors.value, band: true },
              { key: "aid_generosity", name: "Aid generosity", color: CONTEXT, dashed: true },
            ]}
          />
          <ChartPanel
            {...common}
            title="Average grant"
            term="grant-aid"
            kind="academic"
            format="money"
            window={aidWindow}
            headline="grant_avg"
            provisionalYear={provisional.academic}
            specs={[{ key: "grant_avg", name: "Average grant", color: colors.value, band: true }]}
          />
        </div>
      </Group>

      <Group title="Admissions" color={colors.admissions} open={open.admissions} onToggle={() => setOpen((o) => ({ ...o, admissions: !o.admissions }))} footer={
        <div className="space-y-1.5 text-[11px] text-muted-foreground">
          {repeated.length > 0 && (
            <p>
              {joinYears(repeated, "fall")}: left out because the college&apos;s report repeated the previous year&apos;s applicants, admits, and
              enrollees exactly (a carried-forward report, not a new count).
            </p>
          )}
          {sources.admissions}
        </div>
      }>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartPanel
            {...common}
            title="Applicants, admits, and enrollees"
            term="applicants"
            kind="fall"
            format="num"
            window={admWindow}
            headline="applicants"
            provisionalYear={provisional.fall}
            specs={[
              { key: "applicants", name: "Applied", color: colors.admissions },
              { key: "admitted", name: "Admitted", color: CONTEXT },
              { key: "enrolled", name: "Enrolled", color: CONTEXT, dashed: true },
            ]}
          />
          <ChartPanel
            {...common}
            title="Acceptance rate and yield"
            term="acceptance-rate"
            kind="fall"
            format="pctSmart"
            window={admWindow}
            headline="acceptance_rate"
            provisionalYear={provisional.fall}
            specs={[
              { key: "acceptance_rate", name: "Acceptance rate", color: colors.admissions, band: true },
              { key: "yield", name: "Yield", color: CONTEXT, dashed: true },
            ]}
          />
        </div>
      </Group>
    </div>
  );
}
