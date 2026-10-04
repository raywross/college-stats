import Link from "next/link";
import type { School } from "@/lib/types";
import { Crest } from "@/components/school/Crest";
import { crestBrand } from "@/lib/brand";

/** Ranked list with value bars. One series, so one color and no legend. */
export function Leaderboard({
  schools,
  get,
  format,
  color,
  max,
}: {
  schools: School[];
  get: (s: School) => number | null;
  format: (v: number) => string;
  color: string;
  max?: number;
}) {
  const top = max ?? Math.max(1e-9, ...schools.map((s) => get(s) ?? 0));
  return (
    <ol className="space-y-1">
      {schools.map((s, i) => {
        const v = get(s) ?? 0;
        return (
          <li key={s.unit_id}>
            <Link
              href={`/schools/${s.unit_id}`}
              className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/70"
            >
              <span className="w-4 text-right text-xs font-bold text-muted-foreground tabular-nums">{i + 1}</span>
              <Crest id={s.unit_id} name={s.name} size="xs" brand={crestBrand(s)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium group-hover:text-primary">{s.name}</span>
                  <span className="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums">{format(v)}</span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}>
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${Math.max(3, (v / top) * 100)}%`, backgroundColor: color, animationDelay: `${i * 60}ms` }}
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
