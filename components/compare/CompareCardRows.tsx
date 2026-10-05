import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { indicatorOf } from "@/lib/indicators";
import { NOT_REPORTED, rangeAxis, type CardRow, type RangeRow, type TextRow } from "@/lib/compare-cards";
import { RangeBar } from "@/components/charts/RangeBar";
import { MetricLabel } from "@/components/ui/info-tip";
import { DirectionIcon } from "@/components/trends/TrendIndicators";
import { CompareMetric } from "./CompareMetric";

/** The label above a card row: cited, with an optional note on the right ("Axis 1200–1600", "share of graduates"). */
function RowLabel({ row, cited, hint }: { row: CardRow; cited: Cited; hint?: string | null }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <MetricLabel term={row.term} cited={cited} className="text-xs font-semibold text-muted-foreground">
        {row.label}
      </MetricLabel>
      {hint && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{hint}</span>}
    </div>
  );
}

/** Name, middle column, value: the bar rows' columns, with the value column fixed so every track shares one axis. */
const RANGE_GRID = "grid grid-cols-[4.5rem_1fr_5rem] items-center gap-3 sm:grid-cols-[6rem_1fr_5.5rem]";
const TEXT_GRID = "grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[6rem_1fr_auto]";

/** Each college's middle 50% on one axis (ScoreCompare's), the range printed beside it, or why it has none. */
function RangeRows({ row, schools, cited }: { row: RangeRow; schools: School[]; cited: Cited }) {
  const ranges = schools.map(row.get);
  const axis = rangeAxis(row.scale, ranges);
  return (
    <div>
      <RowLabel row={row} cited={cited} hint={axis && `Axis ${axis[0]}–${axis[1]}`} />
      <div className="space-y-2.5">
        {schools.map((s, i) => {
          const r = ranges[i];
          return (
            <div key={s.unit_id} className={RANGE_GRID}>
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              {r && axis ? (
                <RangeBar low={r[0]} high={r[1]} scale={axis} color={SLOT_COLORS[i]} compact />
              ) : (
                <span className="relative h-4" aria-hidden>
                  <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
                </span>
              )}
              <span className="text-right text-sm font-bold whitespace-nowrap tabular-nums">
                {r ? `${r[0]}–${r[1]}` : <span className="text-xs font-normal text-muted-foreground">{row.fallback(s)}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A line per college beside its slot-color dot: the text (with a direction icon for a trend), a note, and a figure. */
function TextRows({ row, schools, cited }: { row: TextRow; schools: School[]; cited: Cited }) {
  return (
    <div>
      <RowLabel row={row} cited={cited} hint={row.hint} />
      <ul className="space-y-2.5">
        {schools.map((s, i) => {
          const text = row.get(s);
          const indicator = text !== null && row.indicator ? indicatorOf(s, row.indicator) : null;
          const note = text !== null ? (row.note?.(s) ?? null) : null;
          const value = text !== null ? (row.value?.(s) ?? null) : null;
          return (
            <li key={s.unit_id} className={TEXT_GRID}>
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} aria-hidden />
                {indicator && <DirectionIcon indicator={indicator} className="size-5" />}
                {text === null ? (
                  <span className="truncate text-muted-foreground">{row.fallback?.(s) ?? NOT_REPORTED}</span>
                ) : (
                  <span className="truncate font-semibold" title={text}>
                    {text}
                  </span>
                )}
                {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
              </span>
              {value && <span className="text-right text-sm font-bold whitespace-nowrap tabular-nums">{value}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A compare topic card's rows (lib/compare-cards.ts): bars as CompareMetric rows, score ranges on a shared axis, and
 * text lines, each label cited to its field (dataset-wide: each college's own year is on its topic page and the table).
 */
export function CompareCardRows({ rows, schools, citeField }: { rows: readonly CardRow[]; schools: School[]; citeField: (path: FieldPath) => Cited }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const cited = citeField(row.field);
        if (row.kind === "range") return <RangeRows key={row.label} row={row} schools={schools} cited={cited} />;
        if (row.kind === "text") return <TextRows key={row.label} row={row} schools={schools} cited={cited} />;
        return (
          <CompareMetric
            key={row.label}
            variant="row"
            label={row.label}
            term={row.term}
            cited={cited}
            schools={schools}
            get={row.get}
            format={row.format}
            max={row.max}
            flag={row.flag}
          />
        );
      })}
    </div>
  );
}
