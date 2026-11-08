import { HelpTip } from "@/components/admin/HelpTip";
import { cn } from "@/lib/utils";
import { statusChips, type ChipTone } from "@/lib/admin/console";
import type { HelpKey } from "@/lib/admin/help";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
  good: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  warn: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
  danger: "bg-destructive/10 text-destructive",
};

/**
 * A small status pill: Paused, Deleting in 12 days, Invited, No account yet, Admin. The label says it; tone is never the
 * only signal. `help` puts the console's (i) icon beside a chip whose word isn't plain English (Held, Stale, Failing).
 */
export function StatusChip({ label, tone = "neutral", className, help }: { label: string; tone?: ChipTone; className?: string; help?: HelpKey }) {
  const chip = <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>{label}</span>;
  if (!help) return chip;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {chip}
      <HelpTip help={help} />
    </span>
  );
}

/** The chips for a search result's status ("active" has none). */
export function StatusChips({ status }: { status: string }) {
  return (
    <>
      {statusChips(status).map((c) => (
        <StatusChip key={c.label} {...c} />
      ))}
    </>
  );
}
