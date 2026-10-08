import { AlertCircle } from "lucide-react";
import type { StuckSignal } from "@/lib/planner/summary";

/**
 * The stuck signals (specs/planner/parents.md "Stuck signals"): a quiet panel above This week, shown to the
 * guardian and to the student in the same words. Each line is a fact with a link where one applies, never a
 * judgment; nothing renders when there's nothing to say.
 */
export function StuckSignals({ signals }: { signals: StuckSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <section aria-labelledby="plan-stuck-signals" className="rounded-3xl border border-muted-foreground/20 bg-muted/30 p-4 sm:p-5">
      <h2 id="plan-stuck-signals" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <AlertCircle className="size-4" aria-hidden />
        Worth a look
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {signals.map((s) => (
          <li key={s.id}>
            {s.text}
            {s.link && (
              <a href={s.link} target="_blank" rel="noreferrer" className="ml-1.5 font-semibold text-primary underline-offset-2 hover:underline">
                Check
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
