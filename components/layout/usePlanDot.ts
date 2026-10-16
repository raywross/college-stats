"use client";

/**
 * The header's and the bottom nav's Plan dot (specs/planner/redesign/page.md "Navigation"; next-steps
 * notifications.md "Channels"): whether a deadline is due within a week or a move was added since the plan was last
 * opened, fetched client-side after mount from `/api/plan/next`, never computed on the server, so public pages stay
 * static. Signed-out visitors and any fetch error read as false.
 *
 * Performance pass (2026-10-16): the answer is kept in sessionStorage for `DOT_TTL_MS`, so moving between pages
 * doesn't ask the server again each time (every page mounted both the header and the bottom nav, two calls). Opening
 * the plan clears it (components/planner/PlanOpened.tsx records the open, which is what changes the answer), and a
 * private window or blocked storage just asks every time.
 */
import { useEffect, useState } from "react";

export type PlanDot = { dueSoon: boolean; deadline?: boolean; newMove?: boolean };

export const DOT_STORAGE_KEY = "plan-dot";
export const DOT_TTL_MS = 5 * 60_000;

function readStored(now: number): PlanDot | null {
  try {
    const raw = sessionStorage.getItem(DOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: PlanDot };
    return typeof parsed.at === "number" && now - parsed.at < DOT_TTL_MS && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

function store(data: PlanDot, now: number) {
  try {
    sessionStorage.setItem(DOT_STORAGE_KEY, JSON.stringify({ at: now, data }));
  } catch {
    /* storage blocked: nothing remembered */
  }
}

/** Forget the stored answer (after the plan was opened or a move was ticked, so the next page asks again). */
export function forgetPlanDot() {
  try {
    sessionStorage.removeItem(DOT_STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
}

/** Shared by Header.tsx and BottomNav.tsx; one fetch per page at most, usually none. */
export function usePlanDot(signedIn: boolean | undefined): { lit: boolean; label: string } {
  const [fetched, setFetched] = useState<PlanDot | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const stored = readStored(Date.now());
    // A stored answer resolves on the next tick like a fetched one (no synchronous setState inside the effect).
    const answer: Promise<PlanDot | null> = stored
      ? Promise.resolve(stored)
      : fetch("/api/plan/next", { cache: "no-store", credentials: "same-origin" })
          .then((r) => (r.ok ? (r.json() as Promise<PlanDot>) : null))
          .then((data) => {
            if (data) store(data, Date.now());
            return data;
          });
    answer
      .then((data) => {
        if (active) setFetched(data ?? null);
      })
      .catch(() => {
        if (active) setFetched(null);
      });
    return () => {
      active = false;
    };
  }, [signedIn]);
  const lit = Boolean(signedIn) && Boolean(fetched?.dueSoon);
  // The dot lights for a deadline within a week or a move added since the plan was last opened; its name says which.
  return { lit, label: fetched?.deadline ? "A deadline in the next 7 days" : "Something new on your plan" };
}
