"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Table2, LineChart } from "lucide-react";
import { formatBy, type FormatKind } from "@/lib/format";
import {
  NET_PRICE_BANDS,
  RACE_SERIES,
  SAT_BREAK,
  SERIES,
  TEST_BLIND_FROM,
  TEST_POLICY_CODES,
  lastYear,
  changeOver,
  firstPointFrom,
  formatChange,
  isTinyBase,
  historyYearLabel,
  WINDOW_YEARS,
  inDollarsOf,
  real as toRealDollars,
  valueAt,
  type CpiTable,
  type NationalHistory,
  type SchoolHistory,
  type Series,
  type SeriesKey,
  type YearKind,
} from "@/lib/history";
import type { TermKey } from "@/lib/glossary";
import { TrendLine, type TrendBand, type TrendExtra, type TrendRange, type TrendSeries } from "@/components/charts/TrendLine";
import { StackedArea100 } from "@/components/charts/StackedArea100";
import { DEMOGRAPHIC_CATEGORIES } from "@/lib/metrics";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { historyEvents } from "@/lib/events";

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
  sources: { cost: ReactNode; aid: ReactNode; admissions: ReactNode; scores: ReactNode; students: ReactNode; outcomes: ReactNode; academics: ReactNode };
  colors: { value: string; admissions: string; scores: string; size: string; diversity: string };
}

const CONTEXT = "var(--muted-foreground)";
const EVENTS = [{ year: 2020, label: "Pandemic" }];
const INCOME_LABELS = ["$0–30K", "$30–48K", "$48–75K", "$75–110K", "$110K+"];

/** How a year's test-policy code reads (codes shifted between eras; see TEST_POLICY_CODES). */
function policyLabel(code: number, year: number): string | null {
  if (code === TEST_POLICY_CODES.required) return null;
  if (code === TEST_POLICY_CODES.considered) return "Test-optional";
  if (code === TEST_POLICY_CODES.recommended) return "Scores recommended";
  return year >= TEST_BLIND_FROM ? "Test-blind" : "Scores not required";
}

/** Runs of consecutive years when scores weren't required, labeled by policy. */
function policySpans(s: Series | undefined): { from: number; to: number; label: string }[] {
  if (!s) return [];
  const out: { from: number; to: number; label: string }[] = [];
  s.values.forEach((code, i) => {
    const year = s.start + i;
    const label = code === null ? null : policyLabel(code, year);
    const last = out[out.length - 1];
    if (!label) return;
    if (last && last.label === label && last.to === year - 1) last.to = year;
    else out.push({ from: year, to: year, label });
  });
  return out;
}

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

