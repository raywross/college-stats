"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface PillItem {
  key: string;
  label: string;
  href: string;
  /** The dot before the label (a domain color); none for Overview. */
  color?: string;
}

/**
 * A row of page pills, the current one filled (the profile's topic pills, the compare header's). One swipeable row
 * on phones with the active pill scrolled into view (scrolling the row only, never the page).
 */
export function PillRow({
  items,
  current,
  ariaLabel,
  className,
  onSelect,
}: {
  items: PillItem[];
  current: string;
  ariaLabel: string;
  className?: string;
  /** Called with the pill's key when it's clicked (usage measurement, specs/product/telemetry.md); the link still navigates. */
  onSelect?: (key: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-key="${current}"]`);
    if (!list || !el) return;
    const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    if (Math.abs(list.scrollLeft - target) > 4) list.scrollLeft = Math.max(0, target);
  }, [current]);

  return (
    <nav aria-label={ariaLabel} className={className}>
      <div ref={listRef} className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        {items.map((p) => {
          const active = p.key === current;
          return (
            <Link
              key={p.key}
              data-key={p.key}
              href={p.href}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect?.(p.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors sm:px-3.5 sm:text-sm",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {p.color && <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />}
              {p.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
