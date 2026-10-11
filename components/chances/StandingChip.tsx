"use client";

import Link from "next/link";
import { StandingBadge } from "@/components/chances/StandingBadge";
import { useStanding } from "@/components/chances/useStanding";
import { InfoTip } from "@/components/ui/info-tip";
import { noteText } from "@/lib/chances/notes";
import { cn } from "@/lib/utils";

/**
 * "Where you stand: Target" in the profile hero and on the overview's admissions card (specs/product/chances-and-fit.md
 * "Display"), linking to the Admissions page's card. Only for a visitor with numbers (the signed-in profile or the one
 * kept in the browser); the college pages are static, so it appears after the estimate comes back, and shows nothing
 * until then. Words always carry the group; the tint is only a tint.
 */
export function StandingChip({ unitId, className }: { unitId: string; className?: string }) {
  const s = useStanding(unitId);
  if (s.status !== "ready" || !s.result.group) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Link
        href={`/schools/${unitId}/admissions#standing`}
        aria-label={`${noteText({ key: "estimate.card_title", values: {} })}: ${noteText({ key: "estimate.card_chip", values: { group: s.result.label === "guaranteed" ? "guaranteed for you" : s.result.label === "reach-for-everyone" ? "reach for everyone" : s.result.group } })}`}
        className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold"
      >
        <span className="text-muted-foreground">{noteText({ key: "estimate.card_title", values: {} })}</span>
        <StandingBadge result={s.result} />
      </Link>
      <InfoTip term="quads-estimate" />
    </span>
  );
}
