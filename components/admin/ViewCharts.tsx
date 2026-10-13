import Link from "next/link";
import type { ViewDay } from "@/lib/admin/college-views";

/**
 * The console's two small view charts (specs/product/college-views.md). Colors are the site's compare slots, validated
 * as a pair in both themes: signed in --s1, signed out --s2. Server-rendered: the hover label is CSS (and the title
 * attribute), and a visually hidden table carries the same numbers for screen readers.
 */

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

/** Views per day as columns, signed in stacked under signed out, with a legend and per-day hover. */
export function DailyViews({ days, label }: { days: ViewDay[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.signedIn + d.signedOut));
  const anyOut = days.some((d) => d.signedOut > 0);
  const total = days.reduce((n, d) => n + d.signedIn + d.signedOut, 0);
  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {label}: {total.toLocaleString("en-US")} {total === 1 ? "view" : "views"}
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[var(--s1)]" aria-hidden /> Signed in
          </span>
          {anyOut && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--s2)]" aria-hidden /> Signed out
            </span>
          )}
        </span>
      </figcaption>
      <div className="flex h-24 items-end gap-[2px] border-b border-border" aria-hidden>
        {days.map((d) => {
          const n = d.signedIn + d.signedOut;
          const tip = `${dayLabel(d.day)}: ${n} ${n === 1 ? "view" : "views"}${d.signedOut ? ` (${d.signedIn} signed in, ${d.signedOut} signed out)` : ""}`;
          return (
            <div key={d.day} title={tip} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              {d.signedOut > 0 && <div className="w-full rounded-t-[3px] bg-[var(--s2)]" style={{ height: `${(d.signedOut / max) * 100}%` }} />}
              {d.signedIn > 0 && (
                <div
                  className={`w-full bg-[var(--s1)] ${d.signedOut > 0 ? "mt-[2px]" : "rounded-t-[3px]"}`}
                  style={{ height: `${(d.signedIn / max) * 100}%` }}
                />
              )}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm group-hover:block">
                {tip}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-hidden>
        <span>{days[0] ? dayLabel(days[0].day) : ""}</span>
        <span>{days.at(-1) ? dayLabel(days.at(-1)!.day) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Signed in</th>
            <th scope="col">Signed out</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{dayLabel(d.day)}</th>
              <td>{d.signedIn}</td>
              <td>{d.signedOut}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface BarRow {
  key: string;
  label: string;
  /** A second line under the label (an email, a last-viewed date). */
  sub?: string;
  value: number;
  href: string;
}

/** A ranked list as horizontal bars: label and count as text, the bar for scale. Each row links to its drill-in. */
export function TopBars({ rows, unit }: { rows: BarRow[]; unit: [one: string, many: string] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} className="group block rounded-lg outline-offset-2 hover:bg-muted/50">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium group-hover:underline">{r.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {r.value.toLocaleString("en-US")} {r.value === 1 ? unit[0] : unit[1]}
              </span>
            </span>
            {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
            <span className="mt-1 block h-1.5 rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-[var(--s1)]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
