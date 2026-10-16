"use client";

/** `plan_guide_opened {slug, from}`, once on mount (build-plan.md "The guide page"). Renders nothing. */
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import type { GuideFrom, GuideSlug } from "@/lib/planner/guides";

export function GuideOpened({ slug, from }: { slug: GuideSlug; from: GuideFrom }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track("plan_guide_opened", { slug, from });
  }, [slug, from]);
  return null;
}

export default GuideOpened;
