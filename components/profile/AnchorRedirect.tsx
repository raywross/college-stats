"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ANCHOR_TOPICS, topicHref } from "@/lib/profile-topics";

/**
 * Keeps the single-page profile's anchors working (specs/profile-redesign.md#routes): a visit to
 * `/schools/{id}#scores` lands on the admissions page at its test-scores block. Anchors that still live on the
 * overview (overview, ranks, similar) are left alone.
 */
export function AnchorRedirect({ unitId }: { unitId: string }) {
  const router = useRouter();
  useEffect(() => {
    const anchor = window.location.hash.replace(/^#/, "");
    const target = anchor ? ANCHOR_TOPICS[anchor] : undefined;
    if (target) router.replace(topicHref(unitId, target.topic, target.hash));
  }, [router, unitId]);
  return null;
}
