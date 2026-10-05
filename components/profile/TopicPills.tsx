"use client";

import { overviewHref, topicHref, type TopicKey } from "@/lib/profile-topics";
import { PillRow, type PillItem } from "@/components/ui/pill-row";

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
  const items: PillItem[] = [
    { key: "overview", label: "Overview", href: overviewHref(unitId) },
    ...pills.map((t) => ({ key: t.key, label: t.label, href: topicHref(unitId, t.key), color: t.color })),
  ];
  return <PillRow items={items} current={current} ariaLabel="Profile topics" className={className} />;
}
