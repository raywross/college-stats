"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { TopicKey } from "@/lib/profile-topics";

/**
 * Reports which blocks of a topic page a visitor actually scrolls to (specs/product/telemetry.md): once per block
 * and visit, when at least half of it is on screen. Blocks that didn't render (no element with the id) are skipped.
 * Renders nothing.
 */
export function BlockViews({ unitId, topic, ids }: { unitId: string; topic: TopicKey; ids: string[] }) {
  // A stable dependency for the id list, so a new array with the same ids doesn't restart the observer.
  const key = ids.join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          observer.unobserve(e.target);
          track("profile_block_viewed", { unit_id: unitId, topic, block: e.target.id });
        }
      },
      { threshold: 0.5 }
    );
    for (const id of key.split("|")) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [unitId, topic, key]);
  return null;
}
