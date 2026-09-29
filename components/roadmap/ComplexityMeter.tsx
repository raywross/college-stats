import { COMPLEXITY, type Complexity } from "@/lib/roadmap";
import { cn } from "@/lib/utils";

/** Four bars, filled up to the spec's complexity, with its label. */
export function ComplexityMeter({
  value,
  showLabel = true,
  className,
}: {
  value: Complexity;
  showLabel?: boolean;
  className?: string;
}) {
  const { label } = COMPLEXITY[value];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex items-end gap-[3px]" role="img" aria-label={`Complexity: ${label}, ${value} of 4`}>
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={cn("w-[5px] rounded-full", n <= value ? "bg-primary" : "bg-border")}
            style={{ height: 6 + n * 3 }}
          />
        ))}
      </span>
      {showLabel && <span className="text-sm font-semibold whitespace-nowrap">{label}</span>}
    </span>
  );
}
