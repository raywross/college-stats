import { STATUS_LABELS, type HealthStatus } from "@/lib/admin/health-rules";
import type { RunTone } from "@/lib/admin/ops-view";
import { cn } from "@/lib/utils";

/**
 * Status is a word first and a mark second (charts.md: status color is only for warnings, text wears ink tokens): the
 * dot beside the word is hollow for Fresh, amber for Watch and Stale (Stale is a filled ring), red for Failing, so the
 * table reads without color. Shared by the Health table and the Operations lists; U3's own StatusChip may replace it.
 */
const DOT: Record<HealthStatus | "unjudged", string> = {
  fresh: "border border-muted-foreground/60",
  watch: "bg-warning/70",
  stale: "bg-warning ring-2 ring-warning/40",
  failing: "bg-destructive ring-2 ring-destructive/30",
  unjudged: "border border-dashed border-muted-foreground/60",
};

export function HealthChip({ status, className }: { status: HealthStatus | null; className?: string }) {
  const key = status ?? "unjudged";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium", className)}>
      <span aria-hidden className={cn("size-2.5 rounded-full", DOT[key])} />
      {status ? STATUS_LABELS[status] : "Not judged"}
    </span>
  );
}

const RUN_DOT: Record<RunTone, string> = {
  running: "bg-primary animate-pulse",
  ok: "border border-muted-foreground/60 bg-muted-foreground/30",
  failed: "bg-destructive ring-2 ring-destructive/30",
  other: "border border-dashed border-muted-foreground/60",
};

export function RunChip({ label, tone, className }: { label: string; tone: RunTone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium", className)}>
      <span aria-hidden className={cn("size-2.5 rounded-full", RUN_DOT[tone])} />
      {label}
    </span>
  );
}
