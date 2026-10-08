"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { MeState } from "@/lib/accounts";

/**
 * The signed-in state for the header and More sheet, fetched from /api/me in the browser so public pages never read
 * cookies on the server (they stay static). One shared copy for every caller; re-checked on navigation (cheap: a
 * signed-out visitor's check never reaches Supabase). Null until the first answer.
 */
let current: MeState | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  inflight ??= fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<MeState>) : null))
    .catch(() => null)
    .then((me) => {
      // A failed check shows "Sign in" rather than nothing; the account pages decide for real.
      current = me ?? { configured: true, signedIn: false, id: null, name: null, email: null };
      listeners.forEach((l) => l());
    })
    .finally(() => {
      inflight = null;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMe(): MeState | null {
  const pathname = usePathname();
  const me = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(() => {
    load();
  }, [pathname]);
  return me;
}
