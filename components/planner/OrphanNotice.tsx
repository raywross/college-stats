"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismiss } from "@/lib/planner/store";

/**
 * A generated step whose source disappeared (specs/planner/timeline.md "Rules": "Tufts no longer offers ED II in its
 * newest data"): shown once, as a line with "Got it", which dismisses the task so it stays hidden. Never deleted.
 */
export function OrphanNotice({ items, canEdit }: { items: { id: string; line: string }[]; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-2xl border border-pop bg-pop/10 p-3 text-sm print:hidden" aria-label="Steps that changed">
      {items.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">{o.line}</span>
          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await dismiss(o.id);
                  if (r.ok) router.refresh();
                })
              }
              className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold hover:bg-muted sm:min-h-8"
            >
              Got it
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
