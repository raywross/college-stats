import { Sparkles } from "lucide-react";
import type { Standout } from "@/lib/insights";
import { DOMAINS } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export function StandoutChip({ standout, size = "sm" }: { standout: Standout; size?: "sm" | "md" }) {
  const color = DOMAINS[standout.domain].color;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-semibold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
      )}
      style={{
        borderColor: `color-mix(in oklch, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
      }}
    >
      <Sparkles className="size-3" style={{ color }} />
      {standout.label}
    </span>
  );
}
