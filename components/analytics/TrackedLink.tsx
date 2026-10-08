"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { markNextViewFrom, track, type AnalyticsEvent, type AnalyticsEvents, type NavigationSource } from "@/lib/analytics";

/**
 * A `next/link` that sends a registered event when clicked (specs/product/telemetry.md), for server components that
 * would otherwise render a plain `Link`. `viewFrom` marks how the next college view was reached.
 */
export function TrackedLink<K extends AnalyticsEvent>({
  event,
  properties,
  viewFrom,
  onClick,
  ...linkProps
}: { event: K; properties: AnalyticsEvents[K]; viewFrom?: NavigationSource } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...linkProps}
      onClick={(e) => {
        onClick?.(e);
        track(event, properties);
        if (viewFrom) markNextViewFrom(viewFrom);
      }}
    />
  );
}
