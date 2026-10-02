import Link from "next/link";
import type { FormatKind } from "@/lib/format";
import type { YearKind } from "@/lib/history";
import { Sparkline } from "@/components/charts/Sparkline";

/**
 * A card's ten-year line (specs/profile-redesign.md#overview-page): a 60×16 sparkline of the window (from `sm`), a
 * bold label, the change in words, and a link to the history page. Replaces the hero's trend cards and the "10
 * years" tile; one per card at most.
 */
export function TenYearLine({
  label,
  text,
  spark,
  color,
  href,
}: {
  label: string;
  /** "+57% since fall 2014 · admit rate 6% → 4%" */
  text: string;
  spark?: { start: number; kind: YearKind; format: FormatKind; values: (number | null)[]; name: string } | null;
  color: string;
  href: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      {spark && (
        <div className="hidden w-[60px] shrink-0 overflow-hidden sm:block" aria-hidden>
          <Sparkline compact height={16} start={spark.start} kind={spark.kind} format={spark.format} label={`${spark.name} over ten years`} series={[{ name: spark.name, color, values: spark.values }]} />
        </div>
      )}
      <span className="min-w-0 flex-1">
        <b className="text-foreground">{label}</b> {text}
      </span>
      <Link href={href} className="shrink-0 font-semibold text-primary hover:underline">
        Over time
      </Link>
    </div>
  );
}
