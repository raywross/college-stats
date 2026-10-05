import Link from "next/link";
import { formatBy } from "@/lib/format";
import type { ConferenceGlanceKey } from "@/lib/trends";
import { Term } from "@/components/ui/info-tip";
import { measureInfo } from "./measures";

/**
 * "Members compared" (specs/trends/conferences.md): one small bar chart per measure, members sorted high to low, the
 * conference median as a dashed rule. One hue per chart (the measure's domain color); values printed on every row,
 * so no hover is needed. Members without a value are listed under the chart.
 */
export function MembersCompared({
  measures,
  members,
}: {
  measures: { key: ConferenceGlanceKey; sub: string; median: number | null; values: { id: string; name: string; value: number | null }[] }[];
  members: number;
}) {
  return (
    <div className="grid gap-4 max-sm:gap-3 max-sm:rail md:grid-cols-2 xl:grid-cols-3">
      {measures.map((m) => {
        const info = measureInfo(m.key);
        const rows = m.values.filter((v) => v.value !== null).sort((a, b) => b.value! - a.value! || a.name.localeCompare(b.name));
        const missing = m.values.filter((v) => v.value === null);
        const hi = info.share ? 1 : Math.max(...rows.map((r) => r.value!), 0) || 1;
        return (
          <figure key={m.key} className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption>
              <p className="text-sm font-semibold">
                <Term term={info.term}>{info.label}</Term>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {m.sub} · {rows.length} of {members} members
              </p>
            </figcaption>
            <ul className="relative mt-3 space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                  <Link href={`/schools/${r.id}`} className="truncate hover:text-primary hover:underline" title={r.name}>
                    {r.name}
                  </Link>
                  <span className="relative h-2.5">
                    <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(1, (r.value! / hi) * 100)}%`, background: info.color }} />
                    {m.median !== null && (
                      <span aria-hidden className="absolute -inset-y-0.5 border-l border-dashed border-foreground/60" style={{ left: `${(m.median / hi) * 100}%` }} />
                    )}
                  </span>
                  <span className="text-right tabular-nums">{formatBy(info.format, r.value!)}</span>
                </li>
              ))}
            </ul>
            {m.median !== null && <p className="mt-2 text-[11px] text-muted-foreground">Dashed: the median member, {formatBy(info.format, m.median)}.</p>}
            {missing.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Not reported: {missing.map((x) => x.name).join(", ")}.</p>}
          </figure>
        );
      })}
    </div>
  );
}
