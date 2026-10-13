"use client";

import { useEffect } from "react";
import { VIEW_REPEAT_MS, type ViewPage } from "@/lib/college-views";

/**
 * Tells the server once that this college page was opened (specs/product/college-views.md). Sends nothing when the
 * browser carries a privacy signal (Global Privacy Control or Do Not Track), and nothing again for the same page in
 * this tab within VIEW_REPEAT_MS. Renders nothing.
 */
export function ViewBeacon({ unit, page }: { unit: string; page: ViewPage }) {
  useEffect(() => {
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
    const key = `quad:view:${unit}:${page}`;
    try {
      const last = Number(sessionStorage.getItem(key));
      if (last && Date.now() - last < VIEW_REPEAT_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage blocked: send anyway; the server folds a signed-in person's repeats.
    }
    void fetch("/api/college-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit, page }),
      keepalive: true,
    }).catch(() => {});
  }, [unit, page]);
  return null;
}
