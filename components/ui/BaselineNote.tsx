import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Quiet reminder near Explore/Compare's source note (specs/data-lineage.md#not-built-yet, now built; revised by
 * specs/college-reported-round-2.md Decision 1): every figure is the newest its college has published, so years
 * can differ between colleges shown side by side.
 */
export function BaselineNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-muted-foreground", className)}>
      Figures are the newest each college has published; years can differ between colleges. Each value&apos;s{" "}
      <span className="font-semibold">ⓘ</span> shows its source and year.{" "}
      <Link href="/data#compare" className="font-medium hover:text-primary hover:underline">
        Why
      </Link>
    </p>
  );
}
