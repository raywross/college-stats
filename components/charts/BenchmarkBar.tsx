import type { TermKey } from "@/lib/glossary";
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * A value on a fixed scale with the dataset median marked (Scorecard-style),
 * so a number is always read against a benchmark.
 */
export function BenchmarkBar({
  label,
  term,
  value,
  median,
  scale = [0, 1],
  format,
  color,
  size = "md",
  className,
}: {
  label: string;
  term?: TermKey;
  value: number;
  median?: number;
  scale?: [number, number];
  format: (v: number) => string;
  color: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [lo, hi] = scale;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const verdict =
    median === undefined
      ? null
      : Math.abs(value - median) / (hi - lo) < 0.03
        ? "About typical"
        : value > median
          ? "Above typical"
          : "Below typical";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <MetricLabel term={term} className={cn("font-medium", size === "sm" ? "text-xs" : "text-sm")}>
          {label}
        </MetricLabel>
        <span className={cn("font-semibold", size === "sm" ? "text-sm" : "text-lg")}>{format(value)}</span>
      </div>
      <div className="relative">
        <div
          className={cn("relative overflow-hidden rounded-full", size === "sm" ? "h-2" : "h-3")}
          style={{ backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)` }}
        >
          <div
            className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full"
            style={{ width: `${pos(value)}%`, backgroundColor: color }}
          />
        </div>
        {median !== undefined && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${pos(median)}%` }}
            aria-hidden
          />
        )}
      </div>
      {median !== undefined && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            <span className="mr-1 inline-block h-2.5 w-0.5 translate-y-0.5 rounded-full bg-foreground" />
            National median: <span className="font-medium text-foreground">{format(median)}</span>
          </span>
          <span className="font-medium">{verdict}</span>
        </div>
      )}
    </div>
  );
}