/** A 25th–75th percentile pair drawn as a band (SAT/ACT middle 50%). */
interface PanelRange {
  lo: SeriesKey;
  hi: SeriesKey;
  name: string;
  color: string;
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
  ranges = [],
  breaks = [],
  spans = [],
  extras = [],
  note,
}: {
  title: string;
  term?: TermKey;
  specs: PanelSeries[];
  ranges?: PanelRange[];
  breaks?: { year: number; label: string }[];
  spans?: { from: number; to: number; label: string }[];
  /** Tooltip-only rows. */
  extras?: { key: SeriesKey; name: string }[];
  /** A line under the chart (e.g. why a series stops). */
  note?: ReactNode;
  history: SchoolHistory;
  national: NationalHistory["series"];
  window: [number, number];
  kind: YearKind;
  format: FormatKind;
  dollars: Dollars;
  cpi: CpiTable;
  showMedian: boolean;
  provisionalYear: number | null;
  /** The series whose latest value and change head the panel; a range panel shows its latest range instead. */
  headline?: SeriesKey;
  /** Year whose dollars money is shown in (after inflation). */
  dollarsOf: number;
}) {
  const [table, setTable] = useState(false);
  // A chart that ends early (median debt stops in 2020–21) is shown in its own last year's dollars, so its last point
  // matches the headline and the change (changeOver uses the window's end as the base too).
  const base = Math.min(dollarsOf, window[1]);
  const convert = (key: SeriesKey, s: Series) => (dollars === "real" ? inDollarsOf(s, SERIES[key].unit, cpi, base) : s);
  const series: TrendSeries[] = specs
    .filter((p) => history.series[p.key])
    .map((p) => {
      const s = convert(p.key, history.series[p.key]!);
      return { key: p.key, name: p.name, color: p.color, dashed: p.dashed, start: s.start, values: s.values, approx: s.approx };
    });
  const trendRanges: TrendRange[] = ranges
    .filter((r) => history.series[r.lo] && history.series[r.hi])
    .map((r) => {
      const lo = history.series[r.lo]!;
      const hi = history.series[r.hi]!;
      const start = Math.min(lo.start, hi.start);
      const end = Math.max(lastYear(lo), lastYear(hi));
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      return { key: r.lo, name: r.name, color: r.color, start, lo: years.map((y) => valueAt(lo, y)), hi: years.map((y) => valueAt(hi, y)) };
    });
  const trendExtras: TrendExtra[] = extras
    .filter((e) => history.series[e.key])
    .map((e) => ({ name: e.name, start: history.series[e.key]!.start, values: history.series[e.key]!.values, format: SERIES[e.key].format }));
  const bandSpec = specs.find((p) => p.band);
  const nat = bandSpec ? national[bandSpec.key] : undefined;
  // For a range, the band is the median college's 25th–75th percentiles, with their midpoint dotted.
  const rangeBand = ((): TrendBand | null => {
    const r = ranges[0];
    const [nlo, nhi] = r ? [national[r.lo], national[r.hi]] : [undefined, undefined];
    if (!showMedian || !nlo || !nhi) return null;
    const start = Math.max(nlo.start, nhi.start);
    const end = Math.min(nlo.start + nlo.stats.length, nhi.start + nhi.stats.length) - 1;
    return {
      label: "Median college",
      start,
      stats: Array.from({ length: end - start + 1 }, (_, i) => {
        const [a, b] = [nlo.stats[start + i - nlo.start], nhi.stats[start + i - nhi.start]];
        return a && b ? [a[1], (a[1] + b[1]) / 2, b[1]] : null;
      }),
    };
  })();
  const band: TrendBand | null = rangeBand ??
    (showMedian && bandSpec && nat
      ? {
          label: "National median",
          start: nat.start,
          stats: nat.stats.map((st, i) => {
            if (!st) return null;
            if (dollars !== "real" || SERIES[bandSpec.key].unit !== "usd") return [st[0], st[1], st[2]];
            // Years before the CPI table (median debt reaches back to 1997) can't be converted: leave them out of the
            // band, as the college's own line does, rather than drawing NaN.
            const k = st.slice(0, 3).map((v) => toRealDollars(v, nat.start + i, cpi, base));
            return k.every((v) => v !== null) ? (k as [number, number, number]) : null;
          }),
        }
      : null);

  const head = headline ? history.series[headline] : undefined;
  const money = headline ? SERIES[headline].unit === "usd" : false;
  // Money changes compare after inflation unless "As reported" is picked.
  const shown = (() => {
    if (!headline) return null;
    // Under "All", measure from the headline's first year rather than the earliest year of any series.
    const cw: [number, number] = [Math.max(window[0], head?.start ?? window[0]), window[1]];
    const real = changeOver(headline, head, cw, cpi);
    if (!money || dollars === "real" || !real) return real;
    const start = firstPointFrom(head, cw[0])!;
    return { measure: "ratio" as const, from: start, change: real.to.value / start.value - 1 };
  })();
  // The latest year is the base year for inflation, so its value reads the same either way.
  const latestShown = valueAt(head, window[1]);
  const latestRange = trendRanges[0] ? [trendRanges[0].lo[window[1] - trendRanges[0].start] ?? null, trendRanges[0].hi[window[1] - trendRanges[0].start] ?? null] : null;

  if (!series.length && !trendRanges.length) return null;
  return (
    <div className="flex min-w-0 flex-col rounded-3xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1 font-display text-base font-bold">
            {title} {term && <InfoTip term={term} />}
          </h4>
          <p className="mt-0.5 text-sm">
            {latestShown !== null && <b className="font-display text-xl font-extrabold tabular-nums">{formatBy(format, latestShown)}</b>}
            {latestShown === null && latestRange && latestRange[0] !== null && latestRange[1] !== null && (
              <b className="font-display text-xl font-extrabold tabular-nums">
                {formatBy(format, latestRange[0])}–{formatBy(format, latestRange[1])}
              </b>
            )}
            {(latestShown !== null || (latestRange?.[0] ?? null) !== null) && <span className="ml-1.5 text-xs text-muted-foreground">{historyYearLabel(window[1], kind)}</span>}
          </p>
          {shown && (
            <p className="text-xs text-muted-foreground">
              {/* Below a tiny base (a ratio like 9 to 1, a small applicant pool) a percent misleads: show from → to. */}
              <b className="text-foreground">{"to" in shown && isTinyBase(shown) ? `${formatBy(format, shown.from.value)} → ${formatBy(format, shown.to.value)}` : formatChange(shown)}</b>
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
          {trendRanges.map((r) => (
            <span key={r.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm" style={{ backgroundColor: r.color, opacity: 0.45 }} aria-hidden />
              {r.name}
            </span>
          ))}
          {spans.some((sp) => sp.to >= window[0]) && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm border border-dashed border-foreground/20 bg-foreground/5" aria-hidden />
              Shaded: scores not required
            </span>
          )}
          {band && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm bg-foreground/10" aria-hidden />
              {rangeBand ? "Median college's middle 50%" : "National middle 50% and median"}
            </span>
          )}
        </div>
      )}
      {table ? (
        <HistoryTable series={series} ranges={trendRanges} extras={trendExtras} band={band} from={window[0]} to={window[1]} kind={kind} format={format} provisionalYear={provisionalYear} />
      ) : (
        <TrendLine
          series={series}
          ranges={trendRanges}
          breaks={breaks}
          spans={spans}
          extras={trendExtras}
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
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function HistoryTable({
  series,
  ranges = [],
  extras = [],
  band,
  from,
  to,
  kind,
  format,
  provisionalYear,
}: {
  series: TrendSeries[];
  ranges?: TrendRange[];
  extras?: TrendExtra[];
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
            {ranges.map((r) => (
              <th key={r.key} className="px-2 py-1.5 text-right font-semibold">
                {r.name}
              </th>
            ))}
            {extras.map((e) => (
              <th key={e.name} className="px-2 py-1.5 text-right font-semibold">
                {e.name}
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
              {ranges.map((r) => {
                const [a, b] = [at(r.start, r.lo, y), at(r.start, r.hi, y)];
                return (
                  <td key={r.key} className="px-2 py-1 text-right">
                    {a === null || b === null ? "—" : `${formatBy(format, a)}–${formatBy(format, b)}`}
                  </td>
                );
              })}
              {extras.map((e) => {
                const v = at(e.start, e.values, y);
                return (
                  <td key={e.name} className="px-2 py-1 text-right">
                    {v === null ? "—" : formatBy(e.format, v)}
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
  // Phone collapse state only: a closed group is `hidden sm:block`, so wider screens always show every group. Starting
  // collapsed in the server HTML (rather than collapsing after hydration) keeps the page from jumping on load.
  const [open, setOpen] = useState({ cost: false, aid: false, admissions: false, scores: false, students: false, outcomes: false, academics: false, changes: false });
  // Policy changes (lib/events.ts) within the default 10-year window.
  const changes = useMemo(() => historyEvents(history).filter((e) => e.year >= latest[e.kind] - WINDOW_YEARS), [history, latest]);
  const toggle = (k: keyof typeof open) => () => setOpen((o) => ({ ...o, [k]: !o[k] }));

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
  const scoreWindow = windowFor("fall", ["sat_25", "act_25"]);
  const sizeWindow = windowFor("fall", ["undergrads"]);
  const raceWindow = windowFor("fall", ["race_white"]);
  const bodyWindow = windowFor("fall", ["men_share", "part_time_share"]);
  const gradWindow = windowFor("cohort", ["grad_rate"]);
  const debtWindow = windowFor("academic", ["median_debt"]);
  const spans = policySpans(history.series.test_policy);
  const hasScores = !!(history.series.sat_25 || history.series.act_25);
  const hasStudents = !!(history.series.undergrads || history.series.race_white || history.series.men_share || history.series.part_time_share || history.series.housing_capacity);
  const hasOutcomes = !!(history.series.grad_rate || history.series.median_debt);
  const debtEnd = history.series.median_debt ? lastYear(history.series.median_debt) : null;

  const incomeRows = useMemo(() => {
    const conv = (p: { year: number; value: number } | null) =>
      p === null ? null : ui.dollars === "real" ? toRealDollars(p.value, p.year, cpi, latest.academic) : p.value;
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

      <Group title="Cost" color={colors.value} open={open.cost} onToggle={toggle("cost")} footer={
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

      <Group title="Aid" color={colors.value} open={open.aid} onToggle={toggle("aid")} footer={sources.aid}>
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
          {history.series.federal_loan_rate && (
            <ChartPanel
              {...common}
              title="Undergrads with a federal loan"
              term="federal-loan-rate"
              kind="academic"
              format="pct"
              window={windowFor("academic", ["federal_loan_rate"])}
              headline="federal_loan_rate"
              provisionalYear={null}
              specs={[{ key: "federal_loan_rate", name: "Federal loan", color: colors.value, band: true }]}
              note="All undergraduates, not only first-years."
            />
          )}
        </div>
      </Group>

      <Group title="Admissions" color={colors.admissions} open={open.admissions} onToggle={toggle("admissions")} footer={
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
          {history.series.application_fee && (
            <ChartPanel
              {...common}
              title="Application fee"
              term="application-fee"
              kind="academic"
              format="money"
              window={windowFor("academic", ["application_fee"])}
              headline="application_fee"
              provisionalYear={null}
              specs={[{ key: "application_fee", name: "Application fee", color: colors.admissions }]}
            />
          )}
          {history.series.admit_rate_men && history.series.admit_rate_women && (
            // One hue for both, told apart by dash and direct labels: neither line is the "main" one.
            <ChartPanel
              {...common}
              title="Acceptance rate, men and women"
              term="admit-rate-by-sex"
              kind="fall"
              format="pctSmart"
              window={admWindow}
              provisionalYear={provisional.fall}
              specs={[
                { key: "admit_rate_women", name: "Women", color: colors.admissions },
                { key: "admit_rate_men", name: "Men", color: colors.admissions, dashed: true },
              ]}
            />
          )}
        </div>
      </Group>

      {hasScores && (
        <Group title="Test scores" color={colors.scores} open={open.scores} onToggle={toggle("scores")} footer={sources.scores}>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartPanel
              {...common}
              title="SAT, middle 50%"
              term="sat"
              kind="fall"
              format="int"
              window={scoreWindow}
              provisionalYear={provisional.fall}
              specs={[]}
              ranges={[{ lo: "sat_25", hi: "sat_75", name: "SAT middle 50%", color: colors.scores }]}
              breaks={SAT_BREAK.map((b) => ({ year: b.year, label: b.label }))}
              spans={spans}
              extras={[{ key: "sat_submit", name: "Submitted SAT" }]}
              note={
                scoreWindow[0] < SAT_BREAK[0].year
                  ? `${SAT_BREAK[0].reason} Shaded years: scores weren't required, so ranges describe only students who sent them.`
                  : "Shaded years: scores weren't required, so ranges describe only students who sent them."
              }
            />
            <ChartPanel
              {...common}
              title="ACT, middle 50%"
              term="act"
              kind="fall"
              format="int"
              window={scoreWindow}
              provisionalYear={provisional.fall}
              specs={[]}
              ranges={[{ lo: "act_25", hi: "act_75", name: "ACT middle 50%", color: colors.scores }]}
              spans={spans}
              extras={[{ key: "act_submit", name: "Submitted ACT" }]}
            />
          </div>
        </Group>
      )}

      {hasStudents && (
        <Group title="Students" color={colors.size} open={open.students} onToggle={toggle("students")} footer={sources.students}>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartPanel
              {...common}
              title="Undergraduates"
              term="undergrad-enrollment"
              kind="fall"
              format="num"
              window={sizeWindow}
              headline="undergrads"
              provisionalYear={null}
              specs={[{ key: "undergrads", name: "Undergraduates", color: colors.size }]}
            />
            {history.series.race_white && (
              <div className="flex min-w-0 flex-col rounded-3xl border bg-card p-4 sm:p-5">
                <h4 className="mb-3 flex items-center gap-1 font-display text-base font-bold">
                  Student body by race and ethnicity <InfoTip term="race-ethnicity" />
                </h4>
                <StackedArea100
                  label="Share of undergraduates by race and ethnicity, by year"
                  from={Math.max(raceWindow[0], history.series.race_white.start)}
                  to={raceWindow[1]}
                  kind="fall"
                  categories={DEMOGRAPHIC_CATEGORIES.map((c) => {
                    const sr = history.series[RACE_SERIES[c.key]];
                    return { key: c.key, label: c.label, color: c.color, start: sr?.start ?? raceWindow[0], values: sr?.values ?? [] };
                  })}
                />
              </div>
            )}
            {history.series.men_share && (
              <ChartPanel
                {...common}
                title="Men (share of undergraduates)"
                term="gender-balance"
                kind="fall"
                format="pct"
                window={bodyWindow}
                headline="men_share"
                provisionalYear={null}
                specs={[{ key: "men_share", name: "Men", color: colors.size, band: true }]}
              />
            )}
            {history.series.housing_capacity && (
              <ChartPanel
                {...common}
                title="Housing capacity"
                term="housing-capacity"
                kind="academic"
                format="num"
                window={windowFor("academic", ["housing_capacity"])}
                headline="housing_capacity"
                provisionalYear={null}
                specs={[{ key: "housing_capacity", name: "Beds", color: colors.size }]}
                note="Beds in college housing; can include graduate housing."
              />
            )}
            {history.series.part_time_share && (
              <ChartPanel
                {...common}
                title="Part-time students"
                term="part-time-student"
                kind="fall"
                format="pct"
                window={bodyWindow}
                headline="part_time_share"
                provisionalYear={null}
                specs={[{ key: "part_time_share", name: "Part-time", color: colors.size, band: true }]}
              />
            )}
          </div>
        </Group>
      )}

      {(history.series.student_faculty_ratio || history.series.faculty_full_time_share || history.series.faculty_salary) && (
        <Group title="Academics" color={colors.size} open={open.academics} onToggle={toggle("academics")} footer={sources.academics}>
          <div className="grid gap-4 lg:grid-cols-2">
            {history.series.student_faculty_ratio && (
              <ChartPanel
                {...common}
                title="Students per faculty member"
                term="student-faculty-ratio"
                kind="fall"
                format="num"
                window={windowFor("fall", ["student_faculty_ratio"])}
                headline="student_faculty_ratio"
                provisionalYear={null}
                specs={[{ key: "student_faculty_ratio", name: "Students per faculty", color: colors.size, band: true }]}
                note="Lower means fewer students for each faculty member. Colleges compute it themselves, so small moves can be a change in counting."
              />
            )}
            {history.series.faculty_full_time_share && (
              <ChartPanel
                {...common}
                title="Full-time faculty share"
                term="full-time-faculty"
                kind="fall"
                format="pct"
                window={windowFor("fall", ["faculty_full_time_share"])}
                headline="faculty_full_time_share"
                provisionalYear={null}
                specs={[{ key: "faculty_full_time_share", name: "Full-time faculty", color: colors.size, band: true }]}
                note="Nationally the full-time share has drifted down for years as colleges rely more on part-time and adjunct instructors."
              />
            )}
            {history.series.faculty_salary && (
              <ChartPanel
                {...common}
                title="Average faculty salary"
                term="nine-month-equated-salary"
                kind="fall"
                format="money"
                window={windowFor("fall", ["faculty_salary"])}
                headline="faculty_salary"
                provisionalYear={null}
                specs={[{ key: "faculty_salary", name: "Faculty salary", color: colors.size, band: true }]}
                note="9-month equated, all ranks combined. Pay tracks local cost of living as much as a college's generosity, so compare with care."
              />
            )}
          </div>
        </Group>
      )}

      {hasOutcomes && (
        <Group title="Outcomes" color={colors.value} open={open.outcomes} onToggle={toggle("outcomes")} footer={sources.outcomes}>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartPanel
              {...common}
              title="Graduated within 6 years"
              term="graduation-rate"
              kind="cohort"
              format="pct"
              window={gradWindow}
              headline="grad_rate"
              provisionalYear={null}
              specs={[{ key: "grad_rate", name: "Graduated in 6 years", color: colors.value, band: true }]}
              note="By the year students entered. First-time, full-time students; the profile's headline rate is the Scorecard's broader measure, so it can differ slightly."
            />
            <ChartPanel
              {...common}
              title="Median debt at graduation"
              term="median-debt"
              kind="academic"
              format="money"
              window={debtEnd !== null ? [Math.min(debtWindow[0], debtEnd - 10), debtEnd] : debtWindow}
              headline="median_debt"
              provisionalYear={null}
              specs={[{ key: "median_debt", name: "Median debt", color: colors.value, band: true }]}
              note={
                debtEnd !== null
                  ? `Ends ${historyYearLabel(debtEnd, "academic")}: newer years aren't published in this series.${ui.dollars === "real" ? ` After inflation, in ${historyYearLabel(debtEnd, "academic")} dollars.` : ""}`
                  : undefined
              }
            />
          </div>
          <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
            <b className="text-foreground">Earnings</b> aren&apos;t shown over time: the College Scorecard changed how it measures them, so earlier
            years aren&apos;t comparable with today&apos;s figure.
          </p>
        </Group>
      )}

      {changes.length > 0 && (
        <Group
          title="Changes"
          color={colors.admissions}
          open={open.changes}
          onToggle={toggle("changes")}
          footer={
            <p className="max-w-3xl text-[11px] text-muted-foreground">
              From the college&apos;s yearly reports to the federal government over the last 10 years. A change can reflect how a college
              answered the survey as well as a new policy; changes undone within two years are left out.
            </p>
          }
        >
          <ol className="max-w-3xl divide-y rounded-3xl border bg-card">
            {changes.map((e) => (
              <li key={`${e.key}-${e.year}`} className="flex items-baseline gap-4 px-4 py-3 sm:px-5">
                <span className="w-20 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{historyYearLabel(e.year, e.kind)}</span>
                <span className="text-sm">{e.text}</span>
              </li>
            ))}
          </ol>
        </Group>
      )}
    </div>
  );
}
