"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * A `Link` that prefetches on intent (hover, touch, or keyboard focus) instead of when it enters the viewport
 * (specs/serving-architecture.md "Prefetching"). Next's `prefetch={false}` turns off hover prefetching too, so this
 * starts at `false` and switches to the default (`null`) at the first sign of intent: the link is then in the
 * viewport, so Next prefetches it at once, a few hundred milliseconds before the click lands. The pattern is Next's own
 * ("Hover-triggered prefetch", node_modules/next/dist/docs/01-app/02-guides/prefetching.md). Use it for links to
 * heavy static pages (a college profile is 125–210 KB of payload, /data 184 KB) and for lists of many links.
 */
export function HoverPrefetchLink({ onMouseEnter, onTouchStart, onFocus, ...props }: Props) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
    />
  );
}
