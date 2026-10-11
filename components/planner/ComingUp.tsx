import { BookMarked } from "lucide-react";
import { dayLabel, type CalendarCite, type CalendarEvent } from "@/lib/planner/calendar";
import { KID_VARS } from "@/lib/planner/colors";

/**
 * Coming up (specs/planner/redesign/calendar.md "Coming up"): the next events as a list, the accessible table view
 * of the chart above it and the first thing a phone shows. Each row carries the date, the mark's shape in its
 * color, the child's name chip (Everyone), the event's text, days to go, and — reachable here as well as from the
 * chart's tooltip — the date's source.
 */
export function ComingUp({
  events,
  everyone,
  today,
  names,
  colorFor,
  resolveCite,
}: {
  events: CalendarEvent[];
  everyone: boolean;
  today: string;
  names: Record<string, { name: string; colorSlot: 0 | 1 | 2 }>;
  /** The mark's fill color (colorBy "child" or "round", resolved the same way as the chart). */
  colorFor: (e: CalendarEvent) => string;
  resolveCite: (cite: CalendarCite) => { url: string } | null;
}) {
  return (
    <section className="rounded-3xl border bg-card p-4 sm:p-5">
      <h2 className="font-display text-lg font-bold">Coming up</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing dated yet.</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-sm">
          <caption className="sr-only">The next {events.length} dates on the plan, soonest first</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Date</th>
              {everyone && <th scope="col">Child</th>}
              <th scope="col">What</th>
              <th scope="col">Days to go</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e, i) => {
              const source = resolveCite(e.cite);
              const who = names[e.studentId];
              return (
                <tr key={i}>
                  <td className="w-16 py-2 pr-2 align-middle font-semibold tabular-nums">{dayLabel(e.date)}</td>
                  <td className="w-6 py-2 pr-2 align-middle">
                    <Shape shape={e.shape} color={colorFor(e)} />
                  </td>
                  {everyone && (
                    <td className="py-2 pr-2 align-middle">
                      {who && (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: KID_VARS[who.colorSlot] }}>
                          {who.name}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="min-w-0 py-2 pr-2 align-middle">{e.text}</td>
                  <td className="w-16 shrink-0 py-2 pr-2 align-middle text-xs text-muted-foreground tabular-nums">
                    {e.daysAway === 0 ? "today" : `${e.daysAway} day${e.daysAway === 1 ? "" : "s"}`}
                  </td>
                  <td className="w-8 py-2 align-middle text-right">
                    {source && (
                      <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Where the ${e.text} date comes from`} className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-primary">
                        <BookMarked className="size-3.5" aria-hidden />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="sr-only">Today is {dayLabel(today)}.</p>
    </section>
  );
}

function Shape({ shape, color }: { shape: CalendarEvent["shape"]; color: string }) {
  const c = color;
  if (shape === "test") return <span className="inline-block" style={{ width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: `10px solid ${c}` }} aria-hidden />;
  if (shape === "money")
    return (
      <span className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: c }} aria-hidden>
        $
      </span>
    );
  if (shape === "decision") return <span className="inline-block size-3 rounded-full border-2" style={{ borderColor: c }} aria-hidden />;
  return <span className="inline-block size-3 rotate-45" style={{ background: c }} aria-hidden />;
}

export default ComingUp;
