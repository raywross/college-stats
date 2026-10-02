"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { overviewHref, topicHref, type TopicKey } from "@/lib/profile-topics";
import { cn } from "@/lib/utils";

export interface TopicPill {
  key: TopicKey;
  label: string;
  color: string;
}

/**
 * Overview + one pill per topic page the college has; the current one filled. One swipeable row on phones with
 * the active pill scrolled into view (scrolling the row only, never the page).
 */
export function TopicPills({ unitId, current, pills, className }: { unitId: string; current: TopicKey | "overview"; pills: TopicPill[]; className?: string }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-key="${current}"]`);
    if (!list || !el) return;
    const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    if (Math.abs(list.scrollLeft - target) > 4) list.scrollLeft = Math.max(0, target);
  }, [current]);

  const all: { key: TopicKey | "overview"; label: string; href: string; color?: string }[] = [
    { key: "overview", label: "Overview", href: overviewHref(unitId) },
    ...pills.map((t) => ({ key: t.key, label: t.label, href: topicHref(unitId, t.key), color: t.color })),
  ];

  return (
    <nav aria-label="Profile topics" className={className}>
      <div ref={listRef} className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        {all.map((p) => {
          const active = p.key === current;
          return (
            <Link
              key={p.key}
              data-key={p.key}
              href={p.href}
              aria-current={active ? "page" : undefined}
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
