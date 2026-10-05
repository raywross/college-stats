import Link from "next/link";
import { crestBrand } from "@/lib/brand";
import { historyYearLabel } from "@/lib/history";
import { formatMoverChange, formatMoverValue, type MoverEntry, type MoverListDef, type MoverResult } from "@/lib/movers";
import type { School } from "@/lib/types";
import { Crest } from "@/components/school/Crest";

/**
 * Ranked rows of a movers list: rank, crest, name, the change as a bar (scaled to `max`, the list's largest change),
 * and from → to with the years. Leaderboard's row shape plus a from → to line. One series per list, so one color.
 */
export function MoverRows({
  def,
  list,
  entries,
  schools,
  max,
  start = 1,
}: {
  def: MoverListDef;
  list: Pick<MoverResult, "from" | "kind">;
  entries: readonly MoverEntry[];
  schools: ReadonlyMap<string, School>;
  max: number;
  /** The `<ol>` start (the rank of the first row's position). */
  start?: number;
}) {
  const late = (e: MoverEntry) => e.since !== list.from;
  return (
    <ol start={start} className="space-y-0.5">
      {entries.map((e, i) => {
        const school = schools.get(e.unit_id);
        const width = max > 0 ? Math.max(3, (Math.abs(e.change) / max) * 100) : 3;
        return (
          <li key={e.unit_id}>
            <Link href={`/schools/${e.unit_id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/70">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground tabular-nums">{e.rank}</span>
              <Crest id={e.unit_id} name={e.name} size="xs" brand={school ? crestBrand(school) : undefined} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium group-hover:text-primary">{school?.name ?? e.name}</span>
                  <span className="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums">{formatMoverChange(def, e.change)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                  {formatMoverValue(def, e.from)}
                  {late(e) && <> ({historyYearLabel(e.since, list.kind).replace(/^Entered f/, "f").replace(/^F/, "f")})</>} → {formatMoverValue(def, e.to)}
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${def.color} 14%, transparent)` }}>
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${width}%`, backgroundColor: def.color, animationDelay: `${Math.min(i, 10) * 50}ms` }}
                  />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
