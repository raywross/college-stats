import type { School } from "@/lib/types";
import type { ProgramEarnings } from "@/lib/field-of-study";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { money } from "@/lib/format";
import { MetricLabel } from "@/components/ui/info-tip";

/**
 * Compare "your major" (specs/data-expansion/field-of-study.md): pick one 4-digit field and compare earnings
 * across the compared colleges. A plain GET form (no client JS) keeps the choice in the URL (`?major=11.07`),
 * so the picked major survives a reload and is shareable like the rest of Compare's state.
 */
export function MajorPicker({ ids, options, selected }: { ids: string; options: { cip4: string; title: string }[]; selected: string | null }) {
  if (!options.length) return null;
  return (
    <form method="GET" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="ids" value={ids} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Your major</span>
        <select name="major" defaultValue={selected ?? ""} className="rounded-xl border bg-card px-3 py-2 text-sm">
          <option value="" disabled>
            Choose a field of study…
          </option>
          {options.map((o) => (
            <option key={o.cip4} value={o.cip4}>
              {o.title}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        Compare earnings
      </button>
    </form>
  );
}

/** One school's row: the program it offers for the picked major, or null when it doesn't offer that CIP at all. */
export interface MajorRow {
  school: School;
  slot: number;
  program: ProgramEarnings | null;
}

export function YourMajorBars({ title, rows }: { title: string; rows: MajorRow[] }) {
  const values = rows.map((r) => r.program?.earnings.y4 ?? r.program?.earnings.y1 ?? null);
  const top = Math.max(1, ...values.filter((v): v is number => v !== null));
  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <MetricLabel term="earnings-after-completion" className="mb-1 font-display text-base font-bold">
        {title}: earnings after completion
      </MetricLabel>
      <p className="mb-4 text-xs text-muted-foreground">4 years after completion where reported; 1 year otherwise.</p>
      <div className="space-y-2.5">
        {rows.map(({ school: s, slot, program }, i) => {
          const v = values[i];
          const note = program === null ? "Doesn't offer this major" : v === null ? "Too few graduates to report" : null;
          return (
            <div key={s.unit_id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[6rem_1fr_auto]">
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              <span className="h-3 overflow-hidden rounded-full bg-muted">
                {v !== null && (
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${Math.max(2, Math.min(100, (v / top) * 100))}%`, backgroundColor: SLOT_COLORS[slot], animationDelay: `${i * 80}ms` }}
                  />
                )}
              </span>
              <span className="text-right text-sm font-bold tabular-nums">{v === null ? <span className="font-normal text-muted-foreground">{note}</span> : money(v)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
