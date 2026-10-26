"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SIGNED_IN_COOKIE, type MeState } from "@/lib/accounts";

/**
 * The signed-in state for the header, the More sheet, and everything that changes with it, kept so the header never
 * waits on the network (specs/product/accounts.md "Header state"):
 * - The server sets a plain `quad_signed_in` cookie beside the session cookies (lib/supabase-server.ts, proxy.ts),
 *   the one cookie page scripts read. Without it the visitor is signed out: that answer is there at hydration and no
 *   request is made beyond one per tab, to learn whether sign-in is configured here.
 * - With it, the last answer from /api/me (kept in sessionStorage) shows at hydration and is asked again only once
 *   it is MEMO_TTL_MS old, after refreshMe(), or when the cookie and the answer disagree (just signed in or out).
 * Public pages never read cookies on the server, so they stay static. One shared copy for every caller; null until
 * the first answer (a signed-in person's first page in a new tab, while /api/me answers).
 */

const SIGNED_OUT: MeState = { configured: true, signedIn: false, id: null, name: null, email: null };
const STORAGE_KEY = "me";
const MEMO_TTL_MS = 5 * 60_000;

function hasSignedInCookie(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").includes(`${SIGNED_IN_COOKIE}=1`);
}

function readStored(): { at: number; data: MeState } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: MeState };
    return typeof parsed.at === "number" && parsed.data && typeof parsed.data.signedIn === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function store(data: MeState, at: number) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ at, data }));
  } catch {
    /* storage blocked: nothing remembered */
  }
}

let current: MeState | null = null;
let answeredAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The first answer, before any request: a stored one that agrees with the cookie, else what the cookie says. */
function initial(): MeState | null {
  const signedIn = hasSignedInCookie();
  const stored = readStored();
  if (stored && stored.data.signedIn === signedIn && Date.now() - stored.at < MEMO_TTL_MS) {
    answeredAt = stored.at;
    return stored.data;
  }
  return signedIn ? null : SIGNED_OUT;
}

// Module code runs once per page load in the browser, before any render; on the server there is no cookie to read.
if (typeof document !== "undefined") current = initial();

function set(me: MeState | null, at: number) {
  current = me;
  answeredAt = at;
  listeners.forEach((l) => l());
}

function load(force = false) {
  const signedIn = hasSignedInCookie();
  if (current && current.signedIn !== signedIn) {
    // Just signed in (show the placeholder while /api/me answers) or out (no request needed).
    set(signedIn ? null : SIGNED_OUT, 0);
  }
  const answered = answeredAt > 0;
  // Signed out and already answered (configured or not): the cookie is the only thing that can change that.
  if (!force && answered && !signedIn) return;
  if (!force && answered && Date.now() - answeredAt < MEMO_TTL_MS) return;
  inflight ??= fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<MeState>) : null))
    .catch(() => null)
    .then((me) => {
      // A failed check shows "Sign in" rather than nothing; the account pages decide for real.
      const next = me ?? SIGNED_OUT;
      const now = Date.now();
      if (me) store(me, now);
      set(next, now);
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

/** Ask /api/me again now (after the person changed their name on /account). */
export function refreshMe() {
  load(true);
}
