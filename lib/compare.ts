"use client";

import { useSyncExternalStore } from "react";
import { track } from "@/lib/analytics";
import { toggledCompare } from "@/lib/discovery-events";

/**
 * Compare list lives in localStorage so it survives navigation and reloads.
 * A custom "compare-updated" event keeps every subscribed component in sync
 * within the tab; the native "storage" event syncs across tabs.
 */

export const MAX_COMPARE = 4;
const KEY = "compareIds";
const EVENT = "compare-updated";
const EMPTY: string[] = [];

let cache: { raw: string | null; ids: string[] } = { raw: null, ids: EMPTY };

function read(): string[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.ids;
  let ids: string[] = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    ids = Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, MAX_COMPARE) : EMPTY;
  } catch {
    ids = EMPTY;
  }
  cache = { raw, ids };
  return ids;
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX_COMPARE)));
  } catch {
    /* storage unavailable: compare still works via URL */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function getCompareIds(): string[] {
  return read();
}

export function setCompareIds(ids: string[]) {
  write([...new Set(ids)]);
}

export function toggleCompare(id: string): string[] {
  const { ids, action } = toggledCompare(read(), id, MAX_COMPARE);
  write(ids);
  // A full list refuses the add: nothing changed, so nothing is reported.
  if (action) track("compare_changed", { action, count: ids.length });
  return ids;
}

export function clearCompare() {
  write([]);
  track("compare_changed", { action: "clear", count: 0 });
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useCompareIds(): string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
