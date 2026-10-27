/**
 * What a parent sees for the sample student: a presentational twin of the guardian's Next steps view (NextSteps.tsx
 * renders the student's own view for a guardian, owner 2026-10-16) with the season's whole list: the open moves, one
 * with the nudge pill (`NudgeButton`'s trigger look), and the "Done and skipped" fold opened, with its check marks and
 * "Skipped" day. Drawn, not wired: no store, no nudge is sent.
 */
import { Bell, Check } from "lucide-react";
import type { SampleParent as SampleParentData } from "./sample";

export function SampleParent({ parent, heading }: { parent: SampleParentData; heading: string }) {
  const foldCount = parent.done.length + parent.skipped.length;
  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-xl font-bold">{parent.title}</p>
        <p className="text-sm text-muted-foreground">{heading}</p>
      </div>
      <ul className="space-y-2">
        {parent.open.map((m) => (
          <li key={m.title} className="flex flex-wrap items-center justify-between gap-2 rounded-3xl bg-card px-4 py-3 ring-1 ring-border">
            <span className="min-w-0 font-semibold">{m.title}</span>
            {m.nudge && (
              <span className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold">
                <Bell className="size-3.5" aria-hidden /> Nudge
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-border">
        <p className="flex min-h-11 items-center text-sm font-semibold">Done and skipped ({foldCount})</p>
        <ul className="mt-1 space-y-2">
          {parent.done.map((t) => (
            <li key={t.title} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="truncate line-through">{t.title}</span>
              </span>
              <span className="shrink-0 text-xs">{t.label}</span>
            </li>
          ))}
          {parent.skipped.map((t) => (
            <li key={t.title} className="text-sm">
              <span className="block truncate">{t.title}</span>
              <span className="block text-xs text-muted-foreground">{t.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
