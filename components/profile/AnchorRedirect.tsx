"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ANCHOR_TOPICS, topicHref } from "@/lib/profile-topics";
import { track } from "@/lib/analytics";

/**
 * Keeps the single-page profile's anchors working (specs/profile-redesign.md#routes): a visit to
 * `/schools/{id}#scores` lands on the admissions page at its test-scores block. Anchors that still live on the
 * overview (overview, ranks, similar) are left alone.
 */
export function AnchorRedirect({ unitId }: { unitId: string }) {
  const router = useRouter();
  // One report per redirect: React's development double-run of effects (and a router change) must not count it twice.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const anchor = window.location.hash.replace(/^#/, "");
    const target = anchor ? ANCHOR_TOPICS[anchor] : undefined;
    if (!target) return;
    if (reported.current !== `${unitId}#${anchor}`) {
      reported.current = `${unitId}#${anchor}`;
      track("profile_card_opened", { unit_id: unitId, topic: target.topic, from: "anchor" });
    }
    router.replace(topicHref(unitId, target.topic, target.hash));
  }, [router, unitId]);
  return null;
}
