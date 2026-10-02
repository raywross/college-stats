/**
 * The Over time page's selected chart group, shared between `OverTime` (which owns the URL state and renders the
 * charts) and the side-column group list on desktop (`HistoryGroupNav`), which is a sibling in the page grid rather
 * than a child. A tiny external store: `OverTime` publishes its active group and listens for picks; the list reads it
 * with `useSyncExternalStore`. Nothing is persisted; `OverTime` publishes on mount, so stale values never show.
 */
import type { HistoryGroupKey } from "./history-groups";

let current: HistoryGroupKey | null = null;
const listeners = new Set<() => void>();

export function readHistoryGroup(): HistoryGroupKey | null {
  return current;
}

export function publishHistoryGroup(group: HistoryGroupKey): void {
  if (current === group) return;
  current = group;
  listeners.forEach((l) => l());
}

export function subscribeHistoryGroup(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
