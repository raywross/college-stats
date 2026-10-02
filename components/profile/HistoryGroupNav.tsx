"use client";

import { useSyncExternalStore } from "react";
import { HISTORY_GROUP_LABELS, type HistoryGroupKey } from "@/lib/history-groups";
import { publishHistoryGroup, readHistoryGroup, subscribeHistoryGroup } from "@/lib/history-group-store";
import { cn } from "@/lib/utils";

/**
 * The Over time page's side column from `lg` (the place "On this page" takes on the other topic pages): one entry per
 * chart group with data, the active one marked, each a pick rather than a jump. Below `lg` it renders nothing; the
 * pill row inside `OverTime` does the same job there. State is shared with `OverTime` through lib/history-group-store.
 */
export function HistoryGroupNav({ groups, colors, initial }: { groups: HistoryGroupKey[]; colors: Record<HistoryGroupKey, string>; initial: HistoryGroupKey }) {
  const active = useSyncExternalStore(subscribeHistoryGroup, readHistoryGroup, () => initial) ?? initial;
  return (
    <nav aria-label="Chart groups" className="sticky hidden lg:block" style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--header-h) + 7rem)" }}>
      <p className="mb-2 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Chart groups</p>
      <ol className="flex flex-col gap-0.5">
        {groups.map((g) => (
          <li key={g}>
            <button
              type="button"
              onClick={() => publishHistoryGroup(g)}
              aria-current={active === g ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border-l-2 py-1.5 pr-2 pl-3 text-left text-sm transition-colors",
                active === g ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[g] }} aria-hidden />
              {HISTORY_GROUP_LABELS[g]}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
