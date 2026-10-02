import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Quiet reminder near Explore/Compare's source note (specs/data-lineage.md#not-built-yet, now built): these views
 * always use the federal baseline, never a college's own newer figures (those appear only on its profile).
 */
export function BaselineNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-muted-foreground", className)}>
      Comparisons use federal data, the newest year every college reports. Newer figures some colleges publish appear
      only on their profiles.{" "}
      <Link href="/data#compare" className="font-medium hover:text-primary hover:underline">
        Why
      </Link>
    </p>
  );
}
