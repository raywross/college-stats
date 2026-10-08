import { windowBar } from "@/lib/planner/timeline";

/**
 * A window drawn across its months (specs/planner/timeline.md "Display": "Windows show as a bar across their
 * months"): a row of month cells with the window as a filled bar and today as a tick. Decorative (the row already
 * says the dates in words), so hidden from screen readers. No hooks: server and client components both render it.
 */
export function WindowBar({ start, end, today }: { start: string; end: string; today: string }) {
  const bar = windowBar(start, end, today);
  return (
    <div aria-hidden className="mt-1.5 max-w-sm">
      <div className="relative h-2 rounded-full bg-muted">
        <div className="absolute inset-y-0 rounded-full bg-primary/60" style={{ left: `${bar.from * 100}%`, width: `${Math.max(2, (bar.to - bar.from) * 100)}%` }} />
        {bar.today !== null && <div className="absolute -inset-y-0.5 w-0.5 rounded bg-foreground" style={{ left: `${bar.today * 100}%` }} />}
      </div>
      <div className="mt-0.5 flex text-[10px] text-muted-foreground">
        {bar.months.map((m, i) => (
          <span key={`${m}-${i}`} className="flex-1 truncate">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
